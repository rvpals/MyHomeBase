import type { AngleMode } from "@/lib/calculator";
import type { ClockFaceOptions } from "@/lib/clock";
import type { FloatingId, FloatingState, PuckCorner } from "@/lib/floating";
import type { TemperatureUnit } from "@/lib/weather";

/** One stored preference row. The owner is part of the identity, not the key alone. */
export interface UserPreference {
  id: number;
  userId: number;
  key: string;
  value: string;
}

/**
 * How the compact layout lays out navigation. See `nav-style.ts` for what each
 * one does and `design.md` for why both exist.
 *
 * A union rather than a boolean because a third arrangement is plausible, and a
 * `useSplitNavBar` flag would have to be renamed to add one.
 */
export type CompactNavStyle = "drill-in" | "segmented";

/**
 * Where a user wants their weather from.
 *
 * All three fields travel together or not at all — coordinates without a name would
 * give the card nothing to label itself with, and a name without coordinates cannot be
 * fetched. That is why this is one nullable object on `UserPreferences` rather than
 * three independent optional fields: the invalid halfway states aren't representable.
 */
export interface WeatherLocation {
  latitude: number;
  longitude: number;
  /** What to show on the card, e.g. "London, England". */
  name: string;
}

/**
 * A user's preferences as a typed object, resolved from the key/value rows.
 * Every field has a defined value here — absence is expressed as `undefined`
 * (favorite) or `false` (the flag), never as a missing property, so callers
 * don't branch on whether a row existed.
 */
export interface UserPreferences {
  /** Module slug, or `undefined` when nothing is chosen. Never `""`. */
  favoriteModuleSlug?: string;
  /** Whether logging in should go straight to the favorite module. */
  openFavoriteModuleOnStartup: boolean;
  /**
   * The compact navigation arrangement. Always a known style — a missing or
   * unrecognised row resolves to the default rather than `undefined`, because
   * navigation has to render whatever is stored.
   */
  compactNavStyle: CompactNavStyle;
  /**
   * Module slugs expanded in the full layout's navigation tree. Always an array —
   * nothing expanded is `[]`, never `undefined` — so the tree never branches on
   * whether a row existed.
   *
   * May contain a slug for a module the reader can no longer see: keeping it means
   * toggling a module off and back on doesn't silently forget the choice. Nothing
   * looks these up, so an unknown slug is inert.
   *
   * Full layout only, like `compactNavStyle` is compact only — the compact bar has
   * no tree to expand.
   */
  expandedModules: string[];
  /**
   * The place the Floating Clock forecasts for, or `undefined` when the user hasn't
   * set one — in which case the clock shows the time alone.
   */
  weatherLocation?: WeatherLocation;
  /** The unit the forecast is shown in. Always defined; defaults to Fahrenheit. */
  weatherUnit: TemperatureUnit;
  /**
   * How the Clock draws itself, wherever it is drawn — the home screen's card and the
   * floating clock read the same object, so a reader who switches to an analog face
   * gets it in both places. Always defined; see `resolveClockFaceOptions`.
   */
  clock: ClockFaceOptions;
  /**
   * Each floating component's shape for this reader: open, minimized, or closed.
   *
   * A full record, so a caller never checks whether a row existed. Note this is the
   * reader's *stored* wish — a component an admin has disabled is still recorded here
   * and simply not shown, which is what lets re-enabling restore what they had rather
   * than resetting everyone to closed. See `effectiveState`.
   */
  floating: Record<FloatingId, FloatingState>;
  /**
   * Which screen corner each floating component's puck docks in.
   *
   * A full record, defaulting to bottom-right. Separate from `floating` above because
   * the two change for different reasons: a corner is a standing choice made once on
   * the Account screen, while a state changes every time a window is minimized.
   */
  floatingCorners: Record<FloatingId, PuckCorner>;
  /**
   * The Floating Calculator's remembered state.
   *
   * Deliberately **not** the in-progress expression. A half-typed `3 * sin(` coming
   * back after a reload is clutter, but the last *result* is what the minimized puck
   * draws, so it has to survive — see migration 0095's note on what is not in the
   * history table.
   */
  calculator: {
    angleMode: AngleMode;
    /** Formatted, as the display showed it. `undefined` before the first calculation. */
    lastResult?: string;
  };
}
