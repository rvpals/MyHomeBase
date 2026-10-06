// Browser-side preparation of a receipt, for the HSA editor.
//
// This is file *handling*, not a business rule: the server re-checks everything (type
// allowlist, size cap, the file signature) on the bytes it receives.
//
// Three paths, deliberately different:
//
// - **One attached file** — sent byte-for-byte. The reader picked that exact file, so
//   re-encoding it would hand the archive something they never saw: a scan loses its
//   text layer, a careful photo loses detail. Only the name changes, server-side.
// - **Several attached files** — packed into one zip, so an expense still holds
//   exactly one file and the whole rename/move/delete path stays as it is. Each file
//   keeps its own name inside the archive, and the entries are STORED, so unpacking
//   gives back the originals bit-for-bit.
// - **A camera shot** — shrunk, because a modern phone emits 4-8 MB. Nobody has "the
//   original" of a photo taken seconds ago into this form, which is what makes
//   re-encoding fair here and not above.

import {
  HSA_RECEIPT_MIME_TYPES,
  MAX_HSA_RECEIPT_BYTES,
  type HsaReceiptMimeType,
} from "@/lib/household/hsa-schema";
import { buildZip, type ZipEntry } from "@/lib/zip";

/**
 * The longest edge a camera photo keeps.
 *
 * The server files whatever it is given, so this is the only resize — which is why it
 * is generous: a receipt has to stay legible down to the line items, unlike a recipe
 * picture at 800px.
 */
const MAX_EDGE = 2000;
const JPEG_QUALITY = 0.85;

/** Where the file came from. See the note at the top of this file. */
export type ReceiptSource = "attach" | "camera";

/**
 * A receipt ready to post, as the action's `FormData` needs it.
 *
 * `blob` rather than base64: the upload travels as binary, which is what keeps it
 * clear of React's per-character slot counter on string arguments. See
 * `setHsaReceiptAction`.
 */
export interface PreparedReceipt {
  blob: Blob;
  mimeType: HsaReceiptMimeType;
  /** The name recorded against the expense. Names every file when it is an archive. */
  fileName: string;
}

/** Redraws an image no wider than `MAX_EDGE`, as JPEG. EXIF rotation is applied by the bitmap. */
async function shrinkImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot resize that image.");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("That image could not be resized."))),
      "image/jpeg",
      JPEG_QUALITY,
    ),
  );
}

/** The app's own cap, in the wording the reader sees. */
function tooLarge(actualBytes: number, source: ReceiptSource, isArchive: boolean): Error {
  const limit = `${(MAX_HSA_RECEIPT_BYTES / 1024 / 1024).toFixed(0)} MB`;
  const actual = `${(actualBytes / 1024 / 1024).toFixed(1)} MB`;
  if (source === "camera") return new Error(`That photo is ${actual} — keep a receipt under ${limit}.`);
  return new Error(
    isArchive
      ? `Those files come to ${actual} zipped — keep a receipt under ${limit}. Attach fewer, or shrink them first.`
      : `That file is ${actual} — keep a receipt under ${limit}. An attached file is stored exactly as it is, so shrink or re-scan it first.`,
  );
}

/** Rejects anything outside the allowlist, naming the file when there are several. */
function assertAllowedType(file: File, many: boolean): HsaReceiptMimeType {
  if (!(HSA_RECEIPT_MIME_TYPES as readonly string[]).includes(file.type) || file.type === "application/zip") {
    throw new Error(
      many
        ? `${file.name || "A file"} is not a PNG, JPEG, WebP, GIF or PDF.`
        : "Attach a PNG, JPEG, WebP, GIF image or a PDF.",
    );
  }
  return file.type as HsaReceiptMimeType;
}

/**
 * Makes a name safe to extract to, and unique within the archive.
 *
 * `buildZip` rejects a name that would escape the archive root, and a duplicate would
 * make one of two files unreachable — both are possible here, since these names come
 * from whatever the reader picked.
 */
function archiveEntryName(rawName: string, index: number, taken: Set<string>): string {
  const base = (rawName || `file-${index + 1}`).replace(/[/\\]/g, "-").replace(/^\.+/, "");
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const extension = dot > 0 ? base.slice(dot) : "";
  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}${extension}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}

/**
 * Turns the chosen file(s), or a camera shot, into one upload.
 *
 * Several files become one zip; a single file is passed through untouched. Throws an
 * Error whose message is fit to show.
 */
export async function prepareReceipt(
  files: File[],
  source: ReceiptSource,
): Promise<PreparedReceipt> {
  if (files.length === 0) throw new Error("No file was chosen.");

  // ---- several files: one archive --------------------------------------------
  if (files.length > 1) {
    const taken = new Set<string>();
    const entries: ZipEntry[] = [];
    for (const [index, file] of files.entries()) {
      assertAllowedType(file, true);
      entries.push({
        name: archiveEntryName(file.name, index, taken),
        data: new Uint8Array(await file.arrayBuffer()),
      });
    }
    const blob = new Blob([buildZip(entries) as BlobPart], { type: "application/zip" });
    if (blob.size > MAX_HSA_RECEIPT_BYTES) throw tooLarge(blob.size, source, true);
    return {
      blob,
      mimeType: "application/zip",
      // Names every file, so the grid and the viewer can say what is inside without
      // unpacking the archive.
      fileName: `${entries.map((entry) => entry.name).join(" + ")} (${entries.length} files)`,
    };
  }

  // ---- one file ----------------------------------------------------------------
  const file = files[0];
  const mimeType = assertAllowedType(file, false);
  let blob: Blob = file;
  let fileName = file.name || "receipt";
  let finalType: HsaReceiptMimeType = mimeType;

  // Only a camera shot is ever re-encoded. A PDF cannot be redrawn on a canvas and an
  // animated GIF would be flattened to its first frame — though neither can reach this
  // branch anyway, since the camera input accepts `image/*` and emits JPEG.
  const canShrink = mimeType !== "application/pdf" && mimeType !== "image/gif";
  if (source === "camera" && canShrink && file.size > 1024 * 1024) {
    try {
      blob = await shrinkImage(file);
      finalType = "image/jpeg";
      fileName = fileName.replace(/\.[^.]+$/, "") + ".jpg";
    } catch {
      // Fall through with the original; the size check below reports it if too big.
      blob = file;
    }
  }

  if (blob.size > MAX_HSA_RECEIPT_BYTES) throw tooLarge(blob.size, source, false);
  return { blob, mimeType: finalType, fileName };
}

/** The `FormData` the upload action takes. Built here so the shape has one definition. */
export function receiptFormData(expenseId: number, receipt: PreparedReceipt): FormData {
  const formData = new FormData();
  formData.set("id", String(expenseId));
  formData.set("mimeType", receipt.mimeType);
  formData.set("fileName", receipt.fileName);
  formData.set("file", receipt.blob);
  return formData;
}
