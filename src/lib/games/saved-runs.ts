import { buildArrowSave, restoreArrowRun } from "./arrow-save";
import type { SavedRunRepository } from "./ports";
import {
  discardSavedRunSchema,
  listSavedRunsSchema,
  loadArrowRunSchema,
  saveArrowRunSchema,
} from "./schema";
import {
  ARROW_DIFFICULTY_SETUP,
  ARROW_SAVE_VERSION,
  arrowDifficultyOf,
  type SavedArrowRun,
  type SavedRunSummary,
  type StoredSavedRun,
} from "./types";

/**
 * Saved runs: a game in progress that its player can leave and come back to.
 *
 * Only Arrow Clearing uses this so far. The table and the repository take any game key;
 * each game adds its own save/restore functions and its own pair of use-cases here.
 */

/**
 * The largest save that will be stored, in characters of JSON. Well above the ~25 KB
 * a full Nightmare board needs.
 */
export const MAX_SAVED_RUN_CHARS = 400_000;

/**
 * Stores the signed-in player's run for one Arrows tier, replacing any earlier save
 * for that tier.
 *
 * The save is replayed before it is stored, so only a run that can actually be resumed
 * gets written. Throws when the input fails the schema, is too large, can't be
 * restored, or has already finished.
 */
export function saveArrowRun(repo: SavedRunRepository, input: unknown): { savedAt: string } {
  const { userId, save } = saveArrowRunSchema.parse(input);

  const restored = restoreArrowRun(save);
  if (!restored.ok) throw new Error(restored.reason);

  const state = JSON.stringify(save);
  if (state.length > MAX_SAVED_RUN_CHARS) throw new Error("That run is too large to save.");

  const savedAt = new Date().toISOString();
  repo.upsertSavedRun({
    userId,
    gameKey: ARROW_DIFFICULTY_SETUP[save.difficulty].gameKey,
    formatVersion: ARROW_SAVE_VERSION,
    state,
    savedAt,
  });
  return { savedAt };
}

/**
 * The player's saved run for one Arrows tier, or undefined when there is none.
 *
 * A stored save that can't be restored (old version, damaged, already finished) is
 * deleted here and reported as "no save". It could never be resumed, and keeping it
 * would only show the player the same failure every time they opened the tier.
 */
export function loadArrowRun(repo: SavedRunRepository, input: unknown): SavedArrowRun | undefined {
  const { userId, difficulty } = loadArrowRunSchema.parse(input);
  const gameKey = ARROW_DIFFICULTY_SETUP[difficulty].gameKey;

  const row = repo.getSavedRun(userId, gameKey);
  if (!row) return undefined;

  const loaded = readArrowRow(row);
  if (!loaded) {
    repo.deleteSavedRun(userId, gameKey);
    return undefined;
  }
  return loaded;
}

/**
 * Deletes the player's saved run for one Arrows tier. Returns whether there was one.
 *
 * Takes a tier rather than a game key, so the board's own Discard can only ever
 * remove an Arrows save.
 */
export function discardArrowRun(repo: SavedRunRepository, input: unknown): boolean {
  const { userId, difficulty } = loadArrowRunSchema.parse(input);
  return repo.deleteSavedRun(userId, ARROW_DIFFICULTY_SETUP[difficulty].gameKey);
}

/** Deletes a player's saved run for one game. Returns whether there was one. */
export function discardSavedRun(repo: SavedRunRepository, input: unknown): boolean {
  const { userId, gameKey } = discardSavedRunSchema.parse(input);
  return repo.deleteSavedRun(userId, gameKey);
}

/** Every saved run, or one player's, newest first, with how far along each one is. */
export function listSavedRuns(repo: SavedRunRepository, input: unknown = {}): SavedRunSummary[] {
  const { userId } = listSavedRunsSchema.parse(input);
  return repo.listSavedRuns(userId).map((row) => {
    const loaded = arrowDifficultyOf(row.gameKey) ? readArrowRow(row) : undefined;
    return {
      userId: row.userId,
      userName: row.userName,
      gameKey: row.gameKey,
      savedAt: row.savedAt,
      cleared: loaded?.cleared ?? 0,
      remaining: loaded?.remaining ?? 0,
      restorable: loaded !== undefined,
    };
  });
}

/**
 * Decodes and replays one stored Arrows row, or returns undefined when it can't be
 * resumed. Also undefined when the row's tier doesn't match its game key, which can
 * only happen if the row was edited by hand.
 */
function readArrowRow(row: StoredSavedRun): SavedArrowRun | undefined {
  if (row.formatVersion !== ARROW_SAVE_VERSION) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(row.state);
  } catch {
    return undefined;
  }

  const restored = restoreArrowRun(parsed);
  if (!restored.ok) return undefined;
  if (ARROW_DIFFICULTY_SETUP[restored.run.difficulty].gameKey !== row.gameKey) return undefined;

  const { run } = restored;
  return {
    savedAt: row.savedAt,
    // Rebuilt from the restored run rather than passing on the raw JSON, so any extra
    // fields in the stored text never reach the client.
    save: buildArrowSave(run),
    cleared: run.cleared,
    remaining: run.board.arrows.length,
  };
}
