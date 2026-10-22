import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getFeatureList } from "./feature-list";
import type { FeatureListRepository } from "./ports";
import { FEATURE_LIST_FILENAME, FileFeatureListRepository } from "./repository";

const SAMPLE = `# MyHomeBase — Features

## Journal

- **Entry authoring** with GPS and weather.
`;

function repoReturning(markdown: string | null): FeatureListRepository {
  return { readFeatureList: () => markdown };
}

describe("getFeatureList", () => {
  it("returns the markdown the repository supplies", () => {
    expect(getFeatureList(repoReturning(SAMPLE))).toEqual({ markdown: SAMPLE });
  });

  // The failure path that matters: a checkout without the document renders an
  // empty state, so `null` has to survive rather than become "" or throw.
  it("passes a missing file through as null", () => {
    expect(getFeatureList(repoReturning(null))).toEqual({ markdown: null });
  });
});

describe("FileFeatureListRepository", () => {
  const dirs: string[] = [];

  function tempDir(): string {
    const dir = mkdtempSync(path.join(tmpdir(), "feature-list-"));
    dirs.push(dir);
    return dir;
  }

  afterEach(() => {
    while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  it("reads the document from the root directory it was given", () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, FEATURE_LIST_FILENAME), SAMPLE, "utf8");

    expect(new FileFeatureListRepository(dir).readFeatureList()).toBe(SAMPLE);
  });

  it("returns null when the file is absent rather than throwing", () => {
    expect(new FileFeatureListRepository(tempDir()).readFeatureList()).toBeNull();
  });
});
