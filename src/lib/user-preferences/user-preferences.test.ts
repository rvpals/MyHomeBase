import { describe, expect, it } from "vitest";
import type { UserPreferencesRepository } from "./ports";
import {
  USER_PREFERENCE_KEYS,
  resolveUserPreferences,
  userPreferencesToEntries,
} from "./preferences";
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
    const entries = userPreferencesToEntries({ openFavoriteModuleOnStartup: false });
    expect(entries).toEqual([
      { key: USER_PREFERENCE_KEYS.favoriteModuleSlug, value: "" },
      { key: USER_PREFERENCE_KEYS.openFavoriteModuleOnStartup, value: "0" },
    ]);
  });

  it("round-trips through resolveUserPreferences", () => {
    const original = { favoriteModuleSlug: "expense", openFavoriteModuleOnStartup: true };
    const rows = userPreferencesToEntries(original).map((entry, index) => ({
      id: index + 1,
      userId: 7,
      ...entry,
    }));
    expect(resolveUserPreferences(rows)).toEqual(original);
  });
});

describe("getUserPreferences", () => {
  it("defaults for a user who has never saved anything", () => {
    const repo = new FakeUserPreferencesRepository();
    expect(getUserPreferences(repo, 7)).toEqual({
      favoriteModuleSlug: undefined,
      openFavoriteModuleOnStartup: false,
    });
  });

  it("keeps users separate", () => {
    const repo = new FakeUserPreferencesRepository();
    saveUserPreferences(
      repo,
      7,
      { favoriteModuleSlug: "journal", openFavoriteModuleOnStartup: true },
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
      { favoriteModuleSlug: "stock-etfs", openFavoriteModuleOnStartup: true },
      MODULES,
    );
    expect(saved).toEqual({ favoriteModuleSlug: "stock-etfs", openFavoriteModuleOnStartup: true });
    expect(getUserPreferences(repo, 7)).toEqual(saved);
  });

  it("upserts rather than accumulating rows when saved repeatedly", () => {
    const repo = new FakeUserPreferencesRepository();
    saveUserPreferences(repo, 7, { favoriteModuleSlug: "journal", openFavoriteModuleOnStartup: true }, MODULES);
    saveUserPreferences(repo, 7, { favoriteModuleSlug: "expense", openFavoriteModuleOnStartup: false }, MODULES);
    expect(repo.countAll()).toBe(2);
    expect(getUserPreferences(repo, 7)).toEqual({
      favoriteModuleSlug: "expense",
      openFavoriteModuleOnStartup: false,
    });
  });

  it("clears a favorite when given a blank slug", () => {
    const repo = new FakeUserPreferencesRepository();
    saveUserPreferences(repo, 7, { favoriteModuleSlug: "journal", openFavoriteModuleOnStartup: true }, MODULES);
    const saved = saveUserPreferences(
      repo,
      7,
      { favoriteModuleSlug: "", openFavoriteModuleOnStartup: true },
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
        { favoriteModuleSlug: "csv-analysis", openFavoriteModuleOnStartup: true },
        MODULES,
      ),
    ).toThrow(UnknownFavoriteModuleError);
  });

  it("stores nothing when the favorite is rejected", () => {
    const repo = new FakeUserPreferencesRepository();
    try {
      saveUserPreferences(repo, 7, { favoriteModuleSlug: "nope", openFavoriteModuleOnStartup: true }, MODULES);
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
        { openFavoriteModuleOnStartup: "yes" } as unknown as {
          openFavoriteModuleOnStartup: boolean;
        },
        MODULES,
      ),
    ).toThrow();
  });
});

describe("resolveStartupDestination", () => {
  it("returns the favorite slug when the flag is on and the module is reachable", () => {
    expect(
      resolveStartupDestination(
        { favoriteModuleSlug: "journal", openFavoriteModuleOnStartup: true },
        MODULES,
      ),
    ).toBe("journal");
  });

  it("returns undefined when the flag is off, even with a favorite set", () => {
    expect(
      resolveStartupDestination(
        { favoriteModuleSlug: "journal", openFavoriteModuleOnStartup: false },
        MODULES,
      ),
    ).toBeUndefined();
  });

  it("returns undefined when no favorite is set", () => {
    expect(resolveStartupDestination({ openFavoriteModuleOnStartup: true }, MODULES)).toBeUndefined();
  });

  it("falls back to the home screen when the favorite is no longer accessible", () => {
    // The module was hidden, removed, or this user's access was revoked after
    // they chose it. Redirecting anyway would strand them.
    expect(
      resolveStartupDestination(
        { favoriteModuleSlug: "journal", openFavoriteModuleOnStartup: true },
        ["expense"],
      ),
    ).toBeUndefined();
  });

  it("falls back to the home screen when the user can reach nothing at all", () => {
    expect(
      resolveStartupDestination(
        { favoriteModuleSlug: "journal", openFavoriteModuleOnStartup: true },
        [],
      ),
    ).toBeUndefined();
  });
});
