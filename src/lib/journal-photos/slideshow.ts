// The slideshow's options as DATA: what a reader may choose, what they get if they
// choose nothing, and what happens when a value arrives that is not on the menu.
//
// In `src/lib/` rather than inside the viewer component because none of it is
// rendering. The component's job is to draw a `<select>` and run a timer; which
// intervals are on offer, and whether 900 seconds is a sensible one, is a decision that
// should be testable without mounting React.
//
// NOT PERSISTED, on purpose: the viewer starts from `DEFAULT_SLIDESHOW_OPTIONS` every
// time it opens. Remembering them would mean a settings row and a migration, and a
// household viewer that opens fresh is the simpler behaviour to reason about -- nobody
// wonders why today's slideshow inherited last month's 30-second pace.

/** How a photo gives way to the next one. */
export type SlideshowEffect = "none" | "fade" | "slide";

export interface SlideshowOptions {
  /** Seconds each photo is held before advancing. */
  intervalSeconds: number;
  effect: SlideshowEffect;
}

/**
 * The intervals offered, in seconds.
 *
 * A fixed menu rather than a free number box: this is a picture frame, not a
 * configuration screen, and a reader who types `0.2` has made their slideshow useless
 * rather than fast. Three to thirty covers "flick through a folder" to "leave it
 * running over dinner".
 */
export const SLIDESHOW_INTERVAL_CHOICES = [3, 5, 10, 15, 30] as const;

/** The effects offered, with the label the viewer shows for each. */
export const SLIDESHOW_EFFECT_CHOICES: readonly { value: SlideshowEffect; label: string }[] = [
  { value: "none", label: "None" },
  { value: "fade", label: "Cross-fade" },
  { value: "slide", label: "Slide" },
];

/**
 * What a freshly opened viewer starts with.
 *
 * Five seconds because it is long enough to look at a photograph and short enough that
 * a folder of forty does not become an evening. `none` because a transition is a taste
 * a reader opts into -- an effect nobody asked for reads as the app being slow.
 */
export const DEFAULT_SLIDESHOW_OPTIONS: SlideshowOptions = {
  intervalSeconds: 5,
  effect: "none",
};

/** Milliseconds for the viewer's timer -- the one unit conversion, in one place. */
export function slideshowIntervalMs(options: SlideshowOptions): number {
  return options.intervalSeconds * 1000;
}

/**
 * Coerces whatever arrived into options the viewer can actually run.
 *
 * Total rather than throwing: the values come from a `<select>` and, in a bookmarked or
 * hand-edited case, from strings. A slideshow is not worth failing over, so anything
 * unrecognised falls back to the default and the pictures still advance.
 */
export function normaliseSlideshowOptions(input: {
  intervalSeconds?: unknown;
  effect?: unknown;
}): SlideshowOptions {
  return {
    intervalSeconds: normaliseInterval(input.intervalSeconds),
    effect: normaliseEffect(input.effect),
  };
}

function normaliseInterval(value: unknown): number {
  const seconds = typeof value === "string" ? Number(value) : value;
  // Membership in the menu, not a range check: an interval of 7 is harmless but is not
  // something the viewer can show as selected, and a `<select>` with no matching option
  // silently displays its first one.
  return typeof seconds === "number" &&
    (SLIDESHOW_INTERVAL_CHOICES as readonly number[]).includes(seconds)
    ? seconds
    : DEFAULT_SLIDESHOW_OPTIONS.intervalSeconds;
}

function normaliseEffect(value: unknown): SlideshowEffect {
  return SLIDESHOW_EFFECT_CHOICES.some((choice) => choice.value === value)
    ? (value as SlideshowEffect)
    : DEFAULT_SLIDESHOW_OPTIONS.effect;
}
