import { DEFAULT_MODULES } from "./defaults";
import type { ModuleRepository } from "./ports";
import { moduleUpdateListSchema, type ModuleUpdate } from "./schema";
import type { Module } from "./types";

export function listModules(
  repo: ModuleRepository,
  options?: { includeHidden?: boolean },
): Module[] {
  return repo.listModules(options);
}

export function getModuleBySlug(repo: ModuleRepository, slug: string): Module | undefined {
  return repo.getModuleBySlug(slug);
}

export function updateModules(repo: ModuleRepository, updates: ModuleUpdate[]): Module[] {
  const validated = moduleUpdateListSchema.parse(updates);
  repo.updateAll(validated);
  return repo.listModules({ includeHidden: true });
}

export function resetModulesToDefaults(repo: ModuleRepository): Module[] {
  repo.resetToDefaults(DEFAULT_MODULES);
  return repo.listModules({ includeHidden: true });
}
