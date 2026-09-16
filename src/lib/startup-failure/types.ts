/**
 * The startup-failure fallback: what gets served on port 3000 when the real app
 * couldn't come up at all.
 *
 * Why this exists as a *separate* server rather than an error page inside the app:
 * when `server.js` dies during startup — a native module built for the wrong Node
 * ABI, an unreadable database path, a port still held by the previous process —
 * nothing binds port 3000, so DSM's reverse proxy has no upstream and shows its
 * own generic "cannot connect" page. The app cannot render its own failure,
 * because the app is what failed. `app.log` holds the real answer, and reaching
 * it used to mean SSH or SMB.
 *
 * Everything here is deliberately dependency-free (see `renderFailurePage`): the
 * whole point is to survive the failures that take the app down.
 */

/**
 * A guess at *why* the app didn't start, matched from the log tail.
 *
 * A hint, never a verdict — the tail is always shown in full underneath, because
 * a wrong guess that hides the real error would be worse than no guess at all.
 * `unknown` is the honest default and the most common answer.
 */
export type FailureCause =
  | "node-abi-mismatch"
  | "missing-native-module"
  | "port-in-use"
  | "database-unreachable"
  | "missing-build"
  | "migration-failed"
  | "unknown";

/** One recognisable failure: how to spot it, and what to tell the reader. */
export interface CauseSignature {
  cause: FailureCause;
  /** Shown as the page's one-line diagnosis. */
  headline: string;
  /** What to actually do about it, in one or two sentences. */
  remedy: string;
}

/** The tail of a log file, plus whether there was more of it above. */
export interface LogTail {
  /** The last N lines, oldest first — reading order, same as the file. */
  lines: string[];
  /** True when lines were dropped off the top to reach the limit. */
  truncated: boolean;
  /** Total lines in the source, so the page can say "last 100 of 4,213". */
  totalLines: number;
}

/** Everything `renderFailurePage` needs. Data in, HTML string out. */
export interface FailurePageInput {
  /** The log tail to show. Empty lines array is valid — the log may not exist yet. */
  tail: LogTail;
  /** When the fallback noticed the failure. */
  occurredAt: Date;
  /** Absolute path to the log, shown so the reader knows what to open over SSH. */
  logPath: string;
  /** Seconds between the page's own auto-refreshes. */
  refreshSeconds: number;
}
