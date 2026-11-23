// Shared formatting for every experiment's plain-text report.
//
// Extracted from `test-server-resize-image.ts` once a second and third experiment needed
// the same labelled lines: the reports are read side by side in one dialog, and pasted
// into a chat, so they must line up in the same monospace columns.
//
// Fixed `en-US` locale everywhere, so a report is identical on every server and in tests.

/** Column the values start in, so the report lines up in a monospace block. */
export const LABEL_WIDTH = 16;

export function line(label: string, value: string): string {
  return `${`${label}:`.padEnd(LABEL_WIDTH)}${value}`;
}

/** A section heading, so the four experiments are tellable apart in one report. */
export function heading(title: string): string {
  return `=== ${title} ===`;
}

export function formatBytes(bytes: number): string {
  return `${bytes.toLocaleString("en-US")} bytes`;
}

export function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatKb(bytes: number): string {
  return `${(bytes / 1024).toFixed(0)} KB`;
}

export function formatMs(ms: number): string {
  return `${Math.round(ms).toLocaleString("en-US")} ms`;
}

/** "97.3% smaller", or "12.0% larger" for an output that grew (it can, at 2048px). */
export function reductionOf(originalBytes: number, outputBytes: number): string {
  if (originalBytes === 0) return "reduction n/a (empty original)";
  const percent = (1 - outputBytes / originalBytes) * 100;
  return percent >= 0 ? `${percent.toFixed(1)}% smaller` : `${(-percent).toFixed(1)}% larger`;
}

/** "2.4x faster", for comparing two timings. Guards the divide-by-zero of a 0 ms fake. */
export function speedupOf(slowerMs: number, fasterMs: number): string {
  if (fasterMs <= 0) return "too fast to measure";
  const times = slowerMs / fasterMs;
  return times >= 1 ? `${times.toFixed(1)}x faster` : `${(1 / times).toFixed(1)}x slower`;
}

/** The first line of an error's message: native-module errors run to a wall of advice. */
export function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.split("\n")[0];
}
