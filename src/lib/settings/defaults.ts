import { DEFAULT_COLOR_THEME_ID } from "./themes";
import type { Setting } from "./types";

// Mirrors the seed INSERTs in migrations/0002_create_app_settings.sql and
// migrations/0004_seed_color_theme_setting.sql.
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
];
