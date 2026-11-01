import { describe, expect, it } from "vitest";

import { FakeSystemLogRepository } from "./fakes";
import { SETTINGS_CACHE_MS, createSystemLogger, noopSystemLogger } from "./logger";
import { SYSTEM_LOG_MESSAGE_MAX, SYSTEM_LOG_SETTING_KEYS } from "./schema";

/** A settings source holding whatever the test puts in it, re-read on every call. */
function settingsSource(initial: Record<string, string> = {}) {
  const values = { ...initial };
  return {
    rows: () => Object.entries(values).map(([key, value]) => ({ key, value })),
    set(key: string, value: string) {
      values[key] = value;
    },
    /** How many times the logger actually read the settings. The cache assertion. */
    reads: 0,
  };
}

function build(initial: Record<string, string> = {}, now: () => number = () => 0) {
  const source = settingsSource(initial);
  const repo = new FakeSystemLogRepository();
  const logger = createSystemLogger(
    {
      repo,
      readSettings: () => {
        source.reads += 1;
        return source.rows();
      },
    },
    now,
  );
  return { logger, repo, source };
}

const BOTH_ON = {
  [SYSTEM_LOG_SETTING_KEYS.debugEnabled]: "true",
  [SYSTEM_LOG_SETTING_KEYS.operationalEnabled]: "true",
};

describe("createSystemLogger — writing", () => {
  it("writes a line when its switch is on", () => {
    const { logger, repo } = build(BOTH_ON);

    logger.operational("scheduled-jobs", 'Job "Data backup" triggered.');

    expect(repo.entries).toHaveLength(1);
    expect(repo.entries[0]).toMatchObject({
      kind: "operational",
      source: "scheduled-jobs",
      message: 'Job "Data backup" triggered.',
    });
  });

  it("stamps every line with a timestamp", () => {
    const { logger, repo } = build(BOTH_ON);

    logger.debug("documents/text-index", "Read one file.");

    expect(repo.entries[0].createdAt).not.toBe("");
  });

  it("writes nothing when the kind's switch is off", () => {
    const { logger, repo } = build({
      [SYSTEM_LOG_SETTING_KEYS.operationalEnabled]: "true",
    });

    logger.debug("documents/text-index", "Read one file.");

    expect(repo.entries).toHaveLength(0);
  });

  it("writes nothing at all when both switches are off — the default", () => {
    const { logger, repo } = build();

    logger.debug("a", "one");
    logger.operational("b", "two");

    expect(repo.entries).toHaveLength(0);
  });

  it("keeps the two kinds independent", () => {
    const { logger, repo } = build({
      [SYSTEM_LOG_SETTING_KEYS.debugEnabled]: "true",
    });

    logger.debug("a", "written");
    logger.operational("b", "dropped");

    expect(repo.entries).toHaveLength(1);
    expect(repo.entries[0].kind).toBe("debug");
  });
});

describe("createSystemLogger — cost when off", () => {
  // The property this whole design exists for: a logging call left in a hot loop
  // must cost nothing on an install that is not debugging.
  it("does NOT call a message thunk when the switch is off", () => {
    const { logger } = build();
    let called = 0;

    logger.debug("documents/text-index", () => {
      called += 1;
      return "expensive";
    });

    expect(called).toBe(0);
  });

  it("does not call a detail thunk when the switch is off", () => {
    const { logger } = build();
    let called = 0;

    logger.debug("a", "cheap", () => {
      called += 1;
      return "expensive";
    });

    expect(called).toBe(0);
  });

  it("calls the thunk exactly once when the switch is on", () => {
    const { logger, repo } = build(BOTH_ON);
    let called = 0;

    logger.debug("a", () => {
      called += 1;
      return "built";
    });

    expect(called).toBe(1);
    expect(repo.entries[0].message).toBe("built");
  });

  it("reports enabled() without writing anything", () => {
    const { logger, repo } = build({ [SYSTEM_LOG_SETTING_KEYS.debugEnabled]: "true" });

    expect(logger.enabled("debug")).toBe(true);
    expect(logger.enabled("operational")).toBe(false);
    expect(repo.entries).toHaveLength(0);
  });
});

describe("createSystemLogger — settings cache", () => {
  it("reads the settings once across many calls", () => {
    const { logger, source } = build(BOTH_ON);

    for (let i = 0; i < 50; i += 1) logger.debug("loop", `line ${i}`);

    expect(source.reads).toBe(1);
  });

  it("picks up a switch ticked after the cache expires", () => {
    let nowMs = 0;
    const { logger, repo, source } = build({}, () => nowMs);

    logger.debug("a", "dropped");
    expect(repo.entries).toHaveLength(0);

    source.set(SYSTEM_LOG_SETTING_KEYS.debugEnabled, "true");
    // Still cached: the switch has changed but the logger has not looked again.
    logger.debug("a", "still dropped");
    expect(repo.entries).toHaveLength(0);

    nowMs += SETTINGS_CACHE_MS;
    logger.debug("a", "written");
    expect(repo.entries).toHaveLength(1);
  });
});

describe("createSystemLogger — never throws", () => {
  // Rule 2 in logger.ts. These calls sit inside the code being diagnosed, often
  // inside a catch; a logger that can fail turns a small bug into a crash.
  it("swallows a repository that throws", () => {
    const source = settingsSource(BOTH_ON);
    const logger = createSystemLogger({
      repo: {
        write() {
          throw new Error("the table is missing");
        },
        list: () => [],
        counts: () => ({ debug: 0, operational: 0, total: 0 }),
        clear: () => 0,
      },
      readSettings: source.rows,
    });

    expect(() => logger.operational("a", "one")).not.toThrow();
  });

  it("swallows a settings read that throws, and writes nothing", () => {
    const repo = new FakeSystemLogRepository();
    const logger = createSystemLogger({
      repo,
      readSettings: () => {
        throw new Error("no database");
      },
    });

    expect(() => logger.debug("a", "one")).not.toThrow();
    expect(logger.enabled("debug")).toBe(false);
    expect(repo.entries).toHaveLength(0);
  });

  it("swallows a thunk that throws", () => {
    const { logger, repo } = build(BOTH_ON);

    expect(() =>
      logger.debug("a", () => {
        throw new Error("could not build the message");
      }),
    ).not.toThrow();
    expect(repo.entries).toHaveLength(0);
  });

  it("drops a blank message rather than throwing on the schema", () => {
    const { logger, repo } = build(BOTH_ON);

    expect(() => logger.debug("a", "   ")).not.toThrow();
    expect(repo.entries).toHaveLength(0);
  });
});

describe("createSystemLogger — truncation", () => {
  it("truncates an over-long message instead of rejecting it", () => {
    const { logger, repo } = build(BOTH_ON);

    logger.debug("a", "x".repeat(SYSTEM_LOG_MESSAGE_MAX + 500));

    expect(repo.entries).toHaveLength(1);
    expect(repo.entries[0].message).toHaveLength(SYSTEM_LOG_MESSAGE_MAX);
  });
});

describe("noopSystemLogger", () => {
  it("reports every kind disabled and writes nothing", () => {
    expect(noopSystemLogger.enabled("debug")).toBe(false);
    expect(noopSystemLogger.enabled("operational")).toBe(false);
    expect(() => noopSystemLogger.debug("a", "one")).not.toThrow();
  });
});
