import { readFileSync } from "node:fs";
import path from "node:path";
import type { ComponentListRepository } from "./ports";

// The component registry is a file in the repo root rather than a table, so
// "data access" for this module is one read.
//
// Deliberately not re-exported from index.ts: `node:fs` would follow the barrel
// into any `"use client"` module that imports this module's types, and the About
// view is one. Wired in wiring.ts instead, exactly like
// FileFeatureListRepository.

export const COMPONENT_LIST_FILENAME = "components.md";

export class FileComponentListRepository implements ComponentListRepository {
  constructor(private readonly rootDir: string = process.cwd()) {}

  readComponentList(): string | null {
    try {
      return readFileSync(path.join(this.rootDir, COMPONENT_LIST_FILENAME), "utf8");
    } catch {
      return null;
    }
  }
}
