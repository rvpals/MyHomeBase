"use server";

// Web adapters for the journal's prefill templates. Each one validates with the
// module's zod schema (inside the use-case, which parses its own input), calls
// the use-case through `@/lib/journal`, and revalidates. No logic lives here —
// the CLI drives the same functions with the same arguments.

import { revalidatePath } from "next/cache";
import {
  deletePrefillTemplate,
  savePrefillTemplate,
  setPrefillTemplateEnabled,
  type JournalPrefillTemplate,
  type SavePrefillTemplateInput,
} from "@/lib/journal";
import { deps } from "@/lib/wiring";

const JOURNAL_TEMPLATES_PATH = "/modules/journal/templates";
// The New Entry form's dropdown lives on the module root, so a template change
// has to invalidate that too — otherwise a newly-saved template doesn't appear
// until the next hard load.
const JOURNAL_MODULE_PATH = "/modules/journal";

export interface PrefillTemplateResult {
  ok: boolean;
  error?: string;
  template?: JournalPrefillTemplate;
}

function toErrorResult(error: unknown, fallback: string): PrefillTemplateResult {
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

function revalidate(): void {
  revalidatePath(JOURNAL_TEMPLATES_PATH);
  revalidatePath(JOURNAL_MODULE_PATH);
}

export async function savePrefillTemplateAction(
  input: SavePrefillTemplateInput,
): Promise<PrefillTemplateResult> {
  let template: JournalPrefillTemplate;
  try {
    template = savePrefillTemplate(deps.journalRepo, input);
  } catch (error) {
    return toErrorResult(error, "Failed to save the template.");
  }
  revalidate();
  return { ok: true, template };
}

export async function deletePrefillTemplateAction(id: number): Promise<PrefillTemplateResult> {
  try {
    deletePrefillTemplate(deps.journalRepo, id);
  } catch (error) {
    return toErrorResult(error, "Failed to delete the template.");
  }
  revalidate();
  return { ok: true };
}

export async function setPrefillTemplateEnabledAction(
  id: number,
  isEnabled: boolean,
): Promise<PrefillTemplateResult> {
  let template: JournalPrefillTemplate;
  try {
    template = setPrefillTemplateEnabled(deps.journalRepo, id, isEnabled);
  } catch (error) {
    return toErrorResult(error, "Failed to update the template.");
  }
  revalidate();
  return { ok: true, template };
}
