"use server";

// Web adapters for the journal's taxonomy combos (migration 0177). Each one
// validates with the module's zod schema (inside the use-case, which parses its
// own input), calls the use-case through `@/lib/journal`, and revalidates. No
// logic lives here — the CLI drives the same functions with the same arguments.
//
// Separate from journal-prefill-actions.ts on purpose: combos and prefill
// templates are different features that happen to both fill a form, and sharing
// an actions file would mean sharing a revalidate list neither wants whole.

import { revalidatePath } from "next/cache";
import {
  deleteTaxonomyCombo,
  saveTaxonomyCombo,
  type JournalTaxonomyCombo,
  type SaveTaxonomyComboInput,
} from "@/lib/journal";
import { deps } from "@/lib/wiring";
import { requireModuleAccess } from "../../require-access";

/** The module these actions belong to, matched exactly by `requireModuleAccess`. */
const ACCESS_MODULE_SLUG = "journal";

// Where combos are managed.
const JOURNAL_METADATA_PATH = "/modules/journal/metadata";
// The combo *picker* lives in both entry editors, so a combo change has to
// invalidate the module root (New Entry) as well — otherwise a newly-saved combo
// doesn't appear in the picker until the next hard load. The editor of an
// existing entry lives under /modules/journal/entries/<id>, which is not
// revalidated here: those pages are per-entry and there can be hundreds, so the
// combo list is read fresh on each navigation rather than invalidated in bulk.
const JOURNAL_MODULE_PATH = "/modules/journal";

export interface TaxonomyComboResult {
  ok: boolean;
  error?: string;
  combo?: JournalTaxonomyCombo;
}

function toErrorResult(error: unknown, fallback: string): TaxonomyComboResult {
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

function revalidate(): void {
  revalidatePath(JOURNAL_METADATA_PATH);
  revalidatePath(JOURNAL_MODULE_PATH);
}

export async function saveTaxonomyComboAction(
  input: SaveTaxonomyComboInput,
): Promise<TaxonomyComboResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  let combo: JournalTaxonomyCombo;
  try {
    combo = saveTaxonomyCombo(deps.journalRepo, input);
  } catch (error) {
    return toErrorResult(error, "Failed to save the combo.");
  }
  revalidate();
  return { ok: true, combo };
}

export async function deleteTaxonomyComboAction(id: number): Promise<TaxonomyComboResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    deleteTaxonomyCombo(deps.journalRepo, id);
  } catch (error) {
    return toErrorResult(error, "Failed to delete the combo.");
  }
  revalidate();
  return { ok: true };
}
