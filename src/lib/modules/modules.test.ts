import { describe, expect, it } from "vitest";
import { getModuleBySlug, listModules, resetModulesToDefaults, updateModules } from "./modules";
import type { ModuleRepository } from "./ports";
import type { Module } from "./types";

// Hand-written fake — no mocking framework, reusable across tests.
function fakeRepo(seed: Module[]): ModuleRepository {
  let state = [...seed];
  let nextId = state.reduce((max, module) => Math.max(max, module.id), 0) + 1;
  return {
    listModules({ includeHidden = false } = {}) {
      return state
        .filter((module) => includeHidden || module.isVisible)
        .sort((a, b) => a.sequence - b.sequence);
    },
    getModuleBySlug(slug) {
      return state.find((module) => module.slug === slug);
    },
    updateAll(updates) {
      state = state.map((module) => {
        const index = updates.findIndex((update) => update.slug === module.slug);
        if (index === -1) return module;
        const update = updates[index];
        return {
          ...module,
          shortName: update.shortName,
          longName: update.longName,
          description: update.description,
          isVisible: update.isVisible,
          sequence: index + 1,
        };
      });
    },
    resetToDefaults(defaults) {
      // Upsert by slug — preserves ids for modules that remain, matching the
      // real repository (so module_settings rows aren't orphaned by a reset).
      const bySlug = new Map(state.map((module) => [module.slug, module]));
      state = defaults.map((item, index) => {
        const existing = bySlug.get(item.slug);
        return { ...item, id: existing?.id ?? nextId++, sequence: index + 1 };
      });
    },
  };
}

const sample: Module[] = [
  {
    id: 1,
    slug: "real-estate-investment",
    shortName: "Real Estate",
    longName: "Real Estate Investment",
    sequence: 1,
    isVisible: true,
    icon: "building",
  },
  {
    id: 2,
    slug: "hidden-module",
    shortName: "Hidden",
    longName: "Hidden Module",
    sequence: 2,
    isVisible: false,
    icon: "folder",
  },
];

describe("listModules", () => {
  it("returns only visible modules, ordered by sequence, by default", () => {
    const result = listModules(fakeRepo(sample));
    expect(result.map((module) => module.slug)).toEqual(["real-estate-investment"]);
  });

  it("includes hidden modules when includeHidden is true", () => {
    const result = listModules(fakeRepo(sample), { includeHidden: true });
    expect(result).toHaveLength(2);
  });
});

describe("getModuleBySlug", () => {
  it("returns the module for a known slug", () => {
    expect(getModuleBySlug(fakeRepo(sample), "real-estate-investment")?.longName).toBe(
      "Real Estate Investment",
    );
  });

  it("returns undefined for an unknown slug", () => {
    expect(getModuleBySlug(fakeRepo(sample), "does-not-exist")).toBeUndefined();
  });
});

describe("updateModules", () => {
  it("updates fields and reassigns sequence from array order", () => {
    const repo = fakeRepo(sample);
    const result = updateModules(repo, [
      { slug: "hidden-module", shortName: "H2", longName: "Hidden Module Two", isVisible: true },
      { slug: "real-estate-investment", shortName: "RE", longName: "Real Estate Investment", isVisible: true },
    ]);
    expect(result.map((module) => module.slug)).toEqual(["hidden-module", "real-estate-investment"]);
    expect(result[0].shortName).toBe("H2");
    expect(result[0].isVisible).toBe(true);
  });

  it("rejects an update with an empty long name", () => {
    const repo = fakeRepo(sample);
    expect(() =>
      updateModules(repo, [
        { slug: "real-estate-investment", shortName: "RE", longName: "", isVisible: true },
      ]),
    ).toThrow();
  });
});

describe("resetModulesToDefaults", () => {
  it("restores the seeded module list", () => {
    const repo = fakeRepo([]);
    const result = resetModulesToDefaults(repo);
    expect(result.map((module) => module.slug)).toEqual([
      "real-estate-investment",
      "stock-etfs",
    ]);
  });

  it("preserves the id of a module that remains in the defaults", () => {
    const repo = fakeRepo([{ ...sample[0], id: 42 }]);
    const result = resetModulesToDefaults(repo);
    expect(result.find((module) => module.slug === "real-estate-investment")?.id).toBe(42);
  });
});
