// The public surface of this module.
//
// Deliberately does NOT re-export `SqliteColorThemeRepository`: the theme builder is a
// client component and imports the contrast helpers and types from here, so a re-export
// would drag `better-sqlite3` into the browser bundle. `src/lib/wiring.ts` imports the
// concrete repository from "./color-themes/repository" instead — the same split
// `src/lib/dashboard-texture/index.ts` keeps, for the same reason.
export type { StoredColorTheme, ColorThemeWrite } from "./types";
export type { ColorThemeRepository } from "./ports";
export {
  colorThemeIdSchema,
  colorThemeTokensSchema,
  colorThemeWriteSchema,
  deleteColorThemeSchema,
  hexColorSchema,
  slugifyThemeName,
  type ColorThemeWriteInput,
} from "./schema";
export {
  CONTRAST_AA_LARGE,
  CONTRAST_AA_TEXT,
  CONTRAST_PAIRS,
  checkThemeContrast,
  contrastRatio,
  failingContrastPairs,
  parseHex,
  relativeLuminance,
  type ContrastFinding,
  type ContrastPair,
} from "./contrast";
export {
  createColorTheme,
  deleteColorTheme,
  duplicateColorTheme,
  getColorThemeById,
  listColorThemes,
  resetBuiltinTheme,
  resolveActiveTheme,
  saveColorTheme,
} from "./color-themes";
