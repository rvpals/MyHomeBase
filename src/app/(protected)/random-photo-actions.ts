"use server";

import {
  listFavPhotos,
  removeFavPhoto,
  removeFavPhotos,
  setFavPhotoNote,
  toggleFavPhoto,
  type FavPhoto,
} from "@/lib/fav-photos";
import { pickRandomPhoto, type RandomPhotoPick } from "@/lib/journal-photos";
import { deps } from "@/lib/wiring";
import { photoStore } from "./modules/[slug]/journal-photo-root";

/**
 * Draws a fresh photograph for the home-screen card's refresh button.
 *
 * A thin adapter over the use-case, like `drawRandomQuoteAction`: the walk, the retry
 * budget and the "why not" reasons all live in `pickRandomPhoto`, and this adds only
 * the store to read from and a failure that cannot throw across the boundary.
 *
 * The store is built per call by `photoStore()` rather than held, so correcting the
 * path on the Journal's configuration screen takes effect on the next click with no
 * restart -- the whole reason that helper exists.
 *
 * No input to validate: the draw takes no parameters, which is also why there is no
 * zod schema here. The one value that does cross a boundary is the resulting relative
 * path, and that is parsed by `photoRelativePathSchema` on the image route that serves
 * the bytes.
 */
export async function drawRandomPhotoAction(): Promise<RandomPhotoPick> {
  try {
    return await pickRandomPhoto(photoStore());
  } catch {
    // An SMB share that drops mid-walk lands here. Reported as "unreachable" -- the
    // same vocabulary the root check uses -- so the card has one set of reasons to
    // render rather than a separate error channel.
    return { isAvailable: false, reason: "unreachable" };
  }
}

/**
 * Flips the heart on the card's title bar, returning the state it landed in.
 *
 * A thin adapter, like the draw above: the validation, the normalisation and the
 * toggle's semantics all live in `toggleFavPhoto`, and this only supplies the
 * repository.
 *
 * The path is not trusted here even though the card got it from a draw we performed —
 * it makes a round trip through the browser, so the use-case parses it through
 * `favPhotoPathSchema` before it can become a row. Nothing else needs to be checked:
 * the schema's `isSafeRelativePath` refinement is the same one guarding the image
 * route.
 */
export async function toggleFavPhotoAction(relativePath: string): Promise<boolean> {
  return toggleFavPhoto(deps.favPhotoRepo, relativePath);
}

/** Every favourite, newest first — what the "My favorites" dialog opens onto. */
export async function listFavPhotosAction(): Promise<FavPhoto[]> {
  return listFavPhotos(deps.favPhotoRepo);
}

/**
 * Writes a note on an existing favourite, reporting whether there was one to write to.
 *
 * `false` rather than an error when the photo is no longer starred — see
 * `setFavPhotoNote` for why an edit must not resurrect a removed favourite. The dialog
 * turns that into a message and re-reads the list.
 */
export async function setFavPhotoNoteAction(
  relativePath: string,
  note: string,
): Promise<boolean> {
  return setFavPhotoNote(deps.favPhotoRepo, relativePath, note);
}

/**
 * Removes one favourite from the list's own remove control.
 *
 * Not the same call as the heart: this caller knows what it wants (`remove`), and a
 * toggle here would re-favourite a photo whose row another tab had already deleted.
 */
export async function removeFavPhotoAction(relativePath: string): Promise<boolean> {
  return removeFavPhoto(deps.favPhotoRepo, relativePath);
}

/**
 * What the list's bulk removal reports back.
 *
 * A result object rather than a throw, because every failure here is something the
 * screen should print next to the button that caused it: a selection containing a
 * malformed path is a bug worth seeing, not a reason to blank the list. Matches the
 * `{ ok }` shape the expense module's bulk actions use.
 */
export type RemoveFavPhotosResult =
  | { ok: true; removed: number; missing: number }
  | { ok: false; error: string };

/**
 * Un-stars several favourites in one call, for the list's bulk action.
 *
 * One round trip for the whole selection rather than one per row: forty sequential
 * server actions over an SMB-backed SQLite file is forty write locks, and the list
 * would re-read itself forty times. The use-case validates every path before deleting
 * any of them, so a bad selection fails whole — see `removeFavPhotos`.
 *
 * `missing` is a count, not the paths: the screen says "removed 3 of 5", and shipping
 * the paths back would invite a caller to render a list nobody asked for.
 */
export async function removeFavPhotosAction(
  relativePaths: string[],
): Promise<RemoveFavPhotosResult> {
  try {
    const result = removeFavPhotos(deps.favPhotoRepo, relativePaths);
    return { ok: true, removed: result.removed, missing: result.missing.length };
  } catch {
    // A path that fails the schema lands here. Deliberately not echoing the raw value
    // back into the page.
    return { ok: false, error: "Some of those photos couldn't be removed." };
  }
}
