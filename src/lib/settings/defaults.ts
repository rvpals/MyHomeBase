// Imported from the settings/types files directly rather than from `@/lib/backup`:
// that index re-exports the runner, which reaches into the composition root.
import {
  BACKUP_SETTING_KEYS,
  DEFAULT_INTERVAL_COUNT as DEFAULT_BACKUP_INTERVAL_COUNT,
  DEFAULT_INTERVAL_UNIT as DEFAULT_BACKUP_INTERVAL_UNIT,
  DEFAULT_KEEP_COUNT,
  DEFAULT_START_TIME,
} from "@/lib/backup/settings";
import { NO_FOLDER } from "@/lib/backup/types";
// Imported from the settings file directly rather than from `@/lib/hello-world`,
// for the same reason as the backup keys above: that index re-exports the runner,
// which reaches into the composition root.
import {
  DEFAULT_INTERVAL_COUNT,
  DEFAULT_INTERVAL_UNIT,
  DEFAULT_MESSAGE,
  HELLO_WORLD_SETTING_KEYS,
} from "@/lib/hello-world/settings";
import {
  HOME_WIDGETS_SETTING_KEY,
  defaultHomeWidgets,
  homeWidgetsToValue,
} from "@/lib/home-dashboard";
import {
  DEFAULT_NAV_TEXTURE_OPACITY,
  NAV_TEXTURE_ID_KEY,
  NAV_TEXTURE_OPACITY_KEY,
  NO_NAV_TEXTURE,
} from "@/lib/nav-texture";
import { DEFAULT_BORDER_WIDTHS, borderWidthsToValue } from "./border-widths";
import { DEFAULT_SCRIPT_FONT, SCRIPT_FONT_SETTING_KEYS } from "./script-fonts";
import { DEFAULT_CHROME_STYLE } from "./chrome-style";
import { DEFAULT_ICON_SET_ID } from "./icon-sets";
import { DEFAULT_COLOR_THEME_ID } from "./themes";
import type { Setting } from "./types";

// Mirrors the seed INSERTs in migrations/0002_create_app_settings.sql,
// migrations/0004_seed_color_theme_setting.sql,
// migrations/0023_seed_icon_set_setting.sql,
// migrations/0067_seed_home_widgets_setting.sql, and
// migrations/0121_seed_chrome_style_setting.sql, and
// migrations/0122_seed_border_widths_setting.sql.
// "Reset to Default" restores the table to exactly this list — keep both in sync.
export const DEFAULT_APP_SETTINGS: Setting[] = [
  {
    key: "application_name",
    value: "MyHomeBase",
    description: "Displayed as the application's name throughout the UI.",
  },
  {
    key: "color_theme",
    value: DEFAULT_COLOR_THEME_ID,
    description: "Selected color theme for the application.",
  },
  {
    key: "icon_set",
    value: DEFAULT_ICON_SET_ID,
    description: "Selected module icon set for the application.",
  },
  {
    // The bevel on the utility header and the navigation tree — see
    // migrations/0121. Imported rather than spelled out so this default can't
    // drift from the catalogue in ./chrome-style.
    key: "chrome_style",
    value: DEFAULT_CHROME_STYLE,
    description: "Border treatment for the utility header and the navigation tree.",
  },
  {
    // All three axes at 1px — the weight the app used before the setting existed.
    // Encoded rather than spelled out so this default can't drift from the
    // catalogue in ./border-widths. See migrations/0122.
    key: "border_widths",
    value: borderWidthsToValue(DEFAULT_BORDER_WIDTHS),
    description:
      "Border weights in pixels: the chrome outline, the navigation dividers, and every other border.",
  },
  {
    // Every home screen card visible, in catalogue order. The encoding and the id
    // list belong to src/lib/home-dashboard — see migrations/0067. Imported rather
    // than spelled out so this default can't drift from the catalogue.
    key: HOME_WIDGETS_SETTING_KEY,
    value: homeWidgetsToValue(defaultHomeWidgets()),
    description:
      'Which home screen cards are drawn and in what order. A "-" prefix hides one.',
  },
  {
    // The navigation's background picture, off by default: a fresh install draws
    // a plain column, exactly as it did before the setting existed.
    //
    // These two have NO seed migration, unlike every entry above. They do not
    // need one -- `updateAll` upserts, so saving works against a table that has
    // never held these keys -- but they are listed here because "Reset to
    // Default" rebuilds this table from exactly this array, and a key missing
    // from it would come back absent rather than off. Absent happens to resolve
    // to the same thing here, which is why this is tidiness rather than a bug.
    key: NAV_TEXTURE_ID_KEY,
    value: NO_NAV_TEXTURE,
    description:
      "The app texture library picture drawn behind the navigation, or 0 for none.",
  },
  {
    key: NAV_TEXTURE_OPACITY_KEY,
    value: String(DEFAULT_NAV_TEXTURE_OPACITY),
    description: "How strongly the navigation's background picture is drawn, from 0 to 1.",
  },
  {
    // The Data backup job — see migrations/0134. Off with no folders, so an install
    // that upgrades into the feature never starts writing archives somewhere nobody
    // chose. Unlike the nav-texture pair above, these MUST be listed here: a reader
    // who presses "Reset to Default" with a backup configured should get the job
    // switched off, not a table missing the switch entirely.
    key: BACKUP_SETTING_KEYS.enabled,
    value: "false",
    description:
      'Whether the scheduled Data backup runs. A manual "Run backup now" ignores this.',
  },
  {
    // `NO_FOLDER`, not "": `settingUpdateSchema` rejects an empty value.
    key: BACKUP_SETTING_KEYS.attachmentRoot,
    value: NO_FOLDER,
    description: 'Folder that attachment files are backed up into. "none" means not set.',
  },
  {
    key: BACKUP_SETTING_KEYS.databaseRoot,
    value: NO_FOLDER,
    description:
      'Folder that compressed database archives are written to. "none" means not set.',
  },
  {
    key: BACKUP_SETTING_KEYS.keepCount,
    value: String(DEFAULT_KEEP_COUNT),
    description:
      "How many database archives to keep. Older ones are deleted after a successful backup.",
  },
  {
    // The cadence is a count plus a unit since migrations/0138, replacing a fixed
    // hourly/daily/weekly/monthly enum. The superseded `backup_interval` key is
    // deliberately absent from this list: "Reset to Default" should not resurrect a
    // key nothing reads.
    key: BACKUP_SETTING_KEYS.intervalCount,
    value: String(DEFAULT_BACKUP_INTERVAL_COUNT),
    description:
      'How many of the interval unit between backups. With the unit, "every 1 day".',
  },
  {
    key: BACKUP_SETTING_KEYS.intervalUnit,
    value: DEFAULT_BACKUP_INTERVAL_UNIT,
    description:
      "The interval unit: second, minute, hour, day or week. Under a minute runs once a minute -- the scheduler checks every 60s.",
  },
  {
    key: BACKUP_SETTING_KEYS.startTime,
    value: DEFAULT_START_TIME,
    description:
      "The time of day the schedule is anchored to, as HH:MM in the server's local time.",
  },
  {
    // The "Hello, world!" job — see migrations/0136. Off by default, for the same
    // reason as the backup keys above: an install that upgrades into the job must
    // not start writing run rows nobody asked for. Listed here so "Reset to
    // Default" leaves the job switched off rather than dropping its keys.
    key: HELLO_WORLD_SETTING_KEYS.enabled,
    value: "false",
    description:
      'Whether the scheduled "Hello, world!" job runs. A manual "Run now" ignores this.',
  },
  {
    key: HELLO_WORLD_SETTING_KEYS.message,
    value: DEFAULT_MESSAGE,
    description:
      "Filed as the title of the message each run puts in the queue (sys_messages).",
  },
  {
    // A count and a unit rather than resolved minutes: that is what the reader
    // typed, and 60 minutes is equally "1 hour" and "60 minutes" on the way back.
    key: HELLO_WORLD_SETTING_KEYS.intervalCount,
    value: String(DEFAULT_INTERVAL_COUNT),
    description: 'How many of the interval unit between runs. With the unit, "every 1 minute".',
  },
  {
    key: HELLO_WORLD_SETTING_KEYS.intervalUnit,
    value: DEFAULT_INTERVAL_UNIT,
    description:
      "The interval unit: second, minute, hour, day or week. Under a minute runs once a minute — the scheduler checks every 60s.",
  },
  {
    // The two decorative script faces — see migrations/0137. Both default to
    // Great Vibes, which is what the Daily Quote and the Journal's handwriting
    // sheet both wore before either was configurable, so "Reset to Default"
    // puts the app back to the look it shipped with rather than to no face.
    key: SCRIPT_FONT_SETTING_KEYS.dailyQuote,
    value: DEFAULT_SCRIPT_FONT,
    description:
      "The script face the Daily Quote card on the home screen is written in. One of the ids in src/lib/settings/script-fonts.ts.",
  },
  {
    key: SCRIPT_FONT_SETTING_KEYS.journalHandwriting,
    value: DEFAULT_SCRIPT_FONT,
    description:
      "The script face the Journal entry form uses when Handwriting is switched on. One of the ids in src/lib/settings/script-fonts.ts.",
  },
  {
    // Blank means "nothing to show" — see migrations/0041.
    key: "STARTUP_MESSAGE",
    value: "",
    description:
      "If the value is not blank, display this message when the application home screen is reached.",
  },
];
