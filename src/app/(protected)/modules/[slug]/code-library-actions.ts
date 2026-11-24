"use server";

import { revalidatePath } from "next/cache";
import {
  createSnippet,
  decryptSnippet,
  deleteSnippetCategory,
  deleteSnippetTag,
  emptyRecycleBin,
  encryptSnippet,
  getSnippet,
  openSnippet,
  purgeRecycledSnippet,
  recycleSnippet,
  restoreRecycledSnippet,
  saveSnippetCategory,
  saveSnippetTag,
  setSnippetColor,
  setSnippetPinned,
  updateSnippet,
  type CreateSnippetInput,
  type EncryptSnippetInput,
  type SnippetCardColor,
  type SnippetPasswordInput,
  type Snippet,
  type SnippetTaxonomyWriteInput,
  type UpdateSnippetInput,
} from "@/lib/code-library";
import { deps } from "@/lib/wiring";
import { requireModuleAccess } from "../../require-access";

/** The module these actions belong to, matched exactly by `requireModuleAccess`. */
const ACCESS_MODULE_SLUG = "code-library";

const CODE_LIBRARY_PATH = "/modules/code-library";

/** The taxonomy screen's own route, revalidated whenever the vocabulary changes. */
const METADATA_PATH = "/modules/code-library/metadata";

/** The bin's own route, revalidated alongside the list whenever a snippet moves. */
const RECYCLED_PATH = "/modules/code-library/recycled";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export interface SnippetResult extends ActionResult {
  snippet?: Snippet;
}

function toErrorResult(error: unknown, fallback: string): SnippetResult {
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

// Every export below opens with `requireModuleAccess`, INSIDE the try so a denial
// renders as an inline error rather than an unhandled rejection. A server action is
// its own POST endpoint: neither the `(protected)` layout nor the page's own access
// check runs before one fires, so hiding the module from the tree does nothing to
// stop these being invoked directly.
//
// The slug is passed in full and matched by equality — never a prefix, never the
// route path.

/**
 * One snippet in full, for the editor.
 *
 * A read action and not a prop on the card, because the list is a **projection**:
 * `SnippetSummary` carries the opening lines only, so a screen showing 200
 * snippets does not pull 200 whole files into memory. The body is fetched when a
 * reader actually opens one for editing — one round trip, on a deliberate click.
 *
 * Carries the access guard like every write here. A read leaks a snippet just as
 * effectively as a write corrupts one.
 */
export async function getSnippetAction(id: number): Promise<SnippetResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    const snippet = getSnippet(deps.codeLibraryRepo, id);
    if (!snippet) return { ok: false, error: "That snippet no longer exists." };
    return { ok: true, snippet };
  } catch (error) {
    return toErrorResult(error, "Could not load that snippet.");
  }
}

export async function createSnippetAction(input: CreateSnippetInput): Promise<SnippetResult> {
  try {
    const user = await requireModuleAccess(ACCESS_MODULE_SLUG);
    // `user.id` is attribution, not permission: the guard above already decided
    // whether this reader may write at all.
    const snippet = createSnippet(deps.codeLibraryRepo, input, user.id);
    revalidatePath(CODE_LIBRARY_PATH);
    return { ok: true, snippet };
  } catch (error) {
    return toErrorResult(error, "Could not save that snippet.");
  }
}

export async function updateSnippetAction(input: UpdateSnippetInput): Promise<SnippetResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    // `SnippetNotFoundError` carries a usable message ("No snippet with id 3."),
    // so it falls through to `toErrorResult` like any other — the reader is told
    // the snippet has gone rather than watching a save do nothing.
    const snippet = updateSnippet(deps.codeLibraryRepo, input);
    revalidatePath(CODE_LIBRARY_PATH);
    // The taxonomy screen's usage counts move when a snippet's labels change.
    revalidatePath(METADATA_PATH);
    return { ok: true, snippet };
  } catch (error) {
    return toErrorResult(error, "Could not save that snippet.");
  }
}

export async function setSnippetPinnedAction(
  id: number,
  isPinned: boolean,
): Promise<ActionResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    setSnippetPinned(deps.codeLibraryRepo, { id, isPinned });
    revalidatePath(CODE_LIBRARY_PATH);
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not change that pin.");
  }
}

export async function setSnippetColorAction(
  id: number,
  color: SnippetCardColor | "",
): Promise<ActionResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    setSnippetColor(deps.codeLibraryRepo, { id, color });
    revalidatePath(CODE_LIBRARY_PATH);
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not change that colour.");
  }
}

// Sealing. The password never persists anywhere — it arrives, it is used to
// derive a key, and it is gone. There is no recovery, which the UI states before
// any of these can be reached.

export async function encryptSnippetAction(
  input: EncryptSnippetInput,
): Promise<ActionResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    encryptSnippet(deps.codeLibraryRepo, input);
    revalidatePath(CODE_LIBRARY_PATH);
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not seal that snippet.");
  }
}

/**
 * The plaintext of a sealed snippet, for the viewer.
 *
 * Returns the content rather than setting a flag: nothing is unsealed by
 * reading, so this leaves the stored row exactly as it was. A wrong password
 * surfaces as `WrongPasswordError`'s own message.
 */
export async function openSnippetAction(
  input: SnippetPasswordInput,
): Promise<SnippetResult & { code?: string; title?: string }> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    const opened = openSnippet(deps.codeLibraryRepo, input);
    return { ok: true, ...opened };
  } catch (error) {
    return toErrorResult(error, "Could not open that snippet.");
  }
}

export async function decryptSnippetAction(
  input: SnippetPasswordInput,
): Promise<ActionResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    decryptSnippet(deps.codeLibraryRepo, input);
    revalidatePath(CODE_LIBRARY_PATH);
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not unseal that snippet.");
  }
}

// The recycle bin. Deleting moves; only the bin destroys.

export async function recycleSnippetAction(id: number): Promise<ActionResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    recycleSnippet(deps.codeLibraryRepo, id);
    revalidatePath(CODE_LIBRARY_PATH);
    revalidatePath(RECYCLED_PATH);
    // The usage counts drop when a snippet leaves the library.
    revalidatePath(METADATA_PATH);
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not delete that snippet.");
  }
}

export async function restoreRecycledSnippetAction(recycledId: number): Promise<ActionResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    restoreRecycledSnippet(deps.codeLibraryRepo, recycledId);
    revalidatePath(CODE_LIBRARY_PATH);
    revalidatePath(RECYCLED_PATH);
    revalidatePath(METADATA_PATH);
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not restore that snippet.");
  }
}

export async function purgeRecycledSnippetAction(recycledId: number): Promise<ActionResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    // Irreversible. The view confirms before calling this.
    purgeRecycledSnippet(deps.codeLibraryRepo, recycledId);
    revalidatePath(RECYCLED_PATH);
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not remove that snippet.");
  }
}

export async function emptyRecycleBinAction(): Promise<ActionResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    emptyRecycleBin(deps.codeLibraryRepo);
    revalidatePath(RECYCLED_PATH);
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not empty the bin.");
  }
}

// Taxonomy. The management screen writes through these; the editor creates a
// category or tag implicitly by naming one, which happens inside the snippet
// write rather than here.

export async function saveCategoryAction(
  input: SnippetTaxonomyWriteInput,
): Promise<ActionResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    saveSnippetCategory(deps.codeLibraryRepo, input);
    revalidatePath(METADATA_PATH);
    // The chips on the home screen come from the same list.
    revalidatePath(CODE_LIBRARY_PATH);
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not save that category.");
  }
}

export async function saveTagAction(input: SnippetTaxonomyWriteInput): Promise<ActionResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    saveSnippetTag(deps.codeLibraryRepo, input);
    revalidatePath(METADATA_PATH);
    revalidatePath(CODE_LIBRARY_PATH);
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not save that tag.");
  }
}

export async function deleteCategoryAction(name: string): Promise<ActionResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    // Takes the pairings with it. The snippets are untouched — they lose the
    // label, which is what retiring a word means.
    deleteSnippetCategory(deps.codeLibraryRepo, name);
    revalidatePath(METADATA_PATH);
    revalidatePath(CODE_LIBRARY_PATH);
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not delete that category.");
  }
}

export async function deleteTagAction(name: string): Promise<ActionResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    deleteSnippetTag(deps.codeLibraryRepo, name);
    revalidatePath(METADATA_PATH);
    revalidatePath(CODE_LIBRARY_PATH);
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not delete that tag.");
  }
}
