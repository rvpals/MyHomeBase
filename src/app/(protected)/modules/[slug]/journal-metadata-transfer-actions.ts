"use server";

import { revalidatePath } from "next/cache";
import {
  applyMetadataImport,
  parseMetadataBundle,
  planMetadataImport,
  type JournalMetadataPlan,
  type JournalMetadataRestoreSummary,
} from "@/lib/journal";
import { saveModuleSettingsPartial } from "@/lib/module-settings";
import { getModuleBySlug } from "@/lib/modules";
import { deps } from "@/lib/wiring";

// The restore half of the Meta Data section's backup feature. The export half is
// a GET route (src/app/api/journal/metadata/export/route.ts) because a download
// needs no arguments; a restore needs a file, so it comes through here.
//
// Both actions take `FormData` carrying the raw .json rather than a base64 string
// argument, for the reason the admin icon actions give: base64 inflates a body by
// ~33% against the server-action body limit, and a metadata bundle holding a few
// hundred icons is exactly the payload that would hit it.

const JOURNAL_MODULE_PATH = "/modules/journal/metadata";
const JOURNAL_MODULE_SLUG = "journal";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Pulls the uploaded file's text out of a form body.
 *
 * Returns the message rather than throwing, so both actions report a missing or
 * unreadable file the same way the rest of the module's actions report failure.
 */
async function readBundleText(formData: FormData): Promise<{ text?: string; error?: string }> {
  const file = formData.get("bundle");
  if (!(file instanceof File)) return { error: "No file was received." };
  if (file.size === 0) return { error: "That file is empty." };
  return { text: await file.text() };
}

export interface JournalMetadataPlanResult extends ActionResult {
  plan?: JournalMetadataPlan;
}

/**
 * Works out what restoring the file would change, without writing anything —
 * the list the confirmation dialog shows before the reader commits. Same
 * plan-then-apply shape as the CSV import's overwrite dialog.
 */
export async function planJournalMetadataImportAction(
  formData: FormData,
): Promise<JournalMetadataPlanResult> {
  try {
    const { text, error } = await readBundleText(formData);
    if (error) return { ok: false, error };

    const bundle = parseMetadataBundle(text!);
    return { ok: true, plan: planMetadataImport(deps.journalRepo, bundle) };
  } catch (error) {
    // Covers bad JSON, a file that isn't a backup, and a newer format version —
    // all of which `parseMetadataBundle` reports with a message worth showing.
    return {
      ok: false,
      error: error instanceof Error ? error.message : "That file couldn't be read.",
    };
  }
}

export interface JournalMetadataRestoreResult extends ActionResult {
  summary?: JournalMetadataRestoreSummary;
}

/**
 * Restores the bundle: file wins, nothing deleted.
 *
 * The file is re-parsed here rather than the plan being trusted from the client
 * — the plan travelled to the browser and back, and a restore must decide what
 * to write from the file itself.
 */
export async function runJournalMetadataImportAction(
  formData: FormData,
): Promise<JournalMetadataRestoreResult> {
  try {
    const { text, error } = await readBundleText(formData);
    if (error) return { ok: false, error };

    const bundle = parseMetadataBundle(text!);
    const summary = applyMetadataImport(deps.journalRepo, bundle);

    // Preferences live outside the journal repository, so the use-case hands back
    // the entries it wants written and they're persisted here. `Partial` leaves
    // every key the bundle didn't mention alone — which is what keeps this
    // install's `photo_root` intact, since the restore never emits one.
    if (summary.preferenceEntries.length > 0) {
      const journalModule = getModuleBySlug(deps.moduleRepo, JOURNAL_MODULE_SLUG);
      if (journalModule) {
        saveModuleSettingsPartial(deps.moduleSettingsRepo, journalModule.id, summary.preferenceEntries);
      }
    }

    // The whole module, not just this section: restored categories and tags show
    // up in the entry form's dropdowns and on the home screen's Top lists.
    revalidatePath("/modules/journal");
    revalidatePath(JOURNAL_MODULE_PATH);
    return { ok: true, summary };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "That backup couldn't be restored.",
    };
  }
}
