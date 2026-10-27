// The Clips module's settings — `sys_module_settings` key/value rows, the same
// storage the Journal's `photo_root` and Household's `hsa_receipt_root` use, so
// adding one needs no migration.
//
// Mirrors `src/lib/household/settings.ts` deliberately: same resolve-from-rows shape,
// same look-the-module-up-by-slug helper, same defaulting when the module is missing.
// A reader who knows one should not have to learn the other.

import { z } from "zod";
import {
  listModuleSettingsFor,
  saveModuleSettingsPartial,
  type ModuleSettingsRepository,
} from "@/lib/module-settings";
import { getModuleBySlug, type ModuleRepository } from "@/lib/modules";

export const CLIPS_MODULE_SLUG = "clips";

export const CLIPS_SETTING_KEYS = {
  /** How much of a clip a board or list card shows before it is cut. */
  excerptChars: "clips_excerpt_chars",
} as const;

/**
 * The default card excerpt, in characters.
 *
 * 300 rather than the 200 the list shipped with: a board card is taller than a list
 * row and a two-line excerpt looks clipped in a column that has room for six. Still
 * far short of a full body — a card is a way back to the clip, not a replacement for
 * opening it.
 */
export const DEFAULT_CLIP_EXCERPT_CHARS = 300;

/**
 * The bounds the setting is clamped to.
 *
 * The floor exists because below ~80 characters an excerpt stops being a sentence and
 * starts being a truncated word, which tells a reader nothing a title does not.
 *
 * The ceiling is the load-bearing one. `EXCERPT_SOURCE_CHARS` in the repository reads
 * a bounded prefix of `content_html` **in SQL** so a pasted email's bytes never leave
 * the database — the property that read was written to protect. Letting this setting
 * exceed that prefix would silently re-introduce the full-column read it exists to
 * avoid, so the two are pinned together: this ceiling IS that prefix.
 */
export const MIN_CLIP_EXCERPT_CHARS = 80;
export const MAX_CLIP_EXCERPT_CHARS = 2000;

export interface ClipsSettings {
  /** Characters of a clip's text a card shows. Always within the bounds above. */
  excerptChars: number;
}

/**
 * The setting as the Configuration screen submits it.
 *
 * Clamps rather than refusing an out-of-range value: a reader dragging past the end
 * of the range has expressed "as much as possible", and an error message would be a
 * worse answer to that than the maximum.
 *
 * **Not `z.coerce.number()`.** `coerce` calls `Number(value)`, and `Number(null)` is
 * `0` — a perfectly valid integer, so `.catch` never fires and a null row clamps
 * silently to the minimum instead of falling back to the default. `Number("")`,
 * `Number(false)` and `Number([])` are 0 for the same reason. Converting by hand and
 * rejecting anything that is not finite keeps "absent or nonsense" distinct from
 * "a number outside the range", which are two different answers.
 */
export const clipExcerptCharsSchema = z
  .unknown()
  .transform((value) => {
    if (typeof value === "number") return value;
    if (typeof value === "string" && value.trim() !== "") return Number(value);
    return Number.NaN;
  })
  .transform((value) =>
    Number.isFinite(value)
      ? Math.min(MAX_CLIP_EXCERPT_CHARS, Math.max(MIN_CLIP_EXCERPT_CHARS, Math.trunc(value)))
      : DEFAULT_CLIP_EXCERPT_CHARS,
  );

/**
 * Reads the settings out of the module's rows, defaulting anything absent.
 *
 * Takes rows rather than a repository so it is callable on a list already in hand —
 * the admin screens read every module's settings in one query — and so it is testable
 * without a database.
 */
export function resolveClipsSettings(rows: { key: string; value: string }[]): ClipsSettings {
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  const raw = byKey.get(CLIPS_SETTING_KEYS.excerptChars);

  // An absent row is the default, and a corrupt one — a value hand-edited in the
  // database to "" or "abc" — is too. `.catch` on the schema makes that a defaulted
  // read rather than a thrown error on a page that only wanted to draw some cards.
  return {
    excerptChars:
      raw === undefined || raw.trim() === ""
        ? DEFAULT_CLIP_EXCERPT_CHARS
        : clipExcerptCharsSchema.parse(raw),
  };
}

/** The Clips module's settings, looked up by slug. Defaults if the module is missing. */
export function getClipsSettings(
  moduleRepo: ModuleRepository,
  settingsRepo: ModuleSettingsRepository,
): ClipsSettings {
  const appModule = getModuleBySlug(moduleRepo, CLIPS_MODULE_SLUG);
  if (!appModule) return resolveClipsSettings([]);
  return resolveClipsSettings(listModuleSettingsFor(settingsRepo, appModule.id));
}

/**
 * Sets how much of a clip a card shows.
 *
 * Always writes a row rather than removing one at the default, unlike
 * `setHsaReceiptRoot`: there the empty string means "unconfigured, and attaching a
 * receipt is refused", a state worth storing as absence. Here every value is valid and
 * the stored row is simply the reader's choice, including when it equals the default.
 */
export function setClipExcerptChars(
  moduleRepo: ModuleRepository,
  settingsRepo: ModuleSettingsRepository,
  rawValue: number | string,
): ClipsSettings {
  const value = clipExcerptCharsSchema.parse(rawValue);
  const appModule = getModuleBySlug(moduleRepo, CLIPS_MODULE_SLUG);
  if (!appModule) throw new Error("The Clips module is not registered.");

  saveModuleSettingsPartial(settingsRepo, appModule.id, [
    {
      key: CLIPS_SETTING_KEYS.excerptChars,
      value: String(value),
      description: "Characters of a clip shown on a board or list card.",
    },
  ]);

  return getClipsSettings(moduleRepo, settingsRepo);
}
