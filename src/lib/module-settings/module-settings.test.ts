import { describe, expect, it } from "vitest";
import { listAllModuleSettings, listModuleSettingsFor, saveModuleSettings } from "./module-settings";
import type { ModuleSettingsRepository } from "./ports";
import type { ModuleSetting } from "./types";

// Hand-written fake — no mocking framework, reusable across tests.
function fakeRepo(seed: ModuleSetting[]): ModuleSettingsRepository {
  let state = [...seed];
  let nextId = state.reduce((max, setting) => Math.max(max, setting.id), 0) + 1;
  return {
    listByModuleId(moduleId) {
      return state.filter((setting) => setting.moduleId === moduleId);
    },
    listAll() {
      return [...state];
    },
    replaceForModule(moduleId, entries) {
      state = state.filter((setting) => setting.moduleId !== moduleId);
      for (const entry of entries) {
        state.push({ id: nextId++, moduleId, ...entry });
      }
    },
  };
}

const sample: ModuleSetting[] = [
  { id: 1, moduleId: 1, key: "api_key", value: "abc123" },
  { id: 2, moduleId: 2, key: "refresh_interval", value: "15" },
];

describe("listAllModuleSettings", () => {
  it("returns every setting across all modules", () => {
    expect(listAllModuleSettings(fakeRepo(sample))).toHaveLength(2);
  });
});

describe("listModuleSettingsFor", () => {
  it("returns only the settings for the given module", () => {
    const result = listModuleSettingsFor(fakeRepo(sample), 1);
    expect(result.map((setting) => setting.key)).toEqual(["api_key"]);
  });
});

describe("saveModuleSettings", () => {
  it("replaces a module's settings with the given entries (add + edit + remove in one save)", () => {
    const repo = fakeRepo(sample);
    const result = saveModuleSettings(repo, {
      moduleId: 1,
      entries: [
        { key: "api_key", value: "new-value" },
        { key: "sync_enabled", value: "true", description: "Whether background sync runs." },
      ],
    });
    expect(result).toHaveLength(2);
    expect(result.find((setting) => setting.key === "api_key")?.value).toBe("new-value");
    expect(result.find((setting) => setting.key === "sync_enabled")?.description).toBe(
      "Whether background sync runs.",
    );
    // Other modules' settings are untouched.
    expect(listModuleSettingsFor(repo, 2)).toHaveLength(1);
  });

  it("removes all settings for a module when saved with an empty list", () => {
    const repo = fakeRepo(sample);
    const result = saveModuleSettings(repo, { moduleId: 1, entries: [] });
    expect(result).toHaveLength(0);
  });

  it("rejects an entry with an empty key", () => {
    const repo = fakeRepo(sample);
    expect(() =>
      saveModuleSettings(repo, { moduleId: 1, entries: [{ key: "", value: "x" }] }),
    ).toThrow();
  });
});
