import { describe, expect, it } from "vitest";
import {
  clearStartupMessage,
  formatDeploymentMessage,
  getSetting,
  getStartupMessage,
  listSettings,
  resetSettingsToDefaults,
  setStartupMessage,
  updateSettings,
} from "./settings";
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
    setValue(key, value) {
      const existing = state.find((setting) => setting.key === key);
      // Replace rather than mutate — `state` shares objects with the seed array.
      if (existing) state = state.map((s) => (s.key === key ? { ...s, value } : s));
      else state = [...state, { key, value }];
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

  it("keeps STARTUP_MESSAGE present and blank", () => {
    const repo = fakeRepo([{ key: "STARTUP_MESSAGE", value: "stale" }]);
    resetSettingsToDefaults(repo);
    expect(getStartupMessage(repo)).toBeUndefined();
    expect(getSetting(repo, "STARTUP_MESSAGE")).toBeDefined();
  });
});

describe("getStartupMessage", () => {
  it("returns the message when one is set", () => {
    const repo = fakeRepo([{ key: "STARTUP_MESSAGE", value: "Deployed" }]);
    expect(getStartupMessage(repo)).toBe("Deployed");
  });

  it("returns undefined when the value is blank", () => {
    expect(getStartupMessage(fakeRepo([{ key: "STARTUP_MESSAGE", value: "" }]))).toBeUndefined();
  });

  it("treats a whitespace-only value as blank", () => {
    expect(getStartupMessage(fakeRepo([{ key: "STARTUP_MESSAGE", value: "   " }]))).toBeUndefined();
  });

  it("returns undefined when the key is missing entirely", () => {
    expect(getStartupMessage(fakeRepo(sample))).toBeUndefined();
  });
});

describe("setStartupMessage", () => {
  it("stores the message so it can be read back", () => {
    const repo = fakeRepo(sample);
    setStartupMessage(repo, "A new deployment is published on 2026-08-08 14:30");
    expect(getStartupMessage(repo)).toBe("A new deployment is published on 2026-08-08 14:30");
  });

  it("creates the row when the key does not exist yet", () => {
    const repo = fakeRepo([]);
    setStartupMessage(repo, "Hello");
    expect(getSetting(repo, "STARTUP_MESSAGE")?.value).toBe("Hello");
  });

  it("rejects a message longer than the schema allows", () => {
    expect(() => setStartupMessage(fakeRepo(sample), "x".repeat(2001))).toThrow();
  });
});

describe("clearStartupMessage", () => {
  it("clears a set message", () => {
    const repo = fakeRepo([{ key: "STARTUP_MESSAGE", value: "Deployed" }]);
    clearStartupMessage(repo);
    expect(getStartupMessage(repo)).toBeUndefined();
  });

  it("is a no-op when there is nothing to clear", () => {
    const repo = fakeRepo([{ key: "STARTUP_MESSAGE", value: "" }]);
    clearStartupMessage(repo);
    expect(getStartupMessage(repo)).toBeUndefined();
  });
});

describe("formatDeploymentMessage", () => {
  it("formats the timestamp in local time, zero-padded", () => {
    expect(formatDeploymentMessage(new Date(2026, 7, 8, 9, 5))).toBe(
      "A new deployment is published on 2026-08-08 09:05",
    );
  });
});
