"use server";

import {
  createTimedPhotoReader,
  serverResizeTestSchema,
  testServerResizeImage,
} from "@/lib/code-test";
import {
  listAllPhotosInFolder,
  listPhotoFoldersForDate,
  photoFolderAllSchema,
  photoFolderLookupSchema,
  type PhotoFile,
  type PhotoFolder,
} from "@/lib/journal-photos";
import { deps } from "@/lib/wiring";
import { photoStore } from "../../modules/[slug]/journal-photo-root";
import { requireAdmin } from "../../require-access";

// Administration -> Code Tester. Thin adapters: authorise, validate, call lib, return.
//
// The two listing actions reuse the archive's existing date-based browsing
// (`listPhotoFoldersForDate`, `listAllPhotosInFolder`), but are their own ADMIN-gated
// endpoints: the Journal and Gallery actions that make the same calls check module
// access, and an administrator testing the server need not have either module.

export interface CodeTestFoldersResult {
  ok: boolean;
  error?: string;
  folders?: PhotoFolder[];
}

export interface CodeTestPhotosResult {
  ok: boolean;
  error?: string;
  photos?: PhotoFile[];
}

export interface CodeTestReportResult {
  ok: boolean;
  error?: string;
  report?: string;
}

/** The archive folders for one date -- the picker's first step. Names only, cheap. */
export async function listCodeTestFoldersAction(date: string): Promise<CodeTestFoldersResult> {
  await requireAdmin();
  const parsed = photoFolderLookupSchema.safeParse({ date });
  if (!parsed.success) return { ok: false, error: "Not a valid date." };

  try {
    const lookup = await listPhotoFoldersForDate(photoStore(), parsed.data.date);
    if (!lookup.isAvailable) {
      return { ok: false, error: `The photo archive isn't available (${lookup.reason ?? "unknown"}).` };
    }
    return { ok: true, folders: lookup.folders };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Folder lookup failed." };
  }
}

/** Every photo in one folder -- the picker's second step. A directory listing, no file opened. */
export async function listCodeTestPhotosAction(relativePath: string): Promise<CodeTestPhotosResult> {
  await requireAdmin();
  const parsed = photoFolderAllSchema.safeParse({ relativePath });
  if (!parsed.success) return { ok: false, error: "Not a valid photo folder." };

  try {
    const result = await listAllPhotosInFolder(photoStore(), parsed.data);
    if (!result.isAvailable) {
      return { ok: false, error: `That folder isn't readable (${result.reason ?? "unknown"}).` };
    }
    return { ok: true, photos: result.photos };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Folder listing failed." };
  }
}

/**
 * Runs the server-resize experiment on one photo.
 *
 * The report carries its own errors as lines, so `ok: false` here means only that the
 * INPUT was refused before anything ran.
 */
export async function runServerResizeTestAction(relativePath: string): Promise<CodeTestReportResult> {
  await requireAdmin();
  const parsed = serverResizeTestSchema.safeParse({ relativePath });
  if (!parsed.success) {
    return { ok: false, error: "That isn't a path relative to the photo root." };
  }

  const report = await testServerResizeImage(
    {
      reader: createTimedPhotoReader(photoStore()),
      imageLib: deps.codeTestImageLib,
      now: () => performance.now(),
    },
    parsed.data,
  );
  return { ok: true, report };
}
