import { discardSavedRun, listSavedRuns, scoreGameName } from "@/lib/games";
import { deps } from "@/lib/wiring";
import { messageOf } from "./error-message";
import { parseFlags } from "./parse-flags";

/**
 * Lists and discards saved Games runs: the same use-cases the Arrows board calls.
 *
 *   npm run cli -- game-saves
 *   npm run cli -- game-saves --user 1
 *   npm run cli -- game-saves --discard --user 1 --game arrow-clearing-nightmare
 *
 * With no flags it prints every saved run, newest first: whose it is, which game, when
 * it was saved and how far along it is. A run marked "can't resume" is one the game
 * will throw away the next time that player opens the tier.
 *
 * `--discard` needs both `--user` and `--game`, since one player has at most one save
 * per game key.
 */
export async function gameSavesCommand(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const userId = flags.user === undefined ? undefined : Number(flags.user);

  try {
    if ("discard" in flags) {
      const removed = discardSavedRun(deps.savedRunsRepo, { userId, gameKey: flags.game });
      console.log(removed ? "Saved run discarded." : "No saved run for that user and game.");
      return;
    }

    const runs = listSavedRuns(deps.savedRunsRepo, { userId });
    if (runs.length === 0) {
      console.log("No saved runs.");
      return;
    }
    for (const run of runs) {
      const progress = run.restorable
        ? `${run.cleared} cleared, ${run.remaining} left`
        : "can't resume";
      console.log(
        `${run.savedAt}  ${run.userName} (#${run.userId})  ${scoreGameName(run.gameKey)}  ${progress}`,
      );
    }
  } catch (error) {
    console.error(messageOf(error));
    process.exitCode = 1;
  }
}
