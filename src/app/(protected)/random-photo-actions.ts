"use server";

import {
  listFavPhotos,
  removeFavPhoto,
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
