import { isSafeRelativePath, normaliseRelativePath } from "./paths";
import type { PhotoFileStore } from "./ports";
import type { FolderPhotos } from "./types";

// Use-case: every photograph in one folder, with no date filtering at all.
//
// The counterpart to `listPhotosInFolder`, and deliberately a separate function rather
// than another flag on it. That one answers "which photos in this folder belong to this
// date", which for a month folder means reading the head of every JPEG for its EXIF
// timestamp. This one answers "what is in this folder" -- a question a directory
// listing settles on its own, with no file ever opened.
//
// Keeping them apart is what makes the cost obvious at the call site: the viewer browses
// a folder, so it must never pay for a month scan it is going to discard. There is no
// `date`, `from` or `to` here to pass by accident.

/**
 * Every JPEG directly inside `relativePath`, in the store's sorted order.
 *
 * Flat, like the archive's two folder conventions: no recursion, so a year folder full
 * of event folders reports no photos rather than the whole year's. That is the honest
 * answer for a viewer browsing one folder.
 *
 * An unsafe path is refused here as well as at the boundary schema and again in
 * `NodePhotoFileStore`. Belt and braces on any path that becomes a file read -- the
 * same reasoning the image route documents.
 */
export async function listAllPhotosInFolder(
  store: PhotoFileStore,
  input: { relativePath: string },
): Promise<FolderPhotos> {
  const relativePath = normaliseRelativePath(input.relativePath);

  if (!isSafeRelativePath(relativePath)) {
    return { relativePath, isAvailable: false, reason: "unsafe-path", photos: [] };
  }

  const rootCheck = await store.checkRoot();
  if (rootCheck.kind !== "ok") {
    return { relativePath, isAvailable: false, reason: rootCheck.kind, photos: [] };
  }

  // Checked before listing so a folder that has been moved or renamed reads as
  // "missing" rather than as an empty folder. The viewer says two different things.
  if (!(await store.folderExists(relativePath))) {
    return { relativePath, isAvailable: false, reason: "missing", photos: [] };
  }

  const names = await store.listPhotoNames(relativePath);

  return {
    relativePath,
    isAvailable: true,
    photos: names.map((name) => ({
      name,
      relativePath: `${relativePath}/${name}`,
      // Membership is the whole evidence: the reader asked for this folder, not for a
      // date. `folder` keeps the shape identical to `listPhotosInFolder`'s output so a
      // caller can render either without branching.
      matchedBy: "folder" as const,
    })),
  };
}
