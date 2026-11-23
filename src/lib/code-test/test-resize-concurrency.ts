import { createConcurrencyLimit } from "@/lib/shared/concurrency";
import type { ScannedPhoto } from "./pick-test-photos";
import type { CodeTestDeps } from "./ports";
import { formatMs, line, speedupOf } from "./report-format";

// Experiment: does resizing several photos AT ONCE actually go faster on the NAS?
//
// The question the single-photo timings cannot answer. A strip request fires several
// thumbnails at once, and both ends cap that at three (`THUMBNAIL_CONCURRENCY` in
// `photo-viewer.tsx`, `photoThumbnailLimit` in `wiring.ts`), so what matters is throughput
// under a burst, not one resize in isolation. On a 4-core ARM chip with libvips using
// threads of its own, more at once can be no faster -- or slower.
//
// Runs the SAME batch of photos at each gate width through the real
// `createConcurrencyLimit`, so this measures the shipped mechanism, not a hand-rolled one.
//
// NEVER THROWS: a failed resize becomes a counted failure and the batch carries on.

/** Gate widths measured. 1 is the sequential baseline every other width is compared to. */
export const CONCURRENCY_WIDTHS = [1, 2, 3, 4] as const;

/** The size a served main photo would use -- the one worth knowing the throughput of. */
export const CONCURRENCY_LONG_EDGE = 1024;

interface BatchResult {
  width: number;
  wallMs: number;
  failures: number;
}

export async function testResizeConcurrency(
  deps: CodeTestDeps,
  input: { photos: ScannedPhoto[] },
): Promise<string> {
  const lines: string[] = [];

  if (input.photos.length === 0) {
    lines.push("Skipped. No photo could be scanned.");
    return lines.join("\n");
  }

  lines.push(
    line("Batch", `${input.photos.length} photos, each resized to ${CONCURRENCY_LONG_EDGE}px`),
    line("Gate", "the shipped createConcurrencyLimit, at each width below"),
  );

  // Read every photo's bytes ONCE, up front, outside the timed batches: this experiment
  // measures resize throughput, and leaving the reads in would time the NAS instead.
  const files: Uint8Array[] = [];
  let unread = 0;
  for (const photo of input.photos) {
    try {
      const file = await deps.reader.read(photo.relativePath);
      if (file === undefined) unread += 1;
      else files.push(file.data);
    } catch {
      unread += 1;
    }
  }
  if (unread > 0) lines.push(line("Unread", `${unread} of the batch could not be read`));
  if (files.length === 0) {
    lines.push("", "Nothing to resize: every photo in the batch failed to read.");
    return lines.join("\n");
  }
  lines.push(line("Bytes held", `${files.length} photos read into memory before timing`));
  lines.push("");

  const results: BatchResult[] = [];
  for (const width of CONCURRENCY_WIDTHS) {
    results.push(await runBatch(deps, files, width));
  }

  const baseline = results[0];
  for (const result of results) {
    const perPhoto = result.wallMs / files.length;
    const comparison =
      result.width === baseline.width
        ? "baseline"
        : speedupOf(baseline.wallMs, result.wallMs);
    lines.push(
      line(
        `${result.width} at once`,
        `${formatMs(result.wallMs)} for ${files.length} photos, ${formatMs(perPhoto)} each, ${comparison}` +
          (result.failures > 0 ? `, ${result.failures} failed` : ""),
      ),
    );
  }

  lines.push("", line("Reading", verdictOf(results)));
  return lines.join("\n");
}

/** One timed pass over every file at one gate width. */
async function runBatch(
  deps: CodeTestDeps,
  files: Uint8Array[],
  width: number,
): Promise<BatchResult> {
  const limit = createConcurrencyLimit(width);
  let failures = 0;
  const startedAt = deps.now();

  await Promise.all(
    files.map((bytes) =>
      limit(async () => {
        try {
          await deps.imageLib.resize(bytes, CONCURRENCY_LONG_EDGE);
        } catch {
          // Counted, not thrown: a batch that dies on one bad file reports nothing.
          failures += 1;
        }
      }),
    ),
  );

  return { width, wallMs: deps.now() - startedAt, failures };
}

/**
 * One line saying what the numbers mean, because the point of the experiment is a
 * decision and the reader should not have to divide the columns themselves.
 */
function verdictOf(results: BatchResult[]): string {
  const baseline = results[0];
  let best = baseline;
  for (const result of results) {
    if (result.wallMs < best.wallMs) best = result;
  }
  if (baseline.wallMs <= 0) return "the batch was too fast to measure";

  const gain = baseline.wallMs / best.wallMs;
  if (best.width === baseline.width || gain < 1.15) {
    return `running them at once does NOT help (best ${best.width} at once, ${gain.toFixed(2)}x) -- the CPU is already saturated by one resize`;
  }
  return `${best.width} at once is best, ${gain.toFixed(1)}x the sequential throughput`;
}
