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
  // One Arrow Clearing entry. It shipped as three (easy/medium/hard) and the two
  // smaller boards were withdrawn in migration 0077 — the largest was already no
  // challenge, so a ladder below it was pointless. The key still says `-hard` because
  // it is stored in `gam_scores.game_key`: renaming it would orphan every score
  // already posted against it, exactly as renaming an icon slot id orphans an upload.
  {
    key: "arrow-clearing-hard",
    name: "Arrow Clearing",
    description: "A 9x9 maze of arrows. Clear every one off the board, in the right order.",
    status: "available",
    scoreUnit: "points",
  },
  {
    key: "tetris",
    name: "Tetris",
    description: "Stack the falling pieces, clear full lines, and outlast the speed.",
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
