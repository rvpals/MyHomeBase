import { GAME_CATALOGUE, findGame, listPlayableGames } from "./catalogue";
import type { PictionaryWordRepository, ScoreRepository } from "./ports";
import { parseWordList, type PictionaryImportProblem } from "./pictionary-import";
import { allWords, wordsInTier } from "./pictionary-words";
import {
  deleteWordSchema,
  importWordsSchema,
  recordScoreSchema,
  topScoresQuerySchema,
  wordBankQuerySchema,
} from "./schema";
import {
  ARROW_DIFFICULTIES,
  ARROW_DIFFICULTY_SETUP,
  arrowDifficultyOf,
  type ArrowDifficulty,
  type CatalogueGame,
  type PictionarySource,
  type PictionaryTier,
  type PictionaryWord,
  type Score,
  type StoredPictionaryWord,
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

/**
 * The word bank, for the CLI and anything else that wants to read it.
 *
 * A use-case rather than a direct import of `pictionary-words` at the call site, so the
 * CLI and the web app reach the bank the same way — through the module's front door.
 */
export function listWordBank(query: unknown = {}): readonly PictionaryWord[] {
  const parsed = wordBankQuerySchema.parse(query);
  return parsed.tier ? wordsInTier(parsed.tier) : allWords();
}

/* -----------------------------------------------------------------------------------
   The custom Pictionary word bank.

   Imported words and built-in words are the same thing to the game: `listPlayableWords`
   flattens both to `PictionaryWord`, so no rule anywhere can treat an imported prompt
   differently from one that shipped with the app.
----------------------------------------------------------------------------------- */

/** What an import did, for the screen to report. */
export interface PictionaryImportSummary {
  /** Rows written. Excludes anything already in the bank. */
  added: number;
  /** Parsed fine but already stored — re-importing the same list lands here. */
  alreadyPresent: number;
  /** Dropped as a repeat of an earlier line in the same paste. */
  duplicatesInPaste: number;
  /** Rows that could not be imported, each with a line number and a reason. */
  problems: readonly PictionaryImportProblem[];
}

/**
 * Imports a pasted list of words.
 *
 * Parsing is pure (`parseWordList`) and storage is the repository's; this use-case is
 * the seam between them, and it is what both the web app and the CLI call. The split is
 * what makes "import this list" testable without a database and storable without
 * re-deriving what a valid word is.
 *
 * Bad rows do **not** fail the import. A list of forty words with two typos should land
 * thirty-eight words and tell you about the two, rather than refusing the lot — which is
 * the behaviour that makes someone paste the list again with one word removed at a time.
 */
export function importWords(
  repo: PictionaryWordRepository,
  input: unknown,
): PictionaryImportSummary {
  const parsed = importWordsSchema.parse(input);
  const result = parseWordList(parsed.text, parsed.tier);

  const added = result.words.length > 0 ? repo.addWords(result.words, parsed.userId) : 0;

  return {
    added,
    alreadyPresent: result.words.length - added,
    duplicatesInPaste: result.duplicates,
    problems: result.problems,
  };
}

/** The custom words, for the Configuration list. */
export function listCustomWords(
  repo: PictionaryWordRepository,
  query: unknown = {},
): StoredPictionaryWord[] {
  const parsed = wordBankQuerySchema.parse(query);
  return repo.listWords(parsed.tier);
}

/** How many custom words exist per tier. */
export function countCustomWords(repo: PictionaryWordRepository): Record<PictionaryTier, number> {
  return repo.countByTier();
}

/** Removes one custom word. Returns whether it was there. */
export function deleteCustomWord(repo: PictionaryWordRepository, id: number): boolean {
  const parsed = deleteWordSchema.parse({ id });
  return repo.deleteWord(parsed.id);
}

/** Removes every custom word, or every one in a tier. Returns how many went. */
export function clearCustomWords(repo: PictionaryWordRepository, tier?: PictionaryTier): number {
  const parsed = wordBankQuerySchema.parse(tier ? { tier } : {});
  return repo.clearWords(parsed.tier);
}

/**
 * The words a session can actually draw from, for one tier.
 *
 * The one function the game asks, and the only place the two banks meet. `source`
 * decides which of them is read; the result is a flat list of prompts with nothing
 * saying where each came from, which is deliberate — see `StoredPictionaryWord`.
 *
 * Falls back to the built-in bank when `custom` was asked for and nothing has been
 * imported: a session that cannot deal a prompt is not a session, and silently playing
 * with the built-ins is a better answer than an empty board. The caller can tell this
 * happened by checking `countCustomWords` if it needs to say so.
 */
export function listPlayableWords(
  repo: PictionaryWordRepository,
  tier: PictionaryTier,
  source: PictionarySource = "both",
): readonly PictionaryWord[] {
  const built = source === "custom" ? [] : wordsInTier(tier);
  const custom =
    source === "built-in"
      ? []
      : repo.listWords(tier).map((entry) => ({ word: entry.word, tier: entry.tier }));

  const all = [...built, ...custom];
  return all.length > 0 ? all : wordsInTier(tier);
}
