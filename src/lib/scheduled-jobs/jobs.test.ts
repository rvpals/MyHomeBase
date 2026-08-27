import { describe, expect, it } from "vitest";
import { describeLastRun, listScheduledJobs } from "./jobs";
import { JOB_DESCRIPTORS, JOB_KEYS, type ScheduledRun } from "./types";

function run(overrides: Partial<ScheduledRun> & { jobKey: string }): ScheduledRun {
  return { lastRunAt: "2026-08-26 04:00:00", ...overrides };
}

describe("listScheduledJobs", () => {
  it("joins every known job against its stored run", () => {
    const views = listScheduledJobs([
      run({ jobKey: JOB_KEYS.stockAutoRefresh, status: "ok", detail: "38 priced" }),
      run({ jobKey: JOB_KEYS.expenseAutoImport, status: "partial", detail: "1 of 2 imported" }),
      run({ jobKey: JOB_KEYS.authEventPrune, status: "ok", detail: "12 deleted" }),
    ]);

    expect(views).toHaveLength(JOB_DESCRIPTORS.length);
    expect(views.map((view) => view.descriptor.key)).toEqual(
      JOB_DESCRIPTORS.map((descriptor) => descriptor.key),
    );
    expect(views[0].lastRun?.detail).toBe("38 priced");
  });

  it("still lists a job that has never run", () => {
    // The failure this whole feature exists to fix: no row must not mean no job.
    const views = listScheduledJobs([]);

    expect(views).toHaveLength(JOB_DESCRIPTORS.length);
    expect(views.every((view) => view.lastRun === undefined)).toBe(true);
    expect(describeLastRun(views[0])).toBe("Never run.");
  });

  it("ignores a stored row for a job key that no longer exists", () => {
    const views = listScheduledJobs([run({ jobKey: "retired_job", status: "ok" })]);

    expect(views.map((view) => view.descriptor.key)).not.toContain("retired_job");
    expect(views).toHaveLength(JOB_DESCRIPTORS.length);
  });
});

describe("describeLastRun", () => {
  it("reads a timestamp with no status as interrupted, never as ok", () => {
    // `start` stamped the row and `finish` never landed -- the process was killed
    // mid-pass. Claiming success here would be the worst possible lie for a screen
    // whose only job is telling you what happened.
    const [view] = listScheduledJobs([run({ jobKey: JOB_KEYS.stockAutoRefresh })]);

    expect(describeLastRun(view)).toBe("Last run 2026-08-26 04:00:00 — interrupted.");
  });

  it("includes the detail line when there is one", () => {
    const [view] = listScheduledJobs([
      run({ jobKey: JOB_KEYS.stockAutoRefresh, status: "failed", detail: "Price refresh failed." }),
    ]);

    expect(describeLastRun(view)).toBe(
      "Last run 2026-08-26 04:00:00 — failed (Price refresh failed.).",
    );
  });
});
