import { pickTestPhotos, samplePhotos, type PickedPhotos, type ScannedPhoto } from "./pick-test-photos";
import type { CodeTestDeps } from "./ports";
import { formatBytes, formatMb, formatMs, heading, line } from "./report-format";
import { testResizeConcurrency } from "./test-resize-concurrency";
import { testServerResizeImage } from "./test-server-resize-image";
import { testThumbnailPaths } from "./test-thumbnail-paths";

// The Code Tester's one button: scan a folder, then run every experiment on photos chosen
// from it, and return ONE plain-text report.
//
// Four sections, cheapest first, so a reader who stops after the first still learns
// something and a failure late on does not cost the earlier numbers:
//
//   1. Folder scan      -- what is actually in there, and the size distribution
//   2. Resize sizes     -- 160/1024/2048 on the median and the largest photo
//   3. Thumbnail paths  -- the shipped preview path against the whole-file fallback
//   4. Concurrency      -- throughput at 1, 2, 3 and 4 resizes at once
//
// NEVER THROWS. Every experiment below reports its own failures as lines.

/** Photos in the concurrency batch, spread across the folder's size range. */
export const CONCURRENCY_BATCH = 4;

export async function runServerResizeSuite(
  deps: CodeTestDeps,
  input: { folderPath: string; photos: { relativePath: string; name: string }[] },
): Promise<string> {
  const startedAt = deps.now();
  const lines: string[] = ["Server image resize suite", "", line("Folder", input.folderPath)];

  if (input.photos.length === 0) {
    lines.push("", "No photos in that folder. Nothing was run.");
    return lines.join("\n");
  }

  const picked = await pickTestPhotos(deps, input.photos);
  lines.push("", heading("1 of 4: Folder scan"), ...scanLines(picked));

  if (picked.scanned === 0) {
    lines.push("", "Nothing could be scanned, so no experiment ran.");
    lines.push("", line("Suite total", formatMs(deps.now() - startedAt)));
    return lines.join("\n");
  }

  lines.push("", heading("2 of 4: Resize sizes"));
  for (const subject of resizeSubjects(picked)) {
    lines.push("", line("Subject", `${subject.label} -- ${subject.photo.name}`));
    lines.push(await testServerResizeImage(deps, { relativePath: subject.photo.relativePath }));
  }

  lines.push("", heading("3 of 4: Thumbnail paths"));
  lines.push(await testThumbnailPaths(deps, { photos: thumbnailSubjects(picked) }));

  lines.push("", heading("4 of 4: Concurrency"));
  lines.push(
    await testResizeConcurrency(deps, { photos: samplePhotos(picked.bySize, CONCURRENCY_BATCH) }),
  );

  lines.push("", line("Suite total", formatMs(deps.now() - startedAt)));
  return lines.join("\n");
}

function scanLines(picked: PickedPhotos): string[] {
  const lines = [
    line(
      "Scanned",
      `${picked.scanned} of ${picked.totalInFolder} photos in ${formatMs(picked.scanMs)}` +
        (picked.isCapped ? " (capped, the rest were not read)" : "") +
        (picked.unreadable > 0 ? `, ${picked.unreadable} unreadable` : ""),
    ),
    line("Method", "a stat plus the first 128KB per photo -- no whole file was read"),
    line(
      "EXIF previews",
      `${picked.withPreviewCount} have one, ${picked.withoutPreviewCount} do not`,
    ),
  ];

  if (picked.smallest !== undefined && picked.median !== undefined && picked.largest !== undefined) {
    lines.push(
      line("Smallest", sizeOf(picked.smallest)),
      line("Median", sizeOf(picked.median)),
      line("Largest", sizeOf(picked.largest)),
    );
  }
  if (picked.withoutPreview !== undefined) {
    lines.push(line("No preview", `e.g. ${picked.withoutPreview.name} -- rare, usually a scan`));
  }
  return lines;
}

function sizeOf(photo: ScannedPhoto): string {
  const preview =
    photo.previewBytes === undefined
      ? "no preview"
      : `${formatBytes(photo.previewBytes)} preview`;
  return `${photo.name}, ${formatBytes(photo.bytes)} (${formatMb(photo.bytes)}), ${preview}`;
}

/**
 * The median and the largest.
 *
 * The median is the one that predicts a typical request; the largest is the worst case.
 * They can be the same photo in a folder of two, which is honest rather than a bug.
 */
function resizeSubjects(picked: PickedPhotos): { label: string; photo: ScannedPhoto }[] {
  const subjects: { label: string; photo: ScannedPhoto }[] = [];
  if (picked.median !== undefined) subjects.push({ label: "median size", photo: picked.median });
  if (picked.largest !== undefined && picked.largest !== picked.median) {
    subjects.push({ label: "largest file", photo: picked.largest });
  }
  return subjects;
}

/** The median and the largest, plus a photo with no preview when the folder has one. */
function thumbnailSubjects(picked: PickedPhotos): ScannedPhoto[] {
  const subjects = resizeSubjects(picked).map((subject) => subject.photo);
  if (picked.withoutPreview !== undefined && !subjects.includes(picked.withoutPreview)) {
    subjects.push(picked.withoutPreview);
  }
  return subjects;
}
