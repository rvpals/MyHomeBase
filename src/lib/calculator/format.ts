// Formatting a result for display.
//
// Two audiences, two functions. `formatResult` fills a window's display line;
// `formatForPuck` has to fit a 56px circle, which is a genuinely different problem --
// `-1.2345678e-11` is a perfectly good answer and completely unreadable at that size.
//
// Both are pure and both live here rather than in the view, because "how many digits is
// this number worth" is a rule about numbers, not about markup -- and the CLI prints
// the same strings the window shows.

/**
 * Significant digits kept in the window's display.
 *
 * 12, not 17. IEEE doubles carry ~15-17 significant digits, but the last few are noise
 * from binary representation rather than information: `0.1 + 0.2` is exactly
 * 0.30000000000000004 and showing that is technically honest and practically useless.
 * Rounding to 12 makes it `0.3` while still distinguishing values a reader could
 * plausibly care about. Every desk calculator makes this trade; 12 is the common choice.
 */
const DISPLAY_PRECISION = 12;

/** Above this magnitude, fixed notation is unreadable and we switch to exponent form. */
const EXPONENT_CEILING = 1e12;

/** Below this magnitude (and non-zero), likewise -- 0.000000001 becomes 1e-9. */
const EXPONENT_FLOOR = 1e-7;

/**
 * Strips the trailing zeros `toPrecision` leaves behind.
 *
 * `(0.3).toPrecision(12)` is "0.300000000000", which is the right number and the wrong
 * string. Only applied to fixed notation -- an exponent form's mantissa is already
 * minimal, and trimming inside one would corrupt it.
 */
function trimZeros(text: string): string {
  if (!text.includes(".")) return text;
  return text.replace(/\.?0+$/, "");
}

/**
 * A result, formatted for the calculator's display.
 *
 * Handles the three cases that would otherwise reach a reader as something odd:
 * negative zero (`-0` renders as "0" -- it is equal to zero and showing a signed zero
 * looks like a bug), very large and very small magnitudes (exponent form), and float
 * representation noise (rounded away by the precision limit).
 */
export function formatResult(value: number): string {
  // `-0` is `=== 0`, so this is about the *string*: `String(-0)` is "0" but
  // `(-0).toPrecision(12)` is "-0.00000000000". Normalised up front.
  if (value === 0) return "0";

  if (!Number.isFinite(value)) {
    // Shouldn't arrive -- the evaluator converts these to errors -- but formatting is
    // also called on stored history, and a corrupted row must not render "Infinity"
    // as though it were an answer.
    return "—";
  }

  const magnitude = Math.abs(value);

  if (magnitude >= EXPONENT_CEILING || magnitude < EXPONENT_FLOOR) {
    // `toExponential` with one fewer digit than the precision, since the mantissa's
    // leading digit counts toward the significant total.
    return value
      .toExponential(Math.min(DISPLAY_PRECISION - 1, 6))
      // "1.200000e+21" -> "1.2e+21": trim the mantissa's zeros without touching the
      // exponent, which is why this is split on "e" rather than regexed whole.
      .replace(/^(-?\d)(?:\.(\d*?))?0*e/, (_match, lead: string, fraction?: string) =>
        fraction && fraction.length > 0 ? `${lead}.${fraction}e` : `${lead}e`,
      );
  }

  return trimZeros(value.toPrecision(DISPLAY_PRECISION));
}

/**
 * How many characters the puck can show before the value has to be abbreviated.
 *
 * Six fits a 56px circle at the smallest font size that is still legible. Past that the
 * digits become a grey smear, which tells the reader nothing -- an abbreviated `1.2e8`
 * says "about a hundred million" at a glance, where `123456789` squeezed into 56px says
 * nothing at all.
 */
const PUCK_BUDGET = 6;

/**
 * The last result, shortened to fit the minimized puck.
 *
 * This is the "image of the last result" the puck shows. It is deliberately lossy: the
 * full value stays in the button's `title` and `aria-label`, and one tap restores the
 * window, so nothing is actually hidden -- the puck is a glance, not a readout.
 *
 * Returns `undefined` for a calculator that has not produced a result yet, so the view
 * can draw its `=` glyph instead of an empty circle.
 */
export function formatForPuck(value: number | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value === 0) return "0";
  if (!Number.isFinite(value)) return "—";

  const full = formatResult(value);
  if (full.length <= PUCK_BUDGET) return full;

  const magnitude = Math.abs(value);

  // Big or tiny: exponent form, mantissa cut to one decimal. `1.2e8` is five characters
  // and conveys the size immediately.
  if (magnitude >= 1e5 || magnitude < 1e-3) {
    const [mantissa, exponent] = value.toExponential(1).split("e");
    // The `+` in "e+8" is noise at this size; the exponent's sign only matters when
    // negative.
    const sign = exponent.startsWith("-") ? "-" : "";
    const digits = exponent.replace(/^[+-]/, "");
    return `${trimZeros(mantissa)}e${sign}${digits}`;
  }

  // A mid-sized number with a long fraction. Rounding the *fraction* to fit is what a
  // reader wants here -- 3.1416 is recognisably pi, where a truncated "3…" says almost
  // nothing. So the decimal places are chosen from the space the integer part leaves,
  // rather than from a fixed significant-digit count: `toPrecision(6)` gives "3.14159"
  // (7 characters) and would overflow the budget it was meant to respect.
  const integerText = String(Math.trunc(value));
  // The budget, less the integer part and the "." itself. Negative for a big integer
  // part, which the clamp turns into "no decimals".
  const decimals = Math.max(PUCK_BUDGET - integerText.length - 1, 0);

  if (decimals > 0) {
    const fixed = trimZeros(value.toFixed(decimals));
    if (fixed.length <= PUCK_BUDGET) return fixed;
  }

  // No room for a fraction at all: the integer part alone, with an ellipsis rather than
  // a silent round, so the reader can see there is more to the number than this.
  const rounded = String(Math.round(value));
  return rounded.length <= PUCK_BUDGET ? rounded : `${rounded.slice(0, PUCK_BUDGET - 1)}…`;
}

/**
 * The font size class for a puck showing `text`, by length.
 *
 * A table rather than a calculation: these are four hand-checked values that keep the
 * text inside a 56px circle, and the steps are not linear in character count. Returning
 * a class name keeps the arithmetic out of the component while leaving the actual
 * styling to Tailwind.
 */
export function puckTextSize(text: string): string {
  if (text.length <= 2) return "text-lg";
  if (text.length <= 4) return "text-sm";
  if (text.length <= 6) return "text-xs";
  return "text-[0.625rem]";
}
