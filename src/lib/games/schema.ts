import { z } from "zod";
import { isKnownGame } from "./catalogue";
import {
  ARROW_DIFFICULTIES,
  ARROW_MOVE_UNDO,
  BOARD_SIZE,
  CHESS_COLORS,
  CHESS_LEVELS,
  CHESS_RESULTS,
  CHESS_TIME_CONTROLS,
  DIRECTIONS,
  PICTIONARY_TIERS,
} from "./types";

/**
 * Boundary validation for the Games module. Every server action and CLI command
 * validates through these before touching a use-case.
 */

const CELL_COUNT = BOARD_SIZE * BOARD_SIZE;

/**
 * A game key that the catalogue actually knows.
 *
 * Refined against `isKnownGame` rather than left as a free string: `game_key` has no
 * foreign key to lean on (see `catalogue.ts`), so this schema is the only thing
 * stopping a crafted request from writing scores for a game that does not exist.
 */
const gameKeySchema = z
  .string()
  .trim()
  .min(1, "A game key is required.")
  .refine(isKnownGame, "Unknown game.");

/** A finished game, as submitted by a player. */
export const recordScoreSchema = z.object({
  gameKey: gameKeySchema,
  userId: z.number().int().positive(),
  // Non-negative rather than positive: losing 2048 without a single merge is a real
  // game that scored nothing, and it should still be recordable.
  score: z.number().int().min(0, "A score cannot be negative."),
  moves: z.number().int().min(0).default(0),
});

export type RecordScoreInput = z.infer<typeof recordScoreSchema>;

/** What the repository is handed — the resolved timestamp included. */
export interface ScoreWriteData extends RecordScoreInput {
  playedAt: string;
}

/** A request for the scoreboard. */
export const topScoresQuerySchema = z.object({
  // Optional: the scoreboard screen shows every game, one section each.
  gameKey: gameKeySchema.optional(),
  limit: z.number().int().positive().max(100).default(10),
});

export type TopScoresQuery = z.infer<typeof topScoresQuerySchema>;

/** One move, as sent from the keyboard or a swipe. */
export const moveSchema = z.object({
  direction: z.enum(DIRECTIONS),
  board: z.array(z.number().int().min(0)).length(CELL_COUNT, `A board has ${CELL_COUNT} cells.`),
});

export type MoveInput = z.infer<typeof moveSchema>;

/** A request for words from the bank — the CLI's only input. */
export const wordBankQuerySchema = z.object({
  tier: z.enum(PICTIONARY_TIERS).optional(),
});

export type WordBankQuery = z.infer<typeof wordBankQuerySchema>;

/**
 * A pasted list of words, as typed into the Configuration screen.
 *
 * `text` is capped rather than unbounded: the box accepts a paste, and a paste can be a
 * whole document. 100,000 characters is far more than any real word list (the built-in
 * bank is under 1,500) while bounding what one request can ask the parser to walk.
 *
 * The words themselves are NOT validated here. `parseWordList` reports a bad row with
 * its line number and keeps the good ones, which a schema cannot do — a `z.array` of
 * valid words would reject the whole paste over one typo. See `importWords`.
 */
export const importWordsSchema = z.object({
  text: z
    .string()
    .min(1, "Type or paste some words first.")
    .max(100_000, "That list is too long to import at once."),
  tier: z.enum(PICTIONARY_TIERS),
  userId: z.number().int().positive(),
});

export type ImportWordsInput = z.infer<typeof importWordsSchema>;

/** One stored word, by id. */
export const deleteWordSchema = z.object({
  id: z.number().int().positive(),
});

/* ---------------------------------------------------------------------------------
   Saved runs (gam_saved_runs, migration 0171).
--------------------------------------------------------------------------------- */

/**
 * Size limits for a saved Arrows run. Generous for any real board (the biggest tier is
 * 1,500 arrows on 2,500 cells) but small enough that one request can't make the server
 * store or replay something huge.
 */
const MAX_SAVED_ARROWS = 5_000;
const MAX_ARROW_ROW_LENGTH = 64;
export const MAX_SAVED_ARROW_MOVES = 20_000;

/**
 * The shape of an `ArrowRunSave`. This only checks the shape. Whether the board is
 * real and every move was legal is checked by replaying it, in `restoreArrowRun`.
 */
export const arrowRunSaveSchema = z.object({
  version: z.number().int().positive(),
  difficulty: z.enum(ARROW_DIFFICULTIES),
  size: z.number().int().positive().max(200),
  arrows: z
    .array(z.array(z.number().int().min(0)).min(3).max(MAX_ARROW_ROW_LENGTH))
    .max(MAX_SAVED_ARROWS),
  moves: z.array(z.number().int().min(ARROW_MOVE_UNDO)).max(MAX_SAVED_ARROW_MOVES),
  unlimitedLives: z.boolean(),
  practiceRun: z.boolean(),
});

/** Storing a run for the signed-in player. */
export const saveArrowRunSchema = z.object({
  userId: z.number().int().positive(),
  save: arrowRunSaveSchema,
});

export type SaveArrowRunInput = z.infer<typeof saveArrowRunSchema>;

/** Reading back one player's run for one Arrows tier. */
export const loadArrowRunSchema = z.object({
  userId: z.number().int().positive(),
  difficulty: z.enum(ARROW_DIFFICULTIES),
});

/** Deleting one player's saved run for one game. */
export const discardSavedRunSchema = z.object({
  userId: z.number().int().positive(),
  gameKey: gameKeySchema,
});

/** Listing saved runs, for everyone or for one player. */
export const listSavedRunsSchema = z.object({
  userId: z.number().int().positive().optional(),
});

/** What the repository is handed for an upsert. */
export interface SavedRunWriteData {
  userId: number;
  gameKey: string;
  formatVersion: number;
  state: string;
  savedAt: string;
}

/* ---------------------------------------------------------------------------------
   Chess saves (gam_chess_saves, migration 0173) and the chess autosave.
--------------------------------------------------------------------------------- */

/**
 * The longest game that may be stored, in plies.
 *
 * The fifty-move rule bounds a game far below this in practice, but it resets on every
 * capture and pawn move, so there is no hard ceiling to read off the rules — the longest
 * recorded tournament games run to about 270 moves. A thousand plies is well past any
 * real game while still bounding what one request can ask the server to replay.
 */
export const MAX_CHESS_MOVES = 1_000;

/** The largest chess save that will be stored, in characters of JSON. */
export const MAX_CHESS_SAVE_CHARS = 32_000;

/** How long a saved game's name may be. */
export const MAX_CHESS_SAVE_NAME = 60;

/**
 * The shape of a `ChessSave`. Shape only: whether the moves are *legal* is decided by
 * replaying them through the rules in `restoreChessGame`, which a schema cannot do.
 *
 * The move pattern is deliberately strict — four squares and an optional promotion
 * letter — so nothing that is not even coordinate notation reaches the replay.
 */
export const chessSaveSchema = z.object({
  version: z.number().int().positive(),
  // A FEN is six space-separated fields and never approaches this length; the cap is
  // here so a crafted string cannot make the parser walk something huge.
  initialFen: z.string().trim().min(1).max(120),
  humanColor: z.enum(CHESS_COLORS),
  level: z.enum(CHESS_LEVELS),
  // Case-insensitive, and the case is *not* normalised here: `findMoveByUci` lowercases
  // before resolving a move against the legal list, so there is one place that decides
  // what "e2e4" and "E2E4" mean rather than a schema transform and a lookup that could
  // drift apart.
  moves: z
    .array(z.string().trim().regex(/^[a-hA-H][1-8][a-hA-H][1-8][qrbnQRBN]?$/, "Not a move."))
    .max(MAX_CHESS_MOVES, "That game is too long to save."),
  /**
   * The clock, when the game has one.
   *
   * **Optional, which is what makes every save written before clocks existed still
   * parse.** An absent clock restores as an untimed game, which is what those games
   * were. The remaining times are capped at a day so a hand-edited row cannot claim a
   * clock that never runs down.
   */
  /**
   * Help taken. Optional, so a save written before assists were counted still parses,
   * and capped so a hand-edited row cannot claim a negative or absurd count.
   */
  hintsUsed: z.number().int().min(0).max(10_000).optional(),
  takebacksUsed: z.number().int().min(0).max(10_000).optional(),
  clock: z
    .object({
      control: z.enum(CHESS_TIME_CONTROLS),
      remainingMs: z.object({
        w: z.number().int().min(0).max(86_400_000),
        b: z.number().int().min(0).max(86_400_000),
      }),
    })
    .optional(),
});

/**
 * Storing a named game.
 *
 * **The name is the key, and it is the only key.** Saving under a name already used
 * replaces that game, which is what makes Save a repeatable action on a game in
 * progress rather than something that fills the list with twenty copies.
 *
 * There was an `id` here that meant "replace this save of mine", and it was a trap: the
 * repository upserts on the name, so an id naming a *different* row than the name did
 * would quietly write to the name's row anyway — while still skipping the cap check it
 * was consulted for. One key, no ambiguity. Renaming a save, if it is ever wanted, is a
 * separate operation rather than a second meaning for Save.
 */
export const saveChessGameSchema = z.object({
  userId: z.number().int().positive(),
  name: z
    .string()
    .trim()
    .min(1, "Give this game a name.")
    .max(MAX_CHESS_SAVE_NAME, "That name is too long."),
  save: chessSaveSchema,
});

export type SaveChessGameInput = z.infer<typeof saveChessGameSchema>;

/** Reading or deleting one of the player's saved games. */
export const chessSaveIdSchema = z.object({
  userId: z.number().int().positive(),
  id: z.number().int().positive(),
});

/** Listing the player's saved games, or autosaving / discarding for them. */
export const chessPlayerSchema = z.object({
  userId: z.number().int().positive(),
});

/**
 * A finished game's result.
 *
 * The score is taken rather than recomputed here: it has already been worked out by
 * `scoreChessGame`, and a second calculation is a second thing that can disagree with
 * what the scoreboard was told.
 */
export const recordChessResultSchema = z.object({
  userId: z.number().int().positive(),
  level: z.enum(CHESS_LEVELS),
  result: z.enum(CHESS_RESULTS),
  moves: z.number().int().min(0).max(MAX_CHESS_MOVES),
  score: z.number().int().min(0),
});

export type RecordChessResultInput = z.infer<typeof recordChessResultSchema>;

/** The autosave: one per player, in `gam_saved_runs` under the `chess` game key. */
export const autosaveChessSchema = z.object({
  userId: z.number().int().positive(),
  save: chessSaveSchema,
});

/**
 * Looking up a Word Wizard word's meaning. Same shape the game itself accepts — 2–15
 * plain letters — so nothing else is ever sent to the dictionary service.
 */
export const lookupWordDefinitionSchema = z.object({
  word: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2,15}$/, "Only a 2–15 letter word can be looked up."),
});

export type LookupWordDefinitionInput = z.infer<typeof lookupWordDefinitionSchema>;
