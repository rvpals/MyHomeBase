"use server";

import {
  configuredCullCeiling,
  cullFolder,
  cullRequestSchema,
  NodeCullingImageStore,
  type RejectedPhoto,
  type ScoredPhoto,
} from "@/lib/culling";
import { configuredPhotoRoot } from "../../journal-photo-root";
import { requireModuleAccess } from "../../../../require-access";

/** The module this action belongs to, matched exactly by `requireModuleAccess`. */
const JOURNAL_MODULE_SLUG = "journal";

// A thin adapter over the culling use-case: authorise, validate, call, return. No
// logic.
//
// Checks Journal module access itself rather than leaning on the (protected) layout.
// The layout guards the *page*, but an action is its own POST endpoint and this one
// reaches the filesystem, so the check belongs on the call that does it — the same
// reasoning as the photo lookups beside it.

/** One photo's verdict, flattened for the dialog. */
export interface CulledPhoto {
  /** The file's name, which is how the dialog's grid identifies a photo. */
  name: string;
  /** 0–1, higher is better. */
  score: number;
  /** The human-readable summary — "sharp, well exposed, low contrast". */
  reason: string;
  /** Whether this one survived. */
  isKeeper: boolean;
  /** Why it was set aside, absent on a keeper. */
  rejectReason?: RejectedPhoto["rejectReason"];
  /** The keeper it duplicates, when it lost to one. A file name, not a path. */
  duplicateOf?: string;
}

export interface CullResultForUi {
  ok: boolean;
  error?: string;
  /** Every photo that was scored, best first. */
  photos?: CulledPhoto[];
  /** How many were considered, including any that could not be read. */
  examined?: number;
  /** How many survived. */
  keeperCount?: number;
  /** Names that could not be decoded at all, so the dialog can say so. */
  unreadable?: string[];
}

/**
 * Scores the given photos of one folder and says which are worth keeping.
 *
 * READ-ONLY. This ranks pictures and returns the ranking; it never moves, deletes or
 * rewrites anything in the archive — see `lib/culling/ports.ts`.
 *
 * The caller passes the names it is *showing*, not the whole folder, because the
 * dialog has usually already filtered a month down to one day's pictures. Culling
 * decodes every file whole, so scoring the rest would cost minutes to answer a
 * question nobody asked.
 */
export async function cullPhotosAction(
  folder: string,
  names: string[],
): Promise<CullResultForUi> {
  if (!(await hasModuleAccess())) return { ok: false, error: "Not signed in." };

  const parsed = cullRequestSchema.safeParse({ folder, names });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Not a valid culling request." };
  }

  try {
    const result = await cullFolder(
      new NodeCullingImageStore(configuredPhotoRoot()),
      parsed.data.folder,
      // The ceiling is the stored setting, so an admin can correct it without a deploy.
      { only: parsed.data.names, maxImages: configuredCullCeiling() },
    );

    // Flattened to names because the dialog's grid is keyed on the file name, and a
    // keeper's full path would have to be re-derived there to match a row.
    const keepers: CulledPhoto[] = result.keepers.map((photo) => toCulledPhoto(photo, true));
    const rejects: CulledPhoto[] = result.rejects.map((photo) => ({
      ...toCulledPhoto(photo, false),
      rejectReason: photo.rejectReason,
      duplicateOf: photo.duplicateOf === undefined ? undefined : baseNameOf(photo.duplicateOf),
    }));

    return {
      ok: true,
      photos: [...keepers, ...rejects].sort((left, right) => right.score - left.score),
      examined: result.examined,
      keeperCount: result.keepers.length,
      unreadable: result.unreadable.map((photo) => photo.name),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Culling failed.",
    };
  }
}

function toCulledPhoto(photo: ScoredPhoto, isKeeper: boolean): CulledPhoto {
  return { name: photo.name, score: photo.score, reason: photo.reason, isKeeper };
}

/** The file name at the end of an archive-relative path. */
function baseNameOf(relativePath: string): string {
  return relativePath.split("/").pop() ?? relativePath;
}

/**
 * A session *and* a grant for the Journal module.
 *
 * Returns a boolean rather than throwing, because the caller reports the refusal
 * through its own `{ ok: false }` result. The slug is matched exactly.
 */
async function hasModuleAccess(): Promise<boolean> {
  try {
    await requireModuleAccess(JOURNAL_MODULE_SLUG);
    return true;
  } catch {
    return false;
  }
}
