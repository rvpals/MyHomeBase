// The sleep timer's arithmetic: durations in, seconds out.
//
// Everything here takes the current time as an argument rather than calling `Date.now()`
// itself. That is the whole reason this file exists apart from the provider that drives
// it -- a countdown whose clock is a parameter can be tested at any instant without fake
// timers, and the only thing left in the component is a `setInterval` and a string.
//
// The timer is a WALL CLOCK, not a playback clock: it counts down whether or not audio is
// playing. Pausing to answer the door does not extend your night, which is what a sleep
// timer is for.

/** One entry in the preset dropdown. */
export interface SleepTimerPreset {
  /** Whole minutes. The stable identity of the preset -- used as a React key. */
  minutes: number;
  /** How the option reads in the list. */
  label: string;
}

/**
 * The presets, shortest first.
 *
 * Under an hour reads in minutes and over it in hours, because "90 minutes" is a
 * quantity while "1 hour 30 minutes" is a duration, and a list that mixes the two units
 * in one column is harder to scan than one that switches at the natural boundary.
 */
export const SLEEP_TIMER_PRESETS: readonly SleepTimerPreset[] = [
  { minutes: 15, label: "15 minutes" },
  { minutes: 20, label: "20 minutes" },
  { minutes: 30, label: "30 minutes" },
  { minutes: 45, label: "45 minutes" },
  { minutes: 60, label: "1 hour" },
  { minutes: 120, label: "2 hours" },
  { minutes: 240, label: "4 hours" },
];

/**
 * The longest timer that can be set, in seconds -- twelve hours.
 *
 * A cap rather than an open number field: the hour box is two characters wide and a
 * mistyped `99` would arm a four-day timer that looks, from the countdown, exactly like
 * a timer that is not running. Twelve hours is past any real overnight use.
 */
export const MAX_SLEEP_TIMER_SECONDS = 12 * 60 * 60;

/** The shortest timer worth arming. Below this, `clampTimerSeconds` reports nothing. */
export const MIN_SLEEP_TIMER_SECONDS = 60;

/**
 * Converts the two number fields into seconds.
 *
 * Non-finite and negative inputs floor to zero rather than throwing: these come straight
 * from `Number(event.target.value)` on an `<input type="number">`, where an empty box is
 * `NaN` and a browser will happily hand over a negative if the user types a minus. The
 * caller wants a duration, not an exception.
 */
export function hoursMinutesToSeconds(hours: number, minutes: number): number {
  const wholeHours = Number.isFinite(hours) ? Math.max(Math.floor(hours), 0) : 0;
  const wholeMinutes = Number.isFinite(minutes) ? Math.max(Math.floor(minutes), 0) : 0;
  return wholeHours * 3600 + wholeMinutes * 60;
}

/**
 * Narrows a requested duration to one that can actually be armed, or `undefined` when it
 * cannot be.
 *
 * Returning `undefined` rather than clamping up to the minimum is deliberate: pressing
 * Start with both boxes empty means "I have not chosen yet", and silently arming a
 * one-minute timer that stops the music mid-song is the worst possible reading of that.
 * Over the maximum *does* clamp, because there the intent is unambiguous -- the listener
 * asked for a long timer and gets the longest one available.
 */
export function clampTimerSeconds(seconds: number): number | undefined {
  if (!Number.isFinite(seconds) || seconds < MIN_SLEEP_TIMER_SECONDS) return undefined;
  return Math.min(Math.floor(seconds), MAX_SLEEP_TIMER_SECONDS);
}

/**
 * Seconds left until `deadlineMs`, never negative.
 *
 * Rounded up, so a timer armed for 60 seconds reads "1:00" on the first tick instead of
 * "0:59" -- the countdown should start at the number the listener asked for.
 */
export function remainingSeconds(deadlineMs: number, nowMs: number): number {
  return Math.max(Math.ceil((deadlineMs - nowMs) / 1000), 0);
}

/**
 * Whether the deadline has passed.
 *
 * Exactly at the deadline counts as expired: the alternative leaves a timer that reads
 * "0:00" and is still playing, which reads as a bug.
 */
export function hasExpired(deadlineMs: number, nowMs: number): boolean {
  return nowMs >= deadlineMs;
}

/**
 * The countdown as it appears on screen: `m:ss` under an hour, `h:mm:ss` over it.
 *
 * The hour field is dropped rather than padded to `0:05:30` so the common case -- the
 * last few minutes of a timer -- stays as narrow as the track position beside it in the
 * player bar, where horizontal space is the scarce thing.
 */
export function formatCountdown(seconds: number): string {
  const whole = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

/**
 * The countdown spelled out for a screen reader, e.g. "1 hour 5 minutes left".
 *
 * `formatCountdown`'s `1:05:00` is read aloud as a time of day by most screen readers,
 * which is wrong in a way that is hard to notice if you are not using one. Seconds are
 * omitted above a minute -- a value that changes every second is announced constantly,
 * and the exact second does not matter until the end.
 */
export function describeCountdown(seconds: number): string {
  const whole = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  if (whole < 60) return `${whole} ${whole === 1 ? "second" : "seconds"} left`;

  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
  if (minutes > 0) parts.push(`${minutes} ${minutes === 1 ? "minute" : "minutes"}`);
  return `${parts.join(" ")} left`;
}
