import { readEmbeddedThumbnail } from "@/lib/journal-photos/embedded-thumbnail";
import { isSafeRelativePath, normaliseRelativePath } from "@/lib/journal-photos/paths";
import type { CodeTestDeps, ImageLibProbe } from "./ports";
import {
  formatBytes,
  formatMb,
  formatMs,
  line,
  messageOf,
  reductionOf,
} from "./report-format";

// Experiment: would resizing photos on the server (the NAS) be worth it?
//
// Reads one photo from the archive and resizes it to three long edges, reporting how
// long each step takes and how many bytes it saves against sending the original. The
// answer is a plain-text report for the Code Tester screen to show in a monospace block
// and copy -- so it reads the same pasted into a chat as it does on screen.
//
// NEVER THROWS. Every failure -- an unsafe path, a missing file, an image library that
// will not load -- becomes a readable line in the report, because the reader is running
// an experiment and "it failed, here is why" is a result.

/** The long edges measured, in pixels: a strip thumbnail, a phone screen, a monitor. */
export const RESIZE_LONG_EDGES = [160, 1024, 2048] as const;

/** The old name for `CodeTestDeps`, kept so existing call sites read the same. */
export type ServerResizeTestDeps = CodeTestDeps;

/** The report, one labelled line or block per fact. */
export async function testServerResizeImage(
  deps: ServerResizeTestDeps,
  input: { relativePath: string },
): Promise<string> {
  const startedAt = deps.now();
  const lines: string[] = ["Server image resize test", ""];
  const finish = () => {
    lines.push(line("Total", `${formatMs(deps.now() - startedAt)}`));
    return lines.join("\n");
  };

  const relativePath = normaliseRelativePath(input.relativePath);
  lines.push(line("Path", input.relativePath));

  // The boundary schema already refused this; checked again because this string
  // becomes a file read. Belt and braces, as everywhere a path reaches the archive.
  //
  // On the RAW input, not the normalised one: normalising drops empty segments, which
  // turns an absolute `/etc/x.jpg` into a harmless-looking `etc/x.jpg`.
  if (!isSafeRelativePath(input.relativePath)) {
    lines.push(line("Error", "Not a safe path relative to the photo root. Nothing was read."));
    return finish();
  }

  let file: { data: Uint8Array; ms: number } | undefined;
  try {
    file = await deps.reader.read(relativePath);
  } catch (error) {
    lines.push(line("Error", `Reading the photo failed: ${messageOf(error)}`));
    return finish();
  }
  if (file === undefined) {
    lines.push(line("Error", "The photo is missing or unreadable."));
    return finish();
  }

  const originalBytes = file.data.length;
  lines.push(
    line(
      "File",
      `${formatBytes(originalBytes)} (${formatMb(originalBytes)}), read from the NAS in ${formatMs(file.ms)}`,
    ),
  );

  // Pure, so it reports even when the image library cannot load.
  const preview = readEmbeddedThumbnail(file.data);
  const previewLine = line(
    "EXIF preview",
    preview === undefined
      ? "not present"
      : `present, ${formatBytes(preview.jpeg.length)}, orientation ${preview.orientation}`,
  );

  let loaded: Awaited<ReturnType<ImageLibProbe["load"]>>;
  try {
    loaded = await deps.imageLib.load();
  } catch (error) {
    lines.push(line("Original", "unknown (sharp unavailable)"));
    lines.push(previewLine);
    lines.push(line("sharp", `unavailable: ${messageOf(error)}`));
    lines.push(line("Resize", "skipped, because sharp did not load"));
    return finish();
  }

  try {
    const metadata = await deps.imageLib.metadata(file.data);
    const size =
      metadata.width !== undefined && metadata.height !== undefined
        ? `${metadata.width} x ${metadata.height}`
        : "size unknown";
    lines.push(line("Original", `${size}, EXIF orientation ${metadata.orientation ?? "none"}`));
  } catch (error) {
    lines.push(line("Original", `could not read metadata: ${messageOf(error)}`));
  }
  lines.push(previewLine);

  lines.push(
    line(
      "sharp load",
      loaded.ms === undefined
        ? "already loaded in this server process"
        : `${formatMs(loaded.ms)} (first use)`,
    ),
  );
  const { info } = loaded;
  lines.push(line("sharp version", info.detail === "" ? info.version : `${info.version} (${info.detail})`));
  lines.push(line("Platform", `${info.platform} ${info.arch}`));
  lines.push("");

  for (const longEdge of RESIZE_LONG_EDGES) {
    const label = `Resize ${longEdge}px`;
    try {
      const resized = await deps.imageLib.resize(file.data, longEdge);
      lines.push(
        line(
          label,
          `${formatMs(resized.ms)}, ${formatBytes(resized.data.length)}, ${reductionOf(
            originalBytes,
            resized.data.length,
          )}`,
        ),
      );
    } catch (error) {
      lines.push(line(label, `failed: ${messageOf(error)}`));
    }
  }

  lines.push("");
  return finish();
}

