import {
  extractAttachmentText,
  formatElapsed,
  getDocumentSettings,
  nodeTextExtractionEngines,
  searchDocumentText,
} from "@/lib/documents";
import { deps } from "@/lib/wiring";
import { parseFlags } from "./parse-flags";

/** How many files one run reads unless `--limit` says otherwise. */
const DEFAULT_LIMIT = 100;

/**
 * Fills the Document Library's text index, and searches it (migration 0165).
 *
 *   documents-index-text                      # read every unindexed file, cheap path
 *   documents-index-text --limit 20
 *   documents-index-text --ocr                # also OCR the scans — SLOW
 *   documents-index-text --search "zottoli"   # query what has been indexed
 *   documents-index-text --scheduled         # only what the background job would do
 *   documents-index-text --dry-run
 *
 * `--dry-run` and `--ocr` take no value, and `parseFlags` consumes the token after
 * every `--flag`, so they go **last** — the same trap `documents-backfill-hashes`
 * documents. Hence the `args.includes` tests below rather than reading them off the
 * parsed flags.
 *
 * ## Why this exists alongside the OCR button
 *
 * The button reads one document, in front of a reader who is waiting. This reads the
 * whole library, unattended, and it is the right place to do bulk work: on the dev box
 * a scanned page costs ~3.7s and several times that on the DS223, so indexing 200
 * documents through the web UI would mean sitting on a spinner for an hour.
 *
 * It is also the escape hatch for the NAS's memory budget. Running this **here**, on a
 * Windows box with the database on the NAS, does the expensive recognition locally and
 * writes only the text — the 2GB NAS never allocates the ~320MB an OCR worker needs.
 *
 * ## Why OCR is opt-in
 *
 * Without `--ocr` this only reads embedded text layers: ~170ms per file, and most
 * filed documents (anything "Print to PDF") have one. Scans come back `needs-ocr` and
 * are left for a later run. That makes the default pass fast enough to run over a
 * whole library, and makes the expensive pass something you ask for deliberately.
 *
 * Re-running is safe and cheap: a file whose stored hash still matches its bytes is
 * skipped, so an interrupted run resumes where it stopped.
 */
export async function documentsIndexTextCommand(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const useOcr = args.includes("--ocr");
  const dryRun = args.includes("--dry-run");

  // A search is a different job from an index, but it belongs on the same command:
  // "what did indexing actually make findable?" is the question you ask right after
  // running it, and a second command would mean a second place to keep the query
  // syntax honest.
  const query = flags.search;
  if (query !== undefined && query !== "") {
    const hits = searchDocumentText(deps.documentsRepo, query);
    if (hits.length === 0) {
      console.log(`No indexed file contains "${query}".`);
      return;
    }
    console.log(`${hits.length} match(es) for "${query}":\n`);
    for (const hit of hits) {
      console.log(`  document ${hit.documentId} — ${hit.originalName}`);
      console.log(`    ${hit.snippet.replace(/\s+/g, " ").trim()}\n`);
    }
    return;
  }

  const root = getDocumentSettings(deps.moduleRepo, deps.moduleSettingsRepo).documentRoot;
  if (root.trim() === "") {
    console.error("No document folder is set. Set one in the module's Configuration.");
    process.exitCode = 1;
    return;
  }

  const limit = Number(flags.limit) || DEFAULT_LIMIT;
  // `--scheduled` asks for exactly what the background job sees: scans OCR has
  // already been run against and could not read are left out, so the list is what a
  // timer would actually do rather than everything that could be attempted. Useful
  // for checking what the job will pick up on its next pass. See migration 0166.
  const scheduled = args.includes("--scheduled");
  const pending = deps.documentsRepo.listUnindexedAttachments(limit, scheduled && useOcr);

  if (pending.length === 0) {
    console.log("Every attachment already has current text. Nothing to do.");
    return;
  }

  console.log(
    `${pending.length} file(s) to read${useOcr ? ", OCR enabled (slow)" : ""}${
      dryRun ? " — dry run, nothing will be written" : ""
    }.\n`,
  );

  if (dryRun) {
    for (const attachment of pending) {
      console.log(`  would read  ${attachment.originalName}`);
    }
    return;
  }

  const textDeps = {
    repo: deps.documentsRepo,
    files: { store: deps.documentFileStore, root },
    engines: nodeTextExtractionEngines,
  };

  let read = 0;
  let scans = 0;
  let failed = 0;
  const started = Date.now();

  for (const attachment of pending) {
    try {
      const run = await extractAttachmentText(textDeps, {
        attachmentId: attachment.id,
        useOcr,
      });
      const { status, charCount, source, confidence } = run.result;
      if (status === "extracted") {
        read += 1;
        const via = source === "ocr" ? `OCR ${Math.round(confidence ?? 0)}%` : "text layer";
        console.log(
          `  read        ${attachment.originalName} — ${charCount.toLocaleString()} chars (${via}, ${run.elapsed})`,
        );
      } else if (status === "needs-ocr") {
        scans += 1;
        console.log(`  scan        ${attachment.originalName} — no text layer${useOcr ? ", OCR found nothing" : ", run with --ocr"}`);
      } else if (status === "failed") {
        failed += 1;
        console.log(`  FAILED      ${attachment.originalName} — ${run.result.error}`);
      } else {
        console.log(`  skipped     ${attachment.originalName} — nothing readable`);
      }
    } catch (error) {
      // One unreadable file must not abandon the rest of the run — the same rule
      // `extractDocumentText` follows.
      failed += 1;
      console.log(
        `  FAILED      ${attachment.originalName} — ${
          error instanceof Error ? error.message : "could not be read"
        }`,
      );
    }
  }

  console.log(
    `\nRead ${read}, ${scans} still unreadable, ${failed} failed, in ${formatElapsed(
      Date.now() - started,
    )}.`,
  );
  if (scans > 0 && !useOcr) {
    console.log("Re-run with --ocr to recognise the scans.");
  }
}
