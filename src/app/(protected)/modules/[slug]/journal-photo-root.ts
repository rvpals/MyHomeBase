import { resolveJournalPreferences } from "@/lib/journal";
import type { PhotoFileStore } from "@/lib/journal-photos";
import { listModuleSettingsFor } from "@/lib/module-settings";
import { getModuleBySlug } from "@/lib/modules";
import { deps } from "@/lib/wiring";

// Where the photo archive's path comes from, for every server-side caller that needs it
// (the entry card's actions, the Check Access diagnostic, the image route).
//
// A plain module rather than part of the `"use server"` action files, which may only
// export async functions — and rather than repeating the lookup in each caller, so
// there is one answer to "which folder are we reading" no matter who asks.

const JOURNAL_MODULE_SLUG = "journal";

/**
 * The configured archive path: the Journal module's `photo_root` setting, falling back
 * to `MYHOMEBASE_PHOTO_ROOT`, else `""`.
 *
 * The setting wins because it is the one an admin can fix in the browser. The env var
 * stays as a fallback so an install configured that way keeps working without an edit.
 * `""` means not configured, and every caller treats it as "no archive" rather than
 * guessing a default — a wrong guess here would read some arbitrary folder.
 */
export function configuredPhotoRoot(): string {
  const journalModule = getModuleBySlug(deps.moduleRepo, JOURNAL_MODULE_SLUG);
  if (!journalModule) return deps.photoRootFromEnv;

  const preferences = resolveJournalPreferences(
    listModuleSettingsFor(deps.moduleSettingsRepo, journalModule.id),
  );
  return preferences.photoRoot !== "" ? preferences.photoRoot : deps.photoRootFromEnv;
}

/**
 * A read-only store pointed at the configured archive.
 *
 * Built per call, not once at boot: the path is a setting, so correcting it on the
 * Configuration screen takes effect on the next click with no restart. That is the whole
 * reason the path moved out of the environment.
 */
export function photoStore(): PhotoFileStore {
  return deps.photoFileStoreFor(configuredPhotoRoot());
}

/** Whether the path came from the module setting rather than the environment. */
export function isPhotoRootFromSetting(): boolean {
  const journalModule = getModuleBySlug(deps.moduleRepo, JOURNAL_MODULE_SLUG);
  if (!journalModule) return false;
  const preferences = resolveJournalPreferences(
    listModuleSettingsFor(deps.moduleSettingsRepo, journalModule.id),
  );
  return preferences.photoRoot !== "";
}
