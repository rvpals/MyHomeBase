// The album use-cases: functions that take data and return data, depending on the
// repository INTERFACE rather than a database. Every one is reachable identically from
// the web app and the CLI, which is what the tests exercise with a fake repository.

import { normaliseRelativePath } from "@/lib/journal-photos";
import type { AlbumRepository } from "./ports";
import {
  albumCreateSchema,
  albumIdSchema,
  albumOrderSchema,
  albumPhotoPathSchema,
  albumPhotosSchema,
  albumUpdateSchema,
  MAX_ALBUM_PHOTOS,
} from "./schema";
import type { Album, AlbumSummary, AlbumWithPhotos } from "./types";

/**
 * What a write reports back.
 *
 * A result object rather than a throw for the things a READER can cause and fix — a
 * duplicate name, an album deleted in another tab, an album that is already full.
 * Those are messages the screen prints next to the control that caused them, matching
 * the `{ ok }` shape `removeFavPhotosAction` already uses.
 *
 * A malformed path or a negative id still throws: that is a caller bug, and turning it
 * into a soft `{ ok: false }` would let a broken screen look like it merely had bad
 * luck. Same split the expense module's bulk actions draw.
 */
export type AlbumResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Every album with its photo count and cover picture. */
export function listAlbums(repo: AlbumRepository): AlbumSummary[] {
  return repo.listSummaries();
}

/** One album with its photographs in order, or `undefined` when there is no such album. */
export function getAlbum(repo: AlbumRepository, rawId: unknown): AlbumWithPhotos | undefined {
  const id = albumIdSchema.parse(rawId);
  return repo.getWithPhotos(id);
}

/**
 * Creates an album.
 *
 * The name is checked for a clash BEFORE inserting, so the reader gets "there is
 * already an album called Christmas" rather than a constraint violation. The unique
 * index still exists and is still the authority — this check can lose a race, and when
 * it does the index refuses the write, which is the outcome we want. Checking here is
 * about the message, not the guarantee.
 */
export function createAlbum(
  repo: AlbumRepository,
  input: unknown,
): AlbumResult<Album> {
  const { name, description } = albumCreateSchema.parse(input);

  if (repo.nameExists(name)) {
    return { ok: false, error: `There is already an album called “${name}”.` };
  }

  return { ok: true, value: repo.create(name, description) };
}

/**
 * Renames an album and rewrites its description.
 *
 * One operation rather than two, because the edit form posts both fields together and
 * a reader who changed only the description should not have their name re-validated
 * against a different rule. `exceptId` is what lets an unchanged name through.
 */
export function updateAlbum(repo: AlbumRepository, input: unknown): AlbumResult<Album> {
  const { id, name, description } = albumUpdateSchema.parse(input);

  const existing = repo.get(id);
  if (existing === undefined) {
    return { ok: false, error: "That album no longer exists." };
  }
  if (repo.nameExists(name, id)) {
    return { ok: false, error: `There is already an album called “${name}”.` };
  }

  repo.update(id, name, description);
  // Re-read rather than patching the object we already hold: `updatedAt` is set by the
  // store, so a locally-assembled return value would carry a stale timestamp.
  return { ok: true, value: repo.get(id) ?? existing };
}

/**
 * Deletes an album.
 *
 * The PHOTOGRAPHS ARE NOT TOUCHED — this drops the album and its membership rows, and
 * every file stays exactly where it is on the NAS. That is the whole reason an album
 * stores paths: deleting a collection someone assembled must never be able to delete
 * the pictures it was assembled from. The screens say so on the confirm dialog.
 *
 * Idempotent: deleting an album that has already gone reports `ok` rather than an
 * error, because two tabs racing on the same delete both got what they asked for.
 */
export function deleteAlbum(repo: AlbumRepository, rawId: unknown): AlbumResult<null> {
  const id = albumIdSchema.parse(rawId);
  repo.remove(id);
  return { ok: true, value: null };
}

/**
 * Adds photographs to an album, skipping any it already holds.
 *
 * Returns how many were actually added and how many were already there, so the screen
 * can say "added 3, 2 were already in the album" — which is the honest report when a
 * reader multi-selects across a folder they have partly filed already. Silently
 * claiming five would be a lie, and refusing the whole call over two duplicates would
 * be worse.
 *
 * Paths are normalised before insertion so two spellings of one path cannot become two
 * membership rows the unique index never sees as equal.
 */
export function addPhotosToAlbum(
  repo: AlbumRepository,
  input: unknown,
): AlbumResult<{ added: number; alreadyPresent: number }> {
  const { albumId, relativePaths } = albumPhotosSchema.parse(input);

  if (repo.get(albumId) === undefined) {
    return { ok: false, error: "That album no longer exists." };
  }

  // Normalise, then de-duplicate within the request itself. Selecting one picture
  // twice is not possible in the UI, but a CLI call or a crafted request could, and
  // `addPhotos` would then count one insert per copy.
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const rawPath of relativePaths) {
    const relativePath = normaliseRelativePath(rawPath);
    if (seen.has(relativePath)) continue;
    seen.add(relativePath);
    paths.push(relativePath);
  }

  // Checked against what the album would BECOME, not what it holds now — otherwise an
  // album one photo under the cap would accept a hundred more.
  const currentCount = repo.listPhotos(albumId).length;
  if (currentCount + paths.length > MAX_ALBUM_PHOTOS) {
    return {
      ok: false,
      error: `An album holds at most ${MAX_ALBUM_PHOTOS} photos, and this one already has ${currentCount}.`,
    };
  }

  const added = repo.addPhotos(albumId, paths);
  return { ok: true, value: { added, alreadyPresent: paths.length - added } };
}

/**
 * Removes photographs from an album.
 *
 * Again: the FILES ARE NOT DELETED. This unfiles them, exactly as un-starring a
 * favourite does.
 */
export function removePhotosFromAlbum(
  repo: AlbumRepository,
  input: unknown,
): AlbumResult<{ removed: number }> {
  const { albumId, relativePaths } = albumPhotosSchema.parse(input);

  if (repo.get(albumId) === undefined) {
    return { ok: false, error: "That album no longer exists." };
  }

  const paths = relativePaths.map(normaliseRelativePath);
  return { ok: true, value: { removed: repo.removePhotos(albumId, paths) } };
}

/**
 * Rewrites an album's order.
 *
 * The incoming list must be exactly the album's current membership — same paths, no
 * more, no fewer. A reorder that quietly ADDED or DROPPED a photo because the client's
 * view was stale would be a data loss nobody could see, so the mismatch is refused and
 * the screen re-reads instead.
 */
export function reorderAlbumPhotos(
  repo: AlbumRepository,
  input: unknown,
): AlbumResult<null> {
  const { albumId, relativePaths } = albumOrderSchema.parse(input);

  if (repo.get(albumId) === undefined) {
    return { ok: false, error: "That album no longer exists." };
  }

  const paths = relativePaths.map(normaliseRelativePath);
  const current = repo.listPhotos(albumId).map((photo) => photo.relativePath);

  // Compared as SETS plus a length check, which together prove it is a permutation:
  // equal lengths and every incoming path present in the album means nothing was added
  // or dropped. A duplicate in the request fails the length test once de-duplicated.
  const currentSet = new Set(current);
  const incomingSet = new Set(paths);
  const isPermutation =
    paths.length === current.length &&
    incomingSet.size === paths.length &&
    paths.every((path) => currentSet.has(path));

  if (!isPermutation) {
    return {
      ok: false,
      error: "The album changed while you were rearranging it. It has been reloaded.",
    };
  }

  repo.setPhotoOrder(albumId, paths);
  return { ok: true, value: null };
}

/**
 * Which albums already contain a photograph — what the viewer's `+` menu ticks.
 *
 * A list of ids rather than of albums: the menu already holds every album to render
 * its rows, so returning whole records would be a second copy that can disagree with
 * the first. Same argument `isFavorite` makes for being a predicate.
 */
export function albumIdsContaining(repo: AlbumRepository, rawPath: unknown): number[] {
  const relativePath = normaliseRelativePath(albumPhotoPathSchema.parse(rawPath));
  return repo.albumIdsContaining(relativePath);
}
