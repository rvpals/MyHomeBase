// Favourite photographs: keeping one picture out of the random photo card's stream.
//
// Thin by design, like `ticker-favorites`. There is no business rule here beyond
// "validate the path and normalise the note before either becomes a row" — the
// interesting decisions were schema ones and live in
// migrations/0073_create_fav_photo.md. What this module buys is that the validation
// happens in exactly one place, so the web app and the CLI cannot disagree about what
// a favourite is.

import { normaliseRelativePath } from "@/lib/journal-photos";
import type { FavPhotoRepository } from "./ports";
import { favPhotoNoteSchema, favPhotoPathSchema } from "./schema";
import type { FavPhoto } from "./types";

/**
 * The stored form of a path.
 *
 * Normalised BEFORE validation, not after: `normaliseRelativePath` collapses `\` to
 * `/` and squeezes duplicate separators, so the same photograph named two ways
 * (`2019/june/x.jpg` and `2019\june\x.jpg`) becomes one key rather than two rows the
 * primary key cannot tell apart. Validation then runs on what will actually be stored,
 * which is the only string worth checking.
 */
function storedPath(rawPath: string): string {
  return favPhotoPathSchema.parse(normaliseRelativePath(rawPath));
}

/** Every favourite, newest first. */
export function listFavPhotos(repo: FavPhotoRepository): FavPhoto[] {
  return repo.list();
}

/** One favourite, or `undefined` when this photo isn't starred. */
export function getFavPhoto(repo: FavPhotoRepository, rawPath: string): FavPhoto | undefined {
  return repo.get(storedPath(rawPath));
}

/**
 * Whether this photo is starred.
 *
 * Returns `false` for a path that will not validate rather than throwing: the caller
 * is a card deciding which glyph to draw, and an unreadable path is simply not a
 * favourite. Every *write* path still throws on bad input — being lenient about a
 * question is not the same as being lenient about a change.
 */
export function isFavPhoto(repo: FavPhotoRepository, rawPath: string): boolean {
  const parsed = favPhotoPathSchema.safeParse(normaliseRelativePath(rawPath));
  if (!parsed.success) return false;
  return repo.isFavorite(parsed.data);
}

/**
 * Flips the heart and returns the state it landed in.
 *
 * Returning the new state rather than void is what lets one round trip serve a toggle
 * button: the card renders the answer instead of following up with a read, and an
 * optimistic UI has something authoritative to reconcile against. Same contract as
 * `toggleFavorite` in ticker-favorites.
 *
 * Un-starring DISCARDS the note, because the row goes with it. That is the honest
 * reading of the button — the reader asked for this photo not to be a favourite — and
 * keeping orphaned notes around to resurrect on a future star would be a surprise, not
 * a courtesy. The dialog's remove control is the one that needs a confirmation if
 * anything does; the heart on a photo with no note has nothing to lose.
 *
 * Reads the current state and writes the opposite, which is a race if two clients press
 * the same heart at once. Accepted: both writes are idempotent, so the outcome is one
 * of the two states someone asked for rather than a corrupt row — and this is a
 * household app where the second client is the same person on their phone.
 */
export function toggleFavPhoto(repo: FavPhotoRepository, rawPath: string, rawNote = ""): boolean {
  const relativePath = storedPath(rawPath);
  const note = favPhotoNoteSchema.parse(rawNote);

  if (repo.isFavorite(relativePath)) {
    repo.remove(relativePath);
    return false;
  }
  repo.add(relativePath, note);
  return true;
}

/**
 * Stars a photo whatever its current state, and reports whether that changed anything.
 *
 * Separate from `toggleFavPhoto` because a toggle is the wrong primitive for a caller
 * that knows what it wants — a CLI `fav-photos add <path>` run twice should leave the
 * photo starred, not unstar it.
 *
 * An already-starred photo keeps its existing note. Re-adding is not a way to overwrite
 * one; `setFavPhotoNote` is, and it says so in its name.
 */
export function addFavPhoto(repo: FavPhotoRepository, rawPath: string, rawNote = ""): boolean {
  const relativePath = storedPath(rawPath);
  const note = favPhotoNoteSchema.parse(rawNote);

  if (repo.isFavorite(relativePath)) return false;
  repo.add(relativePath, note);
  return true;
}

/** Un-stars a photo, reporting whether it was starred to begin with. */
export function removeFavPhoto(repo: FavPhotoRepository, rawPath: string): boolean {
  const relativePath = storedPath(rawPath);
  if (!repo.isFavorite(relativePath)) return false;
  repo.remove(relativePath);
  return true;
}

/**
 * Rewrites the note on a favourite, reporting whether there was one to write to.
 *
 * `false` for a photo that is not starred, rather than starring it. The two actions are
 * distinct on purpose: an edit arriving for a row that another tab just removed should
 * fail visibly, not quietly re-create the favourite the reader deleted.
 */
export function setFavPhotoNote(
  repo: FavPhotoRepository,
  rawPath: string,
  rawNote: string,
): boolean {
  const relativePath = storedPath(rawPath);
  const note = favPhotoNoteSchema.parse(rawNote);

  if (!repo.isFavorite(relativePath)) return false;
  repo.setNote(relativePath, note);
  return true;
}
