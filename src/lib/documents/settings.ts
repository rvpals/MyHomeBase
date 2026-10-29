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
} as const;

export interface DocumentSettings {
  /** `""` = not set, and attaching a file is refused until it is. */
  documentRoot: string;
}

export interface DocumentLimits {
  maxFileBytes: number;
  maxFilesPerDocument: number;
}

/** Reads the module's settings out of its rows, defaulting anything absent. */
export function resolveDocumentSettings(rows: { key: string; value: string }[]): DocumentSettings {
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  return { documentRoot: (byKey.get(DOCUMENT_SETTING_KEYS.documentRoot) ?? "").trim() };
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
