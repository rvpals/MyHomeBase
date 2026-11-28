// The real text-extraction engines: `unpdf` for a PDF's text layer, `tesseract.js`
// for OCR. The only file in the module that knows either library exists.
//
// ## Every import here is lazy, and that is not a style choice
//
// `wiring.ts` is imported by every page in the app. A top-level `import` of
// tesseract.js would therefore load 46MB of WASM glue on an ordinary page render and
// turn an OCR-only dependency into a boot-critical one. That exact mistake has been
// made here before with `sharp` — `icons/image-processor.ts` records it, and it cost
// an `ERR_DLOPEN_FAILED` on pages that had nothing to do with images. So both engines
// are reached through `await import()` inside the method that needs them.
//
// ## Measured costs (dev box, x64, Node 24)
//
//   unpdf text layer, 1-page lab report ....  167ms, +16MB RSS
//   tesseract.js worker init, model cached .. 248ms
//   OCR, same page rendered at 300 DPI ...... 3.7s, ~320MB peak RSS
//
// The NAS is a DS223 (aarch64, 2GB), so expect several times the OCR figure there.
// That is why `ocrImage` caps the pages it will read and why nothing calls it from an
// upload path.

import type { TextExtractionEngines } from "./text-extract";

/**
 * How many pages of one PDF OCR will read.
 *
 * A cap rather than the whole document because the NAS has 2GB and each page costs
 * seconds and a few hundred MB of transient RSS. Six covers the household's real
 * filings — a lab report, a lease, a form — and a 60-page scanned manual would
 * otherwise tie the box up for ten minutes to produce text nobody asked for.
 *
 * The reader is told when this bites rather than being handed a silent truncation.
 */
export const OCR_PAGE_LIMIT = 6;

/**
 * What the page is rendered at before recognition.
 *
 * Measured, not guessed: at 150 DPI the same page scored 83% confidence and 26/27 on
 * the search terms a reader would actually type; at 300 DPI it scored 89% and 27/27.
 * The extra ~1.2s per page buys the last missing term, and a term you cannot find is
 * the failure this feature exists to prevent.
 */
export const OCR_RENDER_DPI = 300;

/** PDF.js works in points (72/in); this is the scale that lands us at OCR_RENDER_DPI. */
const PDF_RENDER_SCALE = OCR_RENDER_DPI / 72;

/**
 * The OCR language. English only, deliberately.
 *
 * Each extra language is another ~5MB model fetched at runtime and a slower pass.
 * Adding one is a one-line change here plus vendoring its `.traineddata` — see the
 * note on `langPath` below.
 */
export const OCR_LANGUAGE = "eng";

/**
 * Where tesseract.js looks for `eng.traineddata`.
 *
 * **This matters for the NAS deploy.** Left unset, tesseract.js downloads the ~5MB
 * model from a CDN on first use and caches it in the process's working directory.
 * On the NAS that is a silent first-run network dependency behind DSM's reverse
 * proxy, and a failure mode that only appears the first time someone presses the
 * button. Setting `MYHOMEBASE_TESSDATA` to a folder holding `eng.traineddata` makes
 * the read local and offline.
 *
 * Unset in dev, where a one-off download is harmless.
 */
export function ocrModelFolder(): string | undefined {
  const configured = process.env.MYHOMEBASE_TESSDATA?.trim();
  return configured === "" ? undefined : configured;
}

/**
 * The options every tesseract.js worker in the app is created with.
 *
 * Shared with Admin -> Code Tester's dependency test, so that test exercises exactly
 * the configuration OCR runs with rather than a hand-copied one that can drift.
 *
 * **`gzip: false` is required whenever `langPath` is set.** tesseract.js defaults to
 * `gzip: true` and then asks for `<langPath>/eng.traineddata.gz`; the folder this app
 * vendors (`./tessdata`, shipped by `publish-nas.mjs`) holds the uncompressed
 * `eng.traineddata`. Without the flag, setting `MYHOMEBASE_TESSDATA` as the NAS guide
 * says made every OCR fail with `ENOENT ... eng.traineddata.gz` -- found by the
 * dependency test on 2026-11-27. Unset, the CDN download path is left alone.
 *
 * **`errorHandler` is always set, and that is not optional either.** Without one,
 * tesseract.js answers a worker-side failure with `throw Error(data)` inside its
 * message listener -- an UNCAUGHT exception in the server process, on top of the
 * rejected promise the caller already gets. In a server action that kills the
 * response, and the browser shows only "An unexpected response was received from the
 * server". With a handler the rejection is the only signal, and it is caught like any
 * other error. `onWorkerError` lets a caller log the raw payload as well.
 */
export function ocrWorkerOptions(onWorkerError?: (error: unknown) => void): {
  errorHandler: (error: unknown) => void;
  langPath?: string;
  gzip?: false;
} {
  const errorHandler = (error: unknown) => onWorkerError?.(error);
  const langPath = ocrModelFolder();
  return langPath ? { errorHandler, langPath, gzip: false } : { errorHandler };
}

/**
 * How long a worker may take to start before it is given up on. Generous: on the
 * DS223 (aarch64, 2GB) loading the WASM core and the 5MB model takes several times
 * the ~0.8s the dev box needs.
 */
export const OCR_WORKER_START_TIMEOUT_MS = 120_000;

/**
 * Starts a tesseract.js worker that FAILS when it can't start, instead of hanging.
 *
 * ## Why `createWorker` can't be awaited on its own
 *
 * tesseract.js 7 (`createWorker.js`) chains its startup as
 * `loadInternal().then(loadLanguage).then(initialize).then(resolve).catch(() => {})`,
 * and rejects the promise it returned only when the FIRST stage fails. A failure
 * while loading the language model -- a missing or wrong model file, a CDN that
 * can't be reached from the NAS -- is swallowed by that `.catch`. What happens next
 * depends on `errorHandler`:
 *
 * - none: the worker's rejection is rethrown with `throw Error(data)` inside a message
 *   listener -- uncaught, so the server process dies mid-request and the browser shows
 *   "An unexpected response was received from the server";
 * - set: nothing is thrown, and the returned promise NEVER SETTLES. The request hangs
 *   until a proxy times it out.
 *
 * So the first worker error before startup completes rejects here, as does
 * `OCR_WORKER_START_TIMEOUT_MS`. Found by Admin -> Code Tester's dependency test.
 * A worker that failed to start can't be terminated -- tesseract.js never hands it
 * over -- so its thread is left to the process; this is rare and bounded by retries.
 */
export async function startOcrWorker(
  hooks: {
    onWorkerError?: (error: unknown) => void;
    logger?: (message: { status: string; progress: number }) => void;
  } = {},
): Promise<import("tesseract.js").Worker> {
  const { createWorker } = await import("tesseract.js");

  let failStart: (error: Error) => void = () => {};
  const startFailed = new Promise<never>((_, reject) => {
    failStart = reject;
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`the OCR worker did not start within ${OCR_WORKER_START_TIMEOUT_MS / 1000}s`)),
      OCR_WORKER_START_TIMEOUT_MS,
    );
  });
  // Either may reject after the race is decided (a later worker error, say). Without a
  // handler that is an unhandled rejection, which Node also treats as fatal.
  startFailed.catch(() => {});
  timedOut.catch(() => {});

  const options = ocrWorkerOptions((error) => {
    hooks.onWorkerError?.(error);
    failStart(
      error instanceof Error
        ? error
        : new Error(`the OCR worker failed: ${typeof error === "string" ? error : JSON.stringify(error)}`),
    );
  });

  try {
    return await Promise.race([
      createWorker(OCR_LANGUAGE, undefined, hooks.logger ? { ...options, logger: hooks.logger } : options),
      startFailed,
      timedOut,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Loads PDF.js through `unpdf` and reads one document's text layer.
 *
 * `unpdf` rather than `pdfjs-dist` directly: it bundles a serverless build with no
 * dependencies and no DOM shims (3.2MB against 35MB), which is what lets this ship to
 * an aarch64 NAS that cannot compile anything.
 */
async function extractPdfText(data: Uint8Array): Promise<{ text: string; pageCount: number }> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  // A fresh copy: PDF.js transfers/detaches the buffer it is given, and the caller
  // still needs these bytes if this read comes back empty and OCR has to run.
  const pdf = await getDocumentProxy(Uint8Array.from(data));
  const { totalPages, text } = await extractText(pdf, { mergePages: true });
  return { text, pageCount: totalPages };
}

/**
 * Renders a PDF's pages to PNG so OCR has something to look at.
 *
 * Needed because tesseract.js reads images, not PDFs.
 *
 * **`canvasImport` is required, not optional.** PDF.js draws to a canvas, and Node has
 * none; without it `renderPageAsImage` throws `Parameter "canvasImport" is required in
 * Node.js environment`. `@napi-rs/canvas` is the third native module in the tree, after
 * `better-sqlite3` and `sharp` — it publishes a `linux-arm64-gnu` prebuild, so the NAS
 * downloads a binary rather than compiling one, which is the only reason this is
 * deployable there at all. `publish-nas.mjs` fetches and verifies it alongside the
 * other two.
 *
 * `sharp` cannot stand in: its prebuilt libvips has no PDF loader. Measured — it
 * refuses a PDF buffer with "unsupported image format".
 *
 * Measured cost: ~1.9s per page at 300 DPI on the dev box, on top of the OCR itself.
 */
async function renderPdfPages(data: Uint8Array): Promise<Uint8Array[]> {
  const { getDocumentProxy, renderPageAsImage } = await import("unpdf");
  const canvasImport = () => import("@napi-rs/canvas");
  const pdf = await getDocumentProxy(Uint8Array.from(data));
  const pages = Math.min(pdf.numPages, OCR_PAGE_LIMIT);
  const out: Uint8Array[] = [];
  for (let page = 1; page <= pages; page += 1) {
    // One page at a time, and pushed straight into the array: holding every rendered
    // page of a long document at 300 DPI is exactly how a 2GB box runs out of memory.
    const image = await renderPageAsImage(Uint8Array.from(data), page, {
      scale: PDF_RENDER_SCALE,
      canvasImport,
    });
    out.push(new Uint8Array(image));
  }
  return out;
}

/**
 * Greyscales and normalises a page before recognition.
 *
 * Cheap (~0.4s at 300 DPI) and it lifts confidence on a photographed page with uneven
 * lighting. `sharp` is already a dependency and already has its arm64 prebuild fetched
 * by `publish-nas.mjs`. A failure here is non-fatal: the original bytes still OCR, so
 * a preprocessing problem degrades the read rather than losing it.
 */
async function preprocess(image: Uint8Array): Promise<Uint8Array> {
  try {
    const sharp = (await import("sharp")).default;
    const out = await sharp(Buffer.from(image)).greyscale().normalise().toBuffer();
    return new Uint8Array(out);
  } catch {
    return image;
  }
}

/**
 * Recognises text in an image, or in every page of a PDF up to `OCR_PAGE_LIMIT`.
 *
 * One worker for the whole call, terminated in a `finally`. tesseract.js's own README
 * is explicit that a worker per image leaks; on a 2GB NAS that is the difference
 * between a slow feature and an OOM-killed app.
 */
async function ocrImage(
  data: Uint8Array,
  mimeType: string,
): Promise<{ text: string; confidence: number }> {
  const pages =
    mimeType.toLowerCase().startsWith("application/pdf")
      ? await renderPdfPages(data)
      : [data];

  if (pages.length === 0) return { text: "", confidence: 0 };

  const worker = await startOcrWorker();
  try {
    const texts: string[] = [];
    const confidences: number[] = [];
    for (const page of pages) {
      const { data: recognised } = await worker.recognize(Buffer.from(await preprocess(page)));
      texts.push(recognised.text);
      confidences.push(recognised.confidence);
    }
    // Mean confidence across pages, which is what the reader is shown. A single bad
    // page in a six-page scan should pull the figure down, not be hidden by a max.
    const confidence =
      confidences.length === 0
        ? 0
        : confidences.reduce((sum, value) => sum + value, 0) / confidences.length;
    return { text: texts.join("\n\n"), confidence };
  } finally {
    await worker.terminate();
  }
}

/**
 * The engines as the use-cases take them.
 *
 * A plain object, built once: it holds no state, and both methods resolve their
 * library on the call rather than at construction, so creating this costs nothing at
 * import time. `wiring.ts` can hand it out freely.
 */
export const nodeTextExtractionEngines: TextExtractionEngines = {
  extractPdfText,
  ocrImage,
};
