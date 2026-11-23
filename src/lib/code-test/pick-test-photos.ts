import { readEmbeddedThumbnail } from "@/lib/journal-photos/embedded-thumbnail";
import type { TimedPhotoReader } from "./ports";

// Picks the three photos the resize suite measures from one folder: one with an EXIF
// preview, one without, and the biggest file. Reads each photo once, sequentially, and
// keeps only a size and a flag -- never the bytes -- so a big folder costs time, not memory.

/** Most photos read per folder, so an enormous folder cannot stall the screen. */
export const MAX_SCAN = 150;

export interface ScannedPhoto {
  relativePath: string;
  name: string;
  bytes: number;
  hasPreview: boolean;
}

export interface PickedPhotos {
  /** Photos in the folder, before the cap. */
  totalInFolder: number;
  /** Photos actually read. */
  scanned: number;
  /** Photos that could not be read (missing, or the read threw). */
  unreadable: number;
  /** True when the folder had more photos than the cap. */
  isCapped: boolean;
  withPreviewCount: number;
  withoutPreviewCount: number;
  /** `undefined` when no scanned photo fits the role. */
  withPreview?: ScannedPhoto;
  withoutPreview?: ScannedPhoto;
  largest?: ScannedPhoto;
}

export async function pickTestPhotos(
  reader: TimedPhotoReader,
  photos: { relativePath: string; name: string }[],
  maxScan: number = MAX_SCAN,
): Promise<PickedPhotos> {
  const toScan = photos.slice(0, maxScan);
  const scanned: ScannedPhoto[] = [];
  let unreadable = 0;

  for (const photo of toScan) {
    try {
      const file = await reader.read(photo.relativePath);
      if (file === undefined) {
        unreadable += 1;
        continue;
      }
      scanned.push({
        relativePath: photo.relativePath,
        name: photo.name,
        bytes: file.data.length,
        hasPreview: readEmbeddedThumbnail(file.data) !== undefined,
      });
    } catch {
      unreadable += 1;
    }
  }

  let largest: ScannedPhoto | undefined;
  for (const photo of scanned) {
    if (largest === undefined || photo.bytes > largest.bytes) largest = photo;
  }

  const withPreviewAll = scanned.filter((photo) => photo.hasPreview);
  const withoutPreviewAll = scanned.filter((photo) => !photo.hasPreview);
  // Prefer a photo that is not the largest, so the three tests are three different
  // photos; fall back to the largest when it is the only one of its kind.
  const firstOf = (list: ScannedPhoto[]) => list.find((photo) => photo !== largest) ?? list[0];

  return {
    totalInFolder: photos.length,
    scanned: scanned.length,
    unreadable,
    isCapped: photos.length > maxScan,
    withPreviewCount: withPreviewAll.length,
    withoutPreviewCount: withoutPreviewAll.length,
    withPreview: firstOf(withPreviewAll),
    withoutPreview: firstOf(withoutPreviewAll),
    largest,
  };
}
