import type { ConcurrencyLimit } from "@/lib/shared/concurrency";
import { orientationTransform, readEmbeddedThumbnail } from "./embedded-thumbnail";
import { EXIF_HEADER_BYTES } from "./exif";
import { isSafeRelativePath, normaliseRelativePath } from "./paths";
import type { PhotoFileStore, PhotoThumbnailRenderer } from "./ports";

// Use-case: a small image for one slot of the viewer's thumbnail strip.
//
// Exists because the strip used to show the ORIGINAL -- a multi-megabyte JPEG pulled over
// SMB and scaled down by the browser to 64px. Those downloads filled the browser's six
// connections, so the main photo, the heart and the EXIF lookup all waited behind them
// and the viewer felt hung. A thumbnail is a few kilobytes and frees a connection almost
// at once.
//
// Cheapest source first:
//   1. the EXIF preview the camera embedded (one partial read, no decode),
//   2. the original, shrunk by the renderer (a full read; at most a few at once),
//   3. the original as-is, when image processing is unavailable -- exactly what the
//      strip showed before, so a broken native module degrades to the old behaviour
//      instead of a strip of broken images.
//
// Source 2 is OPTIONAL, behind the `photo_thumbnail_resize` app setting (migrations/0185,
// default on). Off, a preview-less photo goes straight to source 3. Source 1 is never
// gated: it is 8.7x to 13.3x cheaper than source 2 and is why the strip is quick at all.
//
// Nothing is cached or written: every request builds its answer in memory.

/** Pixels on the thumbnail's shorter side: a 64px slot at 2x, with a little to spare. */
export const THUMBNAIL_SIZE = 160;

export type PhotoThumbnailSource = "embedded" | "rendered" | "original";

export interface PhotoThumbnail {
  data: Uint8Array;
  mimeType: string;
  /** Where the bytes came from -- for tests and diagnostics, not shown to anyone. */
  source: PhotoThumbnailSource;
}

export interface PhotoThumbnailDeps {
  store: PhotoFileStore;
  renderer: PhotoThumbnailRenderer;
  /**
   * Gate for the expensive path (full read + shrink).
   *
   * SHARED ACROSS REQUESTS, which is why it is injected rather than created here: the
   * point is to cap the server as a whole, not one call. The embedded path skips it --
   * a 128KB header read is the same cost as the EXIF lookup and needs no queue.
   */
  limit: ConcurrencyLimit;
  /**
   * Whether the server may SHRINK an original (source 2 above).
   *
   * The `photo_thumbnail_resize` app setting, read per request so the switch takes
   * effect on the next click with no restart -- see `thumbnail-settings.ts` and
   * migrations/0185. Off sends source 3, the original as-is, which is exactly what the
   * strip served before 2026-11-17.
   *
   * Never gates source 1: an embedded preview is always used when there is one, and
   * rotating a sideways 160x120 preview stays on too. Serving a thumbnail on its side is
   * WRONG OUTPUT, not a cheaper one, and that rotation costs about a millisecond.
   */
  resizeOriginals: boolean;
}

/**
 * The thumbnail for one photo, or `undefined` when the photo cannot be read at all.
 *
 * Never throws for a bad photo or an unavailable renderer: an unreadable file is
 * `undefined` (the route's 404), and a renderer failure falls back as described above.
 */
export async function readPhotoThumbnail(
  deps: PhotoThumbnailDeps,
  input: { relativePath: string },
): Promise<PhotoThumbnail | undefined> {
  const relativePath = normaliseRelativePath(input.relativePath);
  // Refused here as well as at the route's schema and again in `NodePhotoFileStore`.
  // Belt and braces on any path that becomes a file read. Checked on the RAW input:
  // normalising drops empty segments, which would turn `/etc/x.jpg` into `etc/x.jpg`.
  if (!isSafeRelativePath(input.relativePath)) return undefined;

  const header = await readHeaderQuietly(deps.store, relativePath);
  const embedded = header === undefined ? undefined : readEmbeddedThumbnail(header);

  if (embedded !== undefined) {
    const transform = orientationTransform(embedded.orientation);
    if (transform === undefined) {
      return { data: embedded.jpeg, mimeType: "image/jpeg", source: "embedded" };
    }
    // A sideways preview needs turning. Cheap -- it is 160x120 -- so no gate. If the
    // renderer is unavailable the preview would show on its side, so fall through to
    // the original rather than serve something wrong.
    try {
      const data = await deps.renderer.render(embedded.jpeg, { size: THUMBNAIL_SIZE, transform });
      return { data, mimeType: "image/jpeg", source: "embedded" };
    } catch {
      // Fall through.
    }
  }

  // Switched off: skip the shrink AND the gate. The gate exists to cap concurrent
  // resizes, so queueing a plain read behind it would throttle reads for no reason.
  if (!deps.resizeOriginals) {
    const original = await deps.store.readPhoto(relativePath);
    if (original === undefined) return undefined;
    return { data: original.data, mimeType: original.mimeType, source: "original" };
  }

  return deps.limit(async () => {
    const original = await deps.store.readPhoto(relativePath);
    if (original === undefined) return undefined;
    try {
      const data = await deps.renderer.render(original.data, { size: THUMBNAIL_SIZE });
      return { data, mimeType: "image/jpeg", source: "rendered" as const };
    } catch {
      return { data: original.data, mimeType: original.mimeType, source: "original" as const };
    }
  });
}

/** The header bytes, or `undefined` when the read fails -- a failure here is not fatal. */
async function readHeaderQuietly(
  store: PhotoFileStore,
  relativePath: string,
): Promise<Uint8Array | undefined> {
  try {
    return await store.readHeader(relativePath, EXIF_HEADER_BYTES);
  } catch {
    return undefined;
  }
}
