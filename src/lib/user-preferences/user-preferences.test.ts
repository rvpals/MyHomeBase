import { describe, expect, it } from "vitest";
import { DEFAULT_COMPACT_NAV_STYLE } from "./nav-style";
import type { UserPreferencesRepository } from "./ports";
import {
  USER_PREFERENCE_KEYS,
  resolveUserPreferences,
  userPreferencesToEntries,
} from "./preferences";
import type { UserPreferencesUpdate } from "./schema";
import type { UserPreference, UserPreferences } from "./types";
import {
  UnknownFavoriteModuleError,
  getUserPreferences,
  saveFloatingState,
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

const MODULES = ["journal", "investments", "expense"];

describe("resolveUserPreferences", () => {
  it("returns the defaults for a user with no stored rows", () => {
    expect(resolveUserPreferences([])).toEqual({
      favoriteModuleSlug: undefined,
      openFavoriteModuleOnStartup: false,
      compactNavStyle: DEFAULT_COMPACT_NAV_STYLE,
      weatherLocation: undefined,
      weatherUnit: "fahrenheit",
      // The clock's own defaults live in `resolveClockFaceOptions`; asserted here as
      // literals so a change to them has to be made deliberately in both places.
      clock: { face: "digital", showDate: true, showWeather: true, showWeekday: true },
      // Every floating component starts closed, so nothing appears over the page
      // until the reader asks for it.
      floating: { clock: "closed", calculator: "closed", scratchpad: "closed" },
      floatingCorners: {
        clock: "bottom-right",
        calculator: "bottom-right",
        scratchpad: "bottom-right",
      },
      calculator: { angleMode: "deg", lastResult: undefined },
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
      clock: { face: "digital", showDate: true, showWeather: true, showWeekday: true },
      floating: { clock: "closed", calculator: "closed", scratchpad: "closed" },
      floatingCorners: {
        clock: "bottom-right",
        calculator: "bottom-right",
        scratchpad: "bottom-right",
      },
      calculator: { angleMode: "deg", lastResult: undefined },
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
      clock: { face: "digital" as const, showDate: true, showWeather: true, showWeekday: true },
    });
    expect(entries).toEqual([
      { key: USER_PREFERENCE_KEYS.favoriteModuleSlug, value: "" },
      { key: USER_PREFERENCE_KEYS.openFavoriteModuleOnStartup, value: "0" },
      { key: USER_PREFERENCE_KEYS.compactNavStyle, value: DEFAULT_COMPACT_NAV_STYLE },
      { key: USER_PREFERENCE_KEYS.weatherLatitude, value: "" },
      { key: USER_PREFERENCE_KEYS.weatherLongitude, value: "" },
      { key: USER_PREFERENCE_KEYS.weatherPlaceName, value: "" },
      { key: USER_PREFERENCE_KEYS.weatherUnit, value: "fahrenheit" },
      { key: USER_PREFERENCE_KEYS.clockFace, value: "digital" },
      { key: USER_PREFERENCE_KEYS.clockShowDate, value: "1" },
      { key: USER_PREFERENCE_KEYS.clockShowWeather, value: "1" },
      { key: USER_PREFERENCE_KEYS.clockShowWeekday, value: "1" },
    ]);
  });

  it("round-trips through resolveUserPreferences", () => {
    const original = {
      favoriteModuleSlug: "expense",
      openFavoriteModuleOnStartup: true,
      compactNavStyle: DEFAULT_COMPACT_NAV_STYLE,
      weatherLocation: { latitude: 40.34, longitude: -74.46, name: "Princeton, NJ" },
      weatherUnit: "fahrenheit" as const,
      clock: { face: "digital" as const, showDate: true, showWeather: true, showWeekday: true },
    };
    const rows = userPreferencesToEntries(original).map((entry, index) => ({
      id: index + 1,
      userId: 7,
      ...entry,
    }));
    // `floating` is added by the resolver but never serialized — the states are
    // written by their own use-case, so a round-trip through the form's entries
    // resolves them to their defaults rather than to whatever was passed in.
    expect(resolveUserPreferences(rows)).toEqual({
      ...original,
      floating: { clock: "closed", calculator: "closed", scratchpad: "closed" },
      floatingCorners: {
        clock: "bottom-right",
        calculator: "bottom-right",
        scratchpad: "bottom-right",
      },
      calculator: { angleMode: "deg", lastResult: undefined },
    });
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
      clock: { face: "digital", showDate: true, showWeather: true, showWeekday: true },
      floating: { clock: "closed", calculator: "closed", scratchpad: "closed" },
      floatingCorners: {
        clock: "bottom-right",
        calculator: "bottom-right",
        scratchpad: "bottom-right",
      },
      calculator: { angleMode: "deg", lastResult: undefined },
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
      { favoriteModuleSlug: "investments", openFavoriteModuleOnStartup: true, compactNavStyle: DEFAULT_COMPACT_NAV_STYLE },
      MODULES,
    );
    expect(saved).toEqual({
      favoriteModuleSlug: "investments",
      openFavoriteModuleOnStartup: true,
      compactNavStyle: DEFAULT_COMPACT_NAV_STYLE,
      weatherLocation: undefined,
      weatherUnit: "fahrenheit",
      clock: { face: "digital", showDate: true, showWeather: true, showWeekday: true },
      floating: { clock: "closed", calculator: "closed", scratchpad: "closed" },
      floatingCorners: {
        clock: "bottom-right",
        calculator: "bottom-right",
        scratchpad: "bottom-right",
      },
      calculator: { angleMode: "deg", lastResult: undefined },
    });
    expect(getUserPreferences(repo, 7)).toEqual(saved);
  });

  it("upserts rather than accumulating rows when saved repeatedly", () => {
    const repo = new FakeUserPreferencesRepository();
    saveUserPreferences(repo, 7, { favoriteModuleSlug: "journal", openFavoriteModuleOnStartup: true, compactNavStyle: DEFAULT_COMPACT_NAV_STYLE }, MODULES);
    saveUserPreferences(repo, 7, { favoriteModuleSlug: "expense", openFavoriteModuleOnStartup: false, compactNavStyle: DEFAULT_COMPACT_NAV_STYLE }, MODULES);
    // One row per key the FORM writes, however many there are — the point is that a
    // second save overwrites rather than appends. Derived from the serializer rather
    // than from the whole key list, because `USER_PREFERENCE_KEYS` also covers keys
    // written by their own use-cases (the calculator's angle mode and last result),
    // which this form deliberately leaves alone.
    expect(repo.countAll()).toBe(
      userPreferencesToEntries({
        openFavoriteModuleOnStartup: false,
        compactNavStyle: DEFAULT_COMPACT_NAV_STYLE,
        weatherUnit: "fahrenheit",
        clock: { face: "digital", showDate: true, showWeather: true, showWeekday: true },
      }).length,
    );
    expect(getUserPreferences(repo, 7)).toEqual({
      favoriteModuleSlug: "expense",
      openFavoriteModuleOnStartup: false,
      compactNavStyle: DEFAULT_COMPACT_NAV_STYLE,
      weatherLocation: undefined,
      weatherUnit: "fahrenheit",
      clock: { face: "digital", showDate: true, showWeather: true, showWeekday: true },
      floating: { clock: "closed", calculator: "closed", scratchpad: "closed" },
      floatingCorners: {
        clock: "bottom-right",
        calculator: "bottom-right",
        scratchpad: "bottom-right",
      },
      calculator: { angleMode: "deg", lastResult: undefined },
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
  /**
   * A `UserPreferences` carrying only the two fields this function reads.
   *
   * A helper rather than five full literals: `resolveStartupDestination` looks at the
   * startup flag and the favorite and nothing else, so spelling out a clock face and a
   * window state in each case would say that they matter when they don't — and every
   * future preference would have to be added to all five.
   */
  function prefs(partial: Partial<UserPreferences>): UserPreferences {
    return {
      openFavoriteModuleOnStartup: false,
      compactNavStyle: DEFAULT_COMPACT_NAV_STYLE,
      weatherUnit: "fahrenheit",
      clock: { face: "digital", showDate: true, showWeather: true, showWeekday: true },
      floating: { clock: "closed", calculator: "closed", scratchpad: "closed" },
      floatingCorners: {
        clock: "bottom-right",
        calculator: "bottom-right",
        scratchpad: "bottom-right",
      },
      calculator: { angleMode: "deg", lastResult: undefined },
      ...partial,
    };
  }

  it("returns the favorite slug when the flag is on and the module is reachable", () => {
    expect(
      resolveStartupDestination(
        prefs({ favoriteModuleSlug: "journal", openFavoriteModuleOnStartup: true }),
        MODULES,
      ),
    ).toBe("journal");
  });

  it("returns undefined when the flag is off, even with a favorite set", () => {
    expect(
      resolveStartupDestination(
        prefs({ favoriteModuleSlug: "journal", openFavoriteModuleOnStartup: false }),
        MODULES,
      ),
    ).toBeUndefined();
  });

  it("returns undefined when no favorite is set", () => {
    expect(
      resolveStartupDestination(
        prefs({ openFavoriteModuleOnStartup: true }),
        MODULES,
      ),
    ).toBeUndefined();
  });

  it("falls back to the home screen when the favorite is no longer accessible", () => {
    // The module was hidden, removed, or this user's access was revoked after
    // they chose it. Redirecting anyway would strand them.
    expect(
      resolveStartupDestination(
        prefs({ favoriteModuleSlug: "journal", openFavoriteModuleOnStartup: true }),
        ["expense"],
      ),
    ).toBeUndefined();
  });

  it("falls back to the home screen when the user can reach nothing at all", () => {
    expect(
      resolveStartupDestination(
        prefs({ favoriteModuleSlug: "journal", openFavoriteModuleOnStartup: true }),
        [],
      ),
    ).toBeUndefined();
  });
});

describe("saveFloatingState", () => {
  it("stores one component's state without touching the other preferences", () => {
    const repo = new FakeUserPreferencesRepository();
    saveUserPreferences(
      repo,
      7,
      { favoriteModuleSlug: "journal", openFavoriteModuleOnStartup: true, compactNavStyle: DEFAULT_COMPACT_NAV_STYLE },
      MODULES,
    );

    saveFloatingState(repo, 7, { id: "clock", state: "minimized" });

    const after = getUserPreferences(repo, 7);
    expect(after.floating.clock).toBe("minimized");
    // The point of the single-key write: saving a window position must not disturb
    // the favorite the reader set on a different screen.
    expect(after.favoriteModuleSlug).toBe("journal");
    expect(after.openFavoriteModuleOnStartup).toBe(true);
  });

  it("overwrites rather than accumulating rows", () => {
    const repo = new FakeUserPreferencesRepository();
    saveFloatingState(repo, 7, { id: "clock", state: "open" });
    saveFloatingState(repo, 7, { id: "clock", state: "closed" });
    expect(repo.countAll()).toBe(1);
    expect(getUserPreferences(repo, 7).floating.clock).toBe("closed");
  });

  it("keeps users separate", () => {
    const repo = new FakeUserPreferencesRepository();
    saveFloatingState(repo, 7, { id: "clock", state: "open" });
    expect(getUserPreferences(repo, 8).floating.clock).toBe("closed");
  });

  it("rejects an unknown component id", () => {
    const repo = new FakeUserPreferencesRepository();
    // A bug in the caller, not an older client — so it throws rather than being
    // silently corrected to something that would sit in the database unexplained.
    expect(() =>
      saveFloatingState(repo, 7, { id: "sundial" as "clock", state: "open" }),
    ).toThrow();
  });

  it("rejects a state that isn't one of the three", () => {
    const repo = new FakeUserPreferencesRepository();
    expect(() =>
      saveFloatingState(repo, 7, { id: "clock", state: "sideways" as "open" }),
    ).toThrow();
  });
});
