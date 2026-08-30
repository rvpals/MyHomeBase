import { z } from "zod";
import { isKnownGame } from "./catalogue";
import { BOARD_SIZE, DIRECTIONS } from "./types";

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
