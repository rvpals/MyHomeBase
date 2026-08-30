"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { recordScore } from "@/lib/games";
import { deps } from "@/lib/wiring";

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
