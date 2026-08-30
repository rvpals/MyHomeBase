import { listColorThemes } from "@/lib/color-themes";
import { DEFAULT_COLOR_THEME_ID, getSetting } from "@/lib/settings";
import { deps } from "@/lib/wiring";
import { ColorThemesView } from "./themes-view";

// A server page as of migration 0076: themes are rows now, so the list has to be read
// from the database rather than imported from `COLOR_THEMES`. Not `async` — every repo
// method is synchronous (better-sqlite3), the same way the Icons page reads its
// overrides inline.
export default function ColorThemesPage() {
  const savedThemeId =
    getSetting(deps.settingsRepo, "color_theme")?.value ?? DEFAULT_COLOR_THEME_ID;

  return (
    <ColorThemesView
      themes={listColorThemes(deps.colorThemeRepo)}
      savedThemeId={savedThemeId}
    />
  );
}
