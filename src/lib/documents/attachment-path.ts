// Where a document's attachment lives inside the document folder. Pure — no I/O.
//
//   doc_<id>/<sanitized-original-name>
//   doc_17/lease-2026.pdf
//
// One folder per document, flat under the root — no year folders. A document has no
// date in this module (that was a deliberate call: nothing here is filed by when it
// happened), so there is no year to file it under, and giving each document its own
// folder keeps the root to one entry per document however many files it holds.

/** Where a deleted document's files are moved to, under the root. */
export const DELETED_FOLDER = "_deleted";

/** The folder one document's files live in, relative to the root. */
export function documentFolder(documentId: number): string {
  return `doc_${documentId}`;
}

/** Where that folder is moved on a delete-with-files. */
export function deletedDocumentFolder(documentId: number): string {
  return `${DELETED_FOLDER}/doc_${documentId}`;
}

/**
 * Makes a file name safe on Windows, macOS and a Synology share.
 *
 * Drops the characters any of them forbid (`<>:"/\|?*` and control characters), turns
 * runs of whitespace into one hyphen, strips leading dots (so a dropped file cannot
 * become `.hidden` or climb with `..`), trims stray dots and hyphens from the ends (a
 * trailing dot is silently dropped by Windows), and caps the length so a long name
 * can't push the path past a filesystem limit. Never returns empty.
 *
 * The extension is preserved separately by `sanitizeFileName` below — capping the
 * whole string would otherwise be able to truncate ".pdf" off the end.
 *
 * This is **defence in depth, not the boundary**: `resolveInside` in `file-store.ts`
 * is what actually guarantees a write lands inside the root. A sanitiser that tried to
 * be the only guard would eventually miss a case.
 */
export function sanitizeNameSegment(text: string, maxLength = 80): string {
  const cleaned = text
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/^\.+/, "")
    .slice(0, maxLength)
    .replace(/^[.-]+|[.-]+$/g, "");
  return cleaned === "" ? "file" : cleaned;
}

/**
 * A stored file name built from the name the file arrived with.
 *
 * The extension is split off first and sanitised on its own, so a 200-character name
 * is truncated in its *stem* and still ends in `.pdf`. An extension longer than 10
 * characters is treated as part of the name rather than an extension — that is a file
 * called "report.final version", not a file of type "final version".
 */
export function sanitizeFileName(originalName: string): string {
  const dot = originalName.lastIndexOf(".");
  const hasExtension = dot > 0 && originalName.length - dot - 1 <= 10;
  if (!hasExtension) return sanitizeNameSegment(originalName);

  const stem = sanitizeNameSegment(originalName.slice(0, dot));
  const extension = sanitizeNameSegment(originalName.slice(dot + 1), 10).toLowerCase();
  return `${stem}.${extension}`;
}

/** The relative path a document's attachment is stored at, forward slashes always. */
export function buildAttachmentPath(documentId: number, originalName: string): string {
  return `${documentFolder(documentId)}/${sanitizeFileName(originalName)}`;
}

/**
 * `doc_17/a.pdf` with n = 2 -> `doc_17/a-2.pdf`. n = 1 is the path unchanged.
 *
 * Two files of the same name on one document is an ordinary thing to do — two scans
 * both called "Scan.pdf" — so the collision is resolved rather than refused.
 */
export function withCollisionSuffix(relativePath: string, n: number): string {
  if (n <= 1) return relativePath;
  const dot = relativePath.lastIndexOf(".");
  const slash = relativePath.lastIndexOf("/");
  if (dot <= slash) return `${relativePath}-${n}`;
  return `${relativePath.slice(0, dot)}-${n}${relativePath.slice(dot)}`;
}

/**
 * The mime type to serve a stored file as, by its extension.
 *
 * A **fixed allowlist**, and anything unlisted is served as
 * `application/octet-stream` — which makes the browser download it rather than render
 * it. That is the safe default: these bytes come back from our own origin, so letting
 * an unknown extension pick its own content type is how a stored `.html` becomes
 * script running on our domain. The serving route pairs this with `nosniff`.
 */
const MIME_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  svg: "image/svg+xml",
  txt: "text/plain",
  csv: "text/csv",
  md: "text/markdown",
  rtf: "application/rtf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  zip: "application/zip",
  json: "application/json",
  xml: "application/xml",
};

export const DEFAULT_MIME_TYPE = "application/octet-stream";

export function mimeTypeFor(fileName: string): string {
  const extension = fileName.slice(fileName.lastIndexOf(".") + 1).toLowerCase();
  return MIME_TYPES[extension] ?? DEFAULT_MIME_TYPE;
}

/**
 * Whether a stored file is one the browser may render inline.
 *
 * Only images and PDFs. Everything else is sent as an attachment download, including
 * `text/html` and `image/svg+xml` — an SVG is a document that can carry script, so
 * rendering one inline from our own origin would be an XSS hole with a file picker in
 * front of it.
 */
export function isInlineRenderable(mimeType: string): boolean {
  if (mimeType === "image/svg+xml") return false;
  return mimeType === "application/pdf" || mimeType.startsWith("image/");
}
