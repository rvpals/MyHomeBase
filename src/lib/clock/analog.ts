// The analog face's geometry. Pure — no I/O, no Date.now() of its own.
//
// Angles only; nothing here knows the face's radius or where it sits on screen. The SVG
// owns those, this owns the maths, and the split is what lets the awkward cases (a
// sweeping hour hand, midnight vs noon) be pinned in a test rather than eyeballed on a
// rendering.

/** Hand angles in degrees clockwise from 12 o'clock. */
export interface HandAngles {
  hour: number;
  minute: number;
  second: number;
}

const DEGREES_PER_HOUR = 30; // 360 / 12
const DEGREES_PER_MINUTE = 6; // 360 / 60
const DEGREES_PER_SECOND = 6; // 360 / 60

/**
 * The three hand angles for a moment.
 *
 * The hour and minute hands **sweep** rather than jump: at 6:30 the hour hand sits
 * halfway between 6 and 7, not on the 6. This is the thing a naive
 * `hours * 30` gets wrong, and it is immediately visible on a real clock face — an hour
 * hand pointing squarely at 6 while the minute hand points at 30 reads as broken.
 *
 * The second hand deliberately does *not* sweep with milliseconds. The face is redrawn
 * once a second, so a fractional second angle would only ever render as a jump anyway,
 * and asking for sub-second repaints to smooth it would cost a timer an order of
 * magnitude busier for something nobody is watching that closely.
 *
 * 12-hour, since this is a clock face: `getHours() % 12` maps both midnight and noon to
 * 0 degrees, which is where the hand belongs on a dial with no 24 on it.
 */
export function handAngles(now: Date): HandAngles {
  const seconds = now.getSeconds();
  const minutes = now.getMinutes();
  const hours = now.getHours() % 12;

  return {
    // Each hour is 30 degrees, plus the fraction of the current hour already elapsed.
    // Minutes alone are enough for the hour hand — adding seconds would move it by
    // 0.008 degrees a tick, which is under a tenth of a pixel on any face we draw.
    hour: hours * DEGREES_PER_HOUR + (minutes / 60) * DEGREES_PER_HOUR,
    // The minute hand sweeps with the seconds for the same reason the hour hand sweeps
    // with the minutes: at :59 it should be on the next minute's doorstep, not still
    // squarely on the last one.
    minute: minutes * DEGREES_PER_MINUTE + (seconds / 60) * DEGREES_PER_MINUTE,
    second: seconds * DEGREES_PER_SECOND,
  };
}

/**
 * The 12 hour-mark angles, for drawing the dial's ticks.
 *
 * A function rather than a literal array so the face can't drift out of step with
 * `handAngles` — both derive from `DEGREES_PER_HOUR`.
 */
export function hourMarkAngles(): number[] {
  return Array.from({ length: 12 }, (_, index) => index * DEGREES_PER_HOUR);
}
