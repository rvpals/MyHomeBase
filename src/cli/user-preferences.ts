import { listModules } from "@/lib/modules";
import { getAccessibleModules, listUsers } from "@/lib/user";
import {
  COMPACT_NAV_STYLES,
  getUserPreferences,
  resolveStartupDestination,
  saveUserPreferences,
  type CompactNavStyle,
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
 *   user-preferences --user min --nav-style segmented
 *
 * Omitting a flag leaves that preference as it is, so any one can be changed
 * without restating the others. That is load-bearing rather than a nicety:
 * `saveUserPreferences` writes every key, so a flag this command forgot to carry
 * forward would be silently reset to its default on every CLI write.
 */
export async function userPreferencesCommand(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const username = flags.user;

  const navStyleIds = COMPACT_NAV_STYLES.map((style) => style.id);

  if (!username) {
    console.error(
      "Usage: user-preferences --user <username> [--favorite <slug|\"\">] [--startup yes|no]" +
        ` [--nav-style ${navStyleIds.join("|")}]`,
    );
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
  const navStyleFlag = flags["nav-style"];
  const isWriting =
    flags.favorite !== undefined || flags.startup !== undefined || navStyleFlag !== undefined;

  if (!isWriting) {
    printPreferences(username, current, accessibleSlugs);
    return;
  }

  if (flags.startup !== undefined && !["yes", "no"].includes(flags.startup)) {
    console.error(`--startup takes "yes" or "no", not "${flags.startup}".`);
    process.exitCode = 1;
    return;
  }

  // Rejected here rather than left to the schema, which `.catch`es an unknown
  // style to the default: at a terminal, silently saving something other than
  // what was typed is worse than an error.
  if (navStyleFlag !== undefined && !navStyleIds.includes(navStyleFlag as CompactNavStyle)) {
    console.error(`--nav-style takes ${navStyleIds.join(" or ")}, not "${navStyleFlag}".`);
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
        compactNavStyle:
          navStyleFlag !== undefined ? (navStyleFlag as CompactNavStyle) : current.compactNavStyle,
        // Carried through unchanged. `saveUserPreferences` writes every key on every
        // save, so omitting these would blank the weather location this user set on
        // the Account screen — a CLI command about favorites must not clear it.
        weatherLocation: current.weatherLocation ?? null,
        weatherUnit: current.weatherUnit,
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
  console.log(`  phone nav style: ${preferences.compactNavStyle}`);

  const destination = resolveStartupDestination(preferences, accessibleSlugs);
  console.log(`  lands on login:  ${destination ? `/modules/${destination}` : "the home screen"}`);
}
