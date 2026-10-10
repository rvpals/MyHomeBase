import { GAME_CATALOGUE, findGame, listPlayableGames } from "./catalogue";
import type { ScoreRepository } from "./ports";
import { recordScoreSchema, topScoresQuerySchema } from "./schema";
import {
  ARROW_DIFFICULTIES,
  ARROW_DIFFICULTY_SETUP,
  arrowDifficultyOf,
  type ArrowDifficulty,
  type CatalogueGame,
  type Score,
} from "./types";

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

/**
 * The best score for each Arrow Clearing tier, keyed by tier.
 *
 * Arrow Clearing is one catalogue entry but three scoreboards — the tiers are picked
 * inside the game and each posts to its own `gameKey`, so `listGames` (which maps the
 * *catalogue*) only ever sees the entry tier's best. The board needs all three, because
 * switching tier mid-session has to switch the "Best" it shows with it.
 *
 * Returns 0 rather than undefined for an unplayed tier: every caller is displaying a
 * number, and three separate "or zero" fallbacks at the call site is worse than one here.
 */
export function arrowBestScores(repo: ScoreRepository): Record<ArrowDifficulty, number> {
  const bests = {} as Record<ArrowDifficulty, number>;
  for (const tier of ARROW_DIFFICULTIES) {
    bests[tier] = repo.getBestScore(ARROW_DIFFICULTY_SETUP[tier].gameKey)?.score ?? 0;
  }
  return bests;
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
 * The catalogue key a stored score should be *displayed* under.
 *
 * Almost always the key itself. The exception is Arrow Clearing, whose three tiers each
 * post to their own `gameKey` but share a single catalogue entry — so a Nightmare score
 * would otherwise find no catalogue row and render as the raw string
 * `arrow-clearing-nightmare`, with no name, no unit and no icon (icon slot ids are
 * derived from the key by `gameSlotId`).
 *
 * Resolving here rather than adding catalogue entries per tier: entries are *cards*, and
 * three cards is exactly the shape migration 0077 withdrew. Resolving here rather than at
 * the view: the scoreboard, the CLI report and anything else reading `gam_scores` back
 * all need the same answer.
 *
 * Note this collapses the tiers for *labelling only* — the stored keys stay distinct, so
 * the three leaderboards remain separate. A row still says which tier it was via its
 * own key where that matters.
 */
export function scoreCardKey(gameKey: string): string {
  const tier = arrowDifficultyOf(gameKey);
  return tier ? ARROW_DIFFICULTY_SETUP.hard.gameKey : gameKey;
}

/**
 * The display name for a stored score's key — the catalogue name, with the Arrow
 * Clearing tier appended so three leaderboards do not read as one.
 *
 * Falls back to the raw key rather than throwing: a scoreboard row for a retired game
 * must still render (see `catalogue.ts`).
 */
export function scoreGameName(gameKey: string): string {
  const game = findGame(scoreCardKey(gameKey));
  if (!game) return gameKey;

  const tier = arrowDifficultyOf(gameKey);
  return tier ? `${game.name} — ${ARROW_DIFFICULTY_SETUP[tier].label}` : game.name;
}

/**
 * Formats a score with its game's unit, so a view never hardcodes "points".
 * An unknown key falls back to a bare number rather than throwing — a scoreboard row
 * for a retired game must still render (see `catalogue.ts`).
 */
export function formatScore(gameKey: string, score: number): string {
  const game = findGame(scoreCardKey(gameKey));
  if (!game) return score.toLocaleString();
  return game.scoreUnit === "seconds"
    ? `${score.toLocaleString()}s`
    : `${score.toLocaleString()} pts`;
}
