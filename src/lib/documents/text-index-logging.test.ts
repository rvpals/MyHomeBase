// The DEBUG lines the unattended indexing pass writes (`lib/system-log`).
//
// Separate from `text-index.test.ts` so that file keeps covering what a pass DOES,
// and this one covers what it SAYS. The two fail for different reasons.

import { describe, expect, it } from "vitest";

import { FakeSystemLogger } from "@/lib/system-log";

import { FakeFileStore, FakeRepository } from "./test-fakes";
import { countWords } from "./text-extract";
import type { TextExtractionEngines } from "./text-extract";
import {
  TEXT_INDEX_LOG_SOURCE,
  describeIndexedFile,
  runTextIndexPass,
  type ExtractionRunResult,
  type TextIndexDeps,
} from "./text-index";

const ROOT = "/docs";

/** A library of `count` one-file documents, plus the ports around them. */
function setup(options: { count?: number; layerText?: string; log?: FakeSystemLogger } = {}) {
  const repo = new FakeRepository();
  const store = new FakeFileStore();

  for (let i = 0; i < (options.count ?? 1); i += 1) {
    const document = repo.createDocument({
      title: `Document ${i}`,
      description: "",
      categories: [],
      tags: [],
      createdBy: 1,
    });
    const attachment = repo.addAttachment({
      documentId: document.id,
      fileName: `file-${i}.pdf`,
      originalName: `Lease ${i}.pdf`,
      relativePath: `doc_${document.id}/file-${i}.pdf`,
      mimeType: "application/pdf",
      byteSize: 4,
      contentHash: `hash-${i}`,
    });
    store.files.set(attachment.relativePath, Buffer.from("%PDF"));
  }

  const engines: TextExtractionEngines = {
    extractPdfText: async () => ({ text: options.layerText ?? "", pageCount: 2 }),
    ocrImage: async () => ({ text: "", confidence: 89 }),
  };

  const log = options.log ?? new FakeSystemLogger();
  const deps: TextIndexDeps = { repo, files: { store, root: ROOT }, engines, log };
  return { deps, repo, log };
}

const LONG_ENOUGH = "Ridgeview Drive lease agreement for the tenancy beginning in March.";

describe("runTextIndexPass — DEBUG lines", () => {
  it("writes a start line and a line per text-layer file", async () => {
    const t = setup({ count: 3, layerText: LONG_ENOUGH });

    await runTextIndexPass(t.deps, { limit: 10, useOcr: false });

    const lines = t.log.messagesOf("debug");
    // Start plus three files. The finish line is OPERATIONAL now: a reader asking
    // "did the pass run, and what did it cost" should not have to enable DEBUG.
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain("Pass starting");
    expect(lines.filter((line) => line.startsWith("Indexed"))).toHaveLength(3);
  });

  it("reports the elapsed time and the word count for each file", async () => {
    const t = setup({ count: 1, layerText: LONG_ENOUGH });

    await runTextIndexPass(t.deps, { limit: 10, useOcr: false });

    const indexed = t.log.messagesOf("debug").find((line) => line.startsWith("Indexed"));
    // The document is named first, the file in brackets after it — a reader
    // recognises "Lease 2026", not the scan's filename.
    expect(indexed).toContain("Lease 0.pdf");
    expect(indexed).toContain(`${countWords(LONG_ENOUGH)} words`);
    expect(indexed).toContain("2 pages");
    expect(indexed).toContain("text-layer");
  });

  it("totals the words across the pass in the finish line", async () => {
    const t = setup({ count: 3, layerText: LONG_ENOUGH });

    await runTextIndexPass(t.deps, { limit: 10, useOcr: false });

    const finished = t.log
      .messagesOf("operational")
      .find((line) => line.startsWith("Pass finished"));
    expect(finished).toContain(`${countWords(LONG_ENOUGH) * 3} words`);
    expect(finished).toContain("3 considered");
    expect(finished).toContain("3 read");
  });

  it("names the source every line carries, so the log can be filtered to this job", async () => {
    const t = setup({ count: 1, layerText: LONG_ENOUGH });

    await runTextIndexPass(t.deps, { limit: 10, useOcr: false });

    expect(t.log.lines.every((line) => line.source === TEXT_INDEX_LOG_SOURCE)).toBe(true);
  });

  it("keeps a plain text-layer read off the operational log", async () => {
    const t = setup({ count: 1, layerText: LONG_ENOUGH });

    await runTextIndexPass(t.deps, { limit: 10, useOcr: false });

    // Only the pass total. A file read instantly from its embedded text layer is
    // not operational news -- 25 digital PDFs would otherwise write 25 lines
    // reporting that nothing took any time.
    const operational = t.log.messagesOf("operational");
    expect(operational).toHaveLength(1);
    expect(operational[0]).toContain("Pass finished");
  });

  it("says 'nothing to do' operationally when the library is fully indexed", async () => {
    const t = setup({ count: 0 });

    await runTextIndexPass(t.deps, { limit: 10, useOcr: false });

    // The answer to "is it working, or is it stuck?" -- a pass that found an
    // already-indexed library is the healthy steady state, and silence would make
    // a working scheduler indistinguishable from a dead one.
    const operational = t.log.messagesOf("operational");
    expect(operational).toHaveLength(1);
    expect(operational[0]).toContain("Nothing to do");
    // It returns early, so there is no start/finish pair to report.
    expect(t.log.messagesOf("debug")).toEqual([]);
  });

  it("builds no message at all when DEBUG is off", async () => {
    const off = new FakeSystemLogger(new Set());
    const t = setup({ count: 3, layerText: LONG_ENOUGH, log: off });

    await runTextIndexPass(t.deps, { limit: 10, useOcr: false });

    expect(off.lines).toEqual([]);
    // The property the whole design rests on: with the switch off, not one of the
    // five message thunks ran.
    expect(off.thunkCalls).toBe(0);
  });

  it("runs unchanged with no logger at all", async () => {
    const t = setup({ count: 2, layerText: LONG_ENOUGH });
    const { log: _log, ...withoutLog } = t.deps;

    const result = await runTextIndexPass(withoutLog, { limit: 10, useOcr: false });

    expect(result).toMatchObject({ considered: 2, read: 2, failed: 0 });
  });

  it("returns the same counts whether or not it is logging", async () => {
    const quiet = setup({ count: 2, layerText: LONG_ENOUGH, log: new FakeSystemLogger(new Set()) });
    const loud = setup({ count: 2, layerText: LONG_ENOUGH });

    const a = await runTextIndexPass(quiet.deps, { limit: 10, useOcr: false });
    const b = await runTextIndexPass(loud.deps, { limit: 10, useOcr: false });

    expect(a.considered).toBe(b.considered);
    expect(a.read).toBe(b.read);
    expect(a.failed).toBe(b.failed);
  });
});

describe("describeIndexedFile", () => {
  const base = (overrides: Partial<ExtractionRunResult["result"]> = {}): ExtractionRunResult => ({
    attachmentId: 1,
    originalName: "Lease.pdf",
    elapsed: "0.2s",
    fromCache: false,
    result: {
      status: "extracted",
      text: "some text",
      source: "text-layer",
      pageCount: 2,
      charCount: 9,
      elapsedMs: 200,
      error: "",
      ...overrides,
    },
  });

  it("reports pages, words, characters, path and time", () => {
    const line = describeIndexedFile(base(), 2);

    expect(line).toBe('Indexed "Lease.pdf" — 2 pages, 2 words, 9 chars via text-layer in 0.2s.');
  });

  it("leads with OCR, and reports the confidence only an OCR read has", () => {
    const line = describeIndexedFile(base({ source: "ocr", confidence: 89.4 }), 2);

    // "OCR on ..." rather than "Indexed ... via ocr": this is the slow, fallible
    // path, and it is what a reader scans the operational log for.
    expect(line).toMatch(/^OCR on /);
    expect(line).toContain("89% confidence");
  });

  it("names the document as well as the file when a title is given", () => {
    const line = describeIndexedFile(base({ source: "ocr", confidence: 89 }), 2, "Lease 2026");

    // The document is what a reader recognises; the file says which of its
    // attachments was read.
    expect(line).toContain('"Lease 2026"');
    expect(line).toContain("(Lease.pdf)");
  });

  it("says a cached hit was cached rather than claiming a 0ms extraction", () => {
    const run = { ...base(), fromCache: true, elapsed: "0ms" };

    expect(describeIndexedFile(run, 2)).toContain("from cache");
    expect(describeIndexedFile(run, 2)).not.toContain("in 0ms");
  });

  it("reports a scan with no recoverable text as 'no text', not as a failure", () => {
    const line = describeIndexedFile(
      base({ status: "needs-ocr", text: "", charCount: 0 }),
      0,
    );

    expect(line).toContain("No text");
    expect(line).not.toContain("Failed");
  });

  it("reports a failure with its reason", () => {
    const line = describeIndexedFile(
      base({ status: "failed", error: "the file is corrupt", text: "", charCount: 0 }),
      0,
    );

    expect(line).toBe('Failed "Lease.pdf" — the file is corrupt after 0.2s.');
  });

  it("falls back when a failure carries no reason", () => {
    const line = describeIndexedFile(base({ status: "failed", error: "" }), 0);

    expect(line).toContain("no reason given");
  });

  it("uses the singular for a one-page, one-word file", () => {
    const line = describeIndexedFile(base({ pageCount: 1, charCount: 4 }), 1);

    expect(line).toContain("1 page, 1 word,");
  });
});

describe("countWords", () => {
  it("counts runs of non-whitespace", () => {
    expect(countWords("Hemoglobin 15.3 g/dL")).toBe(3);
  });

  it("is zero for empty or whitespace-only text", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   \n\t  ")).toBe(0);
  });

  it("ignores the layout whitespace a PDF text layer arrives with", () => {
    expect(countWords("  Lease    2026 \n\n  Ridgeview  ")).toBe(3);
  });
});
