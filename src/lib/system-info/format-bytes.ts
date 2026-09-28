// Byte formatting, on its own so a client component can import it.
//
// Split out of `system-info.ts`, which imports `node:path` for the database-file
// report. `formatBytes` is pure arithmetic and the Administration -> About view
// is a client component, so importing it through a module that reaches for a
// Node builtin fails the webpack build with an unhandled-scheme error. The
// barrel still re-exports it, so nothing outside this folder changed.

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/** Formats a byte count as a human-readable string, e.g. 1536 -> "1.5 KB". */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), BYTE_UNITS.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${exponent === 0 ? value : value.toFixed(1)} ${BYTE_UNITS[exponent]}`;
}
