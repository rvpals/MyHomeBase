// Reading a filed attachment's text and keeping the search index current.
//
// The use-cases the OCR button and the contents search sit on. Like every other file
// in `src/lib/`, these take data and ports and return data — the button is a caller,
// not a special case, and the same functions run from the CLI.
//
// ## The ordering rule, same shape as `documents.ts`
//
// The share holds the bytes, the database holds the text. They cannot be written
// together, so: **read the file, extract, THEN write the row.** A crash mid-extraction
// leaves no row, and the attachment simply looks unindexed — which is recoverable by
// pressing the button again. The reverse would leave a row claiming text that was
// never recovered.

import type { DocumentFileStore } from "./file-store";
import type { DocumentsRepository } from "./ports";
import type { SystemLogger } from "@/lib/system-log";
import {
  countWords,
  extractText,
  extractTextWithOcr,
  formatElapsed,
  type TextExtractionEngines,
  type TextExtractionResult,
} from "./text-extract";
import type { DocumentFiles } from "./documents";
import type { AttachmentText, AttachmentTextSearchHit } from "./types";

/**
 * What an extraction run reports back to whoever asked for it.
 *
 * Carries the attachment and its original name because the OCR button's dialog titles
 * itself with them, and a caller that already had the row should not have to re-read
 * it to draw a heading.
 */
export interface ExtractionRunResult {
  attachmentId: number;
  /** The file this text came out of, for the dialog's heading. */
  originalName: string;
  result: TextExtractionResult;
  /** "3.7s" — the figure the button shows. Formatted here so the CLI prints it too. */
  elapsed: string;
  /** True when the cached row was reused and nothing was re-extracted. */
  fromCache: boolean;
}

/** The ports an extraction needs: the index, the share, and the engines. */
export interface TextIndexDeps {
  repo: DocumentsRepository;
  files: DocumentFiles;
  engines: TextExtractionEngines;
  /**
   * Where a pass reports what it is doing, line by line (`lib/system-log`).
   *
   * **Optional**, and absent in every test and in the OCR button's call: this is a
   * diagnostic for the unattended job, which is the one path nobody watches. A
   * caller that supplies nothing gets no lines and pays nothing.
   *
   * Writes **both kinds**, split by how much a reader needs to know:
   *
   * - **OPERATIONAL** — "nothing to do", every file OCR ran against, every file that
   *   failed, and the pass total. The expensive and the broken, in other words: what
   *   you want without switching anything on.
   * - **DEBUG** — the pass's starting parameters, and files read instantly from an
   *   embedded text layer. A pass over 25 digital PDFs would otherwise write 25
   *   operational lines reporting that nothing took any time.
   *
   * The wrapper around `ScheduledRunRepository` also writes an operational
   * "Job finished" line carrying the same summary. The overlap is deliberate: that
   * wrapper only sees runs recorded in `sys_scheduled_runs`, and a CLI pass never
   * touches it, so relying on it alone would leave a manual run with per-file lines
   * and no total.
   */
  log?: SystemLogger;
}

function requireRoot(files: DocumentFiles): string {
  if (files.root.trim() === "") {
    throw new Error("No document folder is set. Set one in the module's Configuration.");
  }
  return files.root;
}

/**
 * Reads one attachment's text and stores it, running OCR when asked.
 *
 * `useOcr` is the whole difference between the cheap pass and the expensive one, and
 * it is an explicit argument rather than a default so every call site that can spend
 * seconds is visible in a grep.
 *
 * ## Why the cache check is a hash comparison, not a row check
 *
 * "Has this been indexed?" is the wrong question — an attachment can be re-uploaded
 * with different bytes under the same id. The right question is "does the stored text
 * describe the bytes that are there now?", which is what comparing `content_hash`
 * answers. A stale row is re-extracted; a current one is returned untouched, so
 * pressing the button twice costs one extraction.
 *
 * `force` overrides that, for a reader who wants to re-run OCR after the engine or
 * the DPI changed.
 */
export async function extractAttachmentText(
  deps: TextIndexDeps,
  input: { attachmentId: number; useOcr: boolean; force?: boolean },
): Promise<ExtractionRunResult> {
  const attachment = deps.repo.getAttachmentById(input.attachmentId);
  if (!attachment) throw new Error("That attachment no longer exists.");

  const cached = deps.repo.getAttachmentText(input.attachmentId);
  // A cached row is reusable when it describes the current bytes AND actually holds
  // text. A cached `needs-ocr` is NOT reusable on an OCR run: that is precisely the
  // row the reader is pressing the button to replace.
  const describesCurrentBytes =
    cached !== undefined && cached.contentHash !== "" && cached.contentHash === attachment.contentHash;
  const satisfiesRequest =
    describesCurrentBytes && (cached.status === "extracted" || !input.useOcr || cached.source === "ocr");

  if (satisfiesRequest && input.force !== true) {
    return {
      attachmentId: attachment.id,
      originalName: attachment.originalName,
      fromCache: true,
      elapsed: formatElapsed(cached.elapsedMs),
      result: {
        status: cached.status,
        text: cached.body,
        source: cached.source,
        pageCount: cached.pageCount,
        charCount: cached.charCount,
        confidence: cached.confidence,
        elapsedMs: cached.elapsedMs,
        error: cached.error,
      },
    };
  }

  const data = await deps.files.store.read(requireRoot(deps.files), attachment.relativePath);
  if (!data) {
    // A row whose file was moved or removed by hand is a normal state here, not a
    // crash — `readAttachment` treats it the same way.
    throw new Error(`The file for "${attachment.originalName}" is no longer on the share.`);
  }

  const bytes = new Uint8Array(data);
  const result = input.useOcr
    ? await extractTextWithOcr(deps.engines, { data: bytes, mimeType: attachment.mimeType })
    : await extractText(deps.engines, { data: bytes, mimeType: attachment.mimeType });

  // Row last — see the ordering note at the top of the file.
  deps.repo.putAttachmentText({
    attachmentId: attachment.id,
    documentId: attachment.documentId,
    body: result.text,
    status: result.status,
    source: result.source,
    pageCount: result.pageCount,
    charCount: result.charCount,
    confidence: result.confidence,
    elapsedMs: result.elapsedMs,
    contentHash: attachment.contentHash,
    error: result.error,
    // Records the ATTEMPT, not its outcome (migration 0166). `useOcr` is true
    // whenever the expensive path was available to this run, so a scan that came
    // back empty is marked as tried and a scheduled pass skips it next time.
    //
    // Deliberately not `result.source === "ocr"`: that only survives on a row where
    // OCR *succeeded*, so a failure would read as never-attempted and be recognised
    // again on every pass — exactly the treadmill this flag exists to stop.
    //
    // A text-layer hit does not set it: OCR never ran, because the cheap path
    // answered first and `extractTextWithOcr` returned before reaching it.
    ocrAttempted: input.useOcr && result.source !== "text-layer",
  });

  return {
    attachmentId: attachment.id,
    originalName: attachment.originalName,
    result,
    elapsed: formatElapsed(result.elapsedMs),
    fromCache: false,
  };
}

/**
 * Runs an extraction over every file on one document — what the row's OCR button does.
 *
 * Sequential, not `Promise.all`. OCR holds ~320MB of RSS per worker on the dev box and
 * the NAS has 2GB total; two in parallel is how a household app gets OOM-killed by
 * DSM. Slower and finishing is better than faster and dying.
 *
 * One failed attachment does not abandon the rest: a document holding a readable lease
 * and a corrupt scan should still end up with the lease searchable. Each file's
 * outcome is reported separately so the dialog can say which one failed.
 */
export async function extractDocumentText(
  deps: TextIndexDeps,
  input: { documentId: number; useOcr: boolean; force?: boolean },
): Promise<ExtractionRunResult[]> {
  const attachments = deps.repo.listAttachments(input.documentId);
  const out: ExtractionRunResult[] = [];
  for (const attachment of attachments) {
    try {
      out.push(
        await extractAttachmentText(deps, {
          attachmentId: attachment.id,
          useOcr: input.useOcr,
          force: input.force,
        }),
      );
    } catch (error) {
      out.push({
        attachmentId: attachment.id,
        originalName: attachment.originalName,
        fromCache: false,
        elapsed: formatElapsed(0),
        result: {
          status: "failed",
          text: "",
          source: "text-layer",
          pageCount: 0,
          charCount: 0,
          elapsedMs: 0,
          error: error instanceof Error ? error.message : "That file could not be read.",
        },
      });
    }
  }
  return out;
}

/**
 * Totals a run for the single line the dialog leads with.
 *
 * In the library rather than the view because the CLI prints the same summary, and a
 * formatter in a `.tsx` would leave the CLI assembling its own.
 */
export function summariseExtraction(results: ExtractionRunResult[]): string {
  if (results.length === 0) return "This document has no files to read.";

  const read = results.filter((r) => r.result.status === "extracted");
  const failed = results.filter((r) => r.result.status === "failed");
  const scans = results.filter((r) => r.result.status === "needs-ocr");
  const totalMs = results.reduce((sum, r) => sum + r.result.elapsedMs, 0);
  const chars = read.reduce((sum, r) => sum + r.result.charCount, 0);

  const parts: string[] = [];
  parts.push(
    read.length === results.length
      ? `Read ${read.length} file${read.length === 1 ? "" : "s"}`
      : `Read ${read.length} of ${results.length} files`,
  );
  if (chars > 0) parts.push(`${chars.toLocaleString()} characters`);
  if (scans.length > 0) parts.push(`${scans.length} still unreadable`);
  if (failed.length > 0) parts.push(`${failed.length} failed`);
  parts.push(`in ${formatElapsed(totalMs)}`);
  return `${parts.join(" · ")}.`;
}

/**
 * The document ids whose files contain this text.
 *
 * Returned as ids rather than joined here so `listDocuments` stays the single place
 * that shapes a `DocumentSummary` — this narrows the set, it does not build the list.
 *
 * Empty input is "no constraint", signalled by `undefined` rather than an empty array:
 * an empty array legitimately means "searched, matched nothing", and conflating the
 * two would make a search with no hits show the whole library.
 */
export function findDocumentIdsByContent(
  repo: DocumentsRepository,
  query: string,
): number[] | undefined {
  const trimmed = query.trim();
  if (trimmed === "") return undefined;
  return repo.searchAttachmentText(trimmed).map((hit) => hit.documentId);
}

/** The matching passages, for showing a reader *why* a document matched. */
export function searchDocumentText(
  repo: DocumentsRepository,
  query: string,
): AttachmentTextSearchHit[] {
  const trimmed = query.trim();
  if (trimmed === "") return [];
  return repo.searchAttachmentText(trimmed);
}

/** One attachment's stored text, for the viewer. */
export function getAttachmentText(
  repo: DocumentsRepository,
  attachmentId: number,
): AttachmentText | undefined {
  return repo.getAttachmentText(attachmentId);
}

/** Every stored extraction for one document, so a row can show what it knows. */
export function listDocumentText(
  repo: DocumentsRepository,
  documentId: number,
): AttachmentText[] {
  return repo.listAttachmentTextForDocument(documentId);
}

/**
 * Drops an attachment's cached text. Called when its file is removed.
 *
 * Separate from `deleteAttachment` on the port rather than folded into it, because the
 * recycle bin deletes attachment *rows* for a document that may come back — and a
 * restore that found its text still indexed is a feature, not a bug. Only a permanent
 * removal calls this.
 */
export function forgetAttachmentText(repo: DocumentsRepository, attachmentId: number): void {
  repo.deleteAttachmentText(attachmentId);
}

/** The source every line from this file carries, for the log's filter box. */
export const TEXT_INDEX_LOG_SOURCE = "documents/text-index";

/**
 * Whether a file's outcome is worth an OPERATIONAL line rather than a DEBUG one.
 *
 * The rule: **OCR ran, or something went wrong.** Those are the lines a reader wants
 * without switching DEBUG on — recognition is the expensive, slow, fallible path, and
 * "which document took forty seconds" is an operational question.
 *
 * A text-layer read is deliberately NOT operational. It costs about a sixth of a
 * second and always succeeds or it would not be here, so a pass over 25 digital PDFs
 * would otherwise write 25 operational lines that say nothing happened slowly. Those
 * stay on DEBUG, where a reader who wants the full trace can still find them.
 *
 * A cached hit is never operational whatever its source: no work was done this pass.
 */
function isOperationalOutcome(run: ExtractionRunResult): boolean {
  if (run.fromCache) return false;
  if (run.result.status === "failed") return true;
  // `needs-ocr` after an OCR attempt means recognition ran and recovered nothing —
  // worth reporting, because migration 0166 means it will not be tried again.
  return run.result.source === "ocr";
}

/**
 * One file's extraction as a DEBUG line.
 *
 * Reports the four things the stored row already knows but the admin card throws
 * away: which file, how long it took, how much text came back, and WHICH PATH it
 * took — a text-layer read costs about a sixth of a second and OCR costs seconds a
 * page, so a pass that feels slow is answered by this field alone.
 *
 * `words` is passed in rather than recomputed so the caller's running total and this
 * line can never disagree about the same file.
 *
 * Exported for its test. Nothing else calls it.
 */
export function describeIndexedFile(
  run: ExtractionRunResult,
  words: number,
  documentTitle?: string,
): string {
  const { result } = run;
  // The document is what a reader recognises; the file is what actually got read, and
  // a document can hold several. Naming both answers "which document is this?" and
  // "which of its files?" in one line. Falls back to the file alone when the caller
  // has no title to hand — the OCR button's dialog is already headed by the document.
  const name =
    documentTitle === undefined
      ? `"${run.originalName}"`
      : `"${documentTitle}" (${run.originalName})`;

  if (result.status === "failed") {
    return `Failed ${name} — ${result.error || "no reason given"} after ${run.elapsed}.`;
  }

  if (result.status === "needs-ocr") {
    // Not a failure: the file has no text layer and either OCR was off this pass or
    // it ran and recovered nothing. Migration 0166 means it will not be retried.
    return `No text in ${name} — ${result.pageCount} page${
      result.pageCount === 1 ? "" : "s"
    }, nothing recovered in ${run.elapsed}.`;
  }

  const parts = [
    `${result.pageCount} page${result.pageCount === 1 ? "" : "s"}`,
    `${words.toLocaleString()} word${words === 1 ? "" : "s"}`,
    `${result.charCount.toLocaleString()} chars`,
  ];

  // The confidence figure is advisory and only OCR reports one — see its note in
  // text-extract.ts. Shown because a low number is the first thing to look at when a
  // search misses a document that plainly contains the word.
  const via =
    result.confidence === undefined
      ? result.source
      : `${result.source}, ${Math.round(result.confidence)}% confidence`;

  // A cached hit did no work this pass; saying "in 0ms" would read as a fast
  // extraction rather than as no extraction at all.
  const timing = run.fromCache ? "from cache" : `in ${run.elapsed}`;

  // OCR gets its own wording. It is the slow, fallible path, and the line a reader
  // scans an operational log for is "what was recognised, and what did it cost" —
  // so the verb says recognition happened rather than burying it in a `via` clause.
  if (result.source === "ocr" && !run.fromCache) {
    const confidence =
      result.confidence === undefined ? "" : `, ${Math.round(result.confidence)}% confidence`;
    return `OCR on ${name} — ${parts.join(", ")}${confidence}, ${timing}.`;
  }

  return `Indexed ${name} — ${parts.join(", ")} via ${via} ${timing}.`;
}

/** What one unattended pass did, for the job's run record and the admin card. */
export interface TextIndexPassResult {
  /** Files looked at this pass. */
  considered: number;
  /** Files whose text was recovered. */
  read: number;
  /** Scans OCR was run against and could not read — each marked so it is not retried. */
  unreadable: number;
  failed: number;
  elapsedMs: number;
}

/**
 * One unattended indexing pass — what the scheduled job calls (migration 0166).
 *
 * Takes its work from `listUnindexedAttachments(limit, true)`, whose second argument
 * is the whole point: a scan OCR has already been run against and could not read is
 * **not** in the list, and stays out of it until the file itself changes. That is what
 * makes this safe to run on a timer. The OCR button is unaffected and still forces a
 * re-read on demand, because a person asking is not a timer asking.
 *
 * **Unthrottled by choice.** It drains the whole queue each run rather than capping
 * the pages it recognises. On the DS223 that means a backlog of scanned pages can
 * occupy the box for minutes at a time, and OCR holds ~320MB of RSS while it works —
 * so `limit` is the only brake, and the caller sets it per run rather than per page.
 * Sequential for the same reason `extractDocumentText` is: two workers at once on a
 * 2GB NAS is how this gets OOM-killed.
 *
 * Never throws. A scheduled job that takes the server down with it is worse than one
 * that skips a file, so every per-file failure is counted and the pass continues.
 */
export async function runTextIndexPass(
  deps: TextIndexDeps,
  input: { limit: number; useOcr: boolean },
  now: () => number = Date.now,
): Promise<TextIndexPassResult> {
  const started = now();
  // `true`: skip scans already attempted. The flag only means anything when OCR is
  // actually on — a cheap-only pass never attempts one, so there is nothing to skip.
  const pending = deps.repo.listUnindexedAttachments(input.limit, input.useOcr);

  const log = deps.log;

  // "Nothing to do" is OPERATIONAL and returns early.
  //
  // Worth a line of its own because it is the answer to the question this job
  // actually gets asked — "is it working, or is it stuck?". A pass that finds an
  // already-indexed library is the healthy steady state, and a log that stayed
  // silent about it would make a working scheduler indistinguishable from a dead
  // one. Cheap to say: it happens at most once per interval, not once a minute.
  if (pending.length === 0) {
    log?.operational(
      TEXT_INDEX_LOG_SOURCE,
      "Nothing to do — every filed document has already been indexed.",
    );
    return { considered: 0, read: 0, unreadable: 0, failed: 0, elapsedMs: now() - started };
  }

  log?.debug(
    TEXT_INDEX_LOG_SOURCE,
    () =>
      `Pass starting — ${pending.length} file${pending.length === 1 ? "" : "s"} to read, ` +
      `limit ${input.limit}, OCR ${input.useOcr ? "on" : "off"}.`,
  );

  let read = 0;
  let unreadable = 0;
  let failed = 0;
  let words = 0;

  // Document titles, resolved once each rather than once per file.
  //
  // A pass touches far fewer documents than files — a scanned lease is one document
  // and six attachments — so this turns what would be an N+1 read inside the loop
  // into one lookup per distinct document. Only consulted when a line is actually
  // going to be written.
  const titles = new Map<number, string>();
  const titleFor = (documentId: number): string | undefined => {
    const cached = titles.get(documentId);
    if (cached !== undefined) return cached;
    const title = deps.repo.getDocumentById(documentId)?.title;
    if (title !== undefined) titles.set(documentId, title);
    return title;
  };

  for (const attachment of pending) {
    try {
      const run = await extractAttachmentText(deps, {
        attachmentId: attachment.id,
        useOcr: input.useOcr,
      });
      if (run.result.status === "extracted") read += 1;
      else if (run.result.status === "failed") failed += 1;
      else unreadable += 1;

      // Counted whatever the outcome, so the pass total is the sum of its lines.
      // Computed here and never stored — see `countWords` in text-extract.ts for
      // why there is no column for it.
      const fileWords = countWords(run.result.text);
      words += fileWords;

      // One line per file: how long it took, how much came back, which path it took.
      // This is what the job could not answer before — the admin card says
      // "Read 10 of 12 in 48.2s" for the whole batch, which does not say WHICH file
      // spent forty of those seconds.
      //
      // OPERATIONAL when OCR ran or the file failed, DEBUG otherwise — see
      // `isOperationalOutcome`. Both kinds carry the same sentence, so turning DEBUG
      // on adds the quiet files rather than changing how the loud ones read.
      //
      // A thunk, so the title lookup above only happens when the line is actually
      // being written — an install with both switches off pays nothing for it.
      const line = () => describeIndexedFile(run, fileWords, titleFor(attachment.documentId));
      if (isOperationalOutcome(run)) log?.operational(TEXT_INDEX_LOG_SOURCE, line);
      else log?.debug(TEXT_INDEX_LOG_SOURCE, line);
    } catch (error) {
      failed += 1;
      // Always operational: a file the pass could not even read is the one thing
      // here nobody should have to switch DEBUG on to discover.
      log?.operational(
        TEXT_INDEX_LOG_SOURCE,
        () =>
          `Failed "${attachment.originalName}" — ` +
          `${error instanceof Error ? error.message : "that file could not be read."}`,
      );
    }
  }

  const elapsedMs = now() - started;

  // OPERATIONAL, and deliberately kept even though the scheduled-jobs wrapper writes
  // its own "Job finished" line carrying the same summary. That wrapper only sees
  // runs that go through `sys_scheduled_runs` — a CLI pass never touches it, so
  // relying on it would leave a manual run with per-file lines and no total.
  //
  // This one also carries the word count, which the run record does not store.
  log?.operational(
    TEXT_INDEX_LOG_SOURCE,
    () =>
      `Pass finished — ${pending.length} considered, ${read} read, ` +
      `${unreadable} unreadable, ${failed} failed, ` +
      `${words.toLocaleString()} words in ${formatElapsed(elapsedMs)}.`,
  );

  return {
    considered: pending.length,
    read,
    unreadable,
    failed,
    elapsedMs,
  };
}

/** One line for the job's run record — what Admin → Background Tasks shows. */
export function describeTextIndexPass(result: TextIndexPassResult): string {
  if (result.considered === 0) return "Nothing to index.";
  const parts = [`Read ${result.read} of ${result.considered}`];
  if (result.unreadable > 0) parts.push(`${result.unreadable} unreadable`);
  if (result.failed > 0) parts.push(`${result.failed} failed`);
  parts.push(`in ${formatElapsed(result.elapsedMs)}`);
  return `${parts.join(" · ")}.`;
}

/**
 * A store + root pair, as the OCR action builds one.
 *
 * Re-exported so a caller that already has `DocumentFiles` does not have to import
 * from `./documents` just to name the type.
 */
export type { DocumentFileStore };
