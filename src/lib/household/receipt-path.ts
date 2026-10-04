// Where an HSA receipt file lives inside the receipt folder. Pure — no I/O.
//
//   <YYYY>/<YYYY-MM-DD>_<Payee>_<Amount>_<id>.<ext>
//   2026/2026-10-03_CVS_$42.50_17.jpg
//
// The year comes from the expense's Date, so the folders mirror the dates the person
// chose. The id is in the name so two expenses at one payee on one day for the same
// amount can never collide; the suffix helper below covers a stray file someone put
// there by hand.

/** The extension a stored receipt gets, by its mime type. */
const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
};

export function receiptExtension(mimeType: string): string {
  const extension = EXTENSIONS[mimeType];
  if (!extension) throw new Error(`No file extension for ${mimeType}.`);
  return extension;
}

/** The mime type to serve a stored file as, by its extension. `undefined` if unknown. */
export function receiptMimeTypeFor(fileName: string): string | undefined {
  const extension = fileName.slice(fileName.lastIndexOf(".") + 1).toLowerCase();
  if (extension === "jpeg") return "image/jpeg";
  return Object.entries(EXTENSIONS).find(([, ext]) => ext === extension)?.[0];
}

/**
 * Makes free text safe as part of a file name on Windows, macOS and a Synology share.
 *
 * Drops the characters any of them forbid (`<>:"/\|?*` and control characters), turns
 * runs of whitespace into one hyphen, trims stray dots and hyphens from the ends (a
 * trailing dot is silently stripped by Windows), and caps the length so a long payee
 * can't push the whole path past a filesystem limit. Never returns empty.
 */
export function sanitizeNameSegment(text: string, maxLength = 40): string {
  const cleaned = text
    // eslint-disable-next-line no-control-regex -- control characters are exactly what is being removed
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, maxLength)
    .replace(/^[.-]+|[.-]+$/g, "");
  return cleaned === "" ? "unknown" : cleaned;
}

export interface ReceiptPathInput {
  id: number;
  /** YYYY-MM-DD. */
  entryDate: string;
  payee: string;
  amountCents: number;
  mimeType: string;
}

/**
 * The relative path a receipt should be stored at, always with forward slashes.
 *
 * The amount carries its `$` — `2026-10-03_CVS_$42.50_17.jpg`. `$` is legal in a file
 * name on Windows, macOS and a Synology share. It is built here rather than passed
 * through `sanitizeNameSegment`, which is for free text a person typed.
 */
export function buildReceiptPath(input: ReceiptPathInput): string {
  const year = input.entryDate.slice(0, 4);
  const amount = `$${(input.amountCents / 100).toFixed(2)}`;
  const name = [input.entryDate, sanitizeNameSegment(input.payee), amount, String(input.id)].join("_");
  return `${year}/${name}.${receiptExtension(input.mimeType)}`;
}

/** `2026/a_17.jpg` with n = 2 -> `2026/a_17-2.jpg`. n = 1 is the path unchanged. */
export function withCollisionSuffix(relativePath: string, n: number): string {
  if (n <= 1) return relativePath;
  const dot = relativePath.lastIndexOf(".");
  const slash = relativePath.lastIndexOf("/");
  if (dot <= slash) return `${relativePath}-${n}`;
  return `${relativePath.slice(0, dot)}-${n}${relativePath.slice(dot)}`;
}
