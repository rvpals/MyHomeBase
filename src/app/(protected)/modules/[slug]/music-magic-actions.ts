"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import type { Track } from "@/lib/music";
import {
  countMagicCandidates,
  deleteMagicList,
  describeGeneration,
  describeMagicFailure,
  generateMagicPlaylist,
  listMagicFolderOptions,
  listMagicLists,
  listMagicPickerOptions,
  loadMagicList,
  regenerateMagicList,
  saveMagicList,
  updateMagicList,
  type MagicCriteria,
  type MagicDependencies,
  type MagicFolderOption,
  type MagicGenerationStats,
  type MagicListSummary,
} from "@/lib/music-magic";
import { deps } from "@/lib/wiring";

// Server actions for Magic Playlists. Thin on purpose: validate at the boundary, call a
// use-case, return data. Nothing here decides anything -- the decisions live in
// src/lib/music-magic.

const MUSIC_LIBRARY_PATH = "/modules/music-library/magic";

async function requireUser() {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  if (!currentUser) throw new Error("Not signed in.");
  return currentUser;
}

/**
 * The dependency bundle the use-cases take.
 *
 * `Math.random` is injected HERE rather than defaulted inside the library, so the library
 * has no ambient randomness and a test can hand it a deterministic source.
 */
function magicDeps(): MagicDependencies {
  return {
    magicListRepo: deps.magicListRepo,
    candidateSource: deps.magicCandidateSource,
    random: Math.random,
  };
}

/**
 * A track as the player needs it.
 *
 * The player takes `PlayableTrack`, which is a narrower shape than `Track` -- mapping here
 * rather than sending whole catalog rows keeps 50 unused fields off the wire per track.
 */
export interface MagicPlaylistTrack {
  id: number;
  title: string;
  artist: string;
  album: string;
  albumId?: number;
  durationSeconds?: number;
  isStreamable: boolean;
}

function toPlaylistTrack(track: Track): MagicPlaylistTrack {
  return {
    id: track.id,
    title: track.displayTitle,
    artist: track.artist,
    album: track.album,
    albumId: track.albumId,
    durationSeconds: track.durationSeconds,
    isStreamable: track.isStreamable,
  };
}

export interface MagicGenerationResult {
  tracks: MagicPlaylistTrack[];
  stats: MagicGenerationStats;
  /** The library's own wording for how it went, so the CLI and the web agree. */
  message: string;
}

/** The options the three flat criteria pickers offer. */
export async function listMagicOptionsAction() {
  await requireUser();
  return listMagicPickerOptions(magicDeps());
}

/**
 * One level of the folder picker: the folders directly inside `parentPath`.
 *
 * A separate call from `listMagicOptionsAction`, and called again on every drill-down,
 * because the folder tree is walked rather than fetched whole -- see the note on
 * `MagicCandidateSource.listFolderOptions`.
 */
export async function listMagicFolderOptionsAction(
  parentPath: string,
): Promise<MagicFolderOption[]> {
  await requireUser();
  return listMagicFolderOptions(magicDeps(), parentPath);
}

/** Generates a playlist from criteria, saving nothing. */
export async function generateMagicAction(criteria: unknown): Promise<MagicGenerationResult> {
  await requireUser();
  const generated = generateMagicPlaylist(magicDeps(), criteria);
  return {
    tracks: generated.tracks.map(toPlaylistTrack),
    stats: generated.stats,
    message: describeGeneration(generated.stats),
  };
}

/** How many tracks the current criteria match, for the form's live count. */
export async function countMagicCandidatesAction(criteria: unknown): Promise<number> {
  await requireUser();
  return countMagicCandidates(magicDeps(), criteria);
}

export async function listMagicListsAction(): Promise<MagicListSummary[]> {
  await requireUser();
  return listMagicLists(magicDeps());
}

export interface SavedMagicListResult {
  magicListId: number;
  name: string;
  description: string;
  criteria: MagicCriteria;
  tracks: MagicPlaylistTrack[];
  stats?: MagicGenerationStats;
  message?: string;
}

/** Saves criteria under a name and generates the first set. */
export async function saveMagicListAction(input: {
  name: string;
  description?: string;
  criteria: unknown;
}): Promise<SavedMagicListResult | { error: string }> {
  await requireUser();
  const result = saveMagicList(magicDeps(), input);
  if (!result.ok) return { error: describeMagicFailure(result.failure) };

  revalidatePath(MUSIC_LIBRARY_PATH);
  const { magicList, generated } = result.value;
  return {
    magicListId: magicList.id,
    name: magicList.name,
    description: magicList.description,
    criteria: magicList.criteria,
    tracks: generated.tracks.map(toPlaylistTrack),
    stats: generated.stats,
    message: describeGeneration(generated.stats),
  };
}

/** Rewrites a saved list's name, description and criteria. Does not regenerate. */
export async function updateMagicListAction(input: {
  magicListId: number;
  name: string;
  description?: string;
  criteria: unknown;
}): Promise<{ ok: true } | { error: string }> {
  await requireUser();
  const result = updateMagicList(magicDeps(), input);
  if (!result.ok) return { error: describeMagicFailure(result.failure) };
  revalidatePath(MUSIC_LIBRARY_PATH);
  return { ok: true };
}

/** Loads a saved list: its criteria, and the set it last generated. Replays, never re-rolls. */
export async function loadMagicListAction(
  magicListId: number,
): Promise<SavedMagicListResult | { error: string }> {
  await requireUser();
  const result = loadMagicList(magicDeps(), magicListId);
  if (!result.ok) return { error: describeMagicFailure(result.failure) };

  const { magicList, tracks } = result.value;
  return {
    magicListId: magicList.id,
    name: magicList.name,
    description: magicList.description,
    criteria: magicList.criteria,
    tracks: tracks.map(toPlaylistTrack),
  };
}

/** Re-rolls a saved list from its own stored criteria, replacing its tracks. */
export async function regenerateMagicListAction(
  magicListId: number,
): Promise<SavedMagicListResult | { error: string }> {
  await requireUser();
  const result = regenerateMagicList(magicDeps(), magicListId);
  if (!result.ok) return { error: describeMagicFailure(result.failure) };

  revalidatePath(MUSIC_LIBRARY_PATH);
  const { magicList, generated } = result.value;
  return {
    magicListId: magicList.id,
    name: magicList.name,
    description: magicList.description,
    criteria: magicList.criteria,
    tracks: generated.tracks.map(toPlaylistTrack),
    stats: generated.stats,
    message: describeGeneration(generated.stats),
  };
}

/** Deletes a saved list. No track row and no music file is touched. */
export async function deleteMagicListAction(
  magicListId: number,
): Promise<{ ok: true } | { error: string }> {
  await requireUser();
  const result = deleteMagicList(magicDeps(), magicListId);
  if (!result.ok) return { error: describeMagicFailure(result.failure) };
  revalidatePath(MUSIC_LIBRARY_PATH);
  return { ok: true };
}
