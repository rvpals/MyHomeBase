"use server";

// Web adapters for the Document Library's prefill templates. Each one validates with
// the module's zod schema (inside the use-case, which parses its own input), calls the
// use-case through `@/lib/documents`, and revalidates. No logic lives here — the CLI
// drives the same functions with the same arguments.

import { revalidatePath } from "next/cache";
import {
  deletePrefillTemplate,
  savePrefillTemplate,
  setPrefillTemplateEnabled,
  type DocumentPrefillTemplate,
  type SaveDocumentPrefillTemplateInput,
} from "@/lib/documents";
import { deps } from "@/lib/wiring";
import { requireModuleAccess } from "../../require-access";

/** The module these actions belong to, matched exactly by `requireModuleAccess`. */
const ACCESS_MODULE_SLUG = "documents";

const DOCUMENTS_TEMPLATES_PATH = "/modules/documents/templates";
// The New Document form's picker lives on its own route, so a template change has to
// invalidate that too — otherwise a newly-saved template doesn't appear until the next
// hard load. Same trap `journal-prefill-actions.ts` records for the module root.
const DOCUMENTS_NEW_PATH = "/modules/documents/new";

export interface DocumentPrefillTemplateResult {
  ok: boolean;
  error?: string;
  template?: DocumentPrefillTemplate;
}

function toErrorResult(error: unknown, fallback: string): DocumentPrefillTemplateResult {
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

function revalidate(): void {
  revalidatePath(DOCUMENTS_TEMPLATES_PATH);
  revalidatePath(DOCUMENTS_NEW_PATH);
}

export async function saveDocumentPrefillTemplateAction(
  input: SaveDocumentPrefillTemplateInput,
): Promise<DocumentPrefillTemplateResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  let template: DocumentPrefillTemplate;
  try {
    template = savePrefillTemplate(deps.documentsRepo, input);
  } catch (error) {
    return toErrorResult(error, "Failed to save the template.");
  }
  revalidate();
  return { ok: true, template };
}

export async function deleteDocumentPrefillTemplateAction(
  id: number,
): Promise<DocumentPrefillTemplateResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    deletePrefillTemplate(deps.documentsRepo, id);
  } catch (error) {
    return toErrorResult(error, "Failed to delete the template.");
  }
  revalidate();
  return { ok: true };
}

export async function setDocumentPrefillTemplateEnabledAction(
  id: number,
  isEnabled: boolean,
): Promise<DocumentPrefillTemplateResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  let template: DocumentPrefillTemplate;
  try {
    template = setPrefillTemplateEnabled(deps.documentsRepo, id, isEnabled);
  } catch (error) {
    return toErrorResult(error, "Failed to update the template.");
  }
  revalidate();
  return { ok: true, template };
}
