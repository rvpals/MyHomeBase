import { describe, expect, it } from "vitest";
import { COLOR_THEMES, DEFAULT_COLOR_THEME_ID } from "@/lib/settings";
import {
  createColorTheme,
  deleteColorTheme,
  duplicateColorTheme,
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
function fakeRepo(seed: StoredColorTheme[] = []) {
  const rows = new Map<string, StoredColorTheme>();
  for (const row of seed) rows.set(row.id, row);

  const repo: ColorThemeRepository & { rows: Map<string, StoredColorTheme> } = {
    rows,
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

  it("falls back to the code-defined built-ins when the table is empty", () => {
    // An unmigrated database must still show the eight themes the app shipped with,
    // rather than an empty picker.
    const listed = listColorThemes(fakeRepo());
    expect(listed).toHaveLength(COLOR_THEMES.length);
    expect(listed.every((entry) => entry.isBuiltin)).toBe(true);
    expect(listed[0].id).toBe(COLOR_THEMES[0].id);
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
    const repo = fakeRepo([{ ...theme(), isBuiltin: false, updatedAt: "" }]);
    deleteColorTheme(repo, { id: "my-theme" }, "signal-deck");
    expect(repo.rows.size).toBe(0);
  });

  it("refuses to delete a built-in", () => {
    const repo = fakeRepo([builtinRow("signal-deck")]);
    expect(() => deleteColorTheme(repo, { id: "signal-deck" }, "daybreak")).toThrow(/built-in/);
    expect(repo.rows.size).toBe(1);
  });

  it("refuses to delete the theme currently in use", () => {
    // The alternative - silently repointing the setting at the default - would change
    // how the whole app looks as a side effect of a delete.
    const repo = fakeRepo([{ ...theme(), isBuiltin: false, updatedAt: "" }]);
    expect(() => deleteColorTheme(repo, { id: "my-theme" }, "my-theme")).toThrow(/theme in use/);
    expect(repo.rows.size).toBe(1);
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
    const repo = fakeRepo();
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
