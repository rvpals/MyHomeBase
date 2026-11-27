import { describe, expect, it } from "vitest";
import {
  describeError,
  formatDependencyReport,
  formatMs,
  listDependencyChecks,
  runDependencyChecks,
  runDependencyProbe,
  worstStatus,
  type DependencyCheckDeps,
  type DependencyId,
  type DependencyProbe,
  type DependencyRecorder,
} from "./dependency-checks";
import { dependencyCheckSchema } from "./schema";

/** A clock that advances 10ms every time it is read, so every duration is predictable. */
function tickingClock(step = 10): () => number {
  let t = 0;
  return () => (t += step);
}

function probe(id: DependencyId, run: (record: DependencyRecorder) => Promise<void>): DependencyProbe {
  return { id, label: `${id} label`, purpose: `${id} purpose`, run };
}

const RUNTIME = {
  node: "v24.0.0",
  abi: "137",
  platform: "linux",
  arch: "arm64",
  hostname: "nas",
  cwd: "/app",
  rssMb: 120,
  uptimeSeconds: 42,
};

function deps(probes: DependencyProbe[]): DependencyCheckDeps {
  return {
    probes,
    runtime: () => RUNTIME,
    now: tickingClock(),
    clock: () => new Date("2026-11-27T12:00:00.000Z"),
  };
}

describe("runDependencyProbe", () => {
  it("records version, facts and timed steps, and passes when every step passes", async () => {
    const result = await runDependencyProbe(
      probe("sqlite", async (record) => {
        record.version("12.9.0");
        record.fact("Engine", "3.50");
        record.fact("Missing", undefined);
        record.fact("Enabled", true);
        const value = await record.step("Load", () => 41, (n) => `got ${n + 1}`);
        record.check("Value", value === 41, "41 as expected");
      }),
      tickingClock(),
    );

    expect(result.status).toBe("pass");
    expect(result.version).toBe("12.9.0");
    expect(result.facts).toEqual([
      { label: "Engine", value: "3.50" },
      { label: "Missing", value: "-" },
      { label: "Enabled", value: "yes" },
    ]);
    expect(result.steps).toEqual([
      { name: "Load", status: "pass", ms: 10, detail: "got 42" },
      { name: "Value", status: "pass", detail: "41 as expected" },
    ]);
    expect(result.summary).toMatch(/^All 2 steps passed/);
  });

  it("stops at the first failing step and names it in the summary", async () => {
    let reachedLater = false;
    const result = await runDependencyProbe(
      probe("sharp", async (record) => {
        await record.step("Load", () => {
          const error = new Error("wrong ELF class\n    at dlopen (node:internal)") as Error & { code: string };
          error.code = "ERR_DLOPEN_FAILED";
          throw error;
        });
        reachedLater = true;
      }),
      tickingClock(),
    );

    expect(reachedLater).toBe(false);
    expect(result.status).toBe("fail");
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toMatchObject({ name: "Load", status: "fail", detail: "ERR_DLOPEN_FAILED: wrong ELF class" });
    expect(result.summary).toBe('Failed at "Load": ERR_DLOPEN_FAILED: wrong ELF class');
  });

  it("treats a failed check as a warning when asked, and keeps going", async () => {
    const result = await runDependencyProbe(
      probe("tesseract", async (record) => {
        record.check("Local model", false, "downloads from a CDN", "warn");
        await record.step("Recognise", () => "text");
      }),
      tickingClock(),
    );

    expect(result.status).toBe("warn");
    expect(result.steps.map((step) => step.status)).toEqual(["warn", "pass"]);
    expect(result.summary).toBe("Works, with a warning: downloads from a CDN");
  });

  it("records a throw outside any step as an unexpected error", async () => {
    const result = await runDependencyProbe(
      probe("canvas", async () => {
        throw new Error("probe bug");
      }),
      tickingClock(),
    );

    expect(result.status).toBe("fail");
    expect(result.steps).toEqual([{ name: "Unexpected error", status: "fail", detail: "probe bug" }]);
  });

  it("fails a probe that recorded nothing", async () => {
    const result = await runDependencyProbe(probe("canvas", async () => {}), tickingClock());
    expect(result.status).toBe("fail");
    expect(result.summary).toContain("recorded nothing");
  });

  it("keeps a step's pass when only describing its result throws", async () => {
    const result = await runDependencyProbe(
      probe("sqlite", async (record) => {
        await record.step("Load", () => 1, () => {
          throw new Error("bad describe");
        });
      }),
      tickingClock(),
    );
    expect(result.steps[0]).toMatchObject({ status: "pass" });
    expect(result.steps[0]!.detail).toContain("bad describe");
  });
});

describe("runDependencyChecks", () => {
  const passing = (id: DependencyId) =>
    probe(id, async (record) => {
      await record.step("Load", () => undefined);
    });

  it("runs every probe in DEPENDENCY_IDS order when no ids are given", async () => {
    const order: string[] = [];
    const tracked = (id: DependencyId) =>
      probe(id, async (record) => {
        order.push(id);
        await record.step("Load", () => undefined);
      });

    const report = await runDependencyChecks(
      deps([tracked("canvas"), tracked("sharp"), tracked("sqlite"), tracked("tesseract")]),
    );

    expect(order).toEqual(["sqlite", "tesseract", "sharp", "canvas"]);
    expect(report.status).toBe("pass");
    expect(report.ranAt).toBe("2026-11-27T12:00:00.000Z");
    expect(report.runtime).toEqual(RUNTIME);
  });

  it("runs only the requested ids", async () => {
    const report = await runDependencyChecks(deps([passing("sqlite"), passing("sharp")]), { ids: ["sharp"] });
    expect(report.results.map((result) => result.id)).toEqual(["sharp"]);
  });

  it("reports a requested id with no registered probe as a failure", async () => {
    const report = await runDependencyChecks(deps([passing("sqlite")]), { ids: ["sqlite", "canvas"] });
    expect(report.status).toBe("fail");
    expect(report.results[1]).toMatchObject({ id: "canvas", status: "fail" });
  });

  it("takes the worst status across results", async () => {
    const warning = probe("tesseract", async (record) => record.check("Model", false, "CDN", "warn"));
    const report = await runDependencyChecks(deps([passing("sqlite"), warning]));
    expect(report.status).toBe("warn");
  });
});

describe("listDependencyChecks", () => {
  it("lists the registered probes in display order without running them", () => {
    let ran = false;
    const lazy = (id: DependencyId) =>
      probe(id, async () => {
        ran = true;
      });
    expect(listDependencyChecks([lazy("sharp"), lazy("sqlite")])).toEqual([
      { id: "sqlite", label: "sqlite label", purpose: "sqlite purpose" },
      { id: "sharp", label: "sharp label", purpose: "sharp purpose" },
    ]);
    expect(ran).toBe(false);
  });
});

describe("formatDependencyReport", () => {
  it("prints the runtime, the tally, and each result's facts and steps", async () => {
    const report = await runDependencyChecks(
      deps([
        probe("sqlite", async (record) => {
          record.version("12.9.0");
          record.fact("Engine", "3.50");
          await record.step("Load", () => undefined, () => "loaded");
        }),
        probe("sharp", async (record) => {
          await record.step("Load", () => {
            throw new Error("missing binary");
          });
        }),
      ]),
      { ids: ["sqlite", "sharp"] },
    );

    const text = formatDependencyReport(report);
    expect(text).toContain("Node v24.0.0 (ABI 137) on linux/arm64, host nas");
    expect(text).toContain("Overall: FAIL (1 pass, 0 warn, 1 fail)");
    expect(text).toContain("[PASS] sqlite label 12.9.0");
    expect(text).toContain("Engine  3.50");
    expect(text).toMatch(/ok {2}Load .*loaded/);
    expect(text).toContain("[FAIL] sharp label unknown");
    expect(text).toMatch(/FAIL {2}Load .*missing binary/);
  });
});

describe("helpers", () => {
  it("formats durations by magnitude", () => {
    expect(formatMs(0.42)).toBe("0.4 ms");
    expect(formatMs(845.4)).toBe("845 ms");
    expect(formatMs(3720)).toBe("3.72 s");
  });

  it("takes the worst status, pass for none", () => {
    expect(worstStatus([])).toBe("pass");
    expect(worstStatus(["pass", "warn"])).toBe("warn");
    expect(worstStatus(["fail", "warn", "pass"])).toBe("fail");
  });

  it("describes non-Error throws and caps long messages", () => {
    expect(describeError("plain")).toBe("plain");
    expect(describeError(new Error("x".repeat(1000)))).toHaveLength(400);
  });
});

describe("dependencyCheckSchema", () => {
  it("accepts known ids and defaults to all", () => {
    expect(dependencyCheckSchema.parse({ ids: ["sqlite", "tesseract"] }).ids).toEqual(["sqlite", "tesseract"]);
    expect(dependencyCheckSchema.parse({}).ids).toEqual([]);
  });

  it("refuses an unknown id", () => {
    expect(dependencyCheckSchema.safeParse({ ids: ["openssl"] }).success).toBe(false);
  });
});
