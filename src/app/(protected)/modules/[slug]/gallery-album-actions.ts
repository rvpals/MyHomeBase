"use server";

import {
  addPhotosToAlbum,
  albumIdsContaining,
  createAlbum,
  deleteAlbum,
  getAlbum,
  listAlbums,
  removePhotosFromAlbum,
  reorderAlbumPhotos,
  updateAlbum,
  type Album,
  type AlbumResult,
  type AlbumSummary,
  type AlbumWithPhotos,
} from "@/lib/albums";
import { deps } from "@/lib/wiring";
import { requireModuleAccess, requireUser } from "../../require-access";

// Thin adapters over the album use-cases. Each one authorises, validates through the
// module's own zod schema (inside the use-case), and returns the result — no logic
// here, per ARCHITECTURE.md. The same use-cases are reachable from the CLI unchanged.

/** The module these actions belong to, matched exactly by `requireModuleAccess`. */
const ACCESS_MODULE_SLUG = "picture-gallery";

// THE SPLIT IN THIS FILE, since these actions no longer share one guard.
//
// FILING a photo into an album is reachable from anywhere a photograph is shown — the
// gallery's own screens and the Journal entry's picture viewer, which both open the same
// `PhotoViewer` and so want the same `+` menu. Those four actions (list, which albums
// hold this path, add, create) authorise on a SESSION: a reader who can already see the
// picture through `/api/journal/photos` — session-checked, no module grant — gains only
// the ability to record a path they were already handed.
//
// MANAGING albums stays the Picture Gallery module's own work: renaming, reordering,
// deleting, pulling photos out, and reading one album's full contents. Those keep
// `requireModuleAccess`, because widening them would open POST endpoints no viewer asks
// for. Adding an action here means deciding which half it belongs to.

/**
 * Every album, with a photo count and a cover.
 *
 * What the Albums list re-reads after each write, and what the viewer's `+` menu
 * opens onto.
 */
export async function listAlbumsAction(): Promise<AlbumSummary[]> {
  await requireUser();
  return listAlbums(deps.albumRepo);
}

/** One album with its photographs in order — what the detail screen reads. */
export async function getAlbumAction(albumId: number): Promise<AlbumWithPhotos | undefined> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  return getAlbum(deps.albumRepo, albumId);
}

/**
 * Creates an album.
 *
 * Returns the use-case's `{ ok }` result rather than throwing on a duplicate name: the
 * screen prints "there is already an album called Croatia" next to the field that
 * caused it, and the `+` menu's inline create needs the new album's id to file the
 * photo into it straight away.
 */
export async function createAlbumAction(
  name: string,
  description: string,
): Promise<AlbumResult<Album>> {
  await requireUser();
  return createAlbum(deps.albumRepo, { name, description });
}

/** Renames an album and rewrites its description, in one write. */
export async function updateAlbumAction(
  albumId: number,
  name: string,
  description: string,
): Promise<AlbumResult<Album>> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  return updateAlbum(deps.albumRepo, { id: albumId, name, description });
}

/**
 * Deletes an album.
 *
 * The photographs are untouched — see `deleteAlbum`. The confirm dialog says so,
 * because "delete album" is a sentence a reader can reasonably read the other way.
 */
export async function deleteAlbumAction(albumId: number): Promise<AlbumResult<null>> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  return deleteAlbum(deps.albumRepo, albumId);
}

/**
 * Files photographs into an album, skipping any already there.
 *
 * One call for the whole selection rather than one per photo: forty sequential server
 * actions against an SMB-backed SQLite file is forty write locks, the same reason
 * `removeFavPhotosAction` takes a list.
 */
export async function addPhotosToAlbumAction(
  albumId: number,
  relativePaths: string[],
): Promise<AlbumResult<{ added: number; alreadyPresent: number }>> {
  await requireUser();
  return addPhotosToAlbum(deps.albumRepo, { albumId, relativePaths });
}

/** Unfiles photographs from an album. The files themselves are not deleted. */
export async function removePhotosFromAlbumAction(
  albumId: number,
  relativePaths: string[],
): Promise<AlbumResult<{ removed: number }>> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  return removePhotosFromAlbum(deps.albumRepo, { albumId, relativePaths });
}

/** Rewrites an album's order. Refused when the set no longer matches — see the use-case. */
export async function reorderAlbumPhotosAction(
  albumId: number,
  relativePaths: string[],
): Promise<AlbumResult<null>> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  return reorderAlbumPhotos(deps.albumRepo, { albumId, relativePaths });
}

/**
 * Which albums already hold this photograph — the ticks in the viewer's `+` menu.
 *
 * Ids rather than whole albums: the menu already holds every album to render its rows,
 * so returning records would be a second copy that can disagree with the first.
 */
export async function albumIdsContainingAction(relativePath: string): Promise<number[]> {
  await requireUser();
  return albumIdsContaining(deps.albumRepo, relativePath);
}
