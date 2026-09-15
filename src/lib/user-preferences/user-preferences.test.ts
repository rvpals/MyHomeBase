import { describe, expect, it } from "vitest";
import { DEFAULT_COMPACT_NAV_STYLE } from "./nav-style";
import type { UserPreferencesRepository } from "./ports";
import {
  USER_PREFERENCE_KEYS,
  resolveUserPreferences,
  userPreferencesToEntries,
} from "./preferences";
import type { UserPreferencesUpdate } from "./schema";
import type { UserPreference } from "./types";
import {
  UnknownFavoriteModuleError,
  getUserPreferences,
  resolveStartupDestination,
  saveUserPreferences,
} from "./user-preferences";

// Hand-written in-memory fake, per ARCHITECTURE.md — no mocking framework.
// Keyed the same way the real table is: UNIQUE (user_id, preference_key).
class FakeUserPreferencesRepository implements UserPreferencesRepository {
  private rows: UserPreference[] = [];
  private nextId = 1;

  listByUserId(userId: number): UserPreference[] {
    return this.rows
      .filter((row) => row.userId === userId)
      .sort((left, right) => left.key.localeCompare(right.key));
  }

  setValue(userId: number, key: string, value: string): void {
    const existing = this.rows.find((row) => row.userId === userId && row.key === key);
    if (existing) {
      existing.value = value;
      return;
    }
    this.rows.push({ id: this.nextId++, userId, key, value });
  }

  deleteForUser(userId: number): void {
    this.rows = this.rows.filter((row) => row.userId !== userId);
  }

  /** Test-only: how many rows exist, to prove an upsert didn't accumulate. */
  countAll(): number {
    return this.rows.length;
  }
}

const MODULES = ["journal", "stock-etfs", "expense"];

describe("resolveUserPreferences", () => {
  it("returns the defaults for a user with no stored rows", () => {
    expect(resolveUserPreferences([])).toEqual({
      favoriteModuleSlug: undefined,
      openFavoriteModuleOnStartup: false,
      compactNavStyle: DEFAULT_COMPACT_NAV_STYLE,
      weatherLocation: undefined,
      weatherUnit: "fahrenheit",
    });
  });

  it("maps a blank favorite to undefined rather than an empty string", () => {
    const resolved = resolveUserPreferences([
      { id: 1, userId: 7, key: USER_PREFERENCE_KEYS.favoriteModuleSlug, value: "" },
    ]);
    expect(resolved.favoriteModuleSlug).toBeUndefined();
  });

  it("treats a whitespace-only favorite as unset", () => {
    const resolved = resolveUserPreferences([
      { id: 1, userId: 7, key: USER_PREFERENCE_KEYS.favoriteModuleSlug, value: "   " },
    ]);
    expect(resolved.favoriteModuleSlug).toBeUndefined();
  });

  it("reads the stored flag", () => {
    const rows: UserPreference[] = [
      { id: 1, userId: 7, key: USER_PREFERENCE_KEYS.favoriteModuleSlug, value: "journal" },
      { id: 2, userId: 7, key: USER_PREFERENCE_KEYS.openFavoriteModuleOnStartup, value: "1" },
    ];
    expect(resolveUserPreferences(rows)).toEqual({
      favoriteModuleSlug: "journal",
      openFavoriteModuleOnStartup: true,
      compactNavStyle: DEFAULT_COMPACT_NAV_STYLE,
      weatherLocation: undefined,
      weatherUnit: "fahrenheit",
    });
  });

  it("reads an unrecognised flag value as off", () => {
    const rows: UserPreference[] = [
      { id: 1, userId: 7, key: USER_PREFERENCE_KEYS.openFavoriteModuleOnStartup, value: "yes" },
    ];
    expect(resolveUserPreferences(rows).openFavoriteModuleOnStartup).toBe(false);
  });
});

describe("userPreferencesToEntries", () => {
  it("writes a blank value for an unset favorite so clearing it takes effect", () => {
    const entries = userPreferencesToEntries({
      openFavoriteModuleOnStartup: false,
      compactNavStyle: DEFAULT_COMPACT_NAV_STYLE,
      weatherUnit: "fahrenheit",
    });
    expect(entries).toEqual([
      { key: USER_PREFERENCE_KEYS.favoriteModuleSlug, value: "" },
      { key: USER_PREFERENCE_KEYS.openFavoriteModuleOnStartup, value: "0" },
      { key: USER_PREFERENCE_KEYS.compactNavStyle, value: DEFAULT_COMPACT_NAV_STYLE },
      { key: USER_PREFERENCE_KEYS.weatherLatitude, value: "" },
      { key: USER_PREFERENCE_KEYS.weatherLongitude, value: "" },
      { key: USER_PREFERENCE_KEYS.weatherPlaceName, value: "" },
      { key: USER_PREFERENCE_KEYS.weatherUnit, value: "fahrenheit" },
    ]);
  });

  it("round-trips through resolveUserPreferences", () => {
    const original = {
      favoriteModuleSlug: "expense",
      openFavoriteModuleOnStartup: true,
      compactNavStyle: DEFAULT_COMPACT_NAV_STYLE,
      weatherLocation: { latitude: 40.34, longitude: -74.46, name: "Princeton, NJ" },
      weatherUnit: "fahrenheit" as const,
    };
    const rows = userPreferencesToEntries(original).map((entry, index) => ({
      id: index + 1,
      userId: 7,
      ...entry,
    }));
    expect(resolveUserPreferences(rows)).toEqual(original);
  });
});

describe("weather location", () => {
  function rows(values: Record<string, string>) {
    return Object.entries(values).map(([key, value], index) => ({
      id: index + 1,
      userId: 7,
      key,
      value,
    }));
  }

  it("resolves a complete stored location", () => {
    const resolved = resolveUserPreferences(
      rows({
        [USER_PREFERENCE_KEYS.weatherLatitude]: "40.34",
        [USER_PREFERENCE_KEYS.weatherLongitude]: "-74.46",
        [USER_PREFERENCE_KEYS.weatherPlaceName]: "Princeton, NJ",
      }),
    );
    expect(resolved.weatherLocation).toEqual({
      latitude: 40.34,
      longitude: -74.46,
      name: "Princeton, NJ",
    });
  });

  it("reads blank rows as no location rather than as 0,0", () => {
    // The bug this guards: Number("") is 0, and 0,0 is a real place in the Gulf of
    // Guinea — so an unset location must not resolve to a forecast for the ocean.
    const resolved = resolveUserPreferences(
      rows({
        [USER_PREFERENCE_KEYS.weatherLatitude]: "",
        [USER_PREFERENCE_KEYS.weatherLongitude]: "",
        [USER_PREFERENCE_KEYS.weatherPlaceName]: "",
      }),
    );
    expect(resolved.weatherLocation).toBeUndefined();
  });

  it("keeps a genuine 0,0 that has a name", () => {
    const resolved = resolveUserPreferences(
      rows({
        [USER_PREFERENCE_KEYS.weatherLatitude]: "0",
        [USER_PREFERENCE_KEYS.weatherLongitude]: "0",
        [USER_PREFERENCE_KEYS.weatherPlaceName]: "Null Island",
      }),
    );
    expect(resolved.weatherLocation).toEqual({ latitude: 0, longitude: 0, name: "Null Island" });
  });

  it("reads a half-written location as no location", () => {
    // Coordinates with no name would leave the card with nothing to label itself.
    expect(
      resolveUserPreferences(
        rows({
          [USER_PREFERENCE_KEYS.weatherLatitude]: "40.34",
          [USER_PREFERENCE_KEYS.weatherLongitude]: "-74.46",
        }),
      ).weatherLocation,
    ).toBeUndefined();

    // ...and a name with no coordinates can't be fetched.
    expect(
      resolveUserPreferences(
        rows({ [USER_PREFERENCE_KEYS.weatherPlaceName]: "Princeton, NJ" }),
      ).weatherLocation,
    ).toBeUndefined();
  });

  it("rejects a non-numeric or out-of-range coordinate", () => {
    const bad = (latitude: string, longitude: string) =>
      resolveUserPreferences(
        rows({
          [USER_PREFERENCE_KEYS.weatherLatitude]: latitude,
          [USER_PREFERENCE_KEYS.weatherLongitude]: longitude,
          [USER_PREFERENCE_KEYS.weatherPlaceName]: "Somewhere",
        }),
      ).weatherLocation;

    expect(bad("banana", "-74.46")).toBeUndefined();
    expect(bad("91", "0")).toBeUndefined();
    expect(bad("0", "181")).toBeUndefined();
  });

  it("defaults the unit to fahrenheit and accepts celsius", () => {
    expect(resolveUserPreferences([]).weatherUnit).toBe("fahrenheit");
    expect(
      resolveUserPreferences(rows({ [USER_PREFERENCE_KEYS.weatherUnit]: "celsius" })).weatherUnit,
    ).toBe("celsius");
    // A garbled value falls back rather than propagating.
    expect(
      resolveUserPreferences(rows({ [USER_PREFERENCE_KEYS.weatherUnit]: "kelvin" })).weatherUnit,
    ).toBe("fahrenheit");
  });

  it("round-trips a location through save and read", () => {
    const repo = new FakeUserPreferencesRepository();
    const saved = saveUserPreferences(
      repo,
      7,
      {
        favoriteModuleSlug: "journal",
        openFavoriteModuleOnStartup: false,
        compactNavStyle: DEFAULT_COMPACT_NAV_STYLE,
        weatherLocation: { latitude: 51.5072, longitude: -0.1276, name: "London, England" },
        weatherUnit: "celsius",
      },
      MODULES,
    );
    expect(saved.weatherLocation).toEqual({
      latitude: 51.5072,
      longitude: -0.1276,
      name: "London, England",
    });
    expect(saved.weatherUnit).toBe("celsius");
  });

  it("clears a stored location when saved with null", () => {
    const repo = new FakeUserPreferencesRepository();
    const base = {
      favoriteModuleSlug: "journal",
      openFavoriteModuleOnStartup: false,
      compactNavStyle: DEFAULT_COMPACT_NAV_STYLE,
      weatherUnit: "fahrenheit" as const,
    };
    saveUserPreferences(
      repo,
      7,
      { ...base, weatherLocation: { latitude: 1, longitude: 2, name: "Somewhere" } },
      MODULES,
    );
    // Blank rows must overwrite the old ones, not be skipped — otherwise "clear my
    // location" silently leaves the previous place in place.
    const cleared = saveUserPreferences(repo, 7, { ...base, weatherLocation: null }, MODULES);
    expect(cleared.weatherLocation).toBeUndefined();
  });
});

describe("getUserPreferences", () => {
  it("defaults for a user who has never saved anything", () => {
    const repo = new FakeUserPreferencesRepository();
    expect(getUserPreferences(repo, 7)).toEqual({
      favoriteModuleSlug: undefined,
      openFavoriteModuleOnStartup: false,
      compactNavStyle: DEFAULT_COMPACT_NAV_STYLE,
      weatherLocation: undefined,
      weatherUnit: "fahrenheit",
    });
  });

  it("keeps users separate", () => {
    const repo = new FakeUserPreferencesRepository();
    saveUserPreferences(
      repo,
      7,
      { favoriteModuleSlug: "journal", openFavoriteModuleOnStartup: true, compactNavStyle: DEFAULT_COMPACT_NAV_STYLE },
      MODULES,
    );
    expect(getUserPreferences(repo, 8).favoriteModuleSlug).toBeUndefined();
    expect(getUserPreferences(repo, 7).favoriteModuleSlug).toBe("journal");
  });
});

describe("saveUserPreferences", () => {
  it("stores and returns the preferences", () => {
    const repo = new FakeUserPreferencesRepository();
    const saved = saveUserPreferences(
      repo,
      7,
      { favoriteModuleSlug: "stock-etfs", openFavoriteModuleOnStartup: true, compactNavStyle: DEFAULT_COMPACT_NAV_STYLE },
      MODULES,
    );
    expect(saved).toEqual({
      favoriteModuleSlug: "stock-etfs",
      openFavoriteModuleOnStartup: true,
      compactNavStyle: DEFAULT_COMPACT_NAV_STYLE,
      weatherLocation: undefined,
      weatherUnit: "fahrenheit",
    });
    expect(getUserPreferences(repo, 7)).toEqual(saved);
  });

  it("upserts rather than accumulating rows when saved repeatedly", () => {
    const repo = new FakeUserPreferencesRepository();
    saveUserPreferences(repo, 7, { favoriteModuleSlug: "journal", openFavoriteModuleOnStartup: true, compactNavStyle: DEFAULT_COMPACT_NAV_STYLE }, MODULES);
    saveUserPreferences(repo, 7, { favoriteModuleSlug: "expense", openFavoriteModuleOnStartup: false, compactNavStyle: DEFAULT_COMPACT_NAV_STYLE }, MODULES);
    // One row per key, however many keys there are — the point is that a second
    // save overwrites rather than appends. Derived from the key list so adding a
    // preference doesn't turn this into a puzzle about the number 2.
    expect(repo.countAll()).toBe(Object.keys(USER_PREFERENCE_KEYS).length);
    expect(getUserPreferences(repo, 7)).toEqual({
      favoriteModuleSlug: "expense",
      openFavoriteModuleOnStartup: false,
      compactNavStyle: DEFAULT_COMPACT_NAV_STYLE,
      weatherLocation: undefined,
      weatherUnit: "fahrenheit",
    });
  });

  it("clears a favorite when given a blank slug", () => {
    const repo = new FakeUserPreferencesRepository();
    saveUserPreferences(repo, 7, { favoriteModuleSlug: "journal", openFavoriteModuleOnStartup: true, compactNavStyle: DEFAULT_COMPACT_NAV_STYLE }, MODULES);
    const saved = saveUserPreferences(
      repo,
      7,
      { favoriteModuleSlug: "", openFavoriteModuleOnStartup: true, compactNavStyle: DEFAULT_COMPACT_NAV_STYLE },
      MODULES,
    );
    expect(saved.favoriteModuleSlug).toBeUndefined();
  });

  it("rejects a favorite the user cannot reach", () => {
    const repo = new FakeUserPreferencesRepository();
    expect(() =>
      saveUserPreferences(
        repo,
        7,
        { favoriteModuleSlug: "csv-analysis", openFavoriteModuleOnStartup: true, compactNavStyle: DEFAULT_COMPACT_NAV_STYLE },
        MODULES,
      ),
    ).toThrow(UnknownFavoriteModuleError);
  });

  it("stores nothing when the favorite is rejected", () => {
    const repo = new FakeUserPreferencesRepository();
    try {
      saveUserPreferences(repo, 7, { favoriteModuleSlug: "nope", openFavoriteModuleOnStartup: true, compactNavStyle: DEFAULT_COMPACT_NAV_STYLE }, MODULES);
    } catch {
      // expected
    }
    expect(repo.countAll()).toBe(0);
  });

  it("rejects a non-boolean flag at the boundary", () => {
    const repo = new FakeUserPreferencesRepository();
    expect(() =>
      saveUserPreferences(
        repo,
        7,
        // Deliberately bad input, cast past the boundary to prove the zod schema —
        // not TypeScript — is what rejects it at runtime.
        { openFavoriteModuleOnStartup: "yes" } as unknown as UserPreferencesUpdate,
        MODULES,
      ),
    ).toThrow();
  });
});

describe("resolveStartupDestination", () => {
  it("returns the favorite slug when the flag is on and the module is reachable", () => {
    expect(
      resolveStartupDestination(
        { favoriteModuleSlug: "journal", openFavoriteModuleOnStartup: true, compactNavStyle: DEFAULT_COMPACT_NAV_STYLE, weatherUnit: "fahrenheit" },
        MODULES,
      ),
    ).toBe("journal");
  });

  it("returns undefined when the flag is off, even with a favorite set", () => {
    expect(
      resolveStartupDestination(
        { favoriteModuleSlug: "journal", openFavoriteModuleOnStartup: false, compactNavStyle: DEFAULT_COMPACT_NAV_STYLE, weatherUnit: "fahrenheit" },
        MODULES,
      ),
    ).toBeUndefined();
  });

  it("returns undefined when no favorite is set", () => {
    expect(
      resolveStartupDestination(
        { openFavoriteModuleOnStartup: true, compactNavStyle: DEFAULT_COMPACT_NAV_STYLE, weatherUnit: "fahrenheit" },
        MODULES,
      ),
    ).toBeUndefined();
  });

  it("falls back to the home screen when the favorite is no longer accessible", () => {
    // The module was hidden, removed, or this user's access was revoked after
    // they chose it. Redirecting anyway would strand them.
    expect(
      resolveStartupDestination(
        { favoriteModuleSlug: "journal", openFavoriteModuleOnStartup: true, compactNavStyle: DEFAULT_COMPACT_NAV_STYLE, weatherUnit: "fahrenheit" },
        ["expense"],
      ),
    ).toBeUndefined();
  });

  it("falls back to the home screen when the user can reach nothing at all", () => {
    expect(
      resolveStartupDestination(
        { favoriteModuleSlug: "journal", openFavoriteModuleOnStartup: true, compactNavStyle: DEFAULT_COMPACT_NAV_STYLE, weatherUnit: "fahrenheit" },
        [],
      ),
    ).toBeUndefined();
  });
});
