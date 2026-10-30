"use server";

import { revalidatePath } from "next/cache";
import {
  bulkSetTaxonomy,
  clearCategoryIcon,
  clearTagIcon,
  createDocument,
  deleteCategory,
  deleteRecycledDocumentsForever,
  deleteTag,
  describeBulkResult,
  describeDocumentRootCheck,
  emptyDocumentsRecycleBin,
  listCategories,
  listDocuments,
  listRecycledDocuments,
  listTags,
  recycleDocuments,
  removeAttachment,
  restoreRecycledDocuments,
  saveCategory,
  saveTag,
  setCategoryIcon,
  setDocumentRoot,
  setTagIcon,
  updateDocument,
  type BulkTaxonomyInput,
  type CreateDocumentInput,
  type DocumentFilterInput,
  type DocumentSummary,
  type DocumentTaxonomyItem,
  type FolderListing,
  type RecycledDocument,
  type UpdateDocumentInput,
} from "@/lib/documents";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import type { ImageUploadInput } from "@/lib/shared/image-upload";
import { cookies } from "next/headers";
import { deps } from "@/lib/wiring";
import { requireAdmin, requireModuleAccess } from "../../require-access";
import { documentFiles } from "./documents-root";

/** The module these actions belong to, matched exactly by `requireModuleAccess`. */
const ACCESS_MODULE_SLUG = "documents";

const DOCUMENTS_PATH = "/modules/documents";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

function toErrorResult(error: unknown, fallback: string): ActionResult {
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

// Every export below opens with `requireModuleAccess`, INSIDE the try so a denial
// renders as an inline error rather than an unhandled rejection. A server action is
// its own POST endpoint: neither the `(protected)` layout nor the page's own access
// check runs before one fires, so hiding the module from the tree does nothing to
// stop these being invoked directly. The slug is matched exactly — never a prefix,
// never a route path.

/** Who is filing this, for attribution. `null` when the session has gone stale. */
async function currentUserId(): Promise<number | null> {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  return getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo)?.id ?? null;
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export async function listDocumentsAction(
  filter: Partial<DocumentFilterInput>,
): Promise<{ ok: boolean; documents?: DocumentSummary[]; error?: string }> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    return { ok: true, documents: listDocuments(deps.documentsRepo, filter) };
  } catch (error) {
    return toErrorResult(error, "Could not list the documents.");
  }
}

export async function createDocumentAction(
  input: CreateDocumentInput,
): Promise<ActionResult & { id?: number }> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    const document = createDocument(deps.documentsRepo, input, await currentUserId());
    revalidatePath(DOCUMENTS_PATH);
    // The id goes back so the editor can attach files to the document it just made —
    // an upload needs a document to hang from, so filing comes first.
    return { ok: true, id: document.id };
  } catch (error) {
    return toErrorResult(error, "Could not file that document.");
  }
}

export async function updateDocumentAction(input: UpdateDocumentInput): Promise<ActionResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    updateDocument(deps.documentsRepo, input);
    revalidatePath(DOCUMENTS_PATH);
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not save that document.");
  }
}

/**
 * Deletes a document, and its files only if explicitly asked.
 *
 * `deleteFiles` arrives from a checkbox the reader has to tick — the use-case defaults
 * it to false, and even on true the files are moved to `_deleted/` rather than
 * unlinked.
 */
/**
 * The Delete button — which **recycles** since migration 0163.
 *
 * The name is kept because that is what the button says and what the reader means;
 * what changed is that it is now reversible. `deleteDocument` still exists and is
 * still the permanent purge, reached only from the bin.
 *
 * `deleteFiles` is gone: recycling always moves the folder to `_deleted/`, because a
 * restore has to be able to find the files again. "Keep the paperwork, drop the
 * record" is now what a purge does — the bytes stay under `_deleted/` either way.
 */
export async function deleteDocumentAction(id: number): Promise<ActionResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    await recycleDocuments(deps.documentsRepo, documentFiles(), [id]);
    revalidatePath(DOCUMENTS_PATH);
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not delete that document.");
  }
}

// ---------------------------------------------------------------------------
// Bulk operations (migration 0163)
// ---------------------------------------------------------------------------

export async function bulkSetTaxonomyAction(
  input: BulkTaxonomyInput,
): Promise<ActionResult & { message?: string }> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    const result = bulkSetTaxonomy(deps.documentsRepo, input);
    revalidatePath(DOCUMENTS_PATH);
    return { ok: true, message: describeBulkResult(result) };
  } catch (error) {
    return toErrorResult(error, "Could not apply that change.");
  }
}

export async function bulkRecycleAction(
  ids: number[],
): Promise<ActionResult & { message?: string }> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    const result = await recycleDocuments(deps.documentsRepo, documentFiles(), ids);
    revalidatePath(DOCUMENTS_PATH);
    const noun = result.movedCount === 1 ? "document" : "documents";
    return { ok: true, message: `${result.movedCount} ${noun} moved to the bin` };
  } catch (error) {
    return toErrorResult(error, "Could not delete those documents.");
  }
}

// ---------------------------------------------------------------------------
// The recycle bin (migration 0163)
// ---------------------------------------------------------------------------

export async function listRecycledDocumentsAction(): Promise<{
  ok: boolean;
  documents?: RecycledDocument[];
  error?: string;
}> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    return { ok: true, documents: listRecycledDocuments(deps.documentsRepo) };
  } catch (error) {
    return toErrorResult(error, "Could not read the recycle bin.");
  }
}

/**
 * Puts binned documents back.
 *
 * `message` names any renumbering rather than swallowing it: a document whose original
 * id had been taken comes back under a new one, with its attachment paths rewritten to
 * match. Nothing is broken by that, but any bookmark to the old id now points at a
 * different document, and the reader should be told while they are still looking.
 */
export async function restoreDocumentsAction(
  recycledIds: number[],
): Promise<ActionResult & { message?: string }> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    const result = await restoreRecycledDocuments(
      deps.documentsRepo,
      documentFiles(),
      recycledIds,
    );
    revalidatePath(DOCUMENTS_PATH);

    const noun = result.restoredCount === 1 ? "document" : "documents";
    const renumbered =
      result.renumbered.length === 0
        ? ""
        : ` — ${result.renumbered
            .map((row) => `"${row.title}" came back as #${row.toId} (was #${row.fromId})`)
            .join("; ")}`;
    return { ok: true, message: `${result.restoredCount} ${noun} restored${renumbered}` };
  } catch (error) {
    return toErrorResult(error, "Could not restore those documents.");
  }
}

export async function purgeRecycledDocumentsAction(
  recycledIds: number[],
): Promise<ActionResult & { message?: string }> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    const result = deleteRecycledDocumentsForever(deps.documentsRepo, recycledIds);
    revalidatePath(DOCUMENTS_PATH);
    const noun = result.deletedCount === 1 ? "document" : "documents";
    return { ok: true, message: `${result.deletedCount} ${noun} removed from the bin` };
  } catch (error) {
    return toErrorResult(error, "Could not remove those documents.");
  }
}

export async function emptyDocumentsBinAction(): Promise<ActionResult & { message?: string }> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    const result = emptyDocumentsRecycleBin(deps.documentsRepo);
    revalidatePath(DOCUMENTS_PATH);
    const noun = result.deletedCount === 1 ? "document" : "documents";
    return { ok: true, message: `${result.deletedCount} ${noun} removed from the bin` };
  } catch (error) {
    return toErrorResult(error, "Could not empty the bin.");
  }
}

export async function removeAttachmentAction(
  attachmentId: number,
  deleteFile: boolean,
): Promise<ActionResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    await removeAttachment(deps.documentsRepo, documentFiles(), { attachmentId, deleteFile });
    revalidatePath(DOCUMENTS_PATH);
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not remove that attachment.");
  }
}

// ---------------------------------------------------------------------------
// Taxonomy
// ---------------------------------------------------------------------------

export async function listTaxonomyAction(): Promise<{
  ok: boolean;
  categories?: DocumentTaxonomyItem[];
  tags?: DocumentTaxonomyItem[];
  error?: string;
}> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    return {
      ok: true,
      categories: listCategories(deps.documentsRepo),
      tags: listTags(deps.documentsRepo),
    };
  } catch (error) {
    return toErrorResult(error, "Could not list the categories and tags.");
  }
}

export async function saveCategoryAction(
  name: string,
  description: string,
): Promise<ActionResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    saveCategory(deps.documentsRepo, { name, description });
    revalidatePath(DOCUMENTS_PATH);
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not save that category.");
  }
}

export async function saveTagAction(name: string, description: string): Promise<ActionResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    saveTag(deps.documentsRepo, { name, description });
    revalidatePath(DOCUMENTS_PATH);
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not save that tag.");
  }
}

export async function deleteCategoryAction(name: string): Promise<ActionResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    deleteCategory(deps.documentsRepo, name);
    revalidatePath(DOCUMENTS_PATH);
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not delete that category.");
  }
}

export async function deleteTagAction(name: string): Promise<ActionResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    deleteTag(deps.documentsRepo, name);
    revalidatePath(DOCUMENTS_PATH);
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not delete that tag.");
  }
}

// ---------------------------------------------------------------------------
// Taxonomy icons
// ---------------------------------------------------------------------------
//
// Base64 rather than raw bytes, for the same reason the expense and journal icon
// actions take it that way: it survives server-action serialization cleanly, and the
// use-case decodes it and enforces the type and size limits.

export async function saveCategoryIconAction(
  name: string,
  mimeType: string,
  base64Data: string,
): Promise<ActionResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    setCategoryIcon(deps.documentsRepo, name, { mimeType, base64Data } as ImageUploadInput);
    revalidatePath(DOCUMENTS_PATH);
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not save that icon.");
  }
}

export async function clearCategoryIconAction(name: string): Promise<ActionResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    clearCategoryIcon(deps.documentsRepo, name);
    revalidatePath(DOCUMENTS_PATH);
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not remove that icon.");
  }
}

export async function saveTagIconAction(
  name: string,
  mimeType: string,
  base64Data: string,
): Promise<ActionResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    setTagIcon(deps.documentsRepo, name, { mimeType, base64Data } as ImageUploadInput);
    revalidatePath(DOCUMENTS_PATH);
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not save that icon.");
  }
}

export async function clearTagIconAction(name: string): Promise<ActionResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    clearTagIcon(deps.documentsRepo, name);
    revalidatePath(DOCUMENTS_PATH);
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not remove that icon.");
  }
}

// ---------------------------------------------------------------------------
// Configuration — admin only
// ---------------------------------------------------------------------------
//
// `requireAdmin` rather than `requireModuleAccess`: the folder is a server-side path
// and the limits bound what the server will buffer, so holding the module is not
// enough to change either. The same split the Household's receipt-folder actions make.

export async function saveDocumentRootAction(rawPath: string): Promise<ActionResult> {
  try {
    await requireAdmin();
    await setDocumentRoot(
      deps.moduleRepo,
      deps.moduleSettingsRepo,
      deps.documentFileStore,
      rawPath,
    );
    revalidatePath(DOCUMENTS_PATH);
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not save that folder.");
  }
}

export async function checkDocumentRootAction(
  rawPath: string,
): Promise<{ ok: boolean; message?: string; error?: string }> {
  try {
    await requireAdmin();
    const check = await deps.documentFileStore.checkRoot(rawPath);
    const message = describeDocumentRootCheck(check);
    // A failed check is not an exception — it is the answer to the question the
    // button asked, and it belongs in the same place a successful one does.
    return check.kind === "ok" ? { ok: true, message } : { ok: false, error: message };
  } catch (error) {
    return toErrorResult(error, "Could not check that folder.");
  }
}

export interface BrowseFoldersResult extends ActionResult {
  listing?: FolderListing;
}

/** One level of the server's folders, for the Browse dialog. Blank starts at the root. */
export async function browseFoldersAction(path: string): Promise<BrowseFoldersResult> {
  try {
    await requireAdmin();
    return { ok: true, listing: await deps.documentFileStore.listFolders(path) };
  } catch (error) {
    return toErrorResult(error, "Could not open that folder.");
  }
}
