import { describe, expect, it } from "vitest";
import {
  deleteDeployment,
  listDeployments,
  parseBuildLog,
  recordDeployment,
} from "./deployments";
import { MAX_BUILD_OUTPUT_LENGTH } from "./schema";
import type { DeploymentRepository, NewDeploymentRow } from "./ports";
import type { Deployment } from "./types";

function fakeRepo(seed: Deployment[] = []): DeploymentRepository & {
  recorded: NewDeploymentRow[];
  rows: Deployment[];
} {
  const rows = [...seed];
  const recorded: NewDeploymentRow[] = [];
  let nextId = rows.length + 1;

  return {
    rows,
    recorded,
    list: () => rows,
    record: (row) => {
      recorded.push(row);
      return nextId++;
    },
    delete: (id) => {
      const index = rows.findIndex((row) => row.id === id);
      if (index === -1) return false;
      rows.splice(index, 1);
      return true;
    },
  };
}

const FULL_LOG = JSON.stringify({
  buildId: "aBcD1234",
  appVersion: "0.1.0",
  builtAt: "2026-09-01T10:00:00.000Z",
  builtOnHost: "DESKTOP-WIN",
  nodeAbi: 127,
  packageSizeBytes: 41_943_040,
  output: "▸ Building\n  no symlinks\n",
});

describe("parseBuildLog", () => {
  it("reads every field of a well-formed log", () => {
    expect(parseBuildLog(FULL_LOG)).toEqual({
      buildId: "aBcD1234",
      appVersion: "0.1.0",
      builtAt: "2026-09-01T10:00:00.000Z",
      builtOnHost: "DESKTOP-WIN",
      nodeAbi: 127,
      packageSizeBytes: 41_943_040,
      output: "▸ Building\n  no symlinks\n",
    });
  });

  it("returns null when there was no file, which is a package built before this feature", () => {
    expect(parseBuildLog(null)).toBeNull();
  });

  it("returns null for an empty or whitespace-only file rather than an all-null record", () => {
    expect(parseBuildLog("")).toBeNull();
    expect(parseBuildLog("   \n ")).toBeNull();
  });

  it("returns null for invalid JSON instead of throwing into the deploy step", () => {
    expect(parseBuildLog("{ not json")).toBeNull();
  });

  it("returns null for valid JSON that isn't an object", () => {
    expect(parseBuildLog('"a string"')).toBeNull();
    expect(parseBuildLog("[1, 2]")).toBeNull();
    expect(parseBuildLog("null")).toBeNull();
  });

  it("keeps the fields it understands when others are missing", () => {
    const partial = parseBuildLog(JSON.stringify({ buildId: "xyz" }));
    expect(partial).toEqual({
      buildId: "xyz",
      appVersion: null,
      builtAt: null,
      builtOnHost: null,
      nodeAbi: null,
      packageSizeBytes: null,
      output: null,
    });
  });

  it("nulls a single wrong-typed field rather than discarding the whole log", () => {
    // A newer build writing `nodeAbi` as a string must not cost us the build id.
    const drifted = parseBuildLog(JSON.stringify({ buildId: "xyz", nodeAbi: "127" }));
    expect(drifted?.buildId).toBe("xyz");
    expect(drifted?.nodeAbi).toBeNull();
  });

  it("ignores unknown fields, so a log from a future build still reads", () => {
    const future = parseBuildLog(JSON.stringify({ buildId: "xyz", gitCommit: "deadbeef" }));
    expect(future?.buildId).toBe("xyz");
  });

  it("truncates a runaway build log with a visible marker instead of dropping it", () => {
    const huge = JSON.stringify({ output: "x".repeat(MAX_BUILD_OUTPUT_LENGTH + 5_000) });
    const parsed = parseBuildLog(huge);
    expect(parsed?.output).toHaveLength(MAX_BUILD_OUTPUT_LENGTH);
    expect(parsed?.output?.endsWith("… truncated.")).toBe(true);
  });

  it("treats a blank build id as absent, so callers have one unknown", () => {
    expect(parseBuildLog(JSON.stringify({ buildId: "   " }))?.buildId).toBeNull();
  });
});

describe("recordDeployment", () => {
  const deployedAt = new Date("2026-09-01T12:30:00.000Z");

  it("writes the shipped build log's fields alongside the go-live timestamp", () => {
    const repo = fakeRepo();
    const id = recordDeployment(repo, {
      buildLog: parseBuildLog(FULL_LOG),
      migrated: true,
      deployedAt,
    });

    expect(id).toBe(1);
    expect(repo.recorded[0]).toEqual({
      deployedAt: "2026-09-01T12:30:00.000Z",
      builtAt: "2026-09-01T10:00:00.000Z",
      buildId: "aBcD1234",
      appVersion: "0.1.0",
      builtOnHost: "DESKTOP-WIN",
      nodeAbi: 127,
      packageSizeBytes: 41_943_040,
      migrated: true,
      buildOutput: "▸ Building\n  no symlinks\n",
    });
  });

  it("still records a deployment when no build log shipped — a timestamp is a real record", () => {
    const repo = fakeRepo();
    recordDeployment(repo, { buildLog: null, migrated: false, deployedAt });

    expect(repo.recorded[0]).toEqual({
      deployedAt: "2026-09-01T12:30:00.000Z",
      builtAt: null,
      buildId: null,
      appVersion: null,
      builtOnHost: null,
      nodeAbi: null,
      packageSizeBytes: null,
      migrated: false,
      buildOutput: null,
    });
  });

  it("keeps the go-live time distinct from the build time", () => {
    const repo = fakeRepo();
    recordDeployment(repo, { buildLog: parseBuildLog(FULL_LOG), migrated: false, deployedAt });

    const row = repo.recorded[0];
    expect(row.deployedAt).not.toBe(row.builtAt);
    expect(Date.parse(row.deployedAt)).toBeGreaterThan(Date.parse(row.builtAt as string));
  });
});

describe("listDeployments", () => {
  it("hands back what the repository holds", () => {
    const rows: Deployment[] = [
      {
        id: 2,
        deployedAt: "2026-09-01T12:00:00.000Z",
        builtAt: null,
        buildId: null,
        appVersion: null,
        builtOnHost: null,
        nodeAbi: null,
        packageSizeBytes: null,
        migrated: false,
        buildOutput: null,
      },
    ];
    expect(listDeployments(fakeRepo(rows))).toEqual(rows);
  });

  it("is empty before anything has deployed", () => {
    expect(listDeployments(fakeRepo())).toEqual([]);
  });
});

describe("deleteDeployment", () => {
  function repoWithIds(...ids: number[]) {
    return fakeRepo(
      ids.map((id) => ({
        id,
        deployedAt: "2026-09-01T12:00:00.000Z",
        builtAt: null,
        buildId: null,
        appVersion: null,
        builtOnHost: null,
        nodeAbi: null,
        packageSizeBytes: null,
        migrated: false,
        buildOutput: null,
      })),
    );
  }

  it("removes the row and reports that it did", () => {
    const repo = repoWithIds(1, 2);
    expect(deleteDeployment(repo, 1)).toBe(true);
    expect(repo.rows.map((row) => row.id)).toEqual([2]);
  });

  it("reports false for a row that is already gone, rather than failing", () => {
    // Two tabs on the About screen, or a double-tap on a phone.
    const repo = repoWithIds(1);
    expect(deleteDeployment(repo, 1)).toBe(true);
    expect(deleteDeployment(repo, 1)).toBe(false);
  });

  it("accepts a numeric string, since a form field arrives as text", () => {
    const repo = repoWithIds(7);
    expect(deleteDeployment(repo, "7")).toBe(true);
  });

  it("throws on a malformed id — that's a broken caller, not a missing row", () => {
    const repo = repoWithIds(1);
    expect(() => deleteDeployment(repo, 0)).toThrow();
    expect(() => deleteDeployment(repo, -3)).toThrow();
    expect(() => deleteDeployment(repo, 1.5)).toThrow();
    expect(() => deleteDeployment(repo, "not-a-number")).toThrow();
    expect(repo.rows).toHaveLength(1);
  });
});
