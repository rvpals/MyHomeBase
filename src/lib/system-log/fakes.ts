// In-memory implementations of this module's ports, for tests.
//
// Hand-written rather than mocked, per ARCHITECTURE.md: a fake is readable, reusable
// across the module's tests, and does not couple a test to call order.

import type { SystemLogRepository, SystemLogger } from "./ports";
import type { WriteSystemLog } from "./schema";
import type { SystemLogCounts, SystemLogEntry, SystemLogFilter, SystemLogKind } from "./types";

/**
 * An in-memory log.
 *
 * Mirrors the SQLite repository's observable behaviour: newest-first reads, a
 * substring search over source and message, and a row cap. It prunes on **every**
 * write where the real one prunes every fiftieth — a test asserting the cap should
 * not have to write fifty rows to see it, and the contract both honour is "the table
 * stays bounded", not "it is pruned at this exact moment".
 */
export class FakeSystemLogRepository implements SystemLogRepository {
  /** Oldest first, as the table is stored. Reads reverse it. */
  readonly entries: SystemLogEntry[] = [];
  private nextId = 1;

  /** Stamped onto each row. A fixed string so tests can assert on it. */
  constructor(private readonly now: () => string = () => "2026-10-31 12:00:00") {}

  write(entry: WriteSystemLog, maxRows: number): void {
    this.entries.push({
      id: this.nextId++,
      createdAt: this.now(),
      kind: entry.kind,
      source: entry.source,
      message: entry.message,
      detail: entry.detail,
    });
    if (maxRows > 0 && this.entries.length > maxRows) {
      this.entries.splice(0, this.entries.length - maxRows);
    }
  }

  list(filter: SystemLogFilter): SystemLogEntry[] {
    const search = filter.search?.trim().toLowerCase() ?? "";
    return [...this.entries]
      .reverse()
      .filter((entry) => filter.kind === undefined || entry.kind === filter.kind)
      .filter(
        (entry) =>
          search === "" ||
          entry.source.toLowerCase().includes(search) ||
          entry.message.toLowerCase().includes(search),
      )
      .slice(0, filter.limit);
  }

  counts(): SystemLogCounts {
    const debug = this.entries.filter((entry) => entry.kind === "debug").length;
    const operational = this.entries.length - debug;
    return { debug, operational, total: this.entries.length };
  }

  clear(kind?: SystemLogKind): number {
    const before = this.entries.length;
    const kept = kind === undefined ? [] : this.entries.filter((entry) => entry.kind !== kind);
    this.entries.length = 0;
    this.entries.push(...kept);
    return before - this.entries.length;
  }
}

/**
 * A logger that records what it was handed.
 *
 * For testing a CALLER — "did the indexing pass log a line per file?" — where
 * `noopSystemLogger` (logger.ts) is for a caller that should not log at all.
 *
 * `enabledKinds` decides what it accepts, so a test can prove the no-op path as well
 * as the writing one. Both kinds are on by default, which is what a test asserting
 * on output wants; pass an empty set to prove nothing is written when off.
 */
export class FakeSystemLogger implements SystemLogger {
  readonly lines: { kind: SystemLogKind; source: string; message: string; detail: string }[] = [];
  /** How many times a message thunk was actually invoked. The cost-when-off assertion. */
  thunkCalls = 0;

  constructor(private readonly enabledKinds: Set<SystemLogKind> = new Set(["debug", "operational"])) {}

  enabled(kind: SystemLogKind): boolean {
    return this.enabledKinds.has(kind);
  }

  debug(source: string, message: string | (() => string), detail?: string | (() => string)): void {
    this.write("debug", source, message, detail);
  }

  operational(
    source: string,
    message: string | (() => string),
    detail?: string | (() => string),
  ): void {
    this.write("operational", source, message, detail);
  }

  /** Every line of one kind, as plain strings — what most assertions want. */
  messagesOf(kind: SystemLogKind): string[] {
    return this.lines.filter((line) => line.kind === kind).map((line) => line.message);
  }

  private write(
    kind: SystemLogKind,
    source: string,
    message: string | (() => string),
    detail?: string | (() => string),
  ): void {
    if (!this.enabled(kind)) return;
    const resolve = (value: string | (() => string) | undefined): string => {
      if (value === undefined) return "";
      if (typeof value !== "function") return value;
      this.thunkCalls += 1;
      return value();
    };
    this.lines.push({ kind, source, message: resolve(message), detail: resolve(detail) });
  }
}
