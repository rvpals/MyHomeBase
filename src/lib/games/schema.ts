import { z } from "zod";
import { isKnownGame } from "./catalogue";
import {
  BOARD_SIZE,
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
