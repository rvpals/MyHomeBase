"use server";

import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import {
  listPhotoFoldersForDate,
  listPhotoFoldersForRange,
  listPhotosInFolder,
  photoFolderContentsSchema,
  photoFolderLookupSchema,
  photoRangeContentsSchema,
  photoRangeSchema,
  type PhotoFile,
  type PhotoFolder,
  type PhotoFolderLookup,
} from "@/lib/journal-photos";
import { deps } from "@/lib/wiring";
import { photoStore } from "../../journal-photo-root";

// Thin adapters over the journal-photos use-cases: validate, call, return. No logic.
//
// Both check the session themselves rather than leaning on the (protected) layout.
// The layout guards the *page*, but these reach the filesystem, so the check belongs
// on the call that does it — the same reasoning as the image route.

export interface PhotoFoldersResult {
  ok: boolean;
  error?: string;
  isAvailable?: boolean;
  // Reused from the use-case rather than restated, so a new cause cannot be added in
  // lib/ and silently dropped on the way to the UI.
  reason?: PhotoFolderLookup["reason"];
  rootPath?: string;
  folders?: PhotoFolder[];
}

export interface PhotoContentsResult {
  ok: boolean;
  error?: string;
  photos?: PhotoFile[];
  examined?: number;
  isEmptyAfterFilter?: boolean;
}

/** Which folders in the archive hold photos for an entry's date. Cheap: names only. */
export async function findPhotoFoldersAction(date: string): Promise<PhotoFoldersResult> {
  if (!(await hasSession())) return { ok: false, error: "Not signed in." };

  const parsed = photoFolderLookupSchema.safeParse({ date });
  if (!parsed.success) return { ok: false, error: "Not a valid entry date." };

  try {
    const result = await listPhotoFoldersForDate(photoStore(), parsed.data.date);
    return {
      ok: true,
      isAvailable: result.isAvailable,
      reason: result.reason,
      rootPath: result.rootPath,
      folders: result.folders,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Photo lookup failed." };
  }
}

/**
 * The photos in one folder that belong to the date.
 *
 * The expensive call for a month folder — it reads the head of every JPEG in it — which
 * is why the card only makes it when a folder is actually opened.
 */
export async function listPhotosInFolderAction(
  date: string,
  relativePath: string,
  includeAll = false,
): Promise<PhotoContentsResult> {
  if (!(await hasSession())) return { ok: false, error: "Not signed in." };

  const parsed = photoFolderContentsSchema.safeParse({ date, relativePath, includeAll });
  if (!parsed.success) return { ok: false, error: "Not a valid photo folder." };

  try {
    const result = await listPhotosInFolder(photoStore(), parsed.data);
    return {
      ok: true,
      photos: result.photos,
      examined: result.examined,
      isEmptyAfterFilter: result.isEmptyAfterFilter,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not read the folder." };
  }
}

async function hasSession(): Promise<boolean> {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  return getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo) !== undefined;
}

/**
 * Which folders in the archive hold photos anywhere in a date range.
 *
 * The range counterpart of `findPhotoFoldersAction`, and just as cheap: one directory
 * read per year the range touches, matching on names alone. The journal calendar's
 * month button is the caller.
 */
export async function findPhotoFoldersInRangeAction(
  from: string,
  to: string,
): Promise<PhotoFoldersResult> {
  if (!(await hasSession())) return { ok: false, error: "Not signed in." };

  const parsed = photoRangeSchema.safeParse({ from, to });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Not a valid date range." };
  }

  try {
    const result = await listPhotoFoldersForRange(photoStore(), parsed.data);
    return {
      ok: true,
      isAvailable: result.isAvailable,
      reason: result.reason,
      rootPath: result.rootPath,
      folders: result.folders,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Photo lookup failed." };
  }
}

/**
 * The photos in one folder that fall inside a date range.
 *
 * The expensive call for a month folder — it reads the head of every JPEG in it — which
 * is why the dialog only makes it when a folder is actually opened.
 */
export async function listPhotosInFolderForRangeAction(
  from: string,
  to: string,
  relativePath: string,
  includeAll = false,
): Promise<PhotoContentsResult> {
  if (!(await hasSession())) return { ok: false, error: "Not signed in." };

  const parsed = photoRangeContentsSchema.safeParse({ from, to, relativePath, includeAll });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Not a valid photo folder." };
  }

  try {
    const result = await listPhotosInFolder(photoStore(), parsed.data);
    return {
      ok: true,
      photos: result.photos,
      examined: result.examined,
      isEmptyAfterFilter: result.isEmptyAfterFilter,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not read the folder.",
    };
  }
}
