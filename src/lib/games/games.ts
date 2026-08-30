import { GAME_CATALOGUE, findGame, listPlayableGames } from "./catalogue";
import type { ScoreRepository } from "./ports";
import { recordScoreSchema, topScoresQuerySchema } from "./schema";
import type { CatalogueGame, Score } from "./types";

/**
 * The Games use-cases: functions that take data and return data.
 *
 * Callable identically from the web app and the CLI — neither the request nor the
 * terminal appears in any signature.
 */

/** One game plus how it has been played. What the Arcade list draws. */
export interface GameSummary {
  game: CatalogueGame;
  /** The best score anyone has posted, or undefined when nobody has played. */
  best: Score | undefined;
  /** How many games have been finished. */
  played: number;
}

/** Every game in the catalogue, with its scoreboard headline. */
export function listGames(repo: ScoreRepository): GameSummary[] {
  return GAME_CATALOGUE.map((game) => ({
    game,
    best: repo.getBestScore(game.key),
    played: repo.countScores(game.key),
  }));
}

/** Only the games that can be played now. */
export function listAvailableGames(): readonly CatalogueGame[] {
  return listPlayableGames();
}

/** The catalogue entry for a key, or undefined. */
export function getGame(key: string): CatalogueGame | undefined {
  return findGame(key);
}

/**
 * Stores a finished game.
 *
 * `playedAt` is resolved here rather than taken from the caller: a client-supplied
 * timestamp would let a crafted request backdate a score and win every tie-break in
 * the scoreboard's `played_at ASC` ordering.
 */
export function recordScore(repo: ScoreRepository, input: unknown): Score {
  const parsed = recordScoreSchema.parse(input);
  return repo.recordScore({ ...parsed, playedAt: new Date().toISOString() });
}

/** The shared high-score table, for one game or all of them. */
export function listTopScores(repo: ScoreRepository, query: unknown = {}): Score[] {
  const parsed = topScoresQuerySchema.parse(query);
  return repo.listTopScores(parsed.gameKey, parsed.limit);
}

/** The most recently finished games, newest first. */
export function listRecentScores(repo: ScoreRepository, limit = 10): Score[] {
  return repo.listRecentScores(limit);
}

/**
 * Formats a score with its game's unit, so a view never hardcodes "points".
 * An unknown key falls back to a bare number rather than throwing — a scoreboard row
 * for a retired game must still render (see `catalogue.ts`).
 */
export function formatScore(gameKey: string, score: number): string {
  const game = findGame(gameKey);
  if (!game) return score.toLocaleString();
  return game.scoreUnit === "seconds"
    ? `${score.toLocaleString()}s`
    : `${score.toLocaleString()} pts`;
}
