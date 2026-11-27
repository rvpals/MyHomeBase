import { isSafeRelativePath, normaliseRelativePath } from "./paths";
import type { PhotoFileStore } from "./ports";
import type { PhotoRootCheck } from "./types";

// Use-case: one level of the photo archive, for the viewer's "Browse" tree.
//
// Sub-folders AND photographs, one level only. The tree expands a folder when the reader
// opens it, so the archive is never walked up front -- a recursive read here would list
// tens of thousands of files over SMB to draw a tree the reader looks at three branches
// of. Like `listAllPhotosInFolder`, it opens no file at all: it is two directory
// listings.
//
// The ROOT is `""`. That is the one place a blank path is legal: everywhere else a blank
// path is a mistake, which is why `isSafeRelativePath` rejects it and this function
// special-cases it rather than loosening the guard.

/** One level of the archive. */
export interface ArchiveFolderListing {
  /** The folder that was read, normalised. `""` is the archive root. */
  relativePath: string;
  isAvailable: boolean;
  /** Why nothing came back -- the same vocabulary as `FolderPhotos`. */
  reason?: PhotoRootCheck["kind"] | "missing" | "unsafe-path";
  /** Sub-folder names, sorted by the store. */
  folders: string[];
  /** JPEG file names directly inside, sorted by the store. */
  photos: string[];
}

/** Joins a folder and a child name in the archive's stored form. Root-aware. */
export function joinArchivePath(folder: string, name: string): string {
  const parent = normaliseRelativePath(folder);
  return parent === "" ? name : `${parent}/${name}`;
}

/**
 * Every ancestor folder of a path, root first, NOT including the root itself.
 *
 * `"2019/2019-06 June/IMG_1.jpg"` with `isFile` gives `["2019", "2019/2019-06 June"]` --
 * the folders the tree has to expand to show that photo. Used to open the tree on the
 * photo already on the stage.
 */
export function ancestorFolders(relativePath: string, isFile: boolean): string[] {
  const segments = normaliseRelativePath(relativePath).split("/").filter((s) => s !== "");
  const folderSegments = isFile ? segments.slice(0, -1) : segments;
  return folderSegments.map((_, i) => folderSegments.slice(0, i + 1).join("/"));
}

export async function listArchiveFolder(
  store: PhotoFileStore,
  input: { relativePath: string },
): Promise<ArchiveFolderListing> {
  const relativePath = normaliseRelativePath(input.relativePath);
  const empty = { relativePath, folders: [], photos: [] };

  // The root is the one blank path allowed. Any other path goes through the same
  // traversal guard every file read does.
  if (relativePath !== "" && !isSafeRelativePath(relativePath)) {
    return { ...empty, isAvailable: false, reason: "unsafe-path" };
  }

  const rootCheck = await store.checkRoot();
  if (rootCheck.kind !== "ok") {
    return { ...empty, isAvailable: false, reason: rootCheck.kind };
  }

  if (relativePath !== "" && !(await store.folderExists(relativePath))) {
    return { ...empty, isAvailable: false, reason: "missing" };
  }

  const [folders, photos] = await Promise.all([
    store.listFolderNames(relativePath),
    store.listPhotoNames(relativePath),
  ]);

  return { relativePath, isAvailable: true, folders, photos };
}
