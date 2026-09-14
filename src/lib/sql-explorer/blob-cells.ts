// Pure — no I/O. What a BLOB cell becomes on its way to the browser, and how the
// bytes get found again when the reader asks to save or preview one.
//
// The rule this file exists to keep: **blob bytes never travel with a row.** A
// single `sys_users` or `mus_albums` row holds a whole file, so a page of rows
// would be megabytes of line noise. Instead a blob cell is replaced by a small
// descriptor saying what it is and how big, and the bytes are fetched one at a
// time from the admin blob route. Same reasoning as the per-row image rule in
// coding-guide.md, applied to a grid that doesn't know its columns in advance.

import { blobCellSourceSchema } from "./schema";

/** The mime types this tool will render inline, sniffed from the bytes. */
const IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;

/**
 * Preview ceiling. Above this the descriptor still offers Save but not Preview:
 * a 40 MB inline `<img>` is a tab-killer, and the reader who wants it can save it.
 */
export const BLOB_PREVIEW_MAX_BYTES = 10 * 1024 * 1024;

/** What replaces a BLOB in a row sent to the browser. */
export interface BlobCell {
  kind: "blob";
  byteLength: number;
  /** Sniffed from the leading bytes. `application/octet-stream` when unrecognised. */
  mimeType: string;
  /** True when the mime type is an image *and* the blob is under the preview cap. */
  isPreviewable: boolean;
  /**
   * Where to fetch the bytes, or `undefined` when this blob has no address.
   *
   * A `SELECT *` over a table gives every cell a rowid, so it can be re-read. A
   * computed blob — `substr(data, 1, 10)`, a join's expression, a view with no
   * rowid — has no home to point at, and the view disables its buttons rather
   * than offering a download that cannot work.
   */
  source?: BlobCellSource;
}

/** The address of one blob cell in the database. */
export interface BlobCellSource {
  tableName: string;
  columnName: string;
  rowId: number;
}

/** Type guard for a descriptor that has come back through JSON. */
export function isBlobCell(value: unknown): value is BlobCell {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "blob" &&
    typeof (value as { byteLength?: unknown }).byteLength === "number"
  );
}

/**
 * Sniffs a blob's type from its leading bytes.
 *
 * Magic bytes rather than a column-name guess: the schema says `BLOB` and
 * nothing more, and the sibling `_mime_type` convention only exists on the nine
 * curated image columns — this grid has to cope with any table. Unrecognised
 * bytes get `application/octet-stream`, which is honest and still downloadable.
 */
export function sniffMimeType(bytes: Uint8Array): string {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  // WebP is a RIFF container: "RIFF" then four size bytes then "WEBP".
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8))
    return "image/webp";
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return "application/pdf";
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return "application/zip";
  if (startsWith(bytes, [0x49, 0x44, 0x33])) return "audio/mpeg";
  if (startsWith(bytes, [0x4f, 0x67, 0x67, 0x53])) return "audio/ogg";
  if (startsWith(bytes, [0x66, 0x4c, 0x61, 0x43])) return "audio/flac";
  if (startsWith(bytes, [0x53, 0x51, 0x4c, 0x69, 0x74, 0x65])) return "application/vnd.sqlite3";
  return "application/octet-stream";
}

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.byteLength < offset + signature.length) return false;
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

/** True for a mime type this tool will render in an `<img>`. */
export function isImageMimeType(mimeType: string): boolean {
  return (IMAGE_MIME_TYPES as readonly string[]).includes(mimeType);
}

/**
 * Turns raw blob bytes into the descriptor the grid renders.
 *
 * `source` is omitted by callers that cannot address the bytes — see
 * `BlobCell.source`.
 */
export function describeBlobCell(bytes: Uint8Array, source?: BlobCellSource): BlobCell {
  const mimeType = sniffMimeType(bytes);
  return {
    kind: "blob",
    byteLength: bytes.byteLength,
    mimeType,
    isPreviewable: isImageMimeType(mimeType) && bytes.byteLength <= BLOB_PREVIEW_MAX_BYTES,
    ...(source ? { source } : {}),
  };
}

/** The extension to save a sniffed type under. Empty when there's no good guess. */
const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "application/zip": "zip",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/flac": "flac",
  "application/vnd.sqlite3": "sqlite",
};

/**
 * The filename a saved blob lands under — `mus_albums-cover_image-12.png`.
 *
 * Identifier characters only, and the extension comes from the sniffed type
 * rather than from anything the caller sent, so a hostile column name can't
 * steer the download's name or type. Unknown types get `.bin`.
 */
export function blobDownloadFileName(source: BlobCellSource, mimeType: string): string {
  const safe = (part: string) => part.replace(/[^A-Za-z0-9_-]/g, "_");
  const extension = EXTENSIONS[mimeType] ?? "bin";
  return `${safe(source.tableName)}-${safe(source.columnName)}-${source.rowId}.${extension}`;
}

/** Bytes plus everything the serving route needs to send them. */
export interface BlobCellBytes {
  data: Uint8Array;
  mimeType: string;
  fileName: string;
}

/**
 * Reads one BLOB cell for serving.
 *
 * The address is validated here rather than in the route, and the mime type is
 * sniffed from the bytes rather than taken from the caller — so what gets served
 * is decided by what is actually stored, not by anything in the request.
 *
 * Returns undefined when the row is gone, the cell is NULL, or the cell is not a
 * BLOB. Throws when the table or column doesn't exist.
 */
export function readBlobCell(
  // Structural, rather than `Pick<SqlExplorerRepository, ...>`: the port imports
  // `BlobCellSource` from this file, and naming it here would close that into a
  // module cycle for no benefit — one method is all this needs.
  repo: { readBlobCell(source: BlobCellSource): Uint8Array | undefined },
  source: BlobCellSource,
): BlobCellBytes | undefined {
  const validated = blobCellSourceSchema.parse(source);
  const data = repo.readBlobCell(validated);
  if (!data) return undefined;

  const mimeType = sniffMimeType(data);
  return { data, mimeType, fileName: blobDownloadFileName(validated, mimeType) };
}
