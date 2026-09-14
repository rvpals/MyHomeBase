import { describe, expect, it } from "vitest";
import { COLOR_THEMES, DEFAULT_COLOR_THEME_ID } from "@/lib/settings";
import {
  createColorTheme,
  deleteColorTheme,
  duplicateColorTheme,
  generateColorThemes,
  getColorThemeById,
  listColorThemes,
  resetBuiltinTheme,
  resolveActiveTheme,
  saveColorTheme,
} from "./color-themes";
import type { ColorThemeRepository } from "./ports";
import type { ColorThemeWrite, StoredColorTheme } from "./types";

const TOKENS = {
  paper: "#101214",
  paperRaised: "#181B1F",
  ink: "#F0F2F4",
  line: "#2A2E34",
  muted: "#8A9099",
  mutedInverse: "#5A6068",
  brass: "#40D0A0",
  brassDark: "#1E8060",
  brassSoft: "#153028",
  fonts: { display: "sora", body: "inter", mono: "jetbrains-mono" },
} as const;

function theme(overrides: Partial<ColorThemeWrite> = {}): ColorThemeWrite {
  return {
    id: "my-theme",
    name: "My Theme",
    description: "A test theme.",
    tokens: { ...TOKENS },
    sortOrder: 100,
    ...overrides,
  };
}

/** In-memory double. The use-cases depend on the port, so no database is needed. */
function fakeRepo(seed: StoredColorTheme[] = [], migrated = true) {
  const rows = new Map<string, StoredColorTheme>();
  for (const row of seed) rows.set(row.id, row);

  const repo: ColorThemeRepository & { rows: Map<string, StoredColorTheme> } = {
    rows,
    // The real repository answers this from `sqlite_master`. Defaulting to `true`
    // means a seeded fake behaves like a migrated database; pass `false` to model
    // one where the table doesn't exist yet.
    isMigrated() {
      return migrated;
    },
    list() {
      return [...rows.values()].sort(
        (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
      );
    },
    get(id: string) {
      return rows.get(id);
    },
    insert(write: ColorThemeWrite) {
      if (rows.has(write.id)) throw new Error("UNIQUE constraint failed");
      // Mirrors the real repository, which hardcodes is_builtin = 0 on insert.
      rows.set(write.id, { ...write, isBuiltin: false, updatedAt: "2026-08-30" });
    },
    update(write: ColorThemeWrite) {
      const existing = rows.get(write.id);
      if (!existing) throw new Error(`No theme with the id "${write.id}".`);
      // is_builtin is deliberately preserved, as the real UPDATE's SET list does.
      rows.set(write.id, { ...write, isBuiltin: existing.isBuiltin, updatedAt: "2026-08-30" });
    },
    remove(id: string) {
      rows.delete(id);
    },
  };
  return repo;
}

/** A seeded built-in, as migration 0076 leaves it. */
function builtinRow(id: string): StoredColorTheme {
  const baseline = COLOR_THEMES.find((entry) => entry.id === id)!;
  return { ...baseline, isBuiltin: true, sortOrder: 10, updatedAt: "2026-08-30" };
}

describe("listColorThemes", () => {
  it("returns the stored themes in picker order", () => {
    const repo = fakeRepo([
      { ...theme({ id: "b-theme", name: "B", sortOrder: 20 }), isBuiltin: false, updatedAt: "" },
      { ...theme({ id: "a-theme", name: "A", sortOrder: 10 }), isBuiltin: false, updatedAt: "" },
    ]);
    expect(listColorThemes(repo).map((entry) => entry.id)).toEqual(["a-theme", "b-theme"]);
  });

  it("falls back to the code-defined built-ins when the table is absent", () => {
    // An unmigrated database must still show the eight themes the app shipped with,
    // rather than an empty picker.
    const listed = listColorThemes(fakeRepo([], false));
    expect(listed).toHaveLength(COLOR_THEMES.length);
    expect(listed.every((entry) => entry.isBuiltin)).toBe(true);
    expect(listed[0].id).toBe(COLOR_THEMES[0].id);
  });

  it("does NOT resurrect built-ins from an empty but migrated table", () => {
    // The reason this is keyed off `isMigrated()` rather than "the list is empty":
    // built-ins are deletable, so an empty migrated table is a state an admin asked
    // for, and substituting the code defaults would undo their deletions on the next
    // render. (`deleteColorTheme`'s floor makes this hard to reach in practice — this
    // pins the distinction, not the reachability.)
    expect(listColorThemes(fakeRepo([], true))).toEqual([]);
  });
});

describe("resolveActiveTheme", () => {
  it("returns the stored theme named by the setting", () => {
    const repo = fakeRepo([{ ...theme(), isBuiltin: false, updatedAt: "" }]);
    expect(resolveActiveTheme(repo, "my-theme").name).toBe("My Theme");
  });

  it("falls back to the default when the setting names a theme that is gone", () => {
    const repo = fakeRepo([builtinRow(DEFAULT_COLOR_THEME_ID)]);
    expect(resolveActiveTheme(repo, "deleted-theme").id).toBe(DEFAULT_COLOR_THEME_ID);
  });

  it("falls back to the default when the setting is blank or missing", () => {
    const repo = fakeRepo([builtinRow(DEFAULT_COLOR_THEME_ID)]);
    expect(resolveActiveTheme(repo, "   ").id).toBe(DEFAULT_COLOR_THEME_ID);
    expect(resolveActiveTheme(repo, undefined).id).toBe(DEFAULT_COLOR_THEME_ID);
  });

  it("still answers with an empty repository", () => {
    // This runs in the root layout, so it must never throw or return undefined —
    // a missing row has to degrade to a working page.
    expect(resolveActiveTheme(fakeRepo(), "anything").tokens.paper).toBeTruthy();
  });
});

describe("createColorTheme", () => {
  it("stores a valid theme as a user theme", () => {
    const repo = fakeRepo();
    const created = createColorTheme(repo, theme());
    expect(created.isBuiltin).toBe(false);
    expect(repo.rows.get("my-theme")?.tokens.brass).toBe("#40D0A0");
  });

  it("refuses an id that is already stored", () => {
    const repo = fakeRepo([{ ...theme(), isBuiltin: false, updatedAt: "" }]);
    expect(() => createColorTheme(repo, theme())).toThrow(/already exists/);
    expect(repo.rows.size).toBe(1);
  });

  it("refuses a built-in id even on an empty table", () => {
    // Would be shadowed by the seeded row on a migrated database and silently win on an
    // unmigrated one — two different apps depending on migration state.
    const repo = fakeRepo();
    expect(() => createColorTheme(repo, theme({ id: "signal-deck" }))).toThrow(/built-in/);
    expect(repo.rows.size).toBe(0);
  });

  it("refuses a malformed hex color", () => {
    const repo = fakeRepo();
    expect(() =>
      createColorTheme(repo, theme({ tokens: { ...TOKENS, brass: "#abc" } })),
    ).toThrow();
    expect(repo.rows.size).toBe(0);
  });

  it("refuses a font the app does not load", () => {
    const repo = fakeRepo();
    expect(() =>
      createColorTheme(
        repo,
        // @ts-expect-error - proving the runtime schema rejects it, not just the types.
        theme({ tokens: { ...TOKENS, fonts: { ...TOKENS.fonts, body: "comic-sans" } } }),
      ),
    ).toThrow();
    expect(repo.rows.size).toBe(0);
  });

  it("refuses an id that is not a slug", () => {
    const repo = fakeRepo();
    expect(() => createColorTheme(repo, theme({ id: "My Theme!" }))).toThrow(/lowercase/);
  });
});

describe("saveColorTheme", () => {
  it("overwrites an existing user theme", () => {
    const repo = fakeRepo([{ ...theme(), isBuiltin: false, updatedAt: "" }]);
    saveColorTheme(repo, theme({ name: "Renamed", tokens: { ...TOKENS, brass: "#FF0000" } }));
    expect(repo.rows.get("my-theme")?.name).toBe("Renamed");
    expect(repo.rows.get("my-theme")?.tokens.brass).toBe("#FF0000");
  });

  it("edits a built-in without demoting it", () => {
    // Editing a built-in is the whole point of seeding the eight rows - but it must stay
    // resettable afterwards, so `isBuiltin` has to survive the write.
    const repo = fakeRepo([builtinRow("signal-deck")]);
    saveColorTheme(repo, theme({ id: "signal-deck", name: "Signal Deck", sortOrder: 10 }));
    expect(repo.rows.get("signal-deck")?.isBuiltin).toBe(true);
    expect(repo.rows.get("signal-deck")?.tokens.brass).toBe("#40D0A0");
  });

  it("refuses a theme that does not exist", () => {
    const repo = fakeRepo();
    expect(() => saveColorTheme(repo, theme())).toThrow(/No theme with the id/);
  });
});

describe("deleteColorTheme", () => {
  it("removes a user theme that is not in use", () => {
    // Two rows: with only one the floor below would fire first, and this test would
    // pass for the wrong reason.
    const repo = fakeRepo([
      { ...theme(), isBuiltin: false, updatedAt: "" },
      builtinRow("signal-deck"),
    ]);
    deleteColorTheme(repo, { id: "my-theme" }, "signal-deck");
    expect(repo.rows.has("my-theme")).toBe(false);
  });

  it("deletes a built-in that is not in use", () => {
    // Built-ins used to be refused here. They are deletable now: an install that will
    // never use six of the eight shouldn't scroll past them forever, and `Reset`
    // upserts a deleted built-in back from `COLOR_THEMES`, so this stays reversible.
    const repo = fakeRepo([builtinRow("signal-deck"), builtinRow("daybreak")]);
    deleteColorTheme(repo, { id: "signal-deck" }, "daybreak");
    expect(repo.rows.has("signal-deck")).toBe(false);
    expect(repo.rows.size).toBe(1);
  });

  it("refuses to delete the last theme standing", () => {
    // `resolveActiveTheme` must always answer, and an empty picker offers no way back.
    const repo = fakeRepo([builtinRow("signal-deck")]);
    expect(() => deleteColorTheme(repo, { id: "signal-deck" }, "daybreak")).toThrow(
      /only theme left/,
    );
    expect(repo.rows.size).toBe(1);
  });

  it("refuses to delete the theme currently in use", () => {
    // The alternative - silently repointing the setting at the default - would change
    // how the whole app looks as a side effect of a delete.
    const repo = fakeRepo([
      { ...theme(), isBuiltin: false, updatedAt: "" },
      builtinRow("signal-deck"),
    ]);
    expect(() => deleteColorTheme(repo, { id: "my-theme" }, "my-theme")).toThrow(/theme in use/);
    expect(repo.rows.has("my-theme")).toBe(true);
  });

  it("refuses a theme that does not exist", () => {
    expect(() => deleteColorTheme(fakeRepo(), { id: "ghost-theme" }, "signal-deck")).toThrow(
      /No theme with the id/,
    );
  });
});

describe("resetBuiltinTheme", () => {
  it("copies a built-in back to its code definition", () => {
    const repo = fakeRepo([builtinRow("signal-deck")]);
    saveColorTheme(repo, theme({ id: "signal-deck", name: "Mangled", sortOrder: 10 }));
    expect(repo.rows.get("signal-deck")?.tokens.brass).toBe("#40D0A0");

    resetBuiltinTheme(repo, "signal-deck");

    const baseline = COLOR_THEMES.find((entry) => entry.id === "signal-deck")!;
    expect(repo.rows.get("signal-deck")?.name).toBe(baseline.name);
    expect(repo.rows.get("signal-deck")?.tokens.brass).toBe(baseline.tokens.brass);
    expect(repo.rows.get("signal-deck")?.isBuiltin).toBe(true);
  });

  it("creates the row when a built-in has never been stored", () => {
    // A database migrated before a built-in was added to the code list has no row for
    // it, and "reset" should still produce one.
    const repo = fakeRepo();
    resetBuiltinTheme(repo, "daybreak");
    expect(repo.rows.get("daybreak")?.name).toBe("Daybreak");
  });

  it("refuses a theme with no code definition to reset to", () => {
    const repo = fakeRepo([{ ...theme(), isBuiltin: false, updatedAt: "" }]);
    expect(() => resetBuiltinTheme(repo, "my-theme")).toThrow(/not a built-in/);
  });
});

describe("duplicateColorTheme", () => {
  it("copies a built-in's tokens under a new slug id", () => {
    const repo = fakeRepo([builtinRow("signal-deck")]);
    const copy = duplicateColorTheme(repo, "signal-deck", "My Signal Deck");

    expect(copy.id).toBe("my-signal-deck");
    expect(copy.isBuiltin).toBe(false);
    expect(copy.tokens.brass).toBe(
      COLOR_THEMES.find((entry) => entry.id === "signal-deck")!.tokens.brass,
    );
  });

  it("disambiguates with a numeric suffix rather than failing", () => {
    // Duplicating the same theme twice must not make the user invent a name.
    const repo = fakeRepo([builtinRow("signal-deck")]);
    const first = duplicateColorTheme(repo, "signal-deck", "Copy");
    const second = duplicateColorTheme(repo, "signal-deck", "Copy");
    expect(first.id).toBe("copy");
    expect(second.id).toBe("copy-2");
  });

  it("falls back to a '<name> copy' name when given a blank one", () => {
    const repo = fakeRepo([builtinRow("signal-deck")]);
    expect(duplicateColorTheme(repo, "signal-deck", "   ").name).toBe("Signal Deck copy");
  });

  it("can duplicate a code-only built-in on an unmigrated table", () => {
    // `false` = the table doesn't exist, which is what makes `listColorThemes` offer
    // the code-defined built-ins for `getColorThemeById` to find.
    const repo = fakeRepo([], false);
    expect(duplicateColorTheme(repo, "copper-vault", "Mine").tokens.brass).toBe("#C87F4A");
  });

  it("refuses a source theme that does not exist", () => {
    expect(() => duplicateColorTheme(fakeRepo(), "ghost-theme", "Mine")).toThrow(
      /No theme with the id/,
    );
  });
});

describe("getColorThemeById", () => {
  it("finds a stored theme", () => {
    const repo = fakeRepo([{ ...theme(), isBuiltin: false, updatedAt: "" }]);
    expect(getColorThemeById(repo, "my-theme")?.name).toBe("My Theme");
  });

  it("is undefined for an unknown id rather than falling back", () => {
    // Callers that need a definite answer use resolveActiveTheme; this one has to be
    // able to report absence so the picker can grey out a stale selection.
    expect(getColorThemeById(fakeRepo(), "ghost-theme")).toBeUndefined();
  });
});

describe("generateColorThemes", () => {
  it("creates the requested number of themes and stores them", () => {
    const repo = fakeRepo();
    const created = generateColorThemes(repo, 5, 2026);
    expect(created).toHaveLength(5);
    expect(repo.rows.size).toBe(5);
  });

  it("stores them as user themes, not built-ins", () => {
    // `insert` hardcodes is_builtin = 0, so a generated theme is never resettable —
    // it has no code definition to reset to.
    const repo = fakeRepo();
    generateColorThemes(repo, 5, 3).forEach((theme) => expect(theme.isBuiltin).toBe(false));
  });

  it("does not collide with themes already stored", () => {
    const repo = fakeRepo();
    generateColorThemes(repo, 5, 4);
    const firstBatch = [...repo.rows.keys()];
    generateColorThemes(repo, 5, 4);
    // Same seed twice: without the existing-id guard the second batch would collide
    // with the first and `createColorTheme` would throw.
    expect(repo.rows.size).toBe(10);
    expect([...repo.rows.keys()]).toEqual(expect.arrayContaining(firstBatch));
  });

  it("does not collide with a built-in id even when no row exists for it", () => {
    // `createColorTheme` refuses a built-in id outright, so the generator has to avoid
    // them whether or not the table has been seeded.
    const repo = fakeRepo();
    const created = generateColorThemes(repo, 5, 8);
    const builtinIds = COLOR_THEMES.map((theme) => theme.id);
    created.forEach((theme) => expect(builtinIds).not.toContain(theme.id));
  });

  it("is deterministic for a seed", () => {
    const first = generateColorThemes(fakeRepo(), 5, 555).map((theme) => theme.id);
    const second = generateColorThemes(fakeRepo(), 5, 555).map((theme) => theme.id);
    expect(first).toEqual(second);
  });

  it("gives generated themes the default sort order so they follow the built-ins", () => {
    generateColorThemes(fakeRepo(), 3, 6).forEach((theme) => {
      expect(theme.sortOrder).toBe(100);
    });
  });

  it("creates nothing when asked for none", () => {
    const repo = fakeRepo();
    expect(generateColorThemes(repo, 0, 1)).toEqual([]);
    expect(repo.rows.size).toBe(0);
  });
});
