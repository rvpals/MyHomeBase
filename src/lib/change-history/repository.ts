import { readFileSync } from "node:fs";
import path from "node:path";
import type { ChangeHistoryRepository } from "./ports";

// The change log is a file in the repo root rather than a table, so "data
// access" for this module is one read.
//
// Deliberately not re-exported from index.ts: `node:fs` would follow the barrel
// into any `"use client"` module that imports this module's types, and the
// About view is one. Wired in wiring.ts instead, exactly like
// RealSystemInfoRepository.

export const CHANGE_HISTORY_FILENAME = "CHANGE_HISTORY.md";

export class FileChangeHistoryRepository implements ChangeHistoryRepository {
  constructor(private readonly rootDir: string = process.cwd()) {}

  readChangeLog(): string | null {
    try {
      return readFileSync(path.join(this.rootDir, CHANGE_HISTORY_FILENAME), "utf8");
    } catch {
      return null;
    }
  }
}
