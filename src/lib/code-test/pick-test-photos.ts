import { readEmbeddedThumbnail } from "@/lib/journal-photos/embedded-thumbnail";
import { EXIF_HEADER_BYTES } from "@/lib/journal-photos/exif";
import type { TimedPhotoReader } from "./ports";

// Scans one folder cheaply, so the experiments that follow run on photos chosen from the
// WHOLE folder rather than whatever came first alphabetically.
//
// A stat plus the first `EXIF_HEADER_BYTES` per photo, never the whole file: the size
// comes from the stat, and an EXIF preview lives in the first few KB. That is also the
// read the shipped thumbnail route makes (`readPhotoThumbnail`), so the scan costs about
// what a strip of thumbnails costs and not 400 multi-megabyte reads over SMB.

/**
 * Most photos scanned, as a safety rail rather than a meaningful limit.
 *
 * Set far above a real month folder (the archive's biggest run to a few hundred) because
 * the per-photo cost is a stat and 128KB. The earlier 150 was a whole-file-read budget,
 * and it made "the largest photo" mean "the largest of the first 150 by name".
 */
export const MAX_SCAN = 2_000;

export interface ScannedPhoto {
  relativePath: string;
  name: string;
  bytes: number;
  hasPreview: boolean;
  /** The embedded preview's own size, when there is one. */
  previewBytes?: number;
}

export interface PickedPhotos {
  /** Photos in the folder, before the cap. */
  totalInFolder: number;
  /** Photos successfully scanned. */
  scanned: number;
  /** Photos that could not be read (missing, or the read threw). */
  unreadable: number;
  /** True when the folder held more photos than the cap. */
  isCapped: boolean;
  /** Wall-clock for the whole scan. */
  scanMs: number;
  withPreviewCount: number;
  withoutPreviewCount: number;
  /** Every scanned photo, ascending by size. */
  bySize: ScannedPhoto[];
  /** `undefined` when nothing could be scanned. */
  smallest?: ScannedPhoto;
  median?: ScannedPhoto;
  largest?: ScannedPhoto;
  /** The first scanned photo with no embedded preview -- rare, mostly scans. */
  withoutPreview?: ScannedPhoto;
}

export async function pickTestPhotos(
  deps: { reader: TimedPhotoReader; now: () => number },
  photos: { relativePath: string; name: string }[],
  maxScan: number = MAX_SCAN,
): Promise<PickedPhotos> {
  const startedAt = deps.now();
  const toScan = photos.slice(0, maxScan);
  const scanned: ScannedPhoto[] = [];
  let unreadable = 0;

  for (const photo of toScan) {
    const found = await scanOne(deps.reader, photo);
    if (found === undefined) {
      unreadable += 1;
      continue;
    }
    scanned.push(found);
  }

  const bySize = [...scanned].sort((a, b) => a.bytes - b.bytes);

  return {
    totalInFolder: photos.length,
    scanned: scanned.length,
    unreadable,
    isCapped: photos.length > maxScan,
    scanMs: deps.now() - startedAt,
    withPreviewCount: scanned.filter((photo) => photo.hasPreview).length,
    withoutPreviewCount: scanned.filter((photo) => !photo.hasPreview).length,
    bySize,
    smallest: bySize[0],
    median: bySize[Math.floor(bySize.length / 2)],
    largest: bySize[bySize.length - 1],
    withoutPreview: scanned.find((photo) => !photo.hasPreview),
  };
}

/** `undefined` when the photo cannot be read at all -- one bad file must not fail a scan. */
async function scanOne(
  reader: TimedPhotoReader,
  photo: { relativePath: string; name: string },
): Promise<ScannedPhoto | undefined> {
  try {
    const stat = await reader.stat(photo.relativePath);
    if (stat === undefined) return undefined;

    const header = await reader.readHeader(photo.relativePath, EXIF_HEADER_BYTES);
    const preview = header === undefined ? undefined : readEmbeddedThumbnail(header.data);

    return {
      relativePath: photo.relativePath,
      name: photo.name,
      bytes: stat.bytes,
      hasPreview: preview !== undefined,
      previewBytes: preview?.jpeg.length,
    };
  } catch {
    return undefined;
  }
}

/**
 * `count` photos spread evenly across the size range, for the concurrency batch.
 *
 * Evenly spread rather than the biggest `count`, so the batch's timing reflects a mix of
 * sizes like a real strip request, not a worst case.
 */
export function samplePhotos(bySize: ScannedPhoto[], count: number): ScannedPhoto[] {
  if (bySize.length === 0 || count <= 0) return [];
  if (bySize.length <= count) return [...bySize];
  // One of many: the largest, which is the interesting end of the range.
  if (count === 1) return [bySize[bySize.length - 1]];

  const picked: ScannedPhoto[] = [];
  for (let index = 0; index < count; index += 1) {
    // Spans the range end to end: index 0 is the smallest, the last the largest.
    picked.push(bySize[Math.round((index * (bySize.length - 1)) / (count - 1))]);
  }
  return picked;
}
