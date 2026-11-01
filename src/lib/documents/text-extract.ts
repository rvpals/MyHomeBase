// Pulling readable text out of a filed attachment, for search and for the OCR button.
//
// Two paths, and the order matters:
//
//   1. **The embedded text layer.** Anything produced by "Print to PDF" — a bank
//      statement, an e-bill, a lab report — already carries its text. Reading it is
//      exact and costs milliseconds.
//   2. **OCR.** Only for pages that come back empty: a phone photo or a flatbed scan,
//      where the page is a picture of words and nothing else.
//
// Measured on the dev box against a 2-page lab report rendered both ways: the text
// layer took 167ms, OCR of the same page at 300 DPI took 3.7s. That 22x is the whole
// reason this file tries the cheap path first and never runs OCR speculatively. It is
// also why OCR is never on the upload path — see `documents-actions.ts`.
//
// ## Why the engines arrive as a port
//
// `TextExtractionEngines` is an interface rather than a direct import of `unpdf` and
// `tesseract.js` for the reason ARCHITECTURE.md gives for every other port: the
// use-cases have to be testable without the real thing. Both engines are heavy —
// tesseract.js alone unpacks to 46MB and holds ~320MB of RSS while it works — so a
// test that had to load them would be a test nobody runs. `test-fakes.ts` supplies a
// pair that return canned text.
//
// Nothing here imports `react` or `next`, and nothing here reads the filesystem: the
// caller hands the bytes in. That keeps this file callable identically from the web
// app and the CLI, which is the litmus test.

/** How the text was recovered. Stored, so a reader can tell an exact read from a guess. */
export type TextExtractionSource = "text-layer" | "ocr";

export type TextExtractionStatus =
  /** Text was recovered. `text` is non-empty. */
  | "extracted"
  /** A PDF with no text layer — a scan. The OCR path can still read it. */
  | "needs-ocr"
  /** Not a format this knows how to read. Never an error: a .zip has no text. */
  | "unsupported"
  /** The engine threw. `error` says what, and the caller shows it rather than a blank. */
  | "failed";

export interface TextExtractionResult {
  status: TextExtractionStatus;
  /** The recovered text, collapsed and trimmed. `""` for every status but `extracted`. */
  text: string;
  source: TextExtractionSource;
  /** Pages read. `0` when the format has no pages or nothing was read. */
  pageCount: number;
  /** `text.length`, stored so a list screen can show "how much" without the body. */
  charCount: number;
  /**
   * OCR's self-reported confidence, 0-100, or `undefined` for a text-layer read.
   *
   * Advisory only. Measured against a known lab report, 89% confidence still gave
   * 27/27 recall on the terms a reader would actually search for — the errors were
   * punctuation (`x10E3/uL` -> `x10E3/ul,`), not words. So this is shown to the
   * reader and never used to reject a result.
   */
  confidence?: number;
  /** Milliseconds the extraction took, for the button's "took 3.7s" line. */
  elapsedMs: number;
  /** Empty unless `status` is `failed`. */
  error: string;
}

/**
 * The two engines, injected.
 *
 * `extractPdfText` reads an embedded text layer and must NOT fall back to OCR — the
 * decision to spend 3.7s is the use-case's to make, not the adapter's. A silent
 * fallback here would make the cheap path indistinguishable from the expensive one,
 * which is the trap `OMR_method.md` records under "a silent fallback hides a dead
 * feature".
 */
export interface TextExtractionEngines {
  extractPdfText(data: Uint8Array): Promise<{ text: string; pageCount: number }>;
  /** Rasterises if needed and recognises. Returns text plus 0-100 confidence. */
  ocrImage(data: Uint8Array, mimeType: string): Promise<{ text: string; confidence: number }>;
}

/** PDFs carry a text layer worth trying. Everything else goes straight to its own path. */
const PDF_MIME = "application/pdf";

/** What `ocrImage` is willing to be handed. A scan arrives as one of these or a PDF. */
const OCR_IMAGE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/tiff",
  "image/bmp",
]);

/** Plain text needs no engine at all — the bytes already are the answer. */
const PLAIN_TEXT_MIMES = new Set(["text/plain", "text/markdown", "text/csv"]);

/**
 * How many characters a PDF must yield before its text layer is believed.
 *
 * A scanned PDF is rarely byte-for-byte empty: scanners leave a stray ligature, a page
 * number, or an invisible partial OCR layer from the scanning software. Treating "any
 * text at all" as success would mark those `extracted` and index three useless
 * characters, and the document would then never be OCR'd because it already has a row.
 *
 * 24 is deliberately low. The failure that matters is the false *positive* — calling a
 * scan "extracted" — and a genuine one-line document still clears it. A page that
 * really holds under 24 characters has nothing worth searching either way.
 */
export const MIN_TEXT_LAYER_CHARS = 24;

/**
 * Collapses extracted text to something worth storing and searching.
 *
 * PDF text layers arrive with the page's layout baked in as whitespace — a table
 * renders as a run of spaces and newlines wider than the words. Left alone it bloats
 * the index and makes a snippet unreadable. Newlines survive as single `\n` because a
 * reader scanning a result still wants its lines; everything else collapses.
 */
export function normaliseExtractedText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    // Horizontal runs collapse, but not across lines.
    .replace(/[^\S\n]+/g, " ")
    // Three or more blank lines are a layout artefact, never meaning.
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

function result(partial: Partial<TextExtractionResult> & { status: TextExtractionStatus }): TextExtractionResult {
  const text = partial.text ?? "";
  return {
    status: partial.status,
    text,
    source: partial.source ?? "text-layer",
    pageCount: partial.pageCount ?? 0,
    charCount: text.length,
    confidence: partial.confidence,
    elapsedMs: partial.elapsedMs ?? 0,
    error: partial.error ?? "",
  };
}

/**
 * Reads whatever text an attachment holds, WITHOUT running OCR.
 *
 * The cheap pass. A PDF with no usable text layer comes back `needs-ocr` rather than
 * being escalated here, so a caller that only wants to fill the search index can run
 * this over a whole library without ever paying for recognition.
 *
 * `now` is injected so the elapsed figure is testable — the same reason the journal's
 * date helpers take one.
 */
export async function extractText(
  engines: TextExtractionEngines,
  input: { data: Uint8Array; mimeType: string },
  now: () => number = Date.now,
): Promise<TextExtractionResult> {
  const started = now();
  const mime = input.mimeType.toLowerCase().split(";")[0]!.trim();

  if (input.data.byteLength === 0) {
    return result({ status: "unsupported", elapsedMs: now() - started });
  }

  if (PLAIN_TEXT_MIMES.has(mime)) {
    const text = normaliseExtractedText(Buffer.from(input.data).toString("utf8"));
    return result({
      status: text.length > 0 ? "extracted" : "unsupported",
      text,
      source: "text-layer",
      pageCount: 1,
      elapsedMs: now() - started,
    });
  }

  if (mime === PDF_MIME) {
    try {
      const { text, pageCount } = await engines.extractPdfText(input.data);
      const clean = normaliseExtractedText(text);
      // Under the floor means a scan: say so, and let the caller decide about OCR.
      if (clean.length < MIN_TEXT_LAYER_CHARS) {
        return result({ status: "needs-ocr", pageCount, elapsedMs: now() - started });
      }
      return result({
        status: "extracted",
        text: clean,
        source: "text-layer",
        pageCount,
        elapsedMs: now() - started,
      });
    } catch (error) {
      return result({
        status: "failed",
        elapsedMs: now() - started,
        error: error instanceof Error ? error.message : "That PDF could not be read.",
      });
    }
  }

  // An image is a scan by definition — there is no cheap path to try.
  if (OCR_IMAGE_MIMES.has(mime)) {
    return result({ status: "needs-ocr", elapsedMs: now() - started });
  }

  return result({ status: "unsupported", elapsedMs: now() - started });
}

/**
 * Reads an attachment's text, escalating to OCR when the cheap path finds nothing.
 *
 * This is what the OCR button calls. It is deliberately a separate export rather than
 * a flag on `extractText`, so that every call site that spends 3.7s is visible in a
 * grep rather than hidden behind an option someone passed `true` once.
 *
 * A `failed` text-layer read is NOT escalated: a PDF that threw is damaged, and
 * handing its bytes to OCR would spend the time to produce the same failure more
 * slowly. Only `needs-ocr` — a clean read that found nothing — goes on.
 */
export async function extractTextWithOcr(
  engines: TextExtractionEngines,
  input: { data: Uint8Array; mimeType: string },
  now: () => number = Date.now,
): Promise<TextExtractionResult> {
  const started = now();
  const first = await extractText(engines, input, now);
  if (first.status !== "needs-ocr") {
    // Re-stamp so the elapsed figure covers this call, not the inner one.
    return { ...first, elapsedMs: now() - started };
  }

  try {
    const { text, confidence } = await engines.ocrImage(input.data, input.mimeType);
    const clean = normaliseExtractedText(text);
    if (clean.length === 0) {
      // OCR ran and genuinely found no words. That is an answer, not a failure: a
      // photo of a wall has no text. `needs-ocr` would invite an endless retry.
      return result({
        status: "unsupported",
        source: "ocr",
        pageCount: first.pageCount,
        confidence,
        elapsedMs: now() - started,
      });
    }
    return result({
      status: "extracted",
      text: clean,
      source: "ocr",
      pageCount: first.pageCount,
      confidence,
      elapsedMs: now() - started,
    });
  } catch (error) {
    return result({
      status: "failed",
      source: "ocr",
      pageCount: first.pageCount,
      elapsedMs: now() - started,
      error: error instanceof Error ? error.message : "OCR could not read that file.",
    });
  }
}

/**
 * "3.7s", "820ms" — the figure the OCR button reports back.
 *
 * Here rather than in the view because the CLI prints it too, and a formatter that
 * lived in a `.tsx` would leave the CLI printing "3723".
 */
export function formatElapsed(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`;
}

/**
 * How many words a block of extracted text holds.
 *
 * Added for the system log's DEBUG lines (`lib/system-log`), which report what each
 * file's extraction produced. The stored row carries `charCount` and not this, and
 * deliberately so: nothing but the log asks "how many words", and a column would be
 * a migration plus a value to keep current for one diagnostic line.
 *
 * Counts runs of non-whitespace, which is the honest reading of "words" for text
 * that came out of a PDF: OCR output is full of fragments, and anything cleverer --
 * stripping punctuation, merging hyphenated line breaks -- would be guessing at
 * what the page meant in order to report a number nobody totals.
 */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed === "") return 0;
  return trimmed.split(/\s+/).length;
}
