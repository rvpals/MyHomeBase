import { isChessGameOver, replayChessMoves } from "./game-chess";
import type { ChessSaveRepository, SavedRunRepository } from "./ports";
import {
  autosaveChessSchema,
  chessPlayerSchema,
  chessSaveIdSchema,
  chessSaveSchema,
  MAX_CHESS_SAVE_CHARS,
  saveChessGameSchema,
} from "./schema";
import {
  CHESS_GAME_KEY,
  CHESS_SAVE_VERSION,
  MAX_CHESS_SAVES_PER_PLAYER,
  type ChessGame,
  type ChessSave,
  type ChessSaveSummary,
  type LoadedChessGame,
  type StoredChessSave,
} from "./types";

/**
 * Saving and loading chess games.
 *
 * **Two stores, deliberately**, because they answer different questions:
 *
 * - The **autosave** lives in `gam_saved_runs` (migration 0171) under the `chess` game
 *   key — one row per player, replaced on every write. It answers "put me back where I
 *   was", which is exactly the question that table already exists for, and Arrow
 *   Clearing's Resume prompt is the shape it takes on screen.
 * - **Named saves** live in `gam_chess_saves` (migration 0173) — many rows per player.
 *   They answer "keep this game so I can come back to it", which is a library rather
 *   than a resume point.
 *
 * Both store the same `ChessSave` JSON through the same build/restore pair, so a game
 * saved either way is the same bytes and the same replay. Only the row differs.
 */

/** A game as it is stored: where it started, who was who, and the moves. */
export function buildChessSave(game: ChessGame): ChessSave {
  return {
    version: CHESS_SAVE_VERSION,
    initialFen: game.initialFen,
    humanColor: game.humanColor,
    level: game.level,
    moves: game.moves.map((move) => move.uci),
    // Written only when there is something to record, so an unassisted game's save
    // stays identical to one from before assists were counted.
    ...(game.hintsUsed > 0 ? { hintsUsed: game.hintsUsed } : {}),
    ...(game.takebacksUsed > 0 ? { takebacksUsed: game.takebacksUsed } : {}),
    // Omitted entirely for an untimed game, so its save is byte-identical to one
    // written before clocks existed.
    ...(game.clock ? { clock: game.clock } : {}),
  };
}

export type ChessRestoreResult =
  | { ok: true; game: ChessGame }
  | { ok: false; reason: string };

/**
 * A stored save back into a game, or a reason it cannot be.
 *
 * Two gates, and both are needed. The schema checks the *shape* — that this is a chess
 * save at all, that the moves look like moves, that it is not enormous. The replay then
 * checks the *content*, by playing every move through the rules: a save whose moves are
 * not all legal from the position it claims to start in is refused at the move that
 * does not fit, rather than producing an impossible board.
 *
 * Takes `unknown` because every caller is handing it something read from a database
 * row or a request body.
 */
export function restoreChessGame(raw: unknown): ChessRestoreResult {
  const parsed = chessSaveSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: "That saved game is not in a format this version reads." };
  }

  const save = parsed.data;
  if (save.version !== CHESS_SAVE_VERSION) {
    return { ok: false, reason: "That game was saved by a different version." };
  }

  return replayChessMoves({
    initialFen: save.initialFen,
    humanColor: save.humanColor,
    level: save.level,
    moves: save.moves,
    clock: save.clock,
    hintsUsed: save.hintsUsed,
    takebacksUsed: save.takebacksUsed,
  });
}

/**
 * Stores a named game for the signed-in player, replacing one of the same name.
 *
 * The save is **replayed before it is written**, so only a game that can actually be
 * loaded gets stored — the rule migration 0171 set for Arrow Clearing, and it matters
 * more here because a chess save is written by hand from a dialog rather than
 * automatically.
 *
 * A finished game is refused. The point of a save is to come back to it, and a stored
 * checkmate is a game nobody can continue; PGN export is how a finished game is kept.
 */
export function saveChessGame(
  repo: ChessSaveRepository,
  input: unknown,
): { id: number; savedAt: string } {
  const { userId, name, save } = saveChessGameSchema.parse(input);

  const restored = restoreChessGame(save);
  if (!restored.ok) throw new Error(restored.reason);
  if (isChessGameOver(restored.game)) {
    throw new Error("That game has finished, so there is nothing to come back to.");
  }

  const state = JSON.stringify(save);
  if (state.length > MAX_CHESS_SAVE_CHARS) throw new Error("That game is too large to save.");

  // The cap is checked against what *replacing* would leave, not against the current
  // count: overwriting a save adds no row, so a player at the limit must still be able
  // to save over a game they are in the middle of.
  const existing = repo.findChessSaveByName(userId, name);
  if (!existing && repo.countChessSaves(userId) >= MAX_CHESS_SAVES_PER_PLAYER) {
    throw new Error(
      `You already have ${MAX_CHESS_SAVES_PER_PLAYER} saved games. Delete one, or save over it.`,
    );
  }

  const savedAt = new Date().toISOString();
  const written = repo.upsertChessSave({
    userId,
    name,
    formatVersion: CHESS_SAVE_VERSION,
    state,
    savedAt,
  });
  return { id: written, savedAt };
}

/**
 * One of the player's saved games, restored, or undefined when there is no such row.
 *
 * Scoped by `userId` in the repository rather than filtered here: a save is private,
 * and a read that could return somebody else's row and then be checked is one `if` away
 * from a leak. Same shape as the Scratchpad's per-reader port.
 *
 * A row that cannot be restored is reported as an error rather than silently deleted —
 * the opposite of `loadArrowRun`, and on purpose. An Arrows autosave is disposable, so
 * clearing a broken one costs nothing; a game somebody named and kept is not, and
 * deleting it because this build could not read it would destroy it with no way back.
 */
export function loadChessGame(repo: ChessSaveRepository, input: unknown): LoadedChessGame {
  const { userId, id } = chessSaveIdSchema.parse(input);

  const row = repo.getChessSave(userId, id);
  if (!row) throw new Error("That saved game is no longer there.");

  const restored = restoreChessGame(parseState(row));
  if (!restored.ok) throw new Error(restored.reason);

  return { id: row.id, name: row.name, savedAt: row.savedAt, game: restored.game };
}

/**
 * The player's saved games, newest first.
 *
 * **Parsed but not replayed.** Everything the list shows — the level, the colour, how
 * many moves — is in the stored JSON already, so replaying every game to draw a list
 * would mean running the rules over a few thousand moves to print numbers nobody has
 * asked to load yet. A row whose JSON will not even parse is listed as unreadable
 * rather than dropped, so a damaged save is visible and can be deleted.
 */
export function listChessGames(repo: ChessSaveRepository, input: unknown): ChessSaveSummary[] {
  const { userId } = chessPlayerSchema.parse(input);

  return repo.listChessSaves(userId).map((row) => {
    const parsed = chessSaveSchema.safeParse(parseState(row));
    return {
      id: row.id,
      name: row.name,
      level: parsed.success ? parsed.data.level : "beginner",
      humanColor: parsed.success ? parsed.data.humanColor : "w",
      moveCount: parsed.success ? parsed.data.moves.length : 0,
      savedAt: row.savedAt,
      createdAt: row.createdAt,
      readable: parsed.success && parsed.data.version === CHESS_SAVE_VERSION,
    };
  });
}

/** Deletes one of the player's saved games. Returns whether there was one. */
export function deleteChessGame(repo: ChessSaveRepository, input: unknown): boolean {
  const { userId, id } = chessSaveIdSchema.parse(input);
  return repo.deleteChessSave(userId, id);
}

/**
 * Writes the player's autosave, replacing whatever was there.
 *
 * Unlike a named save this is **not replayed first**. The autosave fires every few
 * moves from a board the rules just produced, so a replay here would be the same work
 * the board has already done, several times a game, to re-prove something that cannot
 * be wrong. The load path replays regardless, which is where the guarantee actually
 * has to hold.
 */
export function autosaveChessGame(
  repo: SavedRunRepository,
  input: unknown,
): { savedAt: string } {
  const { userId, save } = autosaveChessSchema.parse(input);

  const state = JSON.stringify(save);
  if (state.length > MAX_CHESS_SAVE_CHARS) throw new Error("That game is too large to save.");

  const savedAt = new Date().toISOString();
  repo.upsertSavedRun({
    userId,
    gameKey: CHESS_GAME_KEY,
    formatVersion: CHESS_SAVE_VERSION,
    state,
    savedAt,
  });
  return { savedAt };
}

/**
 * The player's autosave, or undefined when there is none.
 *
 * A stored autosave that cannot be restored — an old version, a damaged row, a game
 * that has since finished — is **deleted here and reported as "no save"**, which is
 * `loadArrowRun`'s rule and the right one for this store: it could never be resumed,
 * and keeping it would offer the player the same failing Resume prompt every time they
 * opened the game. A named save is treated the opposite way; see `loadChessGame`.
 */
export function loadChessAutosave(
  repo: SavedRunRepository,
  input: unknown,
): { savedAt: string; game: ChessGame } | undefined {
  const { userId } = chessPlayerSchema.parse(input);

  const row = repo.getSavedRun(userId, CHESS_GAME_KEY);
  if (!row) return undefined;

  const discard = () => {
    repo.deleteSavedRun(userId, CHESS_GAME_KEY);
    return undefined;
  };

  if (row.formatVersion !== CHESS_SAVE_VERSION) return discard();

  let parsed: unknown;
  try {
    parsed = JSON.parse(row.state);
  } catch {
    return discard();
  }

  const restored = restoreChessGame(parsed);
  if (!restored.ok) return discard();
  if (isChessGameOver(restored.game)) return discard();

  return { savedAt: row.savedAt, game: restored.game };
}

/** Deletes the player's autosave. Returns whether there was one. */
export function discardChessAutosave(repo: SavedRunRepository, input: unknown): boolean {
  const { userId } = chessPlayerSchema.parse(input);
  return repo.deleteSavedRun(userId, CHESS_GAME_KEY);
}

/**
 * A stored row's JSON, or undefined when it will not parse.
 *
 * Undefined rather than a throw, so a damaged row flows into the same "cannot read
 * this" path as one whose shape is wrong, instead of needing a second kind of handling
 * at every call site.
 */
function parseState(row: StoredChessSave): unknown {
  try {
    return JSON.parse(row.state);
  } catch {
    return undefined;
  }
}
