// Admin -> Code Tester -> "Dependency test": does each fragile dependency still load
// and still do its job on THIS server?
//
// Why it exists: the native and WASM dependencies (better-sqlite3, sharp,
// @napi-rs/canvas, tesseract.js) break from time to time -- a Node or npm bump
// leaves a binding built for the wrong ABI, a Windows binary is shipped to the
// aarch64 NAS, or a model file goes missing and OCR silently falls back to a CDN.
// Every one of those surfaces as a feature failing much later. A check here runs the
// real load path and a small real workload, so the break is seen on demand instead.
//
// This file is the use-case and the report shape. The probes themselves -- the only
// code that touches the libraries -- are in `dependency-probes.ts`, behind the
// `DependencyProbe` port, so this file is unit-tested with fakes.

/** The dependencies the card and the CLI can test, in display order. */
export const DEPENDENCY_IDS = ["sqlite", "tesseract", "sharp", "canvas"] as const;

export type DependencyId = (typeof DEPENDENCY_IDS)[number];

/** `warn` = it works, but something about it will bite later (e.g. a CDN fallback). */
export type DependencyStatus = "pass" | "warn" | "fail";

/** One thing a probe did or checked, in the order it happened. */
export interface DependencyStep {
  name: string;
  status: DependencyStatus;
  /** How long it took; absent for a check that only inspected a value. */
  ms?: number;
  detail: string;
}

/** A fact about the dependency, for the report: a version, a path, a setting. */
export interface DependencyFact {
  label: string;
  value: string;
}

export interface DependencyCheckResult {
  id: string;
  label: string;
  /** One line on what the app uses it for, so a failure says what is affected. */
  purpose: string;
  /** The worst status among the steps. */
  status: DependencyStatus;
  /** One line: why it failed, the first warning, or that everything passed. */
  summary: string;
  /** The package version, or `unknown`. */
  version: string;
  facts: DependencyFact[];
  steps: DependencyStep[];
  totalMs: number;
}

/** Facts about the server process, for the report's header. */
export interface RuntimeInfo {
  /** `process.version`, e.g. `v24.11.0`. */
  node: string;
  /** `process.versions.modules` -- the ABI a native binding must have been built for. */
  abi: string;
  platform: string;
  arch: string;
  hostname: string;
  cwd: string;
  /** Resident memory of this process, in MB. */
  rssMb: number;
  uptimeSeconds: number;
}

export interface DependencyReport {
  /** ISO timestamp the run started. */
  ranAt: string;
  runtime: RuntimeInfo;
  /** The worst status among the results. */
  status: DependencyStatus;
  results: DependencyCheckResult[];
}

/**
 * What a probe writes its findings to. The use-case owns the timing, the error
 * capture and the status arithmetic; a probe only says what it is doing.
 */
export interface DependencyRecorder {
  /** The package version, shown beside the name. */
  version(value: string): void;
  /** A fact for the report. `undefined` is recorded as `-`. */
  fact(label: string, value: string | number | boolean | undefined): void;
  /**
   * Runs and times one step. A throw is recorded as a failed step (with the error's
   * code and first line) and then ABORTS the probe -- later steps usually depend on
   * this one, so continuing would only pile up consequential failures.
   *
   * `describe` turns the step's result into its detail line.
   */
  step<T>(name: string, run: () => T | Promise<T>, describe?: (value: T) => string): Promise<T>;
  /** Records a check on a value already in hand. Does not abort, whatever the result. */
  check(name: string, passed: boolean, detail: string, whenNotPassed?: "warn" | "fail"): void;
}

/** One dependency's test. The real ones are in `dependency-probes.ts`. */
export interface DependencyProbe {
  id: DependencyId;
  label: string;
  purpose: string;
  run(record: DependencyRecorder): Promise<void>;
}

export interface DependencyCheckDeps {
  probes: readonly DependencyProbe[];
  runtime: () => RuntimeInfo;
  /** Milliseconds from an arbitrary origin. `performance.now` in production. */
  now: () => number;
  /** Wall clock for `ranAt`. */
  clock: () => Date;
}

/** What the screen lists before anything has run. */
export interface DependencyCheckSummary {
  id: DependencyId;
  label: string;
  purpose: string;
}

/** The registered probes as the card's rows, in `DEPENDENCY_IDS` order. Runs nothing. */
export function listDependencyChecks(probes: readonly DependencyProbe[]): DependencyCheckSummary[] {
  return DEPENDENCY_IDS.flatMap((id) => {
    const probe = probes.find((candidate) => candidate.id === id);
    return probe ? [{ id, label: probe.label, purpose: probe.purpose }] : [];
  });
}

/** Thrown by `step` after it has recorded the failure; the runner swallows it. */
class StepAborted extends Error {}

/**
 * `ERR_DLOPEN_FAILED: /path/better_sqlite3.node: wrong ELF class` -- the code (when the
 * error has one) and the first line, which is where a native-load error names the
 * file and the reason. Capped so one stack-trace-sized message can't swamp the report.
 */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error).slice(0, 400);
  const code = (error as { code?: unknown }).code;
  const firstLine = error.message.split("\n")[0]?.trim() || error.name;
  const text = typeof code === "string" && !firstLine.includes(code) ? `${code}: ${firstLine}` : firstLine;
  return text.slice(0, 400);
}

const RANK: Record<DependencyStatus, number> = { pass: 0, warn: 1, fail: 2 };

/** Display order of the statuses in a tally. */
export const DEPENDENCY_STATUS_ORDER: readonly DependencyStatus[] = ["pass", "warn", "fail"];

/** The worse of the statuses; `pass` for none. */
export function worstStatus(statuses: readonly DependencyStatus[]): DependencyStatus {
  return statuses.reduce<DependencyStatus>(
    (worst, status) => (RANK[status] > RANK[worst] ? status : worst),
    "pass",
  );
}

function formatFactValue(value: string | number | boolean | undefined): string {
  if (value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}

function summarise(steps: readonly DependencyStep[], totalMs: number): string {
  const failed = steps.find((step) => step.status === "fail");
  if (failed) return `Failed at "${failed.name}": ${failed.detail}`;
  const warnings = steps.filter((step) => step.status === "warn");
  if (warnings.length > 0) {
    const more = warnings.length > 1 ? ` (+${warnings.length - 1} more)` : "";
    return `Works, with a warning: ${warnings[0]!.detail}${more}`;
  }
  return `All ${steps.length} steps passed in ${formatMs(totalMs)}.`;
}

/** Runs one probe and never throws: an exception is a failed step in its result. */
export async function runDependencyProbe(
  probe: DependencyProbe,
  now: () => number,
): Promise<DependencyCheckResult> {
  const steps: DependencyStep[] = [];
  const facts: DependencyFact[] = [];
  let version = "unknown";

  const record: DependencyRecorder = {
    version(value) {
      if (value.trim() !== "") version = value.trim();
    },
    fact(label, value) {
      facts.push({ label, value: formatFactValue(value) });
    },
    async step(name, run, describe) {
      const startedAt = now();
      let value;
      try {
        value = await run();
      } catch (error) {
        steps.push({ name, status: "fail", ms: now() - startedAt, detail: describeError(error) });
        throw new StepAborted();
      }
      const ms = now() - startedAt;
      let detail = "ok";
      if (describe) {
        try {
          detail = describe(value);
        } catch (error) {
          detail = `ok (couldn't describe the result: ${describeError(error)})`;
        }
      }
      steps.push({ name, status: "pass", ms, detail });
      return value;
    },
    check(name, passed, detail, whenNotPassed = "fail") {
      steps.push({ name, status: passed ? "pass" : whenNotPassed, detail });
    },
  };

  const startedAt = now();
  try {
    await probe.run(record);
  } catch (error) {
    // A StepAborted has already been recorded. Anything else escaped the probe
    // outside a step -- a probe bug or an unexpected library throw -- and is recorded
    // here so the report still shows it.
    if (!(error instanceof StepAborted)) {
      steps.push({ name: "Unexpected error", status: "fail", detail: describeError(error) });
    }
  }
  const totalMs = now() - startedAt;

  if (steps.length === 0) {
    steps.push({ name: "Run", status: "fail", detail: "The probe recorded nothing." });
  }

  return {
    id: probe.id,
    label: probe.label,
    purpose: probe.purpose,
    status: worstStatus(steps.map((step) => step.status)),
    summary: summarise(steps, totalMs),
    version,
    facts,
    steps,
    totalMs,
  };
}

/**
 * Runs the selected checks one after another, in `DEPENDENCY_IDS` order.
 *
 * Sequential on purpose: OCR takes a few hundred MB on a 2GB NAS, and timings taken
 * while another library is loading next to it would mean nothing.
 *
 * `ids` omitted or empty = all of them. An id with no registered probe is reported
 * as a failure rather than dropped, so a wiring slip is visible.
 */
export async function runDependencyChecks(
  deps: DependencyCheckDeps,
  input: { ids?: readonly DependencyId[] } = {},
): Promise<DependencyReport> {
  const ranAt = deps.clock().toISOString();
  const wanted = input.ids && input.ids.length > 0 ? new Set(input.ids) : new Set(DEPENDENCY_IDS);

  const results: DependencyCheckResult[] = [];
  for (const id of DEPENDENCY_IDS) {
    if (!wanted.has(id)) continue;
    const probe = deps.probes.find((candidate) => candidate.id === id);
    if (!probe) {
      results.push({
        id,
        label: id,
        purpose: "",
        status: "fail",
        summary: `No probe is registered for "${id}".`,
        version: "unknown",
        facts: [],
        steps: [{ name: "Find probe", status: "fail", detail: `No probe is registered for "${id}".` }],
        totalMs: 0,
      });
      continue;
    }
    results.push(await runDependencyProbe(probe, deps.now));
  }

  return {
    ranAt,
    runtime: deps.runtime(),
    status: worstStatus(results.map((result) => result.status)),
    results,
  };
}

/** `0.4 ms`, `12.3 ms`, `845 ms`, `3.72 s`. */
export function formatMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
  if (ms >= 100) return `${Math.round(ms)} ms`;
  return `${ms.toFixed(1)} ms`;
}

const TAG: Record<DependencyStatus, string> = { pass: "PASS", warn: "WARN", fail: "FAIL" };
const STEP_MARK: Record<DependencyStatus, string> = { pass: "ok  ", warn: "warn", fail: "FAIL" };

/**
 * The plain-text report: what the CLI prints and what the card's Copy button copies.
 * ASCII only, so it reads the same in a NAS SSH session as in a chat message.
 */
export function formatDependencyReport(report: DependencyReport): string {
  const { runtime } = report;
  const counts = DEPENDENCY_STATUS_ORDER.map(
    (status) => `${report.results.filter((result) => result.status === status).length} ${status}`,
  ).join(", ");

  const lines: string[] = [
    `Dependency test - ${report.ranAt}`,
    `Node ${runtime.node} (ABI ${runtime.abi}) on ${runtime.platform}/${runtime.arch}, host ${runtime.hostname}`,
    `cwd ${runtime.cwd} - RSS ${runtime.rssMb} MB - up ${Math.round(runtime.uptimeSeconds)} s`,
    `Overall: ${TAG[report.status]} (${counts})`,
  ];

  for (const result of report.results) {
    lines.push("");
    lines.push(`[${TAG[result.status]}] ${result.label} ${result.version} - ${formatMs(result.totalMs)}`);
    if (result.purpose) lines.push(`  Used for: ${result.purpose}`);
    lines.push(`  ${result.summary}`);

    if (result.facts.length > 0) {
      lines.push("  Facts:");
      const width = Math.max(...result.facts.map((fact) => fact.label.length));
      for (const fact of result.facts) lines.push(`    ${fact.label.padEnd(width)}  ${fact.value}`);
    }

    lines.push("  Steps:");
    const width = Math.max(...result.steps.map((step) => step.name.length));
    for (const step of result.steps) {
      const ms = step.ms === undefined ? "" : formatMs(step.ms);
      lines.push(`    ${STEP_MARK[step.status]}  ${step.name.padEnd(width)}  ${ms.padStart(9)}  ${step.detail}`);
    }
  }

  return lines.join("\n");
}
