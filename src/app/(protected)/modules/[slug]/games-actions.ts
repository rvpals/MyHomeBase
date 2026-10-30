"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import {
  PICTIONARY_TIERS,
  clearCustomWords,
  deleteCustomWord,
  importWords,
  recordScore,
  type PictionaryImportSummary,
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
