import type { ClockFace, ClockFaceOptions } from "./types";

/**
 * The two faces, as the data the preference UI renders.
 *
 * A catalogue rather than literals in the view, matching `HANDWRITING_SIZE_OPTIONS` and
 * `COMPACT_NAV_STYLES`: the labels are facts about the faces and the CLI prints the same
 * list. A union rather than an `isAnalog` boolean because a third face (a word clock, a
 * binary one) is plausible and a boolean would have to be renamed to add it.
 */
export const CLOCK_FACE_OPTIONS: readonly { value: ClockFace; label: string; description: string }[] =
  [
    {
      value: "digital",
      label: "Digital",
      description: "The time as HH:MM:SS, in the theme's mono face.",
    },
    {
      value: "analog",
      label: "Analog",
      description: "A dial with sweeping hour and minute hands.",
    },
  ];

const DEFAULT_FACE: ClockFace = "digital";

/** Whether `value` names a face this app can draw — the guard for a stored row. */
export function isClockFace(value: string): value is ClockFace {
  return CLOCK_FACE_OPTIONS.some((option) => option.value === value);
}

/**
 * The clock's display options, resolved from stored strings.
 *
 * Every field lands defined, and an unrecognised value clamps to the default rather than
 * throwing — this is read on the home screen and behind a floating window, neither of
 * which should fail to render because a row holds a face we retired.
 *
 * The three toggles default to **on**: these describe the card the home screen has
 * always shown, so a reader who has never opened the preference sees exactly what they
 * saw before the setting existed.
 */
export function resolveClockFaceOptions(stored: {
  face?: string;
  showDate?: string;
  showWeather?: string;
  showWeekday?: string;
}): ClockFaceOptions {
  return {
    face: stored.face !== undefined && isClockFace(stored.face) ? stored.face : DEFAULT_FACE,
    showDate: resolveFlag(stored.showDate),
    showWeather: resolveFlag(stored.showWeather),
    showWeekday: resolveFlag(stored.showWeekday),
  };
}

/**
 * A stored flag, defaulting to `true`.
 *
 * "0" is the only value that reads as off, matching how the app's other stored flags are
 * written (`"1"`/`"0"`, per `USER_PREFERENCE_KEYS`). Anything unrecognised is on, which
 * is the direction that shows the reader *more* of their card rather than silently
 * hiding half of it.
 */
function resolveFlag(value: string | undefined): boolean {
  return value?.trim() !== "0";
}

/** The options a reader who has stored nothing gets. */
export function defaultClockFaceOptions(): ClockFaceOptions {
  return resolveClockFaceOptions({});
}
