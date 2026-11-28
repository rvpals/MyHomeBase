// The MyHomeBase Control Center card's per-system settings: how many rows each panel
// lists, and whether Media draws its random photo.
//
// One `sys_app_settings` row, `control_center_config`, encoded like `border_widths`:
//
//   money_movers=5,journal_entries=5,household_recipes=4,classroom_classes=3,
//   media_top_tracks=3,media_random_photo=1
//
// One row rather than six because the admin card reads and writes them together. The
// KEYS ARE PERMANENT — they are the stored encoding, so renaming one silently drops that
// value back to its default on every install that had set it.
//
// Reading is TOTAL: a missing, garbled or out-of-range value falls back to its default
// (or the nearest bound) independently, so a bad row can never break the home screen.
// Writing is STRICT: `controlCenterConfigToValue` validates with zod and throws, so the
// admin form reports a bad payload rather than storing a clamped surprise.

import { z } from "zod";

export const CONTROL_CENTER_SETTING_KEY = "control_center_config";

/** The numeric settings, in the order the admin card lists them. */
export const CONTROL_CENTER_COUNT_KEYS = [
  "moneyMovers",
  "journalEntries",
  "householdRecipes",
  "classroomClasses",
  "mediaTopTracks",
] as const;

export type ControlCenterCountKey = (typeof CONTROL_CENTER_COUNT_KEYS)[number];

export interface ControlCenterConfig {
  /** Money: how many gainers, and how many losers, the panel lists. */
  moneyMovers: number;
  /** Journal & Notes: how many recent entries. */
  journalEntries: number;
  /** Household: how many random recipes, on load and on every re-roll. */
  householdRecipes: number;
  /** Classroom: how many classes to open straight into. */
  classroomClasses: number;
  /** Media: how many most-played songs. */
  mediaTopTracks: number;
  /** Media: whether the "From the archive" photo is drawn at all. */
  mediaRandomPhoto: boolean;
}

export interface ControlCenterCountInfo {
  key: ControlCenterCountKey;
  /** The token in the stored value. Permanent. */
  storedKey: string;
  min: number;
  max: number;
  defaultValue: number;
}

/**
 * Bounds and defaults per count.
 *
 * Recipes stop at 12 because `drawRandomRecipesAction` already caps a re-roll there —
 * a higher setting would draw more on load than the re-roll button could replace.
 */
export const CONTROL_CENTER_COUNTS: Record<ControlCenterCountKey, ControlCenterCountInfo> = {
  moneyMovers: { key: "moneyMovers", storedKey: "money_movers", min: 1, max: 10, defaultValue: 5 },
  journalEntries: {
    key: "journalEntries",
    storedKey: "journal_entries",
    min: 1,
    max: 10,
    defaultValue: 5,
  },
  householdRecipes: {
    key: "householdRecipes",
    storedKey: "household_recipes",
    min: 1,
    max: 12,
    defaultValue: 4,
  },
  classroomClasses: {
    key: "classroomClasses",
    storedKey: "classroom_classes",
    min: 1,
    max: 10,
    defaultValue: 3,
  },
  mediaTopTracks: {
    key: "mediaTopTracks",
    storedKey: "media_top_tracks",
    min: 1,
    max: 10,
    defaultValue: 3,
  },
};

const RANDOM_PHOTO_STORED_KEY = "media_random_photo";

export function defaultControlCenterConfig(): ControlCenterConfig {
  return {
    moneyMovers: CONTROL_CENTER_COUNTS.moneyMovers.defaultValue,
    journalEntries: CONTROL_CENTER_COUNTS.journalEntries.defaultValue,
    householdRecipes: CONTROL_CENTER_COUNTS.householdRecipes.defaultValue,
    classroomClasses: CONTROL_CENTER_COUNTS.classroomClasses.defaultValue,
    mediaTopTracks: CONTROL_CENTER_COUNTS.mediaTopTracks.defaultValue,
    mediaRandomPhoto: true,
  };
}

function countSchema(info: ControlCenterCountInfo) {
  return z
    .number()
    .int("Must be a whole number.")
    .min(info.min, `Must be at least ${info.min}.`)
    .max(info.max, `Must be at most ${info.max}.`);
}

/** The whole config as it arrives from the admin form or a CLI arg. */
export const controlCenterConfigSchema = z.object({
  moneyMovers: countSchema(CONTROL_CENTER_COUNTS.moneyMovers),
  journalEntries: countSchema(CONTROL_CENTER_COUNTS.journalEntries),
  householdRecipes: countSchema(CONTROL_CENTER_COUNTS.householdRecipes),
  classroomClasses: countSchema(CONTROL_CENTER_COUNTS.classroomClasses),
  mediaTopTracks: countSchema(CONTROL_CENTER_COUNTS.mediaTopTracks),
  mediaRandomPhoto: z.boolean(),
});

/** Clamps one stored count into range; anything unparseable is the default. */
function parseCount(value: string | undefined, info: ControlCenterCountInfo): number {
  const parsed = Number(String(value ?? "").trim());
  if (value === undefined || value.trim() === "" || !Number.isFinite(parsed)) {
    return info.defaultValue;
  }
  return Math.min(info.max, Math.max(info.min, Math.round(parsed)));
}

/** Reads the stored row. Total: never throws, every field falls back independently. */
export function resolveControlCenterConfig(stored: string | undefined): ControlCenterConfig {
  const pairs = new Map(
    (stored ?? "")
      .split(",")
      .map((part) => part.split("="))
      .filter((parts): parts is [string, string] => parts.length === 2)
      .map(([key, value]) => [key.trim(), value.trim()]),
  );

  const config = defaultControlCenterConfig();
  for (const key of CONTROL_CENTER_COUNT_KEYS) {
    const info = CONTROL_CENTER_COUNTS[key];
    config[key] = parseCount(pairs.get(info.storedKey), info);
  }
  const photo = pairs.get(RANDOM_PHOTO_STORED_KEY);
  if (photo === "0") config.mediaRandomPhoto = false;
  else if (photo === "1") config.mediaRandomPhoto = true;
  return config;
}

/** Validates and encodes the config. Throws on a bad payload. Round-trips the resolver. */
export function controlCenterConfigToValue(input: unknown): string {
  const parsed = controlCenterConfigSchema.safeParse(input);
  if (!parsed.success) {
    // One readable sentence for the admin form, not zod's JSON dump.
    const issue = parsed.error.issues[0];
    const field = issue?.path.join(".") || "config";
    throw new Error(`Invalid ${field}: ${issue?.message ?? "bad value"}`);
  }
  const config = parsed.data;
  return [
    ...CONTROL_CENTER_COUNT_KEYS.map((key) => `${CONTROL_CENTER_COUNTS[key].storedKey}=${config[key]}`),
    `${RANDOM_PHOTO_STORED_KEY}=${config.mediaRandomPhoto ? 1 : 0}`,
  ].join(",");
}
