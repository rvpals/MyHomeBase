// The Document Library's settings. All three are `sys_module_settings` rows, so none
// of them needs a migration.
//
// - **The folder** is configured on the module's own Configuration screen, like the
//   Journal's `photo_root` and the Household's `hsa_receipt_root`.
// - **The ceiling** (per-file size, files per document) is configured in
//   **Admin → Configuration → Application**, not on the module's screen: it governs how
//   much of the NAS volume and of the server's memory one upload can take, which is a
//   system resource limit rather than a per-reader preference.
//
// The ceiling is stored under this module rather than in `sys_app_settings` for the
// reason `UploadCapControl` records: the admin shell already holds a draft of every
// module's settings and commits them with its one Save button, so a module-setting row
// needs no bespoke context field, setter or save path in a file every admin screen
// depends on. Where it is *set* is the part that matters, and that is Admin.

import { z } from "zod";
import {
  listModuleSettingsFor,
  removeModuleSetting,
  saveModuleSettingsPartial,
  type ModuleSettingsRepository,
} from "@/lib/module-settings";
import { getModuleBySlug, type ModuleRepository } from "@/lib/modules";
import { normalizeWord, parseWordList, serializeWordList } from "@/lib/shared/word-tokens";
import type { DocumentFileStore, DocumentRootCheck } from "./file-store";
import {
  DEFAULT_DOCUMENT_MAX_FILES,
  DEFAULT_DOCUMENT_MAX_FILE_BYTES,
  DOCUMENT_MAX_FILES_CEILING,
  DOCUMENT_MAX_FILE_BYTES_CEILING,
} from "./schema";

export const DOCUMENTS_MODULE_SLUG = "documents";

export const DOCUMENT_SETTING_KEYS = {
  /** The folder documents' attachment files are filed under. */
  documentRoot: "document_root",
  /** The ceiling, set in Admin → Configuration → Application. */
  maxFileBytes: "document_max_file_bytes",
  maxFilesPerDocument: "document_max_files_per_document",
  /**
   * Words the Keywords section stops ranking, comma-joined in one row.
   *
   * One row rather than a row per word, for the reason the Journal's `excluded_words`
   * gives: the list is read and written whole every time, and `parseWordList` already
   * tolerates the blanks, casing and duplicates a hand-edited value could carry.
   *
   * A *module* setting, not a per-reader one: a household's filing cabinet has one
   * letterhead and one surname on every form, so the noise is a property of the
   * library rather than of whoever is looking at it. The Journal's is per-module for
   * the same reason.
   */
  ignoredKeywords: "ignored_keywords",
} as const;

export interface DocumentSettings {
  /** `""` = not set, and attaching a file is refused until it is. */
  documentRoot: string;
  /**
   * Words the Keywords section leaves out of its ranking.
   *
   * Layered on top of the shared stopword list rather than replacing it: that list is
   * a property of English and stays the floor, this is the household's own set of
   * dismissals. Deliberately does **not** affect the search box — ignoring a word
   * declutters a list, it does not make text unfindable.
   */
  ignoredKeywords: string[];
}

export interface DocumentLimits {
  maxFileBytes: number;
  maxFilesPerDocument: number;
}

/** Reads the module's settings out of its rows, defaulting anything absent. */
export function resolveDocumentSettings(rows: { key: string; value: string }[]): DocumentSettings {
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  return {
    documentRoot: (byKey.get(DOCUMENT_SETTING_KEYS.documentRoot) ?? "").trim(),
    // Parsed rather than split: a missing row, a blank one and a hand-edited one with
    // odd casing all have to come back as a usable list, which is what `parseWordList`
    // guarantees. An unparseable entry is dropped, not thrown on — the same
    // forgiveness `parseLimit` below applies to the ceiling.
    ignoredKeywords: parseWordList(byKey.get(DOCUMENT_SETTING_KEYS.ignoredKeywords) ?? ""),
  };
}

/** Reads the ceiling out of the same rows, forgivingly. Never throws. */
export function resolveDocumentLimits(rows: { key: string; value: string }[]): DocumentLimits {
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  return {
    maxFileBytes: parseLimit(
      byKey.get(DOCUMENT_SETTING_KEYS.maxFileBytes),
      DEFAULT_DOCUMENT_MAX_FILE_BYTES,
      DOCUMENT_MAX_FILE_BYTES_CEILING,
    ),
    maxFilesPerDocument: parseLimit(
      byKey.get(DOCUMENT_SETTING_KEYS.maxFilesPerDocument),
      DEFAULT_DOCUMENT_MAX_FILES,
      DOCUMENT_MAX_FILES_CEILING,
    ),
  };
}

/** The module's settings, looked up by slug. Defaults if the module is missing. */
export function getDocumentSettings(
  moduleRepo: ModuleRepository,
  settingsRepo: ModuleSettingsRepository,
): DocumentSettings {
  const appModule = getModuleBySlug(moduleRepo, DOCUMENTS_MODULE_SLUG);
  if (!appModule) return resolveDocumentSettings([]);
  return resolveDocumentSettings(listModuleSettingsFor(settingsRepo, appModule.id));
}

/**
 * Parses one stored limit, **forgivingly**.
 *
 * A settings row can outlive the thing it names and can be edited by hand, so a blank,
 * a non-number, a zero or a negative is "not set" and falls back to the default rather
 * than throwing — `modules.md` requires exactly this of settings parsing. A value above
 * the hard ceiling is clamped rather than rejected, because the alternative is an admin
 * who typed an extra zero finding that uploads stopped working with no explanation.
 */
function parseLimit(raw: string | undefined, fallback: number, ceiling: number): number {
  const value = Number((raw ?? "").trim());
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) return fallback;
  return Math.min(value, ceiling);
}

/** The ceiling in force, looked up by slug. Defaults if the module is missing. */
export function getDocumentLimits(
  moduleRepo: ModuleRepository,
  settingsRepo: ModuleSettingsRepository,
): DocumentLimits {
  const appModule = getModuleBySlug(moduleRepo, DOCUMENTS_MODULE_SLUG);
  if (!appModule) return resolveDocumentLimits([]);
  return resolveDocumentLimits(listModuleSettingsFor(settingsRepo, appModule.id));
}

export const documentRootSchema = z.string().trim().max(500, "That path is too long.");

/** What a failed check means, in words the Configuration screen can show. */
export function describeDocumentRootCheck(check: DocumentRootCheck): string {
  switch (check.kind) {
    case "ok":
      return `The server can write to ${check.path}.`;
    case "not-configured":
      return "No document folder is set.";
    case "missing":
      return `There is no folder at ${check.path}.`;
    case "not-a-directory":
      return `${check.path} is a file, not a folder.`;
    case "not-writable":
      return `The server cannot write to ${check.path} (${check.reason}). On a Synology, check the shared folder's permissions for the account the app runs as.`;
  }
}

/**
 * Sets (or, with `""`, clears) the document folder.
 *
 * A non-empty path is checked by writing a probe file before it is saved — a folder
 * the server can't write to would otherwise only be discovered on the first upload.
 *
 * **Existing files are NOT moved**, which is the same contract the HSA receipt folder
 * has and was confirmed as the wanted behaviour here. Attachments are stored relative
 * to the folder, so pointing the setting at a copy of the old folder keeps every
 * document working, and pointing it at an empty one leaves them unresolvable until the
 * files are copied across. The Configuration screen says so in as many words.
 */
export async function setDocumentRoot(
  moduleRepo: ModuleRepository,
  settingsRepo: ModuleSettingsRepository,
  store: DocumentFileStore,
  rawPath: string,
): Promise<DocumentSettings> {
  const value = documentRootSchema.parse(rawPath);
  const appModule = getModuleBySlug(moduleRepo, DOCUMENTS_MODULE_SLUG);
  if (!appModule) throw new Error("The Document Library module is not registered.");

  if (value === "") {
    removeModuleSetting(settingsRepo, appModule.id, DOCUMENT_SETTING_KEYS.documentRoot);
  } else {
    const check = await store.checkRoot(value);
    if (check.kind !== "ok") throw new Error(describeDocumentRootCheck(check));
    saveModuleSettingsPartial(settingsRepo, appModule.id, [
      {
        key: DOCUMENT_SETTING_KEYS.documentRoot,
        value,
        description: "Folder the Document Library files attachments under.",
      },
    ]);
  }
  return getDocumentSettings(moduleRepo, settingsRepo);
}

/**
 * Adds a word to the ignored list, or removes it — the Keywords screen's ✕ buttons.
 *
 * One function for both directions rather than two, because the read-modify-write
 * around them is the whole of the work and duplicating it is how the two halves of a
 * toggle drift apart. `ignore: false` on a word the list doesn't hold is **not** an
 * error: the end state is what was asked for, and a double-click should not report a
 * failure.
 *
 * The read-modify-write lives here rather than in the action for the reason the
 * Journal's `updateExcludedWords` records: the stored value is one comma-joined row,
 * so two tabs each sending their own idea of the whole list would have the last writer
 * silently drop the other's word. The caller sends one word and a direction.
 *
 * An **empty** result removes the row instead of saving a blank — module-setting
 * values must be non-empty, and `saveModuleSettingsPartial` deliberately cannot
 * express a deletion. Every other key on the module is left untouched, which is why
 * this is the partial save and not `saveModuleSettings`.
 *
 * Returns the stored list, so a caller renders what was actually written rather than
 * an optimistic guess.
 */
export function setKeywordIgnored(
  moduleRepo: ModuleRepository,
  settingsRepo: ModuleSettingsRepository,
  rawWord: string,
  ignore: boolean,
): string[] {
  // Normalized before storing: the ranker compares against the lowercased, trimmed
  // form, so a stored "Beach " would look right in the list and silently never match
  // a token. That is the most confusing way for this feature to fail.
  const word = normalizeWord(rawWord);
  if (word === "") {
    throw new Error(`"${rawWord}" isn't a word that can be ignored.`);
  }

  const appModule = getModuleBySlug(moduleRepo, DOCUMENTS_MODULE_SLUG);
  if (!appModule) throw new Error("The Document Library module is not registered.");

  const rows = listModuleSettingsFor(settingsRepo, appModule.id);
  const stored = rows.find((row) => row.key === DOCUMENT_SETTING_KEYS.ignoredKeywords);
  const current = parseWordList(stored?.value ?? "");

  const next = ignore
    ? current.includes(word)
      ? current
      : [...current, word]
    : current.filter((candidate) => candidate !== word);

  const value = serializeWordList(next);

  if (value === "") {
    removeModuleSetting(settingsRepo, appModule.id, DOCUMENT_SETTING_KEYS.ignoredKeywords);
  } else {
    saveModuleSettingsPartial(settingsRepo, appModule.id, [
      {
        key: DOCUMENT_SETTING_KEYS.ignoredKeywords,
        value,
        description: "Words the Document Library's Keywords section does not rank.",
      },
    ]);
  }

  return parseWordList(value);
}
