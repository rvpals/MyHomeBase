// Re-runs the icon normaliser over raster overrides that are already stored.
//
// Uploads made *before* the normaliser existed kept whatever the browser sent — typically a
// 1024px JPEG with the transparency checkerboard flattened into it, which reads as a grey
// smudge at the 16-20px an icon actually renders at. New uploads are cleaned on the way in;
// this is how the earlier ones catch up without re-uploading each by hand.
//
//   npm run cli -- normalize-icon-overrides --dry-run   # report, change nothing
//   npm run cli -- normalize-icon-overrides
//
// Safe to run repeatedly. A second pass over an already-normalised PNG finds no flattened
// backdrop and nothing to trim, so it rewrites the same picture; the only cost is bytes
// moved. SVG overrides are never touched — they are markup, not pixels.
import { normalizeIconImage, saveOverride } from "@/lib/icons";
import { deps } from "@/lib/wiring";
import { messageOf } from "./error-message";

const USAGE = `Usage:
  npm run cli -- normalize-icon-overrides [--dry-run]

Options:
  --dry-run   Report what would change without writing anything.

Strips a flattened transparency checkerboard back to real alpha, crops empty
margin, and re-encodes as a 256px PNG. A photo is left alone rather than guessed
at. Only raster overrides are considered; SVG overrides are untouched.`;

export async function normalizeIconOverridesCommand(argv: string[]): Promise<void> {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    return;
  }

  const dryRun = argv.includes("--dry-run");

  try {
    const stored = deps.iconOverridesRepo.listAllImages();
    if (stored.length === 0) {
      console.log("No raster icon overrides stored — nothing to do.");
      return;
    }

    console.log(
      `${stored.length} raster override(s)${dryRun ? " — dry run, nothing will be written" : ""}:`,
    );

    let changed = 0;
    let failed = 0;
    let savedBytes = 0;

    for (const row of stored) {
      const label = `${row.slotId} [${row.setId}]`;
      try {
        const result = await normalizeIconImage(deps.iconImageProcessor, row.data);
        const delta = row.data.length - result.data.length;

        const notes = [
          result.strippedBackdrop ? "backdrop stripped" : null,
          result.trimmed ? "trimmed" : null,
        ].filter(Boolean);

        console.log(
          `  ${label}: ${kb(row.data.length)} -> ${kb(result.data.length)}` +
            ` (${result.width}x${result.height}${notes.length ? ", " + notes.join(", ") : ""})`,
        );

        if (!dryRun) {
          // Through `saveOverride` rather than a direct upsert so the slot check, the
          // one-payload rule and the `updated_at` stamp all stay in one place. The stamp
          // matters: it is the `?v=` cache-buster, so without it a browser would keep
          // showing the old picture.
          await saveOverride(
            deps.iconOverridesRepo,
            {
              slotId: row.slotId,
              setId: row.setId,
              kind: "raster",
              mimeType: result.mimeType,
              base64Data: result.data.toString("base64"),
            },
            new Date(),
            // No processor: the bytes are already normalised, and passing one would run
            // the whole pipeline a second time for nothing.
          );
        }

        changed += 1;
        savedBytes += delta;
      } catch (error) {
        // One unreadable image must not abort the rest.
        failed += 1;
        console.log(`  ${label}: SKIPPED — ${messageOf(error)}`);
      }
    }

    console.log(
      `\n${dryRun ? "Would rewrite" : "Rewrote"} ${changed} override(s), ` +
        `${failed} skipped, ${kb(savedBytes)} saved.`,
    );
    if (dryRun) console.log("Re-run without --dry-run to apply.");
  } catch (error) {
    console.error(messageOf(error));
    process.exitCode = 1;
  }
}

function kb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}
