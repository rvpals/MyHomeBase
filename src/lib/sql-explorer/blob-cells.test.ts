import { describe, expect, it } from "vitest";
import {
  BLOB_PREVIEW_MAX_BYTES,
  readBlobCell,
  blobDownloadFileName,
  describeBlobCell,
  isBlobCell,
  isImageMimeType,
  sniffMimeType,
} from "./blob-cells";

/** A blob whose first bytes are `signature` and the rest zero padding. */
function bytesWith(signature: number[], totalLength = signature.length): Uint8Array {
  const bytes = new Uint8Array(totalLength);
  bytes.set(signature);
  return bytes;
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];

describe("sniffMimeType", () => {
  it("recognises the image types the grid can preview", () => {
    expect(sniffMimeType(bytesWith(PNG))).toBe("image/png");
    expect(sniffMimeType(bytesWith(JPEG))).toBe("image/jpeg");
    expect(sniffMimeType(bytesWith([0x47, 0x49, 0x46, 0x38]))).toBe("image/gif");
  });

  it("reads WebP from the RIFF container, not just its first four bytes", () => {
    // "RIFF" + a four-byte size + "WEBP" — the type marker sits at offset 8.
    const webp = bytesWith([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00], 12);
    webp.set([0x57, 0x45, 0x42, 0x50], 8);
    expect(sniffMimeType(webp)).toBe("image/webp");
  });

  it("does not mistake a bare RIFF file for WebP", () => {
    // A RIFF WAVE has the same first four bytes; without the WEBP marker it must
    // not claim to be a previewable image.
    const wave = bytesWith([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00], 12);
    wave.set([0x57, 0x41, 0x56, 0x45], 8);
    expect(sniffMimeType(wave)).toBe("application/octet-stream");
  });

  it("recognises the non-image types these tables actually hold", () => {
    expect(sniffMimeType(bytesWith([0x25, 0x50, 0x44, 0x46]))).toBe("application/pdf");
    expect(sniffMimeType(bytesWith([0x50, 0x4b, 0x03, 0x04]))).toBe("application/zip");
    expect(sniffMimeType(bytesWith([0x49, 0x44, 0x33]))).toBe("audio/mpeg");
  });

  it("falls back to octet-stream for bytes it cannot place", () => {
    expect(sniffMimeType(bytesWith([0x01, 0x02, 0x03, 0x04]))).toBe("application/octet-stream");
  });

  it("does not read past the end of a blob shorter than a signature", () => {
    expect(sniffMimeType(new Uint8Array(0))).toBe("application/octet-stream");
    expect(sniffMimeType(new Uint8Array([0x89, 0x50]))).toBe("application/octet-stream");
  });
});

describe("isImageMimeType", () => {
  it("accepts the four raster types and rejects everything else", () => {
    expect(isImageMimeType("image/png")).toBe(true);
    expect(isImageMimeType("image/webp")).toBe(true);
    expect(isImageMimeType("application/pdf")).toBe(false);
    // SVG is not in the allowlist on purpose: it can carry script, and these
    // bytes are served from the app's own origin.
    expect(isImageMimeType("image/svg+xml")).toBe(false);
  });
});

describe("describeBlobCell", () => {
  const source = { tableName: "mus_albums", columnName: "cover_image", rowId: 12 };

  it("describes an addressable image as previewable", () => {
    const cell = describeBlobCell(bytesWith(PNG, 2048), source);
    expect(cell).toEqual({
      kind: "blob",
      byteLength: 2048,
      mimeType: "image/png",
      isPreviewable: true,
      source,
    });
  });

  it("omits source entirely when the bytes have no address", () => {
    const cell = describeBlobCell(bytesWith(PNG, 2048));
    expect(cell.source).toBeUndefined();
    // Still previewable — the view decides what to do without an address.
    expect(cell.isPreviewable).toBe(true);
  });

  it("refuses to preview an image past the size cap", () => {
    const cell = describeBlobCell(bytesWith(PNG, BLOB_PREVIEW_MAX_BYTES + 1), source);
    expect(cell.mimeType).toBe("image/png");
    expect(cell.isPreviewable).toBe(false);
  });

  it("previews an image exactly at the cap", () => {
    expect(describeBlobCell(bytesWith(PNG, BLOB_PREVIEW_MAX_BYTES), source).isPreviewable).toBe(true);
  });

  it("never marks a non-image previewable", () => {
    const cell = describeBlobCell(bytesWith([0x25, 0x50, 0x44, 0x46], 500), source);
    expect(cell.mimeType).toBe("application/pdf");
    expect(cell.isPreviewable).toBe(false);
  });

  it("describes an empty blob without throwing", () => {
    const cell = describeBlobCell(new Uint8Array(0), source);
    expect(cell.byteLength).toBe(0);
    expect(cell.isPreviewable).toBe(false);
  });
});

describe("isBlobCell", () => {
  it("accepts a descriptor and rejects the other things a cell can be", () => {
    expect(isBlobCell(describeBlobCell(bytesWith(PNG, 10)))).toBe(true);
    expect(isBlobCell(null)).toBe(false);
    expect(isBlobCell("<BLOB 24 KB>")).toBe(false);
    expect(isBlobCell(42)).toBe(false);
    expect(isBlobCell({ kind: "blob" })).toBe(false);
    expect(isBlobCell({ kind: "other", byteLength: 1 })).toBe(false);
  });
});

describe("blobDownloadFileName", () => {
  it("names a file after its table, column and row", () => {
    expect(
      blobDownloadFileName({ tableName: "sys_users", columnName: "avatar", rowId: 3 }, "image/png"),
    ).toBe("sys_users-avatar-3.png");
  });

  it("uses .bin when the type is unknown", () => {
    expect(
      blobDownloadFileName({ tableName: "t", columnName: "c", rowId: 1 }, "application/octet-stream"),
    ).toBe("t-c-1.bin");
  });

  it("strips anything that could steer the download's name", () => {
    const name = blobDownloadFileName(
      { tableName: 'a"/../b', columnName: "c d;e", rowId: 7 },
      "image/jpeg",
    );
    expect(name).toBe("a____.._b-c_d_e-7.jpg");
    expect(name).not.toMatch(/[/"';]/);
  });
});

describe("readBlobCell", () => {
  const source = { tableName: "mus_albums", columnName: "cover_image", rowId: 12 };

  it("returns the bytes with a sniffed type and a derived filename", () => {
    const data = bytesWith(PNG, 64);
    const result = readBlobCell({ readBlobCell: () => data }, source);

    expect(result).toEqual({
      data,
      mimeType: "image/png",
      fileName: "mus_albums-cover_image-12.png",
    });
  });

  it("sniffs the type from the bytes, not from the request", () => {
    // A JPEG stored in a column called cover_image must be served as a JPEG.
    const result = readBlobCell({ readBlobCell: () => bytesWith(JPEG, 64) }, source);

    expect(result?.mimeType).toBe("image/jpeg");
    expect(result?.fileName).toBe("mus_albums-cover_image-12.jpg");
  });

  it("returns undefined when the cell holds nothing", () => {
    expect(readBlobCell({ readBlobCell: () => undefined }, source)).toBeUndefined();
  });

  it("rejects a table name that isn't an identifier before reaching the repository", () => {
    let asked = false;
    const repo = {
      readBlobCell: () => {
        asked = true;
        return bytesWith(PNG, 8);
      },
    };

    expect(() => readBlobCell(repo, { ...source, tableName: "t; DROP TABLE t" })).toThrow();
    expect(asked).toBe(false);
  });

  it("rejects a column name that isn't an identifier before reaching the repository", () => {
    let asked = false;
    const repo = {
      readBlobCell: () => {
        asked = true;
        return bytesWith(PNG, 8);
      },
    };

    expect(() => readBlobCell(repo, { ...source, columnName: 'a" FROM x --' })).toThrow();
    expect(asked).toBe(false);
  });

  it("rejects a non-integer rowid", () => {
    expect(() => readBlobCell({ readBlobCell: () => undefined }, { ...source, rowId: 1.5 })).toThrow();
  });

  it("propagates the repository's error for a column that doesn't exist", () => {
    const repo = {
      readBlobCell: () => {
        throw new Error("No such column: nope");
      },
    };

    expect(() => readBlobCell(repo, { ...source, columnName: "nope" })).toThrow(/No such column/);
  });
});
