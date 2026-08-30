import type { CatalogueGame } from "./types";

/**
 * The catalogue of games, in code rather than in a table.
 *
 * A game is only playable if the code that draws it exists, so a database row could
 * name a game this build cannot run — and an admin could "add" a game by inserting a
 * row and get a broken card. Same reasoning as `HOME_WIDGET_IDS` in
 * `src/lib/home-dashboard` and the symbol list in `src/lib/market-indexes`: a
 * catalogue of what the app can do is code; only what the user *did* is data.
 *
 * That is also why `gam_scores.game_key` is not a foreign key — it references a key
 * here. A score therefore outlives its game being retired from this list, which is
 * deliberate: deleting someone's high score because a game was withdrawn would be a
 * worse outcome than a scoreboard row whose game is no longer listed.
 *
 * `key` is stored, so treat it as permanent once any score exists.
 */
export const GAME_CATALOGUE: readonly CatalogueGame[] = [
  {
    key: "2048",
    name: "2048",
    description: "Slide the tiles, merge matching pairs, and reach 2048.",
    status: "available",
    scoreUnit: "points",
  },
  // Arrow Clearing is three catalogue entries rather than one game with a difficulty
  // setting, because the scoreboard sorts on score alone: a 5x5 clear and a 9x9 clear
  // posting to the same board would rank a much easier puzzle against a much harder
  // one. Three keys give three honest boards.
  {
    key: "arrow-clearing-easy",
    name: "Arrow Clearing — Easy",
    description: "A 5x5 board. Clear every arrow off the edge, in the right order.",
    status: "available",
    scoreUnit: "points",
  },
  {
    key: "arrow-clearing-medium",
    name: "Arrow Clearing — Medium",
    description: "A 7x7 board with more arrows in each other's way.",
    status: "available",
    scoreUnit: "points",
  },
  {
    key: "arrow-clearing-hard",
    name: "Arrow Clearing — Hard",
    description: "A 9x9 board. Every arrow blocks two others; find the thread.",
    status: "available",
    scoreUnit: "points",
  },
];

/** The catalogue entry for `key`, or undefined when nothing matches. */
export function findGame(key: string): CatalogueGame | undefined {
  return GAME_CATALOGUE.find((game) => game.key === key);
}

/**
 * Whether `key` names a game in the catalogue.
 *
 * Used to validate a score before it is written, so a crafted request cannot fill the
 * scoreboard with rows for a game that does not exist.
 */
export function isKnownGame(key: string): boolean {
  return GAME_CATALOGUE.some((game) => game.key === key);
}

/** Only the games that can actually be played, for the Arcade list. */
export function listPlayableGames(): readonly CatalogueGame[] {
  return GAME_CATALOGUE.filter((game) => game.status === "available");
}
