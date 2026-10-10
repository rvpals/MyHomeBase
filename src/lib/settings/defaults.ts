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
    // Blank means "nothing to show" — see migrations/0041.
    key: "STARTUP_MESSAGE",
    value: "",
    description:
      "If the value is not blank, display this message when the application home screen is reached.",
  },
];
