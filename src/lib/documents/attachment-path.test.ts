import { describe, expect, it } from "vitest";
import {
  buildAttachmentPath,
  deletedDocumentFolder,
  documentFolder,
  isInlineRenderable,
  mimeTypeFor,
  sanitizeFileName,
  sanitizeNameSegment,
  withCollisionSuffix,
} from "./attachment-path";

describe("sanitizeNameSegment", () => {
  it("keeps an ordinary name", () => {
    expect(sanitizeNameSegment("Lease 2026")).toBe("Lease-2026");
  });

  it("drops characters a filesystem forbids", () => {
    expect(sanitizeNameSegment('a<b>c:d"e/f\\g|h?i*j')).toBe("abcdefghij");
  });

  it("strips leading dots so a file cannot become hidden or climb", () => {
    expect(sanitizeNameSegment("..\\..\\etc")).toBe("etc");
    expect(sanitizeNameSegment(".hidden")).toBe("hidden");
  });

  it("trims trailing dots, which Windows silently drops", () => {
    expect(sanitizeNameSegment("report.")).toBe("report");
  });

  it("never returns empty", () => {
    expect(sanitizeNameSegment("***")).toBe("file");
    expect(sanitizeNameSegment("   ")).toBe("file");
  });

  it("caps the length", () => {
    expect(sanitizeNameSegment("a".repeat(200)).length).toBe(80);
  });
});

describe("sanitizeFileName", () => {
  it("preserves the extension when truncating a long stem", () => {
    const result = sanitizeFileName(`${"a".repeat(200)}.pdf`);
    expect(result.endsWith(".pdf")).toBe(true);
    expect(result.length).toBeLessThanOrEqual(85);
  });

  it("lowercases the extension but keeps the stem's own case", () => {
    expect(sanitizeFileName("Lease.PDF")).toBe("Lease.pdf");
  });

  it("treats a long tail as part of the name, not an extension", () => {
    expect(sanitizeFileName("report.final version")).toBe("report.final-version");
  });

  it("handles a name with no extension", () => {
    expect(sanitizeFileName("README")).toBe("README");
  });

  it("neutralises a traversal attempt", () => {
    expect(sanitizeFileName("../../secrets.txt")).toBe("secrets.txt");
  });
});

describe("buildAttachmentPath", () => {
  it("puts each document in its own folder", () => {
    expect(buildAttachmentPath(17, "Lease 2026.pdf")).toBe("doc_17/Lease-2026.pdf");
  });

  it("cannot be made to escape the document folder", () => {
    expect(buildAttachmentPath(17, "../../evil.pdf")).toBe("doc_17/evil.pdf");
  });
});

describe("withCollisionSuffix", () => {
  it("is the path unchanged at n = 1", () => {
    expect(withCollisionSuffix("doc_17/a.pdf", 1)).toBe("doc_17/a.pdf");
  });

  it("inserts the suffix before the extension", () => {
    expect(withCollisionSuffix("doc_17/a.pdf", 2)).toBe("doc_17/a-2.pdf");
  });

  it("appends when there is no extension", () => {
    expect(withCollisionSuffix("doc_17/README", 3)).toBe("doc_17/README-3");
  });

  it("is not confused by a dot in a folder name", () => {
    expect(withCollisionSuffix("doc.1/README", 2)).toBe("doc.1/README-2");
  });
});

describe("mimeTypeFor", () => {
  it("maps a known extension", () => {
    expect(mimeTypeFor("a.pdf")).toBe("application/pdf");
    expect(mimeTypeFor("a.JPG")).toBe("image/jpeg");
  });

  it("falls back to octet-stream, so an unknown type downloads rather than renders", () => {
    expect(mimeTypeFor("a.wat")).toBe("application/octet-stream");
    expect(mimeTypeFor("noextension")).toBe("application/octet-stream");
  });

  it("does not let a stored .html pick its own content type", () => {
    expect(mimeTypeFor("page.html")).toBe("application/octet-stream");
  });
});

describe("isInlineRenderable", () => {
  it("allows images and PDFs", () => {
    expect(isInlineRenderable("application/pdf")).toBe(true);
    expect(isInlineRenderable("image/png")).toBe(true);
  });

  it("refuses SVG, which can carry script", () => {
    expect(isInlineRenderable("image/svg+xml")).toBe(false);
  });

  it("refuses anything else", () => {
    expect(isInlineRenderable("text/html")).toBe(false);
    expect(isInlineRenderable("application/octet-stream")).toBe(false);
  });
});

describe("folder helpers", () => {
  it("names a document's folder and its deleted destination", () => {
    expect(documentFolder(17)).toBe("doc_17");
    expect(deletedDocumentFolder(17)).toBe("_deleted/doc_17");
  });
});
