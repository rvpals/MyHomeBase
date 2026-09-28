"use server";

// The My Shortcuts card's write endpoints.
//
// Every one of these is `requireUser()` on its first line and nothing more.
// That is the whole rule here: the card belongs to no module, so there is no
// module grant to check, and every signed-in reader has their own list. Which
// list gets written is never taken from the request — it is the session's user
// id, read here and passed down — so there is no id a caller could substitute
// to reach someone else's shortcuts.
//
// The use-cases live in `@/lib/user-shortcuts`. These are adapters: authorise,
// hand the raw input to the library, return what it says.

import { revalidatePath } from "next/cache";
import { decodeImageUpload } from "@/lib/shared/image-upload";
import {
  MAX_SHORTCUT_ICON_BYTES,
  SHORTCUT_ICON_MAX_EDGE,
  addShortcut,
  clearShortcutIcon,
  editShortcut,
  moveShortcut,
  removeShortcut,
  reorderShortcuts,
  setShortcutIcon,
  type ShortcutDraftInput,
} from "@/lib/user-shortcuts";
import { deps } from "@/lib/wiring";
import { requireUser } from "./require-access";

export interface ShortcutActionResult {
  ok: boolean;
  error?: string;
  /**
   * The new shortcut's id, from `addShortcutAction` only.
   *
   * The card uses it to post an uploaded picture straight after creating the
   * row — the upload is a second write and needs something to write against.
   */
  createdId?: number;
}

/**
 * Turns a thrown error into a message the dialog can show.
 *
 * The use-cases already return `{ ok, error }` for everything a reader can fix,
 * so this only catches the unexpected — a failed session lookup, a database
 * error. Those must not surface as a Next.js error overlay on the home screen.
 */
function failed(error: unknown, fallback: string): ShortcutActionResult {
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

/** The home screen is the only screen that draws these, so it is the only one to revalidate. */
function refresh(): void {
  revalidatePath("/");
}

export async function addShortcutAction(
  draft: ShortcutDraftInput,
): Promise<ShortcutActionResult> {
  try {
    const user = await requireUser();
    const result = addShortcut(deps.userShortcutsRepo, user.id, draft);
    if (result.ok) refresh();
    return { ok: result.ok, error: result.error, createdId: result.createdId };
  } catch (error) {
    return failed(error, "Failed to add the shortcut.");
  }
}

export async function editShortcutAction(
  id: number,
  draft: ShortcutDraftInput,
): Promise<ShortcutActionResult> {
  try {
    const user = await requireUser();
    // `id` arrives from the client and is used as-is, which is safe for one
    // reason worth naming: every repository method is scoped by user id, so an
    // id belonging to someone else matches no row and comes back as a miss.
    const result = editShortcut(deps.userShortcutsRepo, user.id, id, draft);
    if (result.ok) refresh();
    return { ok: result.ok, error: result.error };
  } catch (error) {
    return failed(error, "Failed to save the shortcut.");
  }
}

export async function removeShortcutAction(id: number): Promise<ShortcutActionResult> {
  try {
    const user = await requireUser();
    const result = removeShortcut(deps.userShortcutsRepo, user.id, id);
    if (result.ok) refresh();
    return { ok: result.ok, error: result.error };
  } catch (error) {
    return failed(error, "Failed to remove the shortcut.");
  }
}

/**
 * Nudges one shortcut a place left or right.
 *
 * The card sends a direction rather than a whole order, so the new sequence is
 * computed here from what is actually stored — not from what the client
 * believed was stored. A stale card can therefore only ever produce a no-op or
 * a one-place move, never scramble the list.
 */
export async function moveShortcutAction(
  id: number,
  direction: "up" | "down",
): Promise<ShortcutActionResult> {
  try {
    const user = await requireUser();
    const current = deps.userShortcutsRepo.list(user.id);
    const result = reorderShortcuts(
      deps.userShortcutsRepo,
      user.id,
      moveShortcut(current, id, direction),
    );
    if (result.ok) refresh();
    return { ok: result.ok, error: result.error };
  } catch (error) {
    return failed(error, "Failed to move the shortcut.");
  }
}

/**
 * Stores an uploaded picture as one shortcut's icon.
 *
 * Takes `FormData` carrying a real `File`, not a base64 string argument. That
 * is the documented rule in `coding-guide.md` and it is not stylistic: a base64
 * argument inflates ~33% against the server-action body limit, and Next
 * serialises a long string into nested arrays and rejects it outright with
 * "Maximum array nesting exceeded" — a framework error, not a validation
 * message. `saveModuleCarouselImageAction` is the worked example this follows.
 *
 * Two boundaries the adapter is responsible for crossing, in order:
 *
 *  - `decodeImageUpload` owns the mime allowlist and the size cap. **SVG is
 *    excluded there on purpose** — it can carry script, and these bytes are
 *    served back from the app's own origin.
 *  - The processor downscales to a small WebP. A tile draws this at ~28px, so
 *    storing the original would repeat the mistake migration 0040 recorded for
 *    the carousel: a multi-megabyte picture fetched whole to fill a tiny tile.
 */
export async function uploadShortcutIconAction(
  formData: FormData,
): Promise<ShortcutActionResult> {
  try {
    const user = await requireUser();

    const id = Number(formData.get("id"));
    if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "No shortcut was named." };

    const file = formData.get("icon");
    if (!(file instanceof File)) return { ok: false, error: "No image was received." };

    const decoded = decodeImageUpload(
      {
        // Cast because the value came off a File and is unvalidated until the
        // lib schema narrows it to the allowed set.
        mimeType: file.type as never,
        base64Data: Buffer.from(await file.arrayBuffer()).toString("base64"),
      },
      MAX_SHORTCUT_ICON_BYTES,
    );

    const resized = await deps.carouselImageProcessor.encodeWebp(
      decoded.data,
      SHORTCUT_ICON_MAX_EDGE,
      // Matches the carousel's quality. An icon at this size is mostly flat
      // colour, so there is nothing to gain from a higher setting.
      82,
    );

    const result = setShortcutIcon(deps.userShortcutsRepo, user.id, id, {
      data: resized,
      mimeType: "image/webp",
    });
    if (result.ok) refresh();
    return { ok: result.ok, error: result.error };
  } catch (error) {
    return failed(error, "Could not save that image.");
  }
}

/** Drops the uploaded picture, so the tile goes back to its glyph. */
export async function clearShortcutIconAction(id: number): Promise<ShortcutActionResult> {
  try {
    const user = await requireUser();
    const result = clearShortcutIcon(deps.userShortcutsRepo, user.id, id);
    if (result.ok) refresh();
    return { ok: result.ok, error: result.error };
  } catch (error) {
    return failed(error, "Could not remove that image.");
  }
}
