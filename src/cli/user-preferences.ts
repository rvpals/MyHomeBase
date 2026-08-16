import { listModules } from "@/lib/modules";
import { getAccessibleModules, listUsers } from "@/lib/user";
import {
  getUserPreferences,
  resolveStartupDestination,
  saveUserPreferences,
} from "@/lib/user-preferences";
import { deps } from "@/lib/wiring";
import { parseFlags } from "./parse-flags";

/**
 * Reads or writes one user's preferences — the same use-cases the account screen
 * drives, so the two can't diverge.
 *
 *   user-preferences --user min
 *   user-preferences --user min --favorite journal --startup yes
 *   user-preferences --user min --favorite ""            (clears the favorite)
 *
 * Omitting a flag leaves that preference as it is, so either can be changed
 * without restating the other.
 */
export async function userPreferencesCommand(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const username = flags.user;

  if (!username) {
    console.error("Usage: user-preferences --user <username> [--favorite <slug|\"\">] [--startup yes|no]");
    process.exitCode = 1;
    return;
  }

  const user = listUsers(deps.userRepo).find((candidate) => candidate.username === username);
  if (!user) {
    console.error(`No user with the username "${username}".`);
    process.exitCode = 1;
    return;
  }

  const accessibleSlugs = getAccessibleModules(
    user,
    listModules(deps.moduleRepo),
    deps.userRepo,
  ).map((appModule) => appModule.slug);

  const current = getUserPreferences(deps.userPreferencesRepo, user.id);
  const isWriting = flags.favorite !== undefined || flags.startup !== undefined;

  if (!isWriting) {
    printPreferences(username, current, accessibleSlugs);
    return;
  }

  if (flags.startup !== undefined && !["yes", "no"].includes(flags.startup)) {
    console.error(`--startup takes "yes" or "no", not "${flags.startup}".`);
    process.exitCode = 1;
    return;
  }

  try {
    const saved = saveUserPreferences(
      deps.userPreferencesRepo,
      user.id,
      {
        favoriteModuleSlug:
          flags.favorite !== undefined ? flags.favorite : (current.favoriteModuleSlug ?? ""),
        openFavoriteModuleOnStartup:
          flags.startup !== undefined ? flags.startup === "yes" : current.openFavoriteModuleOnStartup,
      },
      accessibleSlugs,
    );
    printPreferences(username, saved, accessibleSlugs);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Failed to save preferences.");
    if (accessibleSlugs.length > 0) {
      console.error(`Modules ${username} can reach: ${accessibleSlugs.join(", ")}`);
    }
    process.exitCode = 1;
  }
}

function printPreferences(
  username: string,
  preferences: ReturnType<typeof getUserPreferences>,
  accessibleSlugs: string[],
): void {
  console.log(`Preferences for ${username}:`);
  console.log(`  favorite module: ${preferences.favoriteModuleSlug ?? "(none)"}`);
  console.log(`  open on startup: ${preferences.openFavoriteModuleOnStartup ? "yes" : "no"}`);

  const destination = resolveStartupDestination(preferences, accessibleSlugs);
  console.log(`  lands on login:  ${destination ? `/modules/${destination}` : "the home screen"}`);
}
