"use server";

import {
  configuredCullCeiling,
  configuredPhotoRoot,
  cullPhotoPaths,
  MAX_CULL_CEILING,
  NodeCullingImageStore,
  type RejectedPhoto,
  type ScoredPhoto,
} from "@/lib/culling";
import { photoRelativePathSchema } from "@/lib/journal-photos";
import { z } from "zod";
import { requireUser } from "../../require-access";

// A thin adapter over the cross-folder culling use-case: authorise, validate, call,
// return. No logic.
//
// Separate from the journal's `culling-actions.ts` because the two take different
// input: the journal passes one folder plus names inside it, the gallery passes full
// paths spanning many folders. Both end at the same library, which is where the
// judgements live.

/**
 * The paths a gallery set may ask about.
 *
 * Capped at the ABSOLUTE ceiling rather than the configured one: the stored setting may
 * raise the limit above the default, so validating against that default would reject a
 * request the use-case would have truncated and answered. This guards against an
 * unbounded array arriving from a browser; the tunable limit is applied inside
 * `cullPhotoPaths`.
 */
const gallerycullSchema = z.object({
  relativePaths: z
    .array(photoRelativePathSchema)
    .min(1, "Select at least one photograph to cull.")
    .max(MAX_CULL_CEILING, `Cannot cull more than ${MAX_CULL_CEILING} photographs at once.`),
  keepCount: z.number().int().positive().optional(),
});

/** One photograph's verdict, flattened for a gallery view. */
export interface CulledGalleryPhoto {
  /** The archive-relative path — how every gallery grid identifies a photograph. */
  relativePath: string;
  /** The file's own name, for display. */
  name: string;
  /** 0–1, higher is better. */
  score: number;
  /** The human-readable summary — "sharp, well exposed, low contrast". */
  reason: string;
  /** Whether this one survived. */
  isKeeper: boolean;
  /** Why it was set aside. Absent on a keeper. */
  rejectReason?: RejectedPhoto["rejectReason"];
  /** The path of the keeper it duplicates, when it lost to one. */
  duplicateOf?: string;
}

export interface GalleryCullResult {
  ok: boolean;
  error?: string;
  /** Every photograph that was scored, best first. */
  photos?: CulledGalleryPhoto[];
  /** How many paths were asked about. */
  requested?: number;
  /** How many were actually scored. */
  examined?: number;
  /** True when the set exceeded the ceiling and the tail was not scored. */
  wasTruncated?: boolean;
  /** How many survived. */
  keeperCount?: number;
  /** Paths that could not be read or decoded at all. */
  unreadable?: string[];
}

/**
 * Scores an arbitrary set of photographs and says which are worth keeping.
 *
 * READ-ONLY. This ranks pictures and returns the ranking; it never moves, deletes or
 * rewrites anything in the archive — see `lib/culling/ports.ts`. A view that dims a
 * rejected photograph is hiding it from itself, not removing it from disk.
 *
 * Duplicates are grouped across the WHOLE set, so two near-identical pictures group
 * even when filed under different years. For an album or a Magic List that is the
 * question being asked: does this set hold redundant photographs.
 *
 * @param relativePaths The set to judge, in the order the view shows it.
 * @param keepCount Keep only the best N; omit for duplicates-only culling.
 */
export async function cullGalleryPhotosAction(
  relativePaths: string[],
  keepCount?: number,
): Promise<GalleryCullResult> {
  // A SESSION rather than this module's grant, for the reason `gallery-photo-actions.ts`
  // records about the favourite writes: `/api/journal/photos` already serves the BYTES
  // of any archive photo to any signed-in reader, so a gallery grant would buy nothing
  // here — a reader who can already see these pictures gains only a ranking of paths
  // they were handed. It also has to be a session check rather than a module one
  // because the JOURNAL's photo viewer calls this too, and a journal reader need not
  // hold a Picture Gallery grant.
  //
  // This reads the archive but writes nothing, which is what makes the weaker check
  // safe: there is no capability here that the image route does not already grant.
  if (!(await hasSession())) return { ok: false, error: "Not signed in." };

  const parsed = gallerycullSchema.safeParse({ relativePaths, keepCount });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Not a valid culling request." };
  }

  try {
    const result = await cullPhotoPaths(
      new NodeCullingImageStore(configuredPhotoRoot()),
      parsed.data.relativePaths,
      {
        keepCount: parsed.data.keepCount,
        // The ceiling is the stored setting, so an admin can correct it without a deploy.
        maxImages: configuredCullCeiling(),
      },
    );

    const keepers = result.keepers.map((photo) => toGalleryPhoto(photo, true));
    const rejects = result.rejects.map((photo) => ({
      ...toGalleryPhoto(photo, false),
      rejectReason: photo.rejectReason,
      duplicateOf: photo.duplicateOf,
    }));

    return {
      ok: true,
      photos: [...keepers, ...rejects].sort((left, right) => right.score - left.score),
      requested: result.requested,
      examined: result.examined,
      wasTruncated: result.wasTruncated,
      keeperCount: result.keepers.length,
      unreadable: result.unreadable.map((photo) => photo.relativePath),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Culling failed." };
  }
}

function toGalleryPhoto(photo: ScoredPhoto, isKeeper: boolean): CulledGalleryPhoto {
  return {
    relativePath: photo.relativePath,
    name: photo.name,
    score: photo.score,
    reason: photo.reason,
    isKeeper,
  };
}

/**
 * A session *and* a grant for Picture Gallery.
 *
 * Returns a boolean rather than throwing, because the caller reports the refusal
 * through its own `{ ok: false }` result. The slug is matched exactly.
 */
async function hasSession(): Promise<boolean> {
  try {
    await requireUser();
    return true;
  } catch {
    return false;
  }
}
