import { describe, expect, it } from "vitest";

import { FakeSystemLogger } from "@/lib/system-log";

import { SCHEDULED_JOBS_LOG_SOURCE, describeJobKey, withSystemLog } from "./logged-repository";
import type { ScheduledRunRepository } from "./ports";
import { JOB_KEYS } from "./types";
import type { ScheduledRun, ScheduledRunHistoryEntry, ScheduledRunStatus } from "./types";

/** Records what it was asked to do, so the decorator's delegation is assertable. */
class RecordingRunRepository implements ScheduledRunRepository {
  readonly started: { jobKey: string; startedAt: string }[] = [];
  readonly finished: { jobKey: string; status: ScheduledRunStatus; detail: string }[] = [];

  get(): ScheduledRun | undefined {
    return undefined;
  }
  list(): ScheduledRun[] {
    return [];
  }
  listHistory(): ScheduledRunHistoryEntry[] {
    return [];
  }
  start(jobKey: string, startedAt: string): void {
    this.started.push({ jobKey, startedAt });
  }
  finish(jobKey: string, status: ScheduledRunStatus, detail: string): void {
    this.finished.push({ jobKey, status, detail });
  }
}

function build(logger: FakeSystemLogger = new FakeSystemLogger()) {
  const inner = new RecordingRunRepository();
  return { inner, logger, repo: withSystemLog(inner, logger) };
}

describe("describeJobKey", () => {
  it("uses the label the Background Tasks screen shows", () => {
    expect(describeJobKey(JOB_KEYS.stockAutoRefresh)).toBe("Investments auto refresh");
  });

  it("falls back to the raw key for a retired job with no descriptor", () => {
    expect(describeJobKey("some_removed_job")).toBe("some_removed_job");
  });
});

describe("withSystemLog", () => {
  it("still records the run itself", () => {
    const { inner, repo } = build();

    repo.start(JOB_KEYS.dataBackup, "2026-10-31 02:00:00");
    repo.finish(JOB_KEYS.dataBackup, "ok", "3 files copied");

    expect(inner.started).toEqual([
      { jobKey: JOB_KEYS.dataBackup, startedAt: "2026-10-31 02:00:00" },
    ]);
    expect(inner.finished).toEqual([
      { jobKey: JOB_KEYS.dataBackup, status: "ok", detail: "3 files copied" },
    ]);
  });

  it("logs an operational line when a job is triggered", () => {
    const { logger, repo } = build();

    repo.start(JOB_KEYS.stockAutoRefresh, "2026-10-31 09:00:00");

    expect(logger.messagesOf("operational")).toEqual([
      'Job "Investments auto refresh" triggered.',
    ]);
    expect(logger.lines[0].source).toBe(SCHEDULED_JOBS_LOG_SOURCE);
  });

  it("logs the outcome and the detail when a job finishes", () => {
    const { logger, repo } = build();

    repo.finish(JOB_KEYS.stockAutoRefresh, "partial", "38 priced, 1 failed");

    expect(logger.messagesOf("operational")).toEqual([
      'Job "Investments auto refresh" finished: partial — 38 priced, 1 failed',
    ]);
  });

  it("omits the dash when a job finishes with no detail", () => {
    const { logger, repo } = build();

    repo.finish(JOB_KEYS.helloWorld, "ok", "");

    expect(logger.messagesOf("operational")).toEqual(['Job "Hello, world!" finished: ok']);
  });

  it("writes no debug lines — this is operational plumbing only", () => {
    const { logger, repo } = build();

    repo.start(JOB_KEYS.dataBackup, "2026-10-31 02:00:00");
    repo.finish(JOB_KEYS.dataBackup, "ok", "done");

    expect(logger.messagesOf("debug")).toEqual([]);
  });

  it("writes nothing when the operational switch is off", () => {
    const off = new FakeSystemLogger(new Set());
    const { inner, repo } = build(off);

    repo.start(JOB_KEYS.dataBackup, "2026-10-31 02:00:00");
    repo.finish(JOB_KEYS.dataBackup, "ok", "done");

    expect(off.lines).toEqual([]);
    // The run is still recorded — logging being off must not stop the bookkeeping.
    expect(inner.started).toHaveLength(1);
    expect(inner.finished).toHaveLength(1);
  });

  it("does not build a message when the switch is off", () => {
    const off = new FakeSystemLogger(new Set());
    const { repo } = build(off);

    repo.start(JOB_KEYS.dataBackup, "2026-10-31 02:00:00");

    // The whole cost-when-off property, at this call site: the label lookup and the
    // template never ran.
    expect(off.thunkCalls).toBe(0);
  });

  it("passes reads straight through", () => {
    const { repo } = build();

    expect(repo.get(JOB_KEYS.dataBackup)).toBeUndefined();
    expect(repo.list()).toEqual([]);
    expect(repo.listHistory(JOB_KEYS.dataBackup)).toEqual([]);
  });
});
