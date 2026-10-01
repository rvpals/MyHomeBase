"use server";

import { revalidatePath } from "next/cache";
import {
  JOURNAL_SETTING_KEYS,
  parseExcludedWords,
  normalizeExcludedWord,
  serializeExcludedWords,
} from "@/lib/journal";
import {
  listModuleSettingsFor,
  removeModuleSetting,
  saveModuleSettingsPartial,
} from "@/lib/module-settings";
import { getModuleBySlug } from "@/lib/modules";
import { deps } from "@/lib/wiring";
import { requireModuleAccess } from "../../require-access";

/** The module these actions belong to, matched exactly by `requireModuleAccess`. */
const ACCESS_MODULE_SLUG = "journal";

const JOURNAL_MODULE_PATH = "/modules/journal";

export interface ExcludedWordsResult {
  ok: boolean;
  error?: string;
  /** The list after the change, so the caller doesn't re-read to find out. */
  words?: string[];
}

function toErrorResult(error: unknown, fallback: string): ExcludedWordsResult {
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

/**
 * Reads the stored list and writes back a changed one.
 *
 * The read-modify-write lives here rather than in the client because the stored
 * value is one comma-joined row: two tabs each sending their own idea of the
 * whole list would have the last writer silently drop the other's word.
 *
 * An **empty** result removes the row instead of saving a blank — module-setting
 * values must be non-empty, and `saveModuleSettingsPartial` deliberately cannot
 * express a deletion. Every other key on the module is left untouched, which is
 * why this is the partial save and not `saveModuleSettings`.
 */
function updateExcludedWords(
  change: (current: string[]) => string[],
): ExcludedWordsResult {
  const journalModule = getModuleBySlug(deps.moduleRepo, ACCESS_MODULE_SLUG);
  if (!journalModule) return { ok: false, error: "Journal module not found." };

  const settings = listModuleSettingsFor(deps.moduleSettingsRepo, journalModule.id);
  const stored = settings.find((setting) => setting.key === JOURNAL_SETTING_KEYS.excludedWords);
  const current = parseExcludedWords(stored?.value ?? "");

  const next = change(current);
  const value = serializeExcludedWords(next);

  if (value === "") {
    removeModuleSetting(deps.moduleSettingsRepo, journalModule.id, JOURNAL_SETTING_KEYS.excludedWords);
  } else {
    saveModuleSettingsPartial(deps.moduleSettingsRepo, journalModule.id, [
      { key: JOURNAL_SETTING_KEYS.excludedWords, value },
    ]);
  }

  return { ok: true, words: parseExcludedWords(value) };
}

/**
 * The (x) beside a word in the home screen's "most frequently used words" list:
 * stop counting this word, and recompute the ranking.
 *
 * `revalidatePath` is what makes the next word move up into the list — the
 * ranking is computed on the server from every entry's text, so the page has to
 * re-render for the change to show.
 */
export async function excludeWordAction(word: string): Promise<ExcludedWordsResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  let result: ExcludedWordsResult;
  try {
    // Normalized before storing: the tokenizer compares against the lowercased,
    // trimmed form, so a stored "Beach " would never match anything.
    const normalized = normalizeExcludedWord(word);
    if (!normalized) return { ok: false, error: `"${word}" isn't a word that can be excluded.` };
    result = updateExcludedWords((current) =>
      current.includes(normalized) ? current : [...current, normalized],
    );
  } catch (error) {
    return toErrorResult(error, "Failed to exclude that word.");
  }
  if (result.ok) revalidatePath(JOURNAL_MODULE_PATH);
  return result;
}

/**
 * The (x) beside a word in Preferences → Excluded words: count this word again.
 *
 * Removing a word the list doesn't hold is not an error — the end state is the
 * same, and a double-click shouldn't report a failure.
 */
export async function restoreWordAction(word: string): Promise<ExcludedWordsResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  let result: ExcludedWordsResult;
  try {
    const normalized = normalizeExcludedWord(word);
    if (!normalized) return { ok: false, error: `"${word}" isn't an excluded word.` };
    result = updateExcludedWords((current) =>
      current.filter((candidate) => candidate !== normalized),
    );
  } catch (error) {
    return toErrorResult(error, "Failed to restore that word.");
  }
  if (result.ok) revalidatePath(JOURNAL_MODULE_PATH);
  return result;
}
