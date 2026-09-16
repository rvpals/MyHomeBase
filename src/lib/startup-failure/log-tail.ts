import type { CauseSignature, FailureCause, LogTail } from "./types";

/**
 * How many log lines the failure page shows.
 *
 * 100, not the 50 the in-app Server Log tab uses. That tab is for browsing a
 * healthy app's recent activity; this page exists to show a *startup crash*, and
 * a Node stack trace through Next's standalone server plus a native-module dlopen
 * failure routinely runs past 50 lines. Cutting the top off the very stack the
 * page exists to display is the one failure mode worth spending some scrollback on.
 */
export const LOG_TAIL_LINES = 100;

/**
 * Takes the last `limit` lines of raw log text.
 *
 * Splits on `\n` and tolerates `\r\n`, because `app.log` is appended to by both
 * `start.sh` (BusyBox `echo`, LF) and Node's own stderr.
 *
 * A trailing newline does not count as a final empty line — every append ends
 * with one, so counting it would show a blank row at the bottom of every page and
 * make `totalLines` permanently one too high.
 */
export function tailLines(raw: string, limit: number = LOG_TAIL_LINES): LogTail {
  const normalised = raw.replace(/\r\n/g, "\n");
  // A log that is empty, or only whitespace, has no lines at all -- not one empty
  // one. Without this the page would claim "last 1 of 1 lines" for an empty file.
  if (normalised.trim() === "") {
    return { lines: [], truncated: false, totalLines: 0 };
  }

  const withoutTrailingNewline = normalised.endsWith("\n")
    ? normalised.slice(0, -1)
    : normalised;
  const all = withoutTrailingNewline.split("\n");

  // A limit of 0 or less would make slice(-0) return the WHOLE array, which is the
  // opposite of what a caller asking for no lines means.
  if (limit <= 0) {
    return { lines: [], truncated: all.length > 0, totalLines: all.length };
  }

  return {
    lines: all.slice(-limit),
    truncated: all.length > limit,
    totalLines: all.length,
  };
}

/**
 * The failures worth naming, in priority order.
 *
 * Order matters: the first match wins, so the most specific and most actionable
 * signatures come first. The ABI mismatch leads because it is both the most common
 * way a NAS deploy breaks (upgrading Node in Package Center without rebuilding)
 * and the one whose raw error text is least self-explanatory.
 *
 * Patterns match against the *whole* tail rather than line by line, since a Node
 * error and the module it names often sit on different lines.
 */
const SIGNATURES: ReadonlyArray<CauseSignature & { pattern: RegExp }> = [
  {
    cause: "node-abi-mismatch",
    pattern: /NODE_MODULE_VERSION|was compiled against a different Node\.js version/i,
    headline: "A native module was built for a different version of Node.",
    remedy:
      "Node on the NAS was probably upgraded without rebuilding the package. Check the ABI with `node -p process.versions.modules`, then republish with a matching NAS_NODE_ABI (see scripts/publish-nas.mjs).",
  },
  {
    cause: "missing-native-module",
    pattern: /ERR_DLOPEN_FAILED|Cannot find module '(better-sqlite3|sharp)/i,
    headline: "A native module is missing or couldn't be loaded.",
    remedy:
      "Usually a half-copied deploy or a surviving symlink. On the NAS: `rm -rf .next node_modules`, then republish with `npm run publish:nas` and re-copy.",
  },
  {
    cause: "port-in-use",
    pattern: /EADDRINUSE|address already in use/i,
    headline: "Port 3000 was still held by another process.",
    remedy:
      "The previous build hadn't released the port yet. The keepalive task will retry; if it persists, find the holder with `netstat -ltnp | grep 3000` and kill it.",
  },
  {
    cause: "migration-failed",
    pattern: /MIGRATION FAILED/i,
    headline: "A database migration failed, so the app was deliberately not started.",
    remedy:
      "Starting a build whose schema didn't land gives you an app writing to a database it disagrees with. Run it by hand to see the error: `node --env-file-if-exists=.env migrate.cjs`.",
  },
  {
    cause: "database-unreachable",
    pattern: /SQLITE_CANTOPEN|unable to open database|SQLITE_READONLY|SQLITE_CORRUPT/i,
    headline: "The database file couldn't be opened.",
    remedy:
      "Check MYHOMEBASE_DB in .env points at the real file — the folder is /volume1/app/ (singular). Also check the file's permissions.",
  },
  {
    cause: "missing-build",
    pattern: /Cannot find module .*(server\.js|\.next)|ENOENT.*\.next/i,
    headline: "The build output is missing.",
    remedy:
      "`.next` or server.js didn't make it across. If you copied with scp, use `dist-nas/.` — a shell glob skips dot-directories. Confirm with `ls -a`.",
  },
];

/** The wording used when nothing matched. Exported so the page test can assert on it. */
export const UNKNOWN_SIGNATURE: CauseSignature = {
  cause: "unknown",
  headline: "MyHomeBase failed to start.",
  remedy:
    "The log below is the whole story — the last lines before the process exited. If it is empty, the process died before writing anything, which usually means Node itself couldn't start.",
};

/**
 * Guesses at the cause from a log tail.
 *
 * Always returns something; `UNKNOWN_SIGNATURE` is a perfectly ordinary answer and
 * the page reads fine with it, because the full tail is shown either way.
 */
export function classifyFailure(tail: LogTail): CauseSignature {
  const haystack = tail.lines.join("\n");
  const match = SIGNATURES.find((signature) => signature.pattern.test(haystack));
  if (!match) return UNKNOWN_SIGNATURE;

  // Dropped rather than spread, so the returned object is exactly a CauseSignature
  // and the regex never leaks into anything that might serialise it.
  return { cause: match.cause, headline: match.headline, remedy: match.remedy };
}

/** Whether a cause is one the keepalive task can plausibly fix by just retrying. */
export function isTransient(cause: FailureCause): boolean {
  return cause === "port-in-use";
}
