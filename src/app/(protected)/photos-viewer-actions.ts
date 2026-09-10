"use server";

import {
  listAllPhotosInFolder,
  photoDetailsSchema,
  photoFolderAllSchema,
  readPhotoDetails,
  type PhotoDetails,
  type PhotoFile,
} from "@/lib/journal-photos";
import { photoStore } from "./modules/[slug]/journal-photo-root";
import { requireModuleAccess } from "./require-access";

/** The module these actions belong to, matched exactly by `requireModuleAccess`. */
const ACCESS_MODULE_SLUG = "picture-gallery";

// The boundary for `PhotosViewer`: one folder, in full.
//
// Separate from the journal's photo actions because it asks a different question. Those
// answer "which photos here belong to this date" for an entry; this one answers "what is
// in this folder" for a reader browsing it, and takes no date at all.

/** What the viewer gets back. Mirrors the journal actions' shape: `ok`, or a reason. */
export interface FolderPhotosResult {
  ok: boolean;
  photos?: PhotoFile[];
  error?: string;
}

/**
 * Every photograph in one folder.
 *
 * Cheap by construction -- a directory listing, no file opened -- so the viewer can call
 * it on open without the delay a month-folder EXIF scan would cost.
 *
 * The store is built per call by `photoStore()`, so correcting the archive path on the
 * Journal's configuration screen takes effect on the next open with no restart.
 */
export async function listAllPhotosInFolderAction(
  relativePath: string,
): Promise<FolderPhotosResult> {
  // Reports the denial rather than throwing, to keep this action's `{ ok }` contract.
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Not signed in." };
  }

  const parsed = photoFolderAllSchema.safeParse({ relativePath });
  if (!parsed.success) return { ok: false, error: "Not a valid photo folder." };

  try {
    const result = await listAllPhotosInFolder(photoStore(), parsed.data);
    if (!result.isAvailable) return { ok: false, error: messageFor(result.reason) };
    return { ok: true, photos: result.photos };
  } catch {
    // An SMB share that drops mid-listing lands here. Same vocabulary as the root
    // check, so the viewer has one set of reasons to render.
    return { ok: false, error: "The photo archive isn't answering." };
  }
}

/** What the viewer gets back when it asks about the photo on its stage. */
export interface PhotoDetailsResult {
  ok: boolean;
  details?: PhotoDetails;
  error?: string;
}

/**
 * The full path and capture timestamp of ONE photograph.
 *
 * Called per photo the reader actually looks at, not per photo in the folder -- see
 * `readPhotoDetails` for why that split is the performance design. The listing action
 * above opens no files at all; this one opens the first 128KB of exactly one.
 *
 * The path makes a round trip through the browser, so it is parsed here even though the
 * listing we served produced it. `photoDetailsSchema` runs the same
 * `isSafeRelativePath` refinement that guards the image route, and the use-case checks
 * it again before reading.
 */
export async function readPhotoDetailsAction(
  relativePath: string,
): Promise<PhotoDetailsResult> {
  // Reports the denial rather than throwing, to keep this action's `{ ok }` contract.
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Not signed in." };
  }

  const parsed = photoDetailsSchema.safeParse({ relativePath });
  if (!parsed.success) return { ok: false, error: "Not a valid photo path." };

  try {
    return { ok: true, details: await readPhotoDetails(photoStore(), parsed.data) };
  } catch {
    // The use-case already swallows a failed header read and reports "none", so this
    // only catches the store itself failing to construct -- an unset archive path.
    return { ok: false, error: "The photo archive isn't answering." };
  }
}

/**
 * A reason turned into something a reader can act on.
 *
 * Each case has a different fix, which is why the use-case carries a reason rather than
 * a boolean -- "set the path" and "the folder has moved" should not read the same.
 */
function messageFor(reason: string | undefined): string {
  switch (reason) {
    case "not-configured":
      return "The photo archive path isn't set yet.";
    case "missing":
      return "That folder isn't there any more — it may have been moved or renamed.";
    case "no-permission":
      return "The app isn't allowed to read that folder.";
    case "not-a-directory":
      return "The configured photo path isn't a folder.";
    case "unreachable":
      return "The photo archive isn't answering.";
    case "unsafe-path":
      return "That folder path isn't valid.";
    default:
      return "Couldn't read that folder.";
  }
}
