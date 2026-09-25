import { listModules } from "@/lib/modules";
import { getAccessibleModules, listUsers } from "@/lib/user";
import { CLOCK_FACE_OPTIONS, type ClockFace } from "@/lib/clock";
import { FLOATING_COMPONENTS, isFloatingId, type FloatingId, type FloatingState } from "@/lib/floating";
import {
  COMPACT_NAV_STYLES,
  getUserPreferences,
  resolveStartupDestination,
  saveFloatingState,
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
 *   user-preferences --user min --clock-face analog --clock-weather no
 *   user-preferences --user min --floating clock --floating-state open
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
  const faceIds = CLOCK_FACE_OPTIONS.map((option) => option.value);
  const floatingIds = FLOATING_COMPONENTS.map((component) => component.id);

  if (!username) {
    console.error(
      "Usage: user-preferences --user <username> [--favorite <slug|\"\">] [--startup yes|no]" +
        ` [--nav-style ${navStyleIds.join("|")}]` +
        ` [--clock-face ${faceIds.join("|")}]` +
        " [--clock-date yes|no] [--clock-weather yes|no] [--clock-weekday yes|no]" +
        ` [--floating ${floatingIds.join("|")} --floating-state closed|minimized|open]`,
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
  const faceFlag = flags["clock-face"];
  const floatingFlag = flags.floating;
  const floatingStateFlag = flags["floating-state"];

  // The three clock toggles share one shape, so they share one table rather than
  // three copies of the same parse-and-validate.
  const toggleFlags = [
    { flag: "clock-date", value: flags["clock-date"], current: current.clock.showDate },
    { flag: "clock-weather", value: flags["clock-weather"], current: current.clock.showWeather },
    { flag: "clock-weekday", value: flags["clock-weekday"], current: current.clock.showWeekday },
  ] as const;

  const isWriting =
    flags.favorite !== undefined ||
    flags.startup !== undefined ||
    navStyleFlag !== undefined ||
    faceFlag !== undefined ||
    toggleFlags.some((toggle) => toggle.value !== undefined);

  // The floating state is a separate use-case with its own write, so it is handled
  // before the form save and can be combined with it in one invocation.
  if (floatingFlag !== undefined || floatingStateFlag !== undefined) {
    if (floatingFlag === undefined || floatingStateFlag === undefined) {
      console.error("--floating and --floating-state must be given together.");
      process.exitCode = 1;
      return;
    }
    if (!isFloatingId(floatingFlag)) {
      console.error(`--floating takes ${floatingIds.join(" or ")}, not "${floatingFlag}".`);
      process.exitCode = 1;
      return;
    }
    if (!["closed", "minimized", "open"].includes(floatingStateFlag)) {
      console.error(
        `--floating-state takes closed, minimized or open, not "${floatingStateFlag}".`,
      );
      process.exitCode = 1;
      return;
    }
    saveFloatingState(deps.userPreferencesRepo, user.id, {
      id: floatingFlag as FloatingId,
      state: floatingStateFlag as FloatingState,
    });
    console.log(`Set ${floatingFlag} to ${floatingStateFlag} for ${username}.`);
    if (!isWriting) {
      printPreferences(username, getUserPreferences(deps.userPreferencesRepo, user.id), accessibleSlugs);
      return;
    }
  }

  if (!isWriting) {
    printPreferences(username, current, accessibleSlugs);
    return;
  }

  if (flags.startup !== undefined && !["yes", "no"].includes(flags.startup)) {
    console.error(`--startup takes "yes" or "no", not "${flags.startup}".`);
    process.exitCode = 1;
    return;
  }

  // Same reasoning as --nav-style below: rejected here rather than left to the
  // schema's `.catch`, because silently saving a different face than the one typed
  // is worse at a terminal than an error.
  if (faceFlag !== undefined && !faceIds.includes(faceFlag as ClockFace)) {
    console.error(`--clock-face takes ${faceIds.join(" or ")}, not "${faceFlag}".`);
    process.exitCode = 1;
    return;
  }

  for (const toggle of toggleFlags) {
    if (toggle.value !== undefined && !["yes", "no"].includes(toggle.value)) {
      console.error(`--${toggle.flag} takes "yes" or "no", not "${toggle.value}".`);
      process.exitCode = 1;
      return;
    }
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
        // Carried through for the same reason as the weather and clock fields:
        // there is no flag for it, and omitting it would collapse the reader's
        // navigation tree on a command about something else entirely.
        expandedModules: current.expandedModules,
        // Carried through unchanged. `saveUserPreferences` writes every key on every
        // save, so omitting these would blank the weather location this user set on
        // the Account screen — a CLI command about favorites must not clear it.
        weatherLocation: current.weatherLocation ?? null,
        weatherUnit: current.weatherUnit,
        // Each clock field falls back to what is stored, for that same reason: a
        // command that set only the face would otherwise reset the three toggles.
        clock: {
          face: faceFlag !== undefined ? (faceFlag as ClockFace) : current.clock.face,
          showDate: resolveToggle(flags["clock-date"], current.clock.showDate),
          showWeather: resolveToggle(flags["clock-weather"], current.clock.showWeather),
          showWeekday: resolveToggle(flags["clock-weekday"], current.clock.showWeekday),
        },
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

/** A yes/no flag, or the stored value when the flag was omitted. */
function resolveToggle(value: string | undefined, fallback: boolean): boolean {
  return value === undefined ? fallback : value === "yes";
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
  console.log(`  clock face:      ${preferences.clock.face}`);
  console.log(
    `  clock shows:     ${
      [
        preferences.clock.showWeekday ? "weekday" : undefined,
        preferences.clock.showDate ? "date" : undefined,
        preferences.clock.showWeather ? "weather" : undefined,
      ]
        .filter((part) => part !== undefined)
        .join(", ") || "(the time alone)"
    }`,
  );
  for (const component of FLOATING_COMPONENTS) {
    console.log(`  ${component.label}: ${preferences.floating[component.id]}`);
  }

  const destination = resolveStartupDestination(preferences, accessibleSlugs);
  console.log(`  lands on login:  ${destination ? `/modules/${destination}` : "the home screen"}`);
}
