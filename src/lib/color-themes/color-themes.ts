import {
  COLOR_THEMES,
  DEFAULT_COLOR_THEME_ID,
  type ColorTheme,
  getColorTheme,
} from "@/lib/settings";
import type { ColorThemeRepository } from "./ports";
import {
  colorThemeWriteSchema,
  deleteColorThemeSchema,
  slugifyThemeName,
} from "./schema";
import type { ColorThemeWrite, StoredColorTheme } from "./types";

/**
 * Every theme on offer, in picker order.
 *
 * Falls back to the code-defined `COLOR_THEMES` when the table is empty or absent — an
 * unmigrated database still shows the eight built-ins rather than an empty picker. The
 * repository's own `hasTable` guard returns `[]` in that case; this turns that into the
 * eight themes the app shipped with.
 */
export function listColorThemes(repo: ColorThemeRepository): StoredColorTheme[] {
  const stored = repo.list();
  if (stored.length > 0) return stored;

  return COLOR_THEMES.map((theme, index) => ({
    ...theme,
    isBuiltin: true,
    sortOrder: (index + 1) * 10,
    updatedAt: "",
  }));
}

/**
 * One theme by id, or `undefined`.
 *
 * Note this does NOT fall back to `getColorTheme` — a caller asking for a specific id
 * needs to know when it is missing (the picker greys out a stale selection, the reset
 * action refuses). `resolveActiveTheme` below is the one that must always answer.
 */
export function getColorThemeById(
  repo: ColorThemeRepository,
  id: string,
): StoredColorTheme | undefined {
  return repo.get(id) ?? listColorThemes(repo).find((theme) => theme.id === id);
}

/**
 * The theme to render, for a given stored setting value. **Always answers.**
 *
 * This is what the root layout and the manifest call, so it cannot throw and cannot
 * return undefined — a missing row must degrade to a working page, not a blank one.
 * Three steps: the stored id, then the default id, then the code fallback. The last one
 * is why `getColorTheme` stays in themes.ts.
 */
export function resolveActiveTheme(
  repo: ColorThemeRepository,
  settingValue: string | undefined,
): ColorTheme {
  const id = settingValue?.trim() || DEFAULT_COLOR_THEME_ID;
  return (
    getColorThemeById(repo, id) ??
    getColorThemeById(repo, DEFAULT_COLOR_THEME_ID) ??
    getColorTheme(id)
  );
}

/** Creates a user theme. The id must be free — ids are permanent, so reuse is refused. */
export function createColorTheme(
  repo: ColorThemeRepository,
  input: unknown,
): StoredColorTheme {
  const parsed = colorThemeWriteSchema.parse(input);

  if (repo.get(parsed.id)) {
    throw new Error(`A theme with the id "${parsed.id}" already exists.`);
  }
  // Also blocked against the code list: an id matching a built-in would be shadowed by
  // the seeded row on any migrated database and silently win on an unmigrated one.
  if (COLOR_THEMES.some((theme) => theme.id === parsed.id)) {
    throw new Error(`"${parsed.id}" is a built-in theme id — pick another name.`);
  }

  repo.insert(parsed);
  return { ...parsed, isBuiltin: false, sortOrder: parsed.sortOrder, updatedAt: "" };
}

/**
 * Overwrites an existing theme, built-in or not.
 *
 * Editing a built-in is deliberately allowed — that is what seeding the eight rows in
 * migration 0076 bought. `is_builtin` is untouched by the write, so a built-in edited
 * beyond recognition can still be reset with `resetBuiltinTheme`.
 */
export function saveColorTheme(repo: ColorThemeRepository, input: unknown): StoredColorTheme {
  const parsed = colorThemeWriteSchema.parse(input);

  const existing = repo.get(parsed.id);
  if (!existing) {
    throw new Error(`No theme with the id "${parsed.id}".`);
  }

  repo.update(parsed);
  return { ...existing, ...parsed };
}

/**
 * Deletes a user theme.
 *
 * Refuses two cases. A built-in has a code definition and a reset path, so deleting it
 * would only mean "hide something the app ships with". The theme currently selected is
 * refused because the alternative — silently repointing `color_theme` at the default —
 * changes how the whole app looks as a side effect of a delete on a screen listing
 * eight other themes. The caller passes the active id in rather than reading the setting
 * here, so this stays a function of its arguments.
 */
export function deleteColorTheme(
  repo: ColorThemeRepository,
  input: unknown,
  activeThemeId: string,
): void {
  const { id } = deleteColorThemeSchema.parse(input);

  const existing = repo.get(id);
  if (!existing) {
    throw new Error(`No theme with the id "${id}".`);
  }
  if (existing.isBuiltin) {
    throw new Error(`"${existing.name}" is a built-in theme — reset it instead of deleting it.`);
  }
  if (id === activeThemeId) {
    throw new Error(
      `"${existing.name}" is the theme in use — switch to another one before deleting it.`,
    );
  }

  repo.remove(id);
}

/** Copies a built-in back to its definition in `COLOR_THEMES`. */
export function resetBuiltinTheme(
  repo: ColorThemeRepository,
  id: string,
): StoredColorTheme {
  const baseline = COLOR_THEMES.find((theme) => theme.id === id);
  if (!baseline) {
    throw new Error(`"${id}" is not a built-in theme, so it has nothing to reset to.`);
  }

  const existing = repo.get(id);
  const write: ColorThemeWrite = {
    id: baseline.id,
    name: baseline.name,
    description: baseline.description,
    tokens: baseline.tokens,
    sortOrder: existing?.sortOrder ?? 100,
  };

  // Upsert rather than update: a database migrated before a built-in was added to the
  // code list has no row for it, and "reset" should still produce one.
  if (existing) repo.update(write);
  else repo.insert(write);

  return { ...write, isBuiltin: true, updatedAt: "" };
}

/**
 * Copies a theme under a new name, which is how a user starts from a built-in they like
 * rather than from nine blank color pickers.
 *
 * The id is derived from the name and disambiguated with a numeric suffix, so
 * duplicating "Signal Deck" twice gives `signal-deck-copy` then `signal-deck-copy-2`
 * instead of an error the user has to resolve by inventing a name.
 */
export function duplicateColorTheme(
  repo: ColorThemeRepository,
  sourceId: string,
  newName: string,
): StoredColorTheme {
  const source = getColorThemeById(repo, sourceId);
  if (!source) {
    throw new Error(`No theme with the id "${sourceId}".`);
  }

  const name = newName.trim() || `${source.name} copy`;
  const taken = new Set([
    ...repo.list().map((theme) => theme.id),
    ...COLOR_THEMES.map((theme) => theme.id),
  ]);

  const base = slugifyThemeName(name) || "custom-theme";
  let id = base;
  let suffix = 2;
  while (taken.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }

  return createColorTheme(repo, {
    id,
    name,
    description: source.description,
    tokens: source.tokens,
    // After the built-ins (10..80) so a copy lands at the end of the picker rather than
    // next to the theme it was copied from.
    sortOrder: 100,
  });
}
