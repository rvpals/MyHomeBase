import type { Track } from "@/lib/music";
import { describeGeneration, selectTracksForTarget } from "./generate";
import type { MagicCandidateSource, MagicListRepository } from "./ports";
import {
  generateMagicSchema,
  magicListIdSchema,
  magicListUpdateSchema,
  magicListWriteSchema,
} from "./schema";
import type { RandomSource } from "@/lib/shared/random";
import type {
  GeneratedPlaylist,
  MagicCriteria,
  MagicList,
  MagicListSummary,
} from "./types";

// The use-cases. Functions taking data and returning data -- callable identically from the
// web app and the CLI, which is the litmus test in ARCHITECTURE.md.

/** What every use-case here needs. Injected, so tests wire fakes instead of a database. */
export interface MagicDependencies {
  magicListRepo: MagicListRepository;
  candidateSource: MagicCandidateSource;
  /**
   * Defaults to Math.random at the call site, never here -- a default parameter inside
   * the function would make it impossible for a caller to be sure it injected one.
   */
  random: RandomSource;
}

/**
 * Why a use-case could not do what was asked.
 *
 * A returned value rather than a thrown error: "that name is taken" and "that list is
 * gone" are ordinary outcomes of a form, and both adapters need to render them. Throwing
 * would make the CLI print a stack trace for a typo.
 */
export type MagicFailure =
  | { kind: "duplicate-name"; name: string }
  | { kind: "no-such-list"; magicListId: number };

export type MagicResult<T> = { ok: true; value: T } | { ok: false; failure: MagicFailure };

/** Generates a playlist from criteria, without saving anything. */
export function generateMagicPlaylist(
  deps: MagicDependencies,
  input: unknown,
): GeneratedPlaylist & { criteria: MagicCriteria } {
  const criteria = generateMagicSchema.parse(input);
  const candidates = deps.candidateSource.listCandidates(criteria);
  const generated = selectTracksForTarget(candidates, criteria.targetSeconds, deps.random);
  return { ...generated, criteria };
}

/** How many tracks a criteria set matches, for the form's live preview. */
export function countMagicCandidates(deps: MagicDependencies, input: unknown): number {
  return deps.candidateSource.countCandidates(generateMagicSchema.parse(input));
}

/**
 * Saves a new list AND generates its first set in one step.
 *
 * One use-case rather than save-then-generate because a list saved with no tracks is a
 * state the UI would have to explain, and nobody saves criteria they have not just used.
 * `lastGeneratedAt` still distinguishes the two, for a list whose tracks were all pruned.
 */
export function saveMagicList(
  deps: MagicDependencies,
  input: unknown,
): MagicResult<{ magicList: MagicList; generated: GeneratedPlaylist }> {
  const parsed = magicListWriteSchema.parse(input);

  let magicListId: number;
  try {
    magicListId = deps.magicListRepo.createMagicList({
      name: parsed.name,
      description: parsed.description,
      criteria: parsed.criteria,
    });
  } catch {
    // The unique index on name is the realistic cause, and "already exists" is more use
    // to a listener than the driver's constraint text.
    return { ok: false, failure: { kind: "duplicate-name", name: parsed.name } };
  }

  const generated = regenerateInto(deps, magicListId, parsed.criteria);
  const magicList = deps.magicListRepo.getMagicList(magicListId);
  if (magicList === undefined) {
    // Cannot happen -- it was just inserted -- but returning a failure beats a non-null
    // assertion that would crash if it ever did.
    return { ok: false, failure: { kind: "no-such-list", magicListId } };
  }
  return { ok: true, value: { magicList, generated } };
}

/** Rewrites a saved list's name, description and criteria. Leaves its tracks alone. */
export function updateMagicList(deps: MagicDependencies, input: unknown): MagicResult<MagicList> {
  const parsed = magicListUpdateSchema.parse(input);
  if (deps.magicListRepo.getMagicList(parsed.magicListId) === undefined) {
    return { ok: false, failure: { kind: "no-such-list", magicListId: parsed.magicListId } };
  }

  try {
    deps.magicListRepo.updateMagicList(parsed.magicListId, {
      name: parsed.name,
      description: parsed.description,
      criteria: parsed.criteria,
    });
  } catch {
    return { ok: false, failure: { kind: "duplicate-name", name: parsed.name } };
  }

  const updated = deps.magicListRepo.getMagicList(parsed.magicListId);
  if (updated === undefined) {
    return { ok: false, failure: { kind: "no-such-list", magicListId: parsed.magicListId } };
  }
  return { ok: true, value: updated };
}

/**
 * Loads a saved list: its criteria, and the set it last generated.
 *
 * REPLAYS rather than re-rolls -- that is the point of storing the tracks
 * (migrations/0057). Re-rolling is `regenerateMagicList`, which the listener asks for
 * explicitly.
 */
export function loadMagicList(
  deps: MagicDependencies,
  input: unknown,
): MagicResult<{ magicList: MagicList; tracks: Track[] }> {
  const magicListId = magicListIdSchema.parse(input);
  const magicList = deps.magicListRepo.getMagicList(magicListId);
  if (magicList === undefined) {
    return { ok: false, failure: { kind: "no-such-list", magicListId } };
  }
  return {
    ok: true,
    value: { magicList, tracks: deps.magicListRepo.listGeneratedTracks(magicListId) },
  };
}

/**
 * Re-rolls a saved list from its own stored criteria, replacing its tracks.
 *
 * Reads the criteria from the row rather than taking them as an argument, so a regenerate
 * cannot silently apply criteria the listener never saved.
 */
export function regenerateMagicList(
  deps: MagicDependencies,
  input: unknown,
): MagicResult<{ magicList: MagicList; generated: GeneratedPlaylist }> {
  const magicListId = magicListIdSchema.parse(input);
  const magicList = deps.magicListRepo.getMagicList(magicListId);
  if (magicList === undefined) {
    return { ok: false, failure: { kind: "no-such-list", magicListId } };
  }

  const generated = regenerateInto(deps, magicListId, magicList.criteria);
  const refreshed = deps.magicListRepo.getMagicList(magicListId) ?? magicList;
  return { ok: true, value: { magicList: refreshed, generated } };
}

/** Generates for a list and stores the result. The one place a generated set is persisted. */
function regenerateInto(
  deps: MagicDependencies,
  magicListId: number,
  criteria: MagicCriteria,
): GeneratedPlaylist {
  const candidates = deps.candidateSource.listCandidates(criteria);
  const generated = selectTracksForTarget(candidates, criteria.targetSeconds, deps.random);
  deps.magicListRepo.saveGeneratedTracks(
    magicListId,
    generated.tracks.map((track) => track.id),
  );
  return generated;
}

export function listMagicLists(deps: MagicDependencies): MagicListSummary[] {
  return deps.magicListRepo.listMagicLists();
}

/** Deletes a saved list. No track row and no music file is touched. */
export function deleteMagicList(deps: MagicDependencies, input: unknown): MagicResult<true> {
  const magicListId = magicListIdSchema.parse(input);
  if (deps.magicListRepo.getMagicList(magicListId) === undefined) {
    return { ok: false, failure: { kind: "no-such-list", magicListId } };
  }
  deps.magicListRepo.deleteMagicList(magicListId);
  return { ok: true, value: true };
}

/** The options the three criteria pickers offer, read from the catalog. */
export function listMagicPickerOptions(deps: MagicDependencies) {
  return {
    genres: deps.candidateSource.listGenreOptions(),
    artists: deps.candidateSource.listArtistOptions(),
    albums: deps.candidateSource.listAlbumOptions(),
  };
}

/** A readable sentence for a failure, so both adapters word it identically. */
export function describeMagicFailure(failure: MagicFailure): string {
  if (failure.kind === "duplicate-name") {
    return `A magic list called "${failure.name}" already exists.`;
  }
  return "That magic list no longer exists.";
}

export { describeGeneration };
