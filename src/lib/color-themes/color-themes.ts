import { generateThemes } from "./generate";
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
 * Falls back to the code-defined `COLOR_THEMES` only when the table is **absent** — an
 * unmigrated database still shows the eight built-ins rather than an empty picker.
 *
 * Deliberately keyed off `isMigrated()` rather than "the list came back empty", which is
 * what this used to test. Built-ins are deletable now, so an empty *but present* table is
 * a legitimate state an admin asked for; reading it as "unmigrated" would resurrect every
 * deleted theme on the next render. `deleteColorTheme` refuses to remove the last theme,
 * so in practice this table is never empty — but the two conditions mean different things
 * and this one must not guess.
 */
export function listColorThemes(repo: ColorThemeRepository): StoredColorTheme[] {
  if (repo.isMigrated()) return repo.list();

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
 * Built-ins are deletable. They were not always: the argument was that a built-in has a
 * code definition and a reset path, so removing it only means "hide something the app
 * ships with". That is true, and it is the admin's call to make — an install that will
 * never use six of the eight shouldn't have to scroll past them forever. A deleted
 * built-in can be brought back with `resetBuiltinTheme`, which upserts from
 * `COLOR_THEMES`, so this stays reversible without a hidden flag.
 *
 * Two refusals remain, both about leaving the app in a state it cannot render:
 *
 * - **The theme in use.** The alternative — silently repointing `color_theme` at the
 *   default — changes how the whole app looks as a side effect of a delete on a screen
 *   listing other themes. The caller passes the active id in rather than reading the
 *   setting here, so this stays a function of its arguments.
 * - **The last theme standing.** `resolveActiveTheme` must always answer, and a picker
 *   with nothing in it offers no way back. The count comes from the repository rather
 *   than a parameter because it is a fact about storage, not about the request.
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
  if (id === activeThemeId) {
    throw new Error(
      `"${existing.name}" is the theme in use — switch to another one before deleting it.`,
    );
  }
  if (repo.list().length <= 1) {
    throw new Error(
      `"${existing.name}" is the only theme left — create another one before deleting it.`,
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

/**
 * Generates `count` themes and stores them, returning what was created.
 *
 * A batch rather than `count` separate calls so the ids are unique **against each other**
 * as well as against storage: the generator needs to see the ids it has already handed
 * out within this run, which a per-theme call site could not tell it.
 *
 * Saved immediately rather than previewed — this is the "surprise me" path, and an admin
 * who dislikes one deletes it. `insert` is per theme and there is no transaction: a
 * failure partway leaves the earlier themes in place, which is the right outcome for a
 * generator (some new themes, no error state to clean up) and why this returns the list
 * it actually wrote rather than assuming all of them.
 *
 * The seed is a parameter so a caller can make this deterministic. The action passes
 * `Date.now()`; the tests pass a constant.
 */
export function generateColorThemes(
  repo: ColorThemeRepository,
  count: number,
  seed: number,
): StoredColorTheme[] {
  // Both sources matter: stored ids, and the code-defined built-in ids that
  // `createColorTheme` refuses even when no row exists for them.
  const existingIds = [
    ...repo.list().map((theme) => theme.id),
    ...COLOR_THEMES.map((theme) => theme.id),
  ];

  const created: StoredColorTheme[] = [];
  for (const generated of generateThemes(count, existingIds, seed)) {
    created.push(
      createColorTheme(repo, {
        id: generated.id,
        name: generated.name,
        description: generated.description,
        tokens: generated.tokens,
        // Same default a hand-made theme gets, so generated themes sort after the
        // built-ins and among themselves by name.
        sortOrder: 100,
      }),
    );
  }

  return created;
}
