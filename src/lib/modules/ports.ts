import type { ModuleUpdate } from "./schema";
import type { Module } from "./types";

// The use-cases depend on THIS interface, not on a concrete database.
// That is what lets the web app, the CLI, and tests each supply their own.
export interface ModuleRepository {
  listModules(options?: { includeHidden?: boolean }): Module[];
  getModuleBySlug(slug: string): Module | undefined;
  /** Updates each module's editable fields and reassigns sequence by array order. */
  updateAll(updates: ModuleUpdate[]): void;
  /** Replaces the entire table with the given rows (sequence = array order). */
  resetToDefaults(defaults: Omit<Module, "id">[]): void;
}
