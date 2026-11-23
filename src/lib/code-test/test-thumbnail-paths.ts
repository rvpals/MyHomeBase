import { readEmbeddedThumbnail } from "@/lib/journal-photos/embedded-thumbnail";
import { EXIF_HEADER_BYTES } from "@/lib/journal-photos/exif";
import { THUMBNAIL_SIZE } from "@/lib/journal-photos/thumbnail";
import type { ScannedPhoto } from "./pick-test-photos";
import type { CodeTestDeps } from "./ports";
import { formatBytes, formatKb, formatMs, line, messageOf, speedupOf } from "./report-format";

// Experiment: is the strip's embedded-preview path actually worth what it costs?
//
// The shipped `readPhotoThumbnail` reads only the first `EXIF_HEADER_BYTES` of a photo,
// pulls the EXIF preview out of it, and shrinks that. The fallback -- for a photo with no
// preview -- reads the whole file and shrinks the original. Both paths shipped in the
// 2026-11-17 release and NEITHER was ever timed; the single-photo resize test measures the
// fallback only, because it always reads the whole file.
//
// Times both, per photo, so the reports answer: how much does the preview path save, and
// what would it cost if a photo had no preview?
//
// ONE CAVEAT, stated in the report: `ImageLibProbe.resize` fits the LONGER edge where the
// shipped renderer fits the shorter, so the resize step here is slightly cheaper than
// production's. The read step -- which is the part being compared -- is identical.
//
// NEVER THROWS: every failure becomes a line.

interface PathTiming {
  readMs: number;
  resizeMs: number;
  outputBytes: number;
  /** Bytes pulled off the NAS to get there. */
  readBytes: number;
}

export async function testThumbnailPaths(
  deps: CodeTestDeps,
  input: { photos: ScannedPhoto[] },
): Promise<string> {
  const lines: string[] = [];

  if (input.photos.length === 0) {
    lines.push("Skipped. No photo could be scanned.");
    return lines.join("\n");
  }

  lines.push(
    line("Target", `a ${THUMBNAIL_SIZE}px strip thumbnail, the size the viewer asks for`),
    line("Header read", `first ${formatKb(EXIF_HEADER_BYTES)} (EXIF_HEADER_BYTES)`),
    line("Caveat", "the probe fits the longer edge; the shipped renderer fits the shorter"),
  );

  for (const photo of input.photos) {
    lines.push("", line("Photo", `${photo.name} (${formatBytes(photo.bytes)})`));

    const viaPreview = await timePreviewPath(deps, photo);
    const viaOriginal = await timeOriginalPath(deps, photo);

    lines.push(
      line("  preview", typeof viaPreview === "string" ? viaPreview : describe(viaPreview)),
      line("  original", typeof viaOriginal === "string" ? viaOriginal : describe(viaOriginal)),
    );

    if (typeof viaPreview !== "string" && typeof viaOriginal !== "string") {
      const previewTotal = viaPreview.readMs + viaPreview.resizeMs;
      const originalTotal = viaOriginal.readMs + viaOriginal.resizeMs;
      lines.push(
        line(
          "  verdict",
          `preview path is ${speedupOf(originalTotal, previewTotal)}, ` +
            `reading ${formatKb(viaPreview.readBytes)} instead of ${formatKb(viaOriginal.readBytes)}`,
        ),
      );
    }
  }

  return lines.join("\n");
}

/** The shipped path. A string instead of a timing when the photo has no preview. */
async function timePreviewPath(
  deps: CodeTestDeps,
  photo: ScannedPhoto,
): Promise<PathTiming | string> {
  let header: { data: Uint8Array; ms: number } | undefined;
  try {
    header = await deps.reader.readHeader(photo.relativePath, EXIF_HEADER_BYTES);
  } catch (error) {
    return `header read failed: ${messageOf(error)}`;
  }
  if (header === undefined) return "header unreadable";

  const preview = readEmbeddedThumbnail(header.data);
  if (preview === undefined) return "no embedded preview, so this path does not apply";

  try {
    const resized = await deps.imageLib.resize(preview.jpeg, THUMBNAIL_SIZE);
    return {
      readMs: header.ms,
      resizeMs: resized.ms,
      outputBytes: resized.data.length,
      readBytes: header.data.length,
    };
  } catch (error) {
    return `resizing the preview failed: ${messageOf(error)}`;
  }
}

/** The fallback path: whole file, shrink the original. */
async function timeOriginalPath(
  deps: CodeTestDeps,
  photo: ScannedPhoto,
): Promise<PathTiming | string> {
  let file: { data: Uint8Array; ms: number } | undefined;
  try {
    file = await deps.reader.read(photo.relativePath);
  } catch (error) {
    return `read failed: ${messageOf(error)}`;
  }
  if (file === undefined) return "unreadable";

  try {
    const resized = await deps.imageLib.resize(file.data, THUMBNAIL_SIZE);
    return {
      readMs: file.ms,
      resizeMs: resized.ms,
      outputBytes: resized.data.length,
      readBytes: file.data.length,
    };
  } catch (error) {
    return `resizing the original failed: ${messageOf(error)}`;
  }
}

function describe(timing: PathTiming): string {
  const total = timing.readMs + timing.resizeMs;
  return (
    `${formatMs(total)} total (read ${formatMs(timing.readMs)}, resize ${formatMs(timing.resizeMs)}), ` +
    `${formatBytes(timing.outputBytes)} out`
  );
}
