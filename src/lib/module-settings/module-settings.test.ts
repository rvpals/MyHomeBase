import { describe, expect, it } from "vitest";
import {
  listAllModuleSettings,
  listModuleSettingsFor,
  saveModuleSettings,
  saveModuleSettingsPartial,
} from "./module-settings";
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

describe("saveModuleSettingsPartial", () => {
  // The wholesale save deletes every row for the module first, so a screen that
  // owns two of a module's five keys and passes only those wipes the other three.
  // Stocks & ETFs has three such screens (thresholds, dashboard layout,
  // auto-refresh), which is what this exists to stop.
  const manyKeys: ModuleSetting[] = [
    { id: 1, moduleId: 1, key: "profit_target_pct", value: "20" },
    { id: 2, moduleId: 1, key: "dashboard_widgets", value: "a,b,c" },
    { id: 3, moduleId: 1, key: "auto_refresh_enabled", value: "false" },
  ];

  it("overwrites the given keys and leaves every other key untouched", () => {
    const repo = fakeRepo(manyKeys);

    saveModuleSettingsPartial(repo, 1, [{ key: "auto_refresh_enabled", value: "true" }]);

    const byKey = new Map(
      listModuleSettingsFor(repo, 1).map((setting) => [setting.key, setting.value]),
    );
    expect(byKey.get("auto_refresh_enabled")).toBe("true");
    expect(byKey.get("profit_target_pct")).toBe("20");
    expect(byKey.get("dashboard_widgets")).toBe("a,b,c");
    expect(byKey.size).toBe(3);
  });

  it("adds a key the module did not have yet", () => {
    const repo = fakeRepo(manyKeys);

    saveModuleSettingsPartial(repo, 1, [{ key: "auto_refresh_interval", value: "hourly" }]);

    expect(listModuleSettingsFor(repo, 1)).toHaveLength(4);
    expect(
      listModuleSettingsFor(repo, 1).find((setting) => setting.key === "auto_refresh_interval")
        ?.value,
    ).toBe("hourly");
  });

  it("preserves a stored description when a partial save overwrites the value", () => {
    const repo = fakeRepo([
      { id: 1, moduleId: 1, key: "auto_refresh_enabled", value: "false", description: "The switch." },
    ]);

    saveModuleSettingsPartial(repo, 1, [{ key: "auto_refresh_enabled", value: "true" }]);

    const saved = listModuleSettingsFor(repo, 1)[0];
    expect(saved.value).toBe("true");
    expect(saved.description).toBe("The switch.");
  });

  it("never touches another module's settings", () => {
    const repo = fakeRepo([...manyKeys, { id: 9, moduleId: 2, key: "api_key", value: "keep-me" }]);

    saveModuleSettingsPartial(repo, 1, [{ key: "auto_refresh_enabled", value: "true" }]);

    expect(listModuleSettingsFor(repo, 2).map((setting) => setting.value)).toEqual(["keep-me"]);
  });

  it("is a no-op when handed no entries", () => {
    const repo = fakeRepo(manyKeys);

    // Notably NOT the wholesale save's behaviour, which empties the module.
    saveModuleSettingsPartial(repo, 1, []);

    expect(listModuleSettingsFor(repo, 1)).toHaveLength(3);
  });

  it("rejects an entry with an empty key", () => {
    const repo = fakeRepo(manyKeys);
    expect(() => saveModuleSettingsPartial(repo, 1, [{ key: "", value: "x" }])).toThrow();
  });
});
