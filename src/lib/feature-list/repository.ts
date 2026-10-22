import { readFileSync } from "node:fs";
import path from "node:path";
import type { FeatureListRepository } from "./ports";

// The feature catalogue is a file in the repo root rather than a table, so
// "data access" for this module is one read.
//
// Deliberately not re-exported from index.ts: `node:fs` would follow the barrel
// into any `"use client"` module that imports this module's types, and the
// About view is one. Wired in wiring.ts instead, exactly like
// FileChangeHistoryRepository.

export const FEATURE_LIST_FILENAME = "MyHomeBase_feature.md";

export class FileFeatureListRepository implements FeatureListRepository {
  constructor(private readonly rootDir: string = process.cwd()) {}

  readFeatureList(): string | null {
    try {
      return readFileSync(path.join(this.rootDir, FEATURE_LIST_FILENAME), "utf8");
    } catch {
      return null;
    }
  }
}
