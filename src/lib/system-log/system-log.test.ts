import { describe, expect, it } from "vitest";

import { FakeSystemLogRepository } from "./fakes";
import { DEFAULT_SYSTEM_LOG_LIMIT, MAX_SYSTEM_LOG_LIMIT } from "./schema";
import {
  clearSystemLog,
  countSystemLog,
  describeSystemLogCounts,
  describeSystemLogKind,
  listSystemLog,
} from "./system-log";
import type { SystemLogKind } from "./types";

function seeded(lines: { kind: SystemLogKind; source: string; message: string }[]) {
  const repo = new FakeSystemLogRepository();
  for (const line of lines) {
    repo.write({ ...line, detail: "" }, 0);
  }
  return repo;
}

describe("listSystemLog", () => {
  it("returns the newest lines first", () => {
    const repo = seeded([
      { kind: "operational", source: "jobs", message: "first" },
      { kind: "operational", source: "jobs", message: "second" },
    ]);

    expect(listSystemLog(repo).map((entry) => entry.message)).toEqual(["second", "first"]);
  });

  it("filters to one kind", () => {
    const repo = seeded([
      { kind: "operational", source: "jobs", message: "job ran" },
      { kind: "debug", source: "documents", message: "read a file" },
    ]);

    expect(listSystemLog(repo, { kind: "debug" })).toHaveLength(1);
    expect(listSystemLog(repo, { kind: "debug" })[0].message).toBe("read a file");
  });

  it("returns both kinds when none is named", () => {
    const repo = seeded([
      { kind: "operational", source: "jobs", message: "job ran" },
      { kind: "debug", source: "documents", message: "read a file" },
    ]);

    expect(listSystemLog(repo)).toHaveLength(2);
  });

  it("searches the message and the source", () => {
    const repo = seeded([
      { kind: "debug", source: "documents/text-index", message: "read lease.pdf" },
      { kind: "operational", source: "scheduled-jobs", message: "Backup triggered." },
    ]);

    expect(listSystemLog(repo, { search: "lease" })).toHaveLength(1);
    expect(listSystemLog(repo, { search: "text-index" })).toHaveLength(1);
    expect(listSystemLog(repo, { search: "nothing here" })).toHaveLength(0);
  });

  it("applies the default limit when none is given", () => {
    const repo = new FakeSystemLogRepository();
    for (let i = 0; i < DEFAULT_SYSTEM_LOG_LIMIT + 20; i += 1) {
      repo.write({ kind: "debug", source: "loop", message: `line ${i}`, detail: "" }, 0);
    }

    expect(listSystemLog(repo)).toHaveLength(DEFAULT_SYSTEM_LOG_LIMIT);
  });

  it("rejects a limit past the ceiling rather than reading the table into memory", () => {
    const repo = seeded([{ kind: "debug", source: "a", message: "one" }]);

    expect(() => listSystemLog(repo, { limit: MAX_SYSTEM_LOG_LIMIT + 1 })).toThrow();
  });

  it("rejects a limit of zero", () => {
    const repo = seeded([{ kind: "debug", source: "a", message: "one" }]);

    expect(() => listSystemLog(repo, { limit: 0 })).toThrow();
  });

  it("rejects a kind that is not one of the two", () => {
    const repo = seeded([{ kind: "debug", source: "a", message: "one" }]);

    expect(() => listSystemLog(repo, { kind: "warning" as SystemLogKind })).toThrow();
  });
});

describe("countSystemLog", () => {
  it("counts each kind separately", () => {
    const repo = seeded([
      { kind: "operational", source: "jobs", message: "one" },
      { kind: "operational", source: "jobs", message: "two" },
      { kind: "debug", source: "documents", message: "three" },
    ]);

    expect(countSystemLog(repo)).toEqual({ operational: 2, debug: 1, total: 3 });
  });

  it("is all zeroes for an empty log", () => {
    expect(countSystemLog(new FakeSystemLogRepository())).toEqual({
      operational: 0,
      debug: 0,
      total: 0,
    });
  });
});

describe("clearSystemLog", () => {
  it("clears one kind and leaves the other", () => {
    const repo = seeded([
      { kind: "operational", source: "jobs", message: "kept" },
      { kind: "debug", source: "documents", message: "removed" },
    ]);

    const removed = clearSystemLog(repo, { kind: "debug" });

    expect(removed).toBe(1);
    expect(countSystemLog(repo)).toEqual({ operational: 1, debug: 0, total: 1 });
  });

  it("clears everything when no kind is named", () => {
    const repo = seeded([
      { kind: "operational", source: "jobs", message: "one" },
      { kind: "debug", source: "documents", message: "two" },
    ]);

    expect(clearSystemLog(repo)).toBe(2);
    expect(countSystemLog(repo).total).toBe(0);
  });

  it("reports zero rather than failing on an empty log", () => {
    expect(clearSystemLog(new FakeSystemLogRepository())).toBe(0);
  });

  it("rejects a kind that is not one of the two", () => {
    const repo = new FakeSystemLogRepository();

    expect(() => clearSystemLog(repo, { kind: "everything" as SystemLogKind })).toThrow();
  });
});

describe("the row cap", () => {
  it("drops the oldest lines once the log is full", () => {
    const repo = new FakeSystemLogRepository();
    for (let i = 0; i < 10; i += 1) {
      repo.write({ kind: "debug", source: "loop", message: `line ${i}`, detail: "" }, 4);
    }

    const kept = listSystemLog(repo).map((entry) => entry.message);
    expect(kept).toEqual(["line 9", "line 8", "line 7", "line 6"]);
  });
});

describe("describeSystemLogCounts", () => {
  it("says so plainly when the log is empty", () => {
    expect(describeSystemLogCounts({ debug: 0, operational: 0, total: 0 })).toBe(
      "The system log is empty.",
    );
  });

  it("names only the kinds that have lines", () => {
    const line = describeSystemLogCounts({ debug: 0, operational: 12, total: 12 });

    expect(line).toContain("12 operational");
    expect(line).not.toContain("debug");
  });

  it("names both kinds when both have lines", () => {
    const line = describeSystemLogCounts({ debug: 3, operational: 12, total: 15 });

    expect(line).toContain("15 lines");
    expect(line).toContain("12 operational");
    expect(line).toContain("3 debug");
  });
});

describe("describeSystemLogKind", () => {
  it("labels each kind as the screen and the CLI show it", () => {
    expect(describeSystemLogKind("debug")).toBe("DEBUG");
    expect(describeSystemLogKind("operational")).toBe("OPERATIONAL");
  });
});
