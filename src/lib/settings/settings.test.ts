import { describe, expect, it } from "vitest";
import { getSetting, listSettings, resetSettingsToDefaults, updateSettings } from "./settings";
import type { SettingsRepository } from "./ports";
import type { Setting } from "./types";

// Hand-written fake — no mocking framework, reusable across tests.
function fakeRepo(seed: Setting[]): SettingsRepository {
  let state = [...seed];
  return {
    listSettings() {
      return [...state].sort((a, b) => a.key.localeCompare(b.key));
    },
    getSetting(key) {
      return state.find((setting) => setting.key === key);
    },
    updateAll(updates) {
      state = state.map((setting) => {
        const update = updates.find((item) => item.key === setting.key);
        return update ? { ...setting, value: update.value } : setting;
      });
    },
    resetToDefaults(defaults) {
      state = [...defaults];
    },
  };
}

const sample: Setting[] = [{ key: "application_name", value: "MyHomeBase" }];

describe("listSettings", () => {
  it("returns all settings", () => {
    expect(listSettings(fakeRepo(sample))).toHaveLength(1);
  });
});

describe("getSetting", () => {
  it("returns the setting for a known key", () => {
    expect(getSetting(fakeRepo(sample), "application_name")?.value).toBe("MyHomeBase");
  });

  it("returns undefined for an unknown key", () => {
    expect(getSetting(fakeRepo(sample), "does-not-exist")).toBeUndefined();
  });
});

describe("updateSettings", () => {
  it("updates the value for a matching key", () => {
    const repo = fakeRepo(sample);
    const result = updateSettings(repo, [{ key: "application_name", value: "Casa" }]);
    expect(result.find((setting) => setting.key === "application_name")?.value).toBe("Casa");
  });

  it("rejects an update with an empty value", () => {
    const repo = fakeRepo(sample);
    expect(() => updateSettings(repo, [{ key: "application_name", value: "" }])).toThrow();
  });
});

describe("resetSettingsToDefaults", () => {
  it("restores the seeded settings", () => {
    const repo = fakeRepo([{ key: "application_name", value: "Something Else" }]);
    const result = resetSettingsToDefaults(repo);
    expect(result.find((setting) => setting.key === "application_name")?.value).toBe("MyHomeBase");
  });
});
