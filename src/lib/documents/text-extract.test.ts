import { describe, expect, it } from "vitest";
import {
  MIN_TEXT_LAYER_CHARS,
  extractText,
  extractTextWithOcr,
  formatElapsed,
  normaliseExtractedText,
  type TextExtractionEngines,
} from "./text-extract";

/**
 * A stand-in for `unpdf` and `tesseract.js`.
 *
 * The real engines unpack to ~46MB and hold hundreds of MB of RSS while they work, so
 * a test that loaded them would be a test nobody runs. Everything below exercises the
 * decisions this module makes — which path to take, what to believe, what to report —
 * which is the part that can actually be wrong.
 */
function engines(overrides: Partial<TextExtractionEngines> = {}): TextExtractionEngines {
  return {
    extractPdfText: async () => ({ text: "", pageCount: 1 }),
    ocrImage: async () => ({ text: "", confidence: 0 }),
    ...overrides,
  };
}

const pdf = { data: new Uint8Array([1, 2, 3]), mimeType: "application/pdf" };

describe("normaliseExtractedText", () => {
  it("collapses the layout padding a PDF text layer arrives with", () => {
    expect(normaliseExtractedText("Lease    2026   \n\n\n\n  Ridgeview  ")).toBe(
      "Lease 2026\n\nRidgeview",
    );
  });

  it("keeps single newlines, because a reader still wants the document's lines", () => {
    expect(normaliseExtractedText("WBC 5.6\nRBC 5.23")).toBe("WBC 5.6\nRBC 5.23");
  });
});

describe("extractText", () => {
  it("reads a PDF's text layer without ever calling OCR", async () => {
    let ocrCalls = 0;
    const result = await extractText(
      engines({
        extractPdfText: async () => ({ text: "Hemoglobin 15.3 g/dL Zottoli", pageCount: 2 }),
        ocrImage: async () => {
          ocrCalls += 1;
          return { text: "should never run", confidence: 90 };
        },
      }),
      pdf,
    );

    expect(result.status).toBe("extracted");
    expect(result.source).toBe("text-layer");
    expect(result.text).toContain("Hemoglobin");
    expect(result.pageCount).toBe(2);
    expect(result.charCount).toBe(result.text.length);
    // The whole economic argument for this module: the cheap path must not quietly
    // become the expensive one.
    expect(ocrCalls).toBe(0);
  });

  it("reports a scan as needs-ocr rather than extracting near-empty text", async () => {
    // A scanner leaving a stray page number behind is the realistic case, and the one
    // that would otherwise be indexed as a successfully-read document.
    const result = await extractText(
      engines({ extractPdfText: async () => ({ text: "  3  ", pageCount: 1 }) }),
      pdf,
    );
    expect(result.status).toBe("needs-ocr");
    expect(result.text).toBe("");
  });

  it("believes a text layer that clears the floor", async () => {
    const body = "x".repeat(MIN_TEXT_LAYER_CHARS);
    const result = await extractText(
      engines({ extractPdfText: async () => ({ text: body, pageCount: 1 }) }),
      pdf,
    );
    expect(result.status).toBe("extracted");
  });

  it("reads a plain text file with no engine at all", async () => {
    let pdfCalls = 0;
    const result = await extractText(
      engines({
        extractPdfText: async () => {
          pdfCalls += 1;
          return { text: "", pageCount: 0 };
        },
      }),
      { data: new TextEncoder().encode("Lease agreement for Ridgeview"), mimeType: "text/plain" },
    );
    expect(result.status).toBe("extracted");
    expect(result.text).toBe("Lease agreement for Ridgeview");
    expect(pdfCalls).toBe(0);
  });

  it("sends an image straight to needs-ocr — there is no cheap path to try", async () => {
    const result = await extractText(engines(), {
      data: new Uint8Array([1]),
      mimeType: "image/png",
    });
    expect(result.status).toBe("needs-ocr");
  });

  it("calls a format it cannot read unsupported, not failed", async () => {
    const result = await extractText(engines(), {
      data: new Uint8Array([1]),
      mimeType: "application/zip",
    });
    // A .zip has no text. That is an answer, not an error, and must not surface to
    // the reader as a failure they might try to fix.
    expect(result.status).toBe("unsupported");
    expect(result.error).toBe("");
  });

  it("reports a damaged PDF as failed, carrying the reason", async () => {
    const result = await extractText(
      engines({
        extractPdfText: async () => {
          throw new Error("Invalid PDF structure");
        },
      }),
      pdf,
    );
    expect(result.status).toBe("failed");
    expect(result.error).toBe("Invalid PDF structure");
  });

  it("treats an empty file as unsupported rather than reading it", async () => {
    const result = await extractText(engines(), {
      data: new Uint8Array(),
      mimeType: "application/pdf",
    });
    expect(result.status).toBe("unsupported");
  });
});

describe("extractTextWithOcr", () => {
  it("escalates to OCR only when the text layer found nothing", async () => {
    let ocrCalls = 0;
    const result = await extractTextWithOcr(
      engines({
        extractPdfText: async () => ({ text: "", pageCount: 1 }),
        ocrImage: async () => {
          ocrCalls += 1;
          return { text: "HUANG, MINLIANG  Specimen ID 271-425-0584-0", confidence: 89 };
        },
      }),
      pdf,
    );

    expect(ocrCalls).toBe(1);
    expect(result.status).toBe("extracted");
    expect(result.source).toBe("ocr");
    expect(result.confidence).toBe(89);
    expect(result.text).toContain("MINLIANG");
  });

  it("does not spend OCR time on a PDF that already had text", async () => {
    let ocrCalls = 0;
    await extractTextWithOcr(
      engines({
        extractPdfText: async () => ({ text: "A perfectly readable lease agreement", pageCount: 1 }),
        ocrImage: async () => {
          ocrCalls += 1;
          return { text: "", confidence: 0 };
        },
      }),
      pdf,
    );
    expect(ocrCalls).toBe(0);
  });

  it("does not escalate a damaged PDF — OCR would fail more slowly", async () => {
    let ocrCalls = 0;
    const result = await extractTextWithOcr(
      engines({
        extractPdfText: async () => {
          throw new Error("Invalid PDF structure");
        },
        ocrImage: async () => {
          ocrCalls += 1;
          return { text: "", confidence: 0 };
        },
      }),
      pdf,
    );
    expect(result.status).toBe("failed");
    expect(ocrCalls).toBe(0);
  });

  it("calls a page with no words unsupported, so the reader is not invited to retry", async () => {
    const result = await extractTextWithOcr(
      engines({ ocrImage: async () => ({ text: "   ", confidence: 12 }) }),
      { data: new Uint8Array([1]), mimeType: "image/png" },
    );
    // Not `needs-ocr`: OCR has already run. Leaving it as needs-ocr would make the
    // button offer to do again what it just did.
    expect(result.status).toBe("unsupported");
    expect(result.source).toBe("ocr");
  });

  it("reports an OCR engine failure without losing the reason", async () => {
    const result = await extractTextWithOcr(
      engines({
        ocrImage: async () => {
          throw new Error("worker terminated");
        },
      }),
      { data: new Uint8Array([1]), mimeType: "image/png" },
    );
    expect(result.status).toBe("failed");
    expect(result.error).toBe("worker terminated");
    expect(result.source).toBe("ocr");
  });

  it("times the whole call, not just the inner extraction", async () => {
    let clock = 1000;
    const now = () => clock;
    const result = await extractTextWithOcr(
      engines({
        extractPdfText: async () => {
          clock += 150;
          return { text: "", pageCount: 1 };
        },
        ocrImage: async () => {
          clock += 3700;
          return { text: "Readable scanned text here", confidence: 89 };
        },
      }),
      pdf,
      now,
    );
    // 150ms of text-layer attempt plus 3.7s of OCR. Reporting only the OCR would
    // under-state what the reader actually waited for.
    expect(result.elapsedMs).toBe(3850);
  });
});

describe("formatElapsed", () => {
  it("reads as milliseconds under a second and seconds above it", () => {
    expect(formatElapsed(167)).toBe("167ms");
    expect(formatElapsed(3723)).toBe("3.7s");
    expect(formatElapsed(45_000)).toBe("45s");
  });
});
