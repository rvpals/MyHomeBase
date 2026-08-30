import { formatScore, listGames, listTopScores } from "@/lib/games";
import { deps } from "@/lib/wiring";
import { messageOf } from "./error-message";
import { parseFlags } from "./parse-flags";

/**
 * Prints the Games module's shared high-score board — the same use-cases the web
 * app's Arcade and Scores screens call.
 *
 *   npm run cli -- game-scores
 *   npm run cli -- game-scores --game 2048
 *   npm run cli -- game-scores --game 2048 --limit 25
 *
 * With no `--game` it prints one line per catalogue game (its record and how many
 * times it has been played) followed by the overall board. With `--game` it prints
 * just that game's board.
 *
 * An unknown `--game` is reported rather than silently returning nothing: the key is
 * validated against the catalogue by the use-case's zod schema, so a typo reads as an
 * error instead of an empty table.
 */
export async function gameScoresCommand(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const gameKey = flags.game;
  const limit = flags.limit ? Number(flags.limit) : 10;

  if (flags.limit && (!Number.isFinite(limit) || limit < 1)) {
    console.error("--limit must be a positive whole number.");
    process.exitCode = 1;
    return;
  }

  try {
    if (!gameKey) {
      console.log("Games");
      console.log("-----");
      for (const { game, best, played } of listGames(deps.gamesRepo)) {
        const record = best
          ? `${formatScore(game.key, best.score)} by ${best.userName}`
          : "not played yet";
        const status = game.status === "available" ? "" : " (coming soon)";
        console.log(`${game.name}${status} — ${record}; ${played} game(s)`);
      }
      console.log("");
    }

    const scores = listTopScores(deps.gamesRepo, gameKey ? { gameKey, limit } : { limit });

    console.log(gameKey ? `Top ${limit} — ${gameKey}` : `Top ${limit} — all games`);
    console.log("-".repeat(24));

    if (scores.length === 0) {
      console.log("No scores recorded yet.");
      return;
    }

    scores.forEach((score, index) => {
      const rank = String(index + 1).padStart(3);
      const player = score.userName.padEnd(20).slice(0, 20);
      const value = formatScore(score.gameKey, score.score).padStart(12);
      const when = score.playedAt.slice(0, 10);
      console.log(`${rank}. ${player} ${value}  ${String(score.moves).padStart(5)} moves  ${when}`);
    });
  } catch (error) {
    // A zod failure (an unknown game key, a limit over the cap) lands here.
    // `messageOf` rather than `error.message`: a ZodError's message is the serialized
    // issue array, so printing it dumps JSON at someone who mistyped a flag.
    console.error(messageOf(error));
    process.exitCode = 1;
  }
}
