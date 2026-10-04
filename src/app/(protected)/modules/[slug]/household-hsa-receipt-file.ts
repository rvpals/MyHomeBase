// Browser-side preparation of a receipt file, for the HSA editor.
//
// This is file *handling*, not a business rule: the server re-checks everything (type
// allowlist, size cap, the PDF signature) on the decoded bytes.
//
// Two sources, treated differently on purpose:
//
// - `"attach"` — a file the reader chose. Sent **byte-for-byte**. They picked that
//   exact file, so re-encoding it would hand the archive something they never saw:
//   a scan loses its text layer, a careful photo loses detail. Only the name changes,
//   and that happens on the server.
// - `"camera"` — a shot just taken. Shrunk, because a modern phone emits 4-8 MB and a
//   server action's body is capped at 4 MB, so the untouched frame would simply be
//   refused. Nobody has "the original" of a photo taken seconds ago into this form,
//   which is what makes re-encoding it fair here and not above.

import {
  HSA_RECEIPT_MIME_TYPES,
  MAX_HSA_RECEIPT_BYTES,
  type HsaReceiptUploadInput,
} from "@/lib/household/hsa-schema";

/**
 * The longest edge a camera photo keeps.
 *
 * The server files whatever it is given, so this is the only resize — which is why it
 * is generous: a receipt has to stay legible down to the line items, unlike a recipe
 * picture at 800px.
 */
const MAX_EDGE = 2000;
const JPEG_QUALITY = 0.85;

function readBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error("That file could not be read."));
    reader.readAsDataURL(blob);
  });
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

/** Where the file came from. See the note at the top of this file. */
export type ReceiptSource = "attach" | "camera";

/**
 * Turns a chosen file or a camera shot into the upload the server action takes.
 *
 * `fileName` is the file's own name, never a path — a browser's `File.name` carries
 * no directory, and the server stores it as a record of what was uploaded rather than
 * using it on disk.
 *
 * Throws an Error whose message is fit to show.
 */
export async function prepareReceiptFile(
  file: File,
  source: ReceiptSource,
): Promise<HsaReceiptUploadInput> {
  if (!(HSA_RECEIPT_MIME_TYPES as readonly string[]).includes(file.type)) {
    throw new Error("Attach a PNG, JPEG, WebP, GIF image or a PDF.");
  }
  const mimeType = file.type as HsaReceiptUploadInput["mimeType"];

  let blob: Blob = file;
  let fileName = file.name || "receipt";
  let finalType = mimeType;

  // Only a camera shot is ever re-encoded. A PDF cannot be redrawn on a canvas, and an
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

  if (blob.size > MAX_HSA_RECEIPT_BYTES) {
    const limit = `${(MAX_HSA_RECEIPT_BYTES / 1024 / 1024).toFixed(1)} MB`;
    throw new Error(
      source === "attach"
        ? `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB — keep a receipt under ${limit}. An attached file is stored exactly as it is, so shrink or re-scan it first.`
        : `That photo is too large — keep a receipt under ${limit}.`,
    );
  }

  return { mimeType: finalType, base64Data: await readBase64(blob), fileName };
}
