export type {
  CompactNavStyle,
  DesktopNavStyle,
  UserPreference,
  UserPreferences,
  WeatherLocation,
} from "./types";
export {
  COMPACT_NAV_STYLES,
  DEFAULT_COMPACT_NAV_STYLE,
  getCompactNavStyle,
  resolveCompactNavStyle,
  type CompactNavStyleInfo,
} from "./nav-style";
export {
  DESKTOP_NAV_STYLES,
  DEFAULT_DESKTOP_NAV_STYLE,
  getDesktopNavStyle,
  resolveDesktopNavStyle,
  type DesktopNavStyleInfo,
} from "./desktop-nav-style";
export {
  userPreferenceSchema,
  userPreferencesUpdateSchema,
  floatingStateUpdateSchema,
  calculatorStateUpdateSchema,
  floatingCornerUpdateSchema,
  type UserPreferenceInput,
  type UserPreferencesUpdate,
  type FloatingStateUpdate,
  type CalculatorStateUpdate,
  type FloatingCornerUpdate,
} from "./schema";
export type { UserPreferencesRepository } from "./ports";
export {
  USER_PREFERENCE_KEYS,
  resolveUserPreferences,
  userPreferencesToEntries,
} from "./preferences";
export {
  getUserPreferences,
  saveUserPreferences,
  saveFloatingState,
  saveFloatingCorner,
  saveFloatingPosition,
  resetFloatingPosition,
  saveCalculatorState,
  saveHomeLayout,
  resolveStartupDestination,
  UnknownFavoriteModuleError,
} from "./user-preferences";
