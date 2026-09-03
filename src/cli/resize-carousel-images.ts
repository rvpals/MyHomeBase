// Re-encodes carousel graphics that are already stored, so the ones uploaded
// before the resizer existed catch up without being re-uploaded by hand.
//
// Nothing used to resize these: the upload control only rejected files over 2 MB,
// so a full-size photo was stored whole and then downloaded whole to fill a
// 192px tile. That is what made the home carousel paint in slowly from the top.
// New uploads are shrunk on the way in; this is the backfill.
//
//   npm run cli -- resize-carousel-images --dry-run   # report, change nothing
//   npm run cli -- resize-carousel-images
//
// Safe to run repeatedly: a second pass over an already-resized WebP is inside
// the box and already the right format, so it is reported as skipped and not
// rewritten. There is no undo beyond a database restore — run `--dry-run` first,
// and note the NAS keeps dated `.bak` copies.
import {
  CAROUSEL_IMAGE_MAX_EDGE,
  resizeCarouselImage,
  setModuleCarouselImage,
} from "@/lib/modules";
import { deps } from "@/lib/wiring";
import { messageOf } from "./error-message";

const USAGE = `Usage:
  npm run cli -- resize-carousel-images [--dry-run] [--max-edge <px>]

Options:
  --dry-run        Report what would change without writing anything.
  --max-edge <px>  Longest edge to allow (default ${CAROUSEL_IMAGE_MAX_EDGE}).

Downscales each stored carousel graphic to fit ${CAROUSEL_IMAGE_MAX_EDGE}px and re-encodes it
as WebP. Never upscales and never crops. An animated GIF is left alone, because
flattening it to its first frame would silently kill the animation.

There is no undo beyond restoring the database — use --dry-run first.`;

export async function resizeCarouselImagesCommand(argv: string[]): Promise<void> {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    return;
  }

  const dryRun = argv.includes("--dry-run");

  const maxEdgeIndex = argv.indexOf("--max-edge");
  let maxEdge = CAROUSEL_IMAGE_MAX_EDGE;
  if (maxEdgeIndex !== -1) {
    // Validated rather than coerced: `Number(undefined)` is NaN, which would
    // otherwise reach sharp as a resize target and fail somewhere much less clear.
    const parsed = Number(argv[maxEdgeIndex + 1]);
    if (!Number.isInteger(parsed) || parsed < 32 || parsed > 4096) {
      console.error("--max-edge needs a whole number of pixels between 32 and 4096.");
      process.exitCode = 1;
      return;
    }
    maxEdge = parsed;
  }

  try {
    const stored = deps.moduleRepo.listAllCarouselImages();
    if (stored.length === 0) {
      console.log("No carousel graphics stored — nothing to do.");
      return;
    }

    console.log(
      `${stored.length} carousel graphic(s), target ${maxEdge}px` +
        `${dryRun ? " — dry run, nothing will be written" : ""}:`,
    );

    let changed = 0;
    let skipped = 0;
    let failed = 0;
    let savedBytes = 0;

    for (const row of stored) {
      try {
        const result = await resizeCarouselImage(
          deps.carouselImageProcessor,
          { data: row.data, mimeType: row.mimeType },
          { maxEdge },
        );

        if (!result.resized) {
          const why =
            result.skippedReason === "animated-format"
              ? "animated format, left as is"
              : "already small enough";
          console.log(`  ${row.slug}: skipped — ${why} (${kb(row.data.length)})`);
          skipped += 1;
          continue;
        }

        const delta = result.originalBytes - result.data.length;
        console.log(
          `  ${row.slug}: ${kb(result.originalBytes)} -> ${kb(result.data.length)}` +
            ` (${result.width}x${result.height} webp, ${percent(delta, result.originalBytes)} smaller)`,
        );

        if (!dryRun) {
          // Through the use-case rather than a direct `setCarouselImage` so the
          // slug check and the `updated_at` stamp stay in one place. The stamp
          // matters: it is the `?v=` cache-buster, so without it a browser would
          // keep serving the old bytes from cache.
          //
          // No processor argument — these bytes are already resized, and passing
          // one would re-encode a second time and lose another generation.
          await setModuleCarouselImage(deps.moduleRepo, row.slug, {
            mimeType: result.mimeType as never,
            base64Data: result.data.toString("base64"),
          });
        }

        changed += 1;
        savedBytes += delta;
      } catch (error) {
        // One unreadable image must not abort the rest.
        failed += 1;
        console.log(`  ${row.slug}: FAILED — ${messageOf(error)}`);
      }
    }

    console.log(
      `\n${dryRun ? "Would rewrite" : "Rewrote"} ${changed} graphic(s), ` +
        `${skipped} skipped, ${failed} failed, ${kb(savedBytes)} saved.`,
    );
    if (dryRun && changed > 0) console.log("Re-run without --dry-run to apply.");
  } catch (error) {
    console.error(messageOf(error));
    process.exitCode = 1;
  }
}

function kb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function percent(part: number, whole: number): string {
  return whole === 0 ? "0%" : `${Math.round((part / whole) * 100)}%`;
}
