import { DEFAULT_ICON_SET_ID } from "./icon-sets";
import { DEFAULT_COLOR_THEME_ID } from "./themes";
import type { Setting } from "./types";

// Mirrors the seed INSERTs in migrations/0002_create_app_settings.sql,
// migrations/0004_seed_color_theme_setting.sql, and
// migrations/0023_seed_icon_set_setting.sql.
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
];
