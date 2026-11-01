import { describe, expect, it } from "vitest";
import { FakeFileStore, FakeRepository } from "./test-fakes";
import {
  describeTextIndexPass,
  extractAttachmentText,
  extractDocumentText,
  runTextIndexPass,
  summariseExtraction,
  type TextIndexDeps,
} from "./text-index";
import type { TextExtractionEngines } from "./text-extract";

const ROOT = "/docs";

/**
 * A library holding one document with one PDF, plus the ports around it.
 *
 * `ocrText` and `layerText` are what the fake engines will return, so each test says
 * what the file "contains" in one line rather than wiring two stubs.
 */
function setup(options: {
  layerText?: string;
  ocrText?: string;
  ocrThrows?: string;
  contentHash?: string;
} = {}) {
  const repo = new FakeRepository();
  const store = new FakeFileStore();
  const document = repo.createDocument({
    title: "Lab report",
    description: "",
    categories: [],
    tags: [],
    createdBy: 1,
  });
  const attachment = repo.addAttachment({
    documentId: document.id,
    fileName: "report.pdf",
    originalName: "09-27-2016 (Dr Zottoli).pdf",
    relativePath: `doc_${document.id}/report.pdf`,
    mimeType: "application/pdf",
    byteSize: 4,
    contentHash: options.contentHash ?? "hash-v1",
  });
  store.files.set(attachment.relativePath, Buffer.from("%PDF"));

  let ocrCalls = 0;
  let layerCalls = 0;
  const engines: TextExtractionEngines = {
    extractPdfText: async () => {
      layerCalls += 1;
      return { text: options.layerText ?? "", pageCount: 2 };
    },
    ocrImage: async () => {
      ocrCalls += 1;
      if (options.ocrThrows !== undefined) throw new Error(options.ocrThrows);
      return { text: options.ocrText ?? "", confidence: 89 };
    },
  };

  const deps: TextIndexDeps = { repo, files: { store, root: ROOT }, engines };
  return {
    deps,
    repo,
    store,
    document,
    attachment,
    counts: () => ({ ocrCalls, layerCalls }),
  };
}

describe("extractAttachmentText", () => {
  it("stores what the text layer found and indexes it", async () => {
    const t = setup({ layerText: "Hemoglobin 15.3 g/dL  Ordering: S ZOTTOLI" });

    const run = await extractAttachmentText(t.deps, {
      attachmentId: t.attachment.id,
      useOcr: false,
    });

    expect(run.result.status).toBe("extracted");
    expect(run.result.source).toBe("text-layer");
    expect(run.fromCache).toBe(false);
    expect(run.originalName).toBe("09-27-2016 (Dr Zottoli).pdf");

    const stored = t.repo.getAttachmentText(t.attachment.id);
    expect(stored?.body).toContain("ZOTTOLI");
    // The hash is what later makes the cache trustworthy — a row without it would be
    // re-extracted every time.
    expect(stored?.contentHash).toBe("hash-v1");
  });

  it("reuses the cached text when the bytes have not changed", async () => {
    const t = setup({ layerText: "Readable lease agreement text" });

    await extractAttachmentText(t.deps, { attachmentId: t.attachment.id, useOcr: false });
    const second = await extractAttachmentText(t.deps, {
      attachmentId: t.attachment.id,
      useOcr: false,
    });

    expect(second.fromCache).toBe(true);
    // One extraction for two presses of the button.
    expect(t.counts().layerCalls).toBe(1);
  });

  it("re-extracts when the file's bytes changed under the same id", async () => {
    const t = setup({ layerText: "Original text that is long enough" });
    await extractAttachmentText(t.deps, { attachmentId: t.attachment.id, useOcr: false });

    // A re-upload: same attachment row, different bytes.
    t.repo.setAttachmentHash(t.attachment.id, "hash-v2");
    const run = await extractAttachmentText(t.deps, {
      attachmentId: t.attachment.id,
      useOcr: false,
    });

    // The cached row described bytes that are gone, so believing it would have served
    // the reader text from a file that no longer exists.
    expect(run.fromCache).toBe(false);
    expect(t.counts().layerCalls).toBe(2);
  });

  it("runs OCR on a scan and records it as an OCR read", async () => {
    const t = setup({ layerText: "", ocrText: "HUANG, MINLIANG Specimen ID 271-425-0584-0" });

    const run = await extractAttachmentText(t.deps, {
      attachmentId: t.attachment.id,
      useOcr: true,
    });

    expect(run.result.status).toBe("extracted");
    expect(run.result.source).toBe("ocr");
    expect(run.result.confidence).toBe(89);
    expect(t.repo.getAttachmentText(t.attachment.id)?.source).toBe("ocr");
  });

  it("does not run OCR when the caller did not ask for it", async () => {
    const t = setup({ layerText: "", ocrText: "should not run" });

    const run = await extractAttachmentText(t.deps, {
      attachmentId: t.attachment.id,
      useOcr: false,
    });

    expect(run.result.status).toBe("needs-ocr");
    expect(t.counts().ocrCalls).toBe(0);
  });

  it("re-runs OCR over a cached needs-ocr row rather than returning it", async () => {
    const t = setup({ layerText: "", ocrText: "Recovered by recognition" });

    // The cheap pass first: stores a `needs-ocr` row.
    await extractAttachmentText(t.deps, { attachmentId: t.attachment.id, useOcr: false });
    // Then the button. Serving the cached `needs-ocr` here would make the button do
    // nothing, which is the bug this guards.
    const run = await extractAttachmentText(t.deps, {
      attachmentId: t.attachment.id,
      useOcr: true,
    });

    expect(run.fromCache).toBe(false);
    expect(run.result.status).toBe("extracted");
    expect(run.result.source).toBe("ocr");
  });

  it("re-extracts on force even when the cache is current", async () => {
    const t = setup({ layerText: "Perfectly good cached text here" });
    await extractAttachmentText(t.deps, { attachmentId: t.attachment.id, useOcr: false });

    const forced = await extractAttachmentText(t.deps, {
      attachmentId: t.attachment.id,
      useOcr: false,
      force: true,
    });

    expect(forced.fromCache).toBe(false);
    expect(t.counts().layerCalls).toBe(2);
  });

  it("refuses an attachment that is not there", async () => {
    const t = setup();
    await expect(
      extractAttachmentText(t.deps, { attachmentId: 9999, useOcr: false }),
    ).rejects.toThrow(/no longer exists/i);
  });

  it("names the file when its bytes have gone from the share", async () => {
    const t = setup({ layerText: "text" });
    t.store.files.clear();

    await expect(
      extractAttachmentText(t.deps, { attachmentId: t.attachment.id, useOcr: false }),
    ).rejects.toThrow(/09-27-2016 \(Dr Zottoli\)\.pdf/);
  });

  it("refuses when no document folder is configured", async () => {
    const t = setup({ layerText: "text" });
    t.deps.files = { store: t.store, root: "" };

    await expect(
      extractAttachmentText(t.deps, { attachmentId: t.attachment.id, useOcr: false }),
    ).rejects.toThrow(/No document folder is set/);
  });
});

describe("extractDocumentText", () => {
  it("reads every file on the document", async () => {
    const t = setup({ layerText: "The first file's readable text" });
    const second = t.repo.addAttachment({
      documentId: t.document.id,
      fileName: "page2.pdf",
      originalName: "page2.pdf",
      relativePath: `doc_${t.document.id}/page2.pdf`,
      mimeType: "application/pdf",
      byteSize: 4,
      contentHash: "hash-b",
    });
    t.store.files.set(second.relativePath, Buffer.from("%PDF"));

    const runs = await extractDocumentText(t.deps, {
      documentId: t.document.id,
      useOcr: false,
    });

    expect(runs).toHaveLength(2);
    expect(runs.every((run) => run.result.status === "extracted")).toBe(true);
  });

  it("keeps going when one file fails, so the readable ones still land", async () => {
    // Comfortably over MIN_TEXT_LAYER_CHARS — a shorter string is correctly read as
    // `needs-ocr`, which would make this test about the floor rather than about one
    // bad file not abandoning the others.
    const t = setup({ layerText: "The readable one, with enough text to be believed" });
    const broken = t.repo.addAttachment({
      documentId: t.document.id,
      fileName: "gone.pdf",
      originalName: "gone.pdf",
      relativePath: `doc_${t.document.id}/gone.pdf`,
      mimeType: "application/pdf",
      byteSize: 4,
      contentHash: "hash-c",
    });
    // Deliberately not written to the store: its bytes are missing.

    const runs = await extractDocumentText(t.deps, {
      documentId: t.document.id,
      useOcr: false,
    });

    expect(runs).toHaveLength(2);
    expect(runs.find((r) => r.attachmentId === t.attachment.id)?.result.status).toBe("extracted");
    const failure = runs.find((r) => r.attachmentId === broken.id);
    expect(failure?.result.status).toBe("failed");
    expect(failure?.result.error).toMatch(/no longer on the share/);
  });

  it("returns nothing for a document with no files", async () => {
    const t = setup();
    const empty = t.repo.createDocument({
      title: "No files",
      description: "",
      categories: [],
      tags: [],
      createdBy: 1,
    });
    expect(await extractDocumentText(t.deps, { documentId: empty.id, useOcr: false })).toEqual([]);
  });
});

describe("summariseExtraction", () => {
  it("says so when a document has nothing to read", () => {
    expect(summariseExtraction([])).toMatch(/no files/i);
  });

  it("totals the time and the characters across files", () => {
    const summary = summariseExtraction([
      {
        attachmentId: 1,
        originalName: "a.pdf",
        fromCache: false,
        elapsed: "167ms",
        result: {
          status: "extracted",
          text: "x".repeat(2092),
          source: "text-layer",
          pageCount: 1,
          charCount: 2092,
          elapsedMs: 167,
          error: "",
        },
      },
      {
        attachmentId: 2,
        originalName: "b.pdf",
        fromCache: false,
        elapsed: "3.7s",
        result: {
          status: "extracted",
          text: "y".repeat(1000),
          source: "ocr",
          pageCount: 1,
          charCount: 1000,
          elapsedMs: 3723,
          error: "",
        },
      },
    ]);

    expect(summary).toContain("Read 2 files");
    expect(summary).toContain("3,092 characters");
    expect(summary).toContain("3.9s");
  });

  it("counts what could not be read instead of quietly reporting success", () => {
    const summary = summariseExtraction([
      {
        attachmentId: 1,
        originalName: "scan.pdf",
        fromCache: false,
        elapsed: "120ms",
        result: {
          status: "needs-ocr",
          text: "",
          source: "text-layer",
          pageCount: 1,
          charCount: 0,
          elapsedMs: 120,
          error: "",
        },
      },
      {
        attachmentId: 2,
        originalName: "broken.pdf",
        fromCache: false,
        elapsed: "0ms",
        result: {
          status: "failed",
          text: "",
          source: "text-layer",
          pageCount: 0,
          charCount: 0,
          elapsedMs: 0,
          error: "boom",
        },
      },
    ]);

    expect(summary).toContain("Read 0 of 2 files");
    expect(summary).toContain("1 still unreadable");
    expect(summary).toContain("1 failed");
  });
});

describe("the scheduled pass (migration 0166)", () => {
  /** A library with one scanned PDF that OCR will not be able to read. */
  function scanLibrary(ocrText = "") {
    return setup({ layerText: "", ocrText });
  }

  it("marks a scan OCR could not read, so a later pass skips it", async () => {
    const t = scanLibrary("");

    const first = await runTextIndexPass(t.deps, { limit: 10, useOcr: true });
    expect(first.considered).toBe(1);
    expect(first.unreadable).toBe(1);
    // The attempt is recorded even though nothing was recovered — that is the whole
    // point of the flag.
    expect(t.repo.getAttachmentText(t.attachment.id)?.ocrAttempted).toBe(true);

    const second = await runTextIndexPass(t.deps, { limit: 10, useOcr: true });
    expect(second.considered).toBe(0);
    // Without the flag this would be a treadmill: ~10s a page on the NAS, every pass,
    // forever, producing the same nothing.
    expect(t.counts().ocrCalls).toBe(1);
  });

  it("picks the file up again once new bytes are uploaded", async () => {
    const t = scanLibrary("");
    await runTextIndexPass(t.deps, { limit: 10, useOcr: true });
    expect(await runTextIndexPass(t.deps, { limit: 10, useOcr: true })).toMatchObject({
      considered: 0,
    });

    // A replacement file: same attachment row, different bytes.
    t.repo.setAttachmentHash(t.attachment.id, "hash-v2");

    const after = await runTextIndexPass(t.deps, { limit: 10, useOcr: true });
    // "Re-OCR only when a new file is uploaded" — this is that requirement.
    expect(after.considered).toBe(1);
  });

  it("does not re-read a file whose text was already recovered", async () => {
    const t = setup({ layerText: "A readable lease, long enough to believe" });

    const first = await runTextIndexPass(t.deps, { limit: 10, useOcr: true });
    expect(first.read).toBe(1);

    const second = await runTextIndexPass(t.deps, { limit: 10, useOcr: true });
    expect(second.considered).toBe(0);
    expect(t.counts().layerCalls).toBe(1);
  });

  it("leaves a scan for a later OCR pass when run cheap-only", async () => {
    const t = scanLibrary("Recovered by recognition");

    const cheap = await runTextIndexPass(t.deps, { limit: 10, useOcr: false });
    expect(cheap.unreadable).toBe(1);
    expect(t.counts().ocrCalls).toBe(0);
    // Not marked: OCR never ran, so an OCR pass must still consider it.
    expect(t.repo.getAttachmentText(t.attachment.id)?.ocrAttempted).toBe(false);

    const withOcr = await runTextIndexPass(t.deps, { limit: 10, useOcr: true });
    expect(withOcr.read).toBe(1);
  });

  it("does not mark a text-layer hit as OCR-attempted", async () => {
    const t = setup({ layerText: "Read straight from the text layer, no OCR needed" });
    await runTextIndexPass(t.deps, { limit: 10, useOcr: true });
    // OCR never ran — the cheap path answered first. If this file is ever replaced
    // by a scan it must still be eligible for recognition.
    expect(t.repo.getAttachmentText(t.attachment.id)?.ocrAttempted).toBe(false);
  });

  it("keeps going when one file fails, and counts it", async () => {
    const t = setup({ layerText: "Readable text that is long enough to count" });
    t.repo.addAttachment({
      documentId: t.document.id,
      fileName: "gone.pdf",
      originalName: "gone.pdf",
      relativePath: `doc_${t.document.id}/gone.pdf`,
      mimeType: "application/pdf",
      byteSize: 4,
      contentHash: "hash-missing",
    });
    // Its bytes are deliberately absent from the store.

    const pass = await runTextIndexPass(t.deps, { limit: 10, useOcr: false });
    expect(pass.considered).toBe(2);
    expect(pass.read).toBe(1);
    expect(pass.failed).toBe(1);
  });

  it("honours the limit, so one pass is bounded", async () => {
    const t = setup({ layerText: "Long enough to be believed as real text" });
    for (let n = 0; n < 4; n += 1) {
      const extra = t.repo.addAttachment({
        documentId: t.document.id,
        fileName: `f${n}.pdf`,
        originalName: `f${n}.pdf`,
        relativePath: `doc_${t.document.id}/f${n}.pdf`,
        mimeType: "application/pdf",
        byteSize: 4,
        contentHash: `hash-${n}`,
      });
      t.store.files.set(extra.relativePath, Buffer.from("%PDF"));
    }

    const pass = await runTextIndexPass(t.deps, { limit: 2, useOcr: false });
    expect(pass.considered).toBe(2);
  });

  it("reports an empty library without pretending it did work", async () => {
    const t = setup({ layerText: "text" });
    t.repo.attachments.length = 0;
    const pass = await runTextIndexPass(t.deps, { limit: 10, useOcr: true });
    expect(pass.considered).toBe(0);
    expect(describeTextIndexPass(pass)).toMatch(/nothing to index/i);
  });
});

describe("describeTextIndexPass", () => {
  it("names what the pass did", () => {
    expect(
      describeTextIndexPass({ considered: 5, read: 3, unreadable: 1, failed: 1, elapsedMs: 4200 }),
    ).toBe("Read 3 of 5 · 1 unreadable · 1 failed · in 4.2s.");
  });
});

describe("the list's text badge", () => {
  it("reports nothing for a document whose files have not been read", async () => {
    const t = setup({ layerText: "unused" });
    expect(t.repo.listDocuments()[0]
      ?.textState).toBe("none");
  });

  it("reports an exact read as text-layer", async () => {
    const t = setup({ layerText: "Read exactly from the embedded text layer" });
    await extractAttachmentText(t.deps, { attachmentId: t.attachment.id, useOcr: false });
    expect(t.repo.listDocuments()[0]
      ?.textState).toBe("text-layer");
  });

  it("reports a recognised read as ocr", async () => {
    const t = setup({ layerText: "", ocrText: "Recovered by recognition" });
    await extractAttachmentText(t.deps, { attachmentId: t.attachment.id, useOcr: true });
    expect(t.repo.listDocuments()[0]
      ?.textState).toBe("ocr");
  });

  it("lets ocr outrank text-layer on a document holding both", async () => {
    const t = setup({ layerText: "Read exactly from the embedded text layer" });
    await extractAttachmentText(t.deps, { attachmentId: t.attachment.id, useOcr: false });

    // A second file on the same document, recovered by recognition.
    const scanned = t.repo.addAttachment({
      documentId: t.document.id,
      fileName: "scan.pdf",
      originalName: "scan.pdf",
      relativePath: `doc_${t.document.id}/scan.pdf`,
      mimeType: "application/pdf",
      byteSize: 4,
      contentHash: "hash-scan",
    });
    t.repo.putAttachmentText({
      attachmentId: scanned.id,
      documentId: t.document.id,
      body: "recognised words",
      status: "extracted",
      source: "ocr",
      pageCount: 1,
      charCount: 16,
      elapsedMs: 3700,
      contentHash: "hash-scan",
      error: "",
      ocrAttempted: true,
    });

    // The weaker claim wins: part of this document's text was guessed at, and a
    // badge promising an exact read would be the wrong reassurance.
    expect(t.repo.listDocuments()[0]
      ?.textState).toBe("ocr");
  });

  it("does not badge a file that was looked at and yielded nothing", async () => {
    const t = setup({ layerText: "", ocrText: "" });
    await extractAttachmentText(t.deps, { attachmentId: t.attachment.id, useOcr: true });
    // OCR ran, so the row exists — but there is no text to search, so nothing is
    // claimed.
    expect(t.repo.listDocuments()[0]
      ?.textState).toBe("none");
  });
});
