"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import {
  PICTIONARY_TIERS,
  autosaveChessGame,
  clearCustomWords,
  deleteChessGame,
  deleteCustomWord,
  discardArrowRun,
  discardChessAutosave,
  importWords,
  listChessGames,
  listChessRecords,
  loadArrowRun,
  loadChessAutosave,
  loadChessGame,
  lookupWordWizardDefinition,
  recordScore,
  saveArrowRun,
  recordChessResult,
  saveChessGame,
  type ChessGame,
  type ChessRecord,
  type ChessSaveSummary,
  type LoadedChessGame,
  type PictionaryImportSummary,
  type SavedArrowRun,
  type WordWizardDefinitionResult,
} from "@/lib/games";
import { deps } from "@/lib/wiring";
import { requireModuleAccess } from "../../require-access";

/** The module these actions belong to, matched exactly by `requireModuleAccess`. */
const ACCESS_MODULE_SLUG = "games";

// No logic here: each action resolves the player, validates through the module's zod
// schema (inside the use-case), and revalidates. The rules of 2048 live in
// src/lib/games/game-2048.ts and are never reimplemented in a view.

const GAMES_MODULE_PATH = "/modules/games";

export type SaveScoreResult = { ok: true; best: boolean } | { ok: false; error: string };

/**
 * Records a finished game against the signed-in user.
 *
 * The player is taken from the session, never from the client: a `userId` in the
 * request body would let anyone post a score in someone else's name onto a board that
 * is shared by design. `playedAt` is likewise stamped by the use-case.
 *
 * The board itself is not sent or re-simulated. A determined player can post any
 * number they like through this action — which is accepted deliberately for a
 * single-household arcade, where the scoreboard is a bit of fun rather than a
 * contested ranking. Verifying a score would mean replaying every move server-side
 * and is noted in the module's docs as the thing to do if that ever matters.
 */
export async function saveScoreAction(
  gameKey: string,
  score: number,
  moves: number,
): Promise<SaveScoreResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
    const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
    if (!currentUser) return { ok: false, error: "Sign in to save a score." };

    // Read the board's best BEFORE inserting, so the new row can't be its own
    // predecessor and every game would report itself as a record.
    const previousBest = deps.gamesRepo.getBestScore(gameKey)?.score ?? -1;

    const created = recordScore(deps.gamesRepo, {
      gameKey,
      userId: currentUser.id,
      score,
      moves,
    });

    revalidatePath(GAMES_MODULE_PATH);
    revalidatePath(`${GAMES_MODULE_PATH}/scores`);

    return { ok: true, best: created.score > previousBest };
  } catch (error) {
    // A zod failure (an unknown game key, a negative score) lands here rather than
    // surfacing as an unhandled server-action error in the browser console. The first
    // issue's message rather than `error.message`, which for a ZodError is the
    // serialized issue array — a wall of JSON in place of the schema's own wording.
    const issues = (error as { issues?: { message?: string }[] }).issues;
    const first = Array.isArray(issues) ? issues[0]?.message : undefined;
    return { ok: false, error: first ?? "Could not save that score." };
  }
}

export type ImportWordsResult =
  | { ok: true; summary: PictionaryImportSummary }
  | { ok: false; error: string };

/**
 * Saves a typed or pasted list of Pictionary words.
 *
 * The words are attributed to the signed-in user, taken from the session rather than
 * the body, so `created_by` cannot be forged.
 *
 * A list with a few unusable rows still imports the rest; the summary says what landed,
 * what was already there and which lines were rejected. See `importWords`.
 */
export async function importWordsAction(text: string, tier: string): Promise<ImportWordsResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
    const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
    if (!currentUser) return { ok: false, error: "Sign in to add words." };

    const summary = importWords(deps.pictionaryWordsRepo, {
      text,
      tier,
      userId: currentUser.id,
    });

    revalidatePath(`${GAMES_MODULE_PATH}/configuration`);
    // The Arcade reads the bank when a session starts, so a newly imported word should
    // be in play without a reload.
    revalidatePath(GAMES_MODULE_PATH);

    return { ok: true, summary };
  } catch (error) {
    const issues = (error as { issues?: { message?: string }[] }).issues;
    const first = Array.isArray(issues) ? issues[0]?.message : undefined;
    return { ok: false, error: first ?? "Could not save those words." };
  }
}

export type DeleteWordResult = { ok: true } | { ok: false; error: string };

/** Removes one custom word. */
export async function deleteWordAction(id: number): Promise<DeleteWordResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    const removed = deleteCustomWord(deps.pictionaryWordsRepo, id);
    if (!removed) return { ok: false, error: "That word is no longer there." };

    revalidatePath(`${GAMES_MODULE_PATH}/configuration`);
    revalidatePath(GAMES_MODULE_PATH);
    return { ok: true };
  } catch (error) {
    const issues = (error as { issues?: { message?: string }[] }).issues;
    const first = Array.isArray(issues) ? issues[0]?.message : undefined;
    return { ok: false, error: first ?? "Could not remove that word." };
  }
}

export type ClearWordsResult = { ok: true; removed: number } | { ok: false; error: string };

/**
 * Removes every custom word, or every one in a tier.
 *
 * Destructive and not undoable, so the view confirms before calling — there is no
 * recycle bin for words, since the list can be pasted back in.
 */
export async function clearWordsAction(tier?: string): Promise<ClearWordsResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    const parsedTier = PICTIONARY_TIERS.find((entry) => entry === tier);
    if (tier && !parsedTier) return { ok: false, error: "Unknown tier." };

    const removed = clearCustomWords(deps.pictionaryWordsRepo, parsedTier);

    revalidatePath(`${GAMES_MODULE_PATH}/configuration`);
    revalidatePath(GAMES_MODULE_PATH);
    return { ok: true, removed };
  } catch {
    return { ok: false, error: "Could not clear those words." };
  }
}

/* ---------------------------------------------------------------------------------
   Saved Arrows runs. The player always comes from the session, so nobody can read,
   write or delete another player's run.

   No `revalidatePath`: a saved run is only read through `loadArrowRunAction`, never
   by a server-rendered page, so there is nothing to refresh.
--------------------------------------------------------------------------------- */

/** The signed-in user's id, or undefined when the session has expired. */
async function sessionUserId(): Promise<number | undefined> {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  return getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo)?.id;
}

/** A zod error's first message, or the error's own message, or a fallback. */
function errorText(error: unknown, fallback: string): string {
  const issues = (error as { issues?: { message?: string }[] }).issues;
  if (Array.isArray(issues)) return issues[0]?.message ?? fallback;
  return error instanceof Error && error.message ? error.message : fallback;
}

export type SaveArrowRunResult = { ok: true; savedAt: string } | { ok: false; error: string };

/** Stores the player's Arrows run for its tier, replacing any earlier one. */
export async function saveArrowRunAction(save: unknown): Promise<SaveArrowRunResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    const userId = await sessionUserId();
    if (!userId) return { ok: false, error: "Sign in to save your run." };
    return { ok: true, ...saveArrowRun(deps.savedRunsRepo, { userId, save }) };
  } catch (error) {
    return { ok: false, error: errorText(error, "Could not save this run.") };
  }
}

export type LoadArrowRunResult =
  | { ok: true; run: SavedArrowRun | undefined }
  | { ok: false; error: string };

/** The player's saved run for one Arrows tier, if there is one. */
export async function loadArrowRunAction(difficulty: string): Promise<LoadArrowRunResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    const userId = await sessionUserId();
    if (!userId) return { ok: true, run: undefined };
    return { ok: true, run: loadArrowRun(deps.savedRunsRepo, { userId, difficulty }) };
  } catch (error) {
    return { ok: false, error: errorText(error, "Could not load the saved run.") };
  }
}

/** Deletes the player's saved run for one Arrows tier. */
export async function discardArrowRunAction(
  difficulty: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    const userId = await sessionUserId();
    if (!userId) return { ok: true };
    discardArrowRun(deps.savedRunsRepo, { userId, difficulty });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: errorText(error, "Could not discard the saved run.") };
  }
}

/* ---------------------------------------------------------------------------------
   Chess: an autosave and a library of named games.

   The player always comes from the session, so nobody can read, write or delete
   another player's game — the repository is scoped by that id as well, so there is no
   path here that could return somebody else's row to be filtered afterwards.

   No `revalidatePath` on any of these: a saved game is only ever read back through
   these actions, never by a server-rendered page, so there is nothing to refresh. The
   one exception is a finished game's score, which goes through `saveScoreAction` above
   and revalidates there.
--------------------------------------------------------------------------------- */

export type SaveChessGameResult =
  | { ok: true; id: number; savedAt: string }
  | { ok: false; error: string };

/** Stores a game under a name, replacing the player's save of the same name. */
export async function saveChessGameAction(
  name: string,
  save: unknown,
): Promise<SaveChessGameResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    const userId = await sessionUserId();
    if (!userId) return { ok: false, error: "Sign in to save a game." };
    return { ok: true, ...saveChessGame(deps.chessSavesRepo, { userId, name, save }) };
  } catch (error) {
    return { ok: false, error: errorText(error, "Could not save this game.") };
  }
}

export type ListChessGamesResult =
  | { ok: true; games: ChessSaveSummary[] }
  | { ok: false; error: string };

/** The player's saved games, newest first. */
export async function listChessGamesAction(): Promise<ListChessGamesResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    const userId = await sessionUserId();
    if (!userId) return { ok: true, games: [] };
    return { ok: true, games: listChessGames(deps.chessSavesRepo, { userId }) };
  } catch (error) {
    return { ok: false, error: errorText(error, "Could not read your saved games.") };
  }
}

export type LoadChessGameResult =
  | { ok: true; loaded: LoadedChessGame }
  | { ok: false; error: string };

/** One of the player's saved games, replayed through the rules. */
export async function loadChessGameAction(id: number): Promise<LoadChessGameResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    const userId = await sessionUserId();
    if (!userId) return { ok: false, error: "Sign in to load a game." };
    return { ok: true, loaded: loadChessGame(deps.chessSavesRepo, { userId, id }) };
  } catch (error) {
    return { ok: false, error: errorText(error, "Could not load that game.") };
  }
}

/** Deletes one of the player's saved games. */
export async function deleteChessGameAction(
  id: number,
): Promise<{ ok: true; removed: boolean } | { ok: false; error: string }> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    const userId = await sessionUserId();
    if (!userId) return { ok: false, error: "Sign in to delete a game." };
    return { ok: true, removed: deleteChessGame(deps.chessSavesRepo, { userId, id }) };
  } catch (error) {
    return { ok: false, error: errorText(error, "Could not delete that game.") };
  }
}

export type AutosaveChessResult = { ok: true; savedAt: string } | { ok: false; error: string };

/** Writes the player's autosave, replacing whatever was there. */
export async function autosaveChessAction(save: unknown): Promise<AutosaveChessResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    const userId = await sessionUserId();
    if (!userId) return { ok: false, error: "Sign in to save your game." };
    return { ok: true, ...autosaveChessGame(deps.savedRunsRepo, { userId, save }) };
  } catch (error) {
    return { ok: false, error: errorText(error, "Could not save this game.") };
  }
}

export type LoadChessAutosaveResult =
  | { ok: true; run: { savedAt: string; game: ChessGame } | undefined }
  | { ok: false; error: string };

/** The player's autosave, if there is one that can still be resumed. */
export async function loadChessAutosaveAction(): Promise<LoadChessAutosaveResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    const userId = await sessionUserId();
    if (!userId) return { ok: true, run: undefined };
    return { ok: true, run: loadChessAutosave(deps.savedRunsRepo, { userId }) };
  } catch (error) {
    return { ok: false, error: errorText(error, "Could not load the saved game.") };
  }
}

/** Deletes the player's autosave — pressed by New game, and when one finishes. */
export async function discardChessAutosaveAction(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    const userId = await sessionUserId();
    if (!userId) return { ok: true };
    discardChessAutosave(deps.savedRunsRepo, { userId });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: errorText(error, "Could not discard the saved game.") };
  }
}

export type ChessRecordsResult =
  | { ok: true; records: ChessRecord[] }
  | { ok: false; error: string };

/** The player's win/loss/draw record against each level. */
export async function listChessRecordsAction(): Promise<ChessRecordsResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    const userId = await sessionUserId();
    if (!userId) return { ok: true, records: [] };
    return { ok: true, records: listChessRecords(deps.chessResultsRepo, { userId }) };
  } catch (error) {
    return { ok: false, error: errorText(error, "Could not read your record.") };
  }
}

/**
 * Records how a finished game went.
 *
 * Separate from `saveScoreAction` because they record different facts: that one posts
 * what the game was *worth* to a board shared by the household, this one records what
 * *happened* to a record that is the player's own. A loss, a draw and a heavily hinted
 * win all score 0, so the scoreboard cannot tell them apart.
 */
export async function recordChessResultAction(
  level: string,
  result: string,
  moves: number,
  score: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    const userId = await sessionUserId();
    if (!userId) return { ok: false, error: "Sign in to keep a record." };
    recordChessResult(deps.chessResultsRepo, { userId, level, result, moves, score });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: errorText(error, "Could not record that game.") };
  }
}

/**
 * Looks up what a Word Wizard word means (Wiktionary, via the library). Only the word is
 * sent; validation, caching and every failure path live in `lookupWordWizardDefinition`.
 */
export async function lookupWordAction(word: string): Promise<WordWizardDefinitionResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  return lookupWordWizardDefinition({ word }, fetch);
}
