import { describe, expect, it } from "vitest";
import { decodeImageUpload, imageUploadSchema } from "./image-upload";

// A 1x1 transparent PNG — the smallest real image, so size assertions aren't
// measuring test-fixture bloat.
const tinyPng =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe("imageUploadSchema", () => {
  it("accepts each allowed type", () => {
    for (const mimeType of ["image/png", "image/jpeg", "image/webp", "image/gif"]) {
      expect(imageUploadSchema.parse({ mimeType, base64Data: tinyPng }).mimeType).toBe(mimeType);
    }
  });

  it("rejects SVG, which could carry script and would be served from our origin", () => {
    expect(() => imageUploadSchema.parse({ mimeType: "image/svg+xml", base64Data: tinyPng })).toThrow();
  });

  it("rejects a non-image type", () => {
    expect(() => imageUploadSchema.parse({ mimeType: "application/pdf", base64Data: tinyPng })).toThrow();
    expect(() => imageUploadSchema.parse({ mimeType: "text/html", base64Data: tinyPng })).toThrow();
  });

  it("rejects empty data", () => {
    expect(() => imageUploadSchema.parse({ mimeType: "image/png", base64Data: "" })).toThrow();
  });
});

describe("decodeImageUpload", () => {
  it("decodes a valid upload to bytes and keeps its type", () => {
    const decoded = decodeImageUpload({ mimeType: "image/png", base64Data: tinyPng }, 128 * 1024);
    expect(decoded.mimeType).toBe("image/png");
    expect(decoded.data.length).toBeGreaterThan(0);
    // PNG magic number, i.e. it really decoded rather than storing the string.
    expect([...decoded.data.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("rejects an image over the cap", () => {
    const tooBig = Buffer.alloc(200 * 1024, 1).toString("base64");
    expect(() => decodeImageUpload({ mimeType: "image/png", base64Data: tooBig }, 128 * 1024)).toThrow(
      /too large/i,
    );
  });

  it("measures the decoded size, not the base64 string, which is a third longer", () => {
    // 100 KB of bytes is ~133 KB of base64: under a 128 KB cap by bytes, over it
    // by string length. It must be accepted.
    const hundredKb = Buffer.alloc(100 * 1024, 1).toString("base64");
    expect(hundredKb.length).toBeGreaterThan(128 * 1024);
    expect(() =>
      decodeImageUpload({ mimeType: "image/png", base64Data: hundredKb }, 128 * 1024),
    ).not.toThrow();
  });

  it("honours a caller's smaller cap", () => {
    const input = { mimeType: "image/png" as const, base64Data: tinyPng };
    expect(() => decodeImageUpload(input, 512 * 1024)).not.toThrow();
    expect(() => decodeImageUpload(input, 10)).toThrow(/too large/i);
  });

  it("rejects base64 that decodes to nothing", () => {
    expect(() => decodeImageUpload({ mimeType: "image/png", base64Data: "!!!!" }, 1024)).toThrow(
      /could not be read/i,
    );
  });

  it("rejects a disallowed type before looking at the bytes", () => {
    expect(() =>
      decodeImageUpload(
        { mimeType: "image/svg+xml" as never, base64Data: tinyPng },
        128 * 1024,
      ),
    ).toThrow();
  });
});
