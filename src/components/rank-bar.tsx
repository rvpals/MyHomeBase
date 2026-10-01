// A flat proportional bar for one row of a ranked list — "how big is this one
// relative to the biggest".
//
// Pure presentation: it is handed a value and the value to measure against, and
// it draws. It does no ranking, no sorting and no formatting, so the list that
// already sorted its rows stays the only thing that knows the order.

export interface RankBarProps {
  /** This row's magnitude. Negatives and zero render an empty track. */
  value: number;
  /**
   * The value a full bar represents — normally the first row's, since a ranked
   * list arrives sorted. `0` or less renders an empty track rather than
   * dividing by it.
   */
  max: number;
  /**
   * Describes what the bar shows, for assistive tech. Omit it and the bar is
   * `aria-hidden` instead — correct when the row already states the number
   * beside it, which is the common case here.
   */
  ariaLabel?: string;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

/**
 * The smallest width a non-zero value is drawn at, in percent.
 *
 * Without a floor, a count of 1 against a top count of 400 rounds to 0% and the
 * row looks like it has no bar at all — indistinguishable from missing data. Two
 * percent is a visible sliver that still reads as "much smaller".
 */
const MIN_VISIBLE_PERCENT = 2;

/**
 * **Not a chart and not a progress bar.** `ChartBar` is a full Recharts figure
 * with its own axis and height — it replaces a list rather than sitting in one.
 * `Progress3D` is for work underway, and its hard offset shadow is licensed
 * specifically because it reads as a slab in a groove (`design.md` → "buttons are
 * switches, cards are calm"); borrowing that here would put a static statistic
 * into the button vocabulary. So this is deliberately flat: a tinted track with a
 * filled portion, no shadow, no border, no animation.
 *
 * Used by the journal home screen's three ranked lists — Top Tags, Top
 * Categories and the most-used words.
 *
 * The default `w-12` is sized for those: three lists abreast on a full screen
 * leaves each row about a third of the card, and the row already spends ~170px
 * on a rank number, an icon, a count badge and (for words) a dismiss button
 * before the name gets any width at all. Pass `className="w-24"` or wider where
 * the row has room.
 */
export function RankBar({ value, max, ariaLabel, className = "" }: RankBarProps) {
  const percent =
    max <= 0 || value <= 0
      ? 0
      : Math.max(MIN_VISIBLE_PERCENT, Math.min(100, Math.round((value / max) * 100)));

  return (
    <span
      // A plain graphic when it is labelled, so a screen reader announces the
      // label rather than reading a bare percentage; hidden entirely when the
      // caller's row already carries the figure.
      role={ariaLabel ? "img" : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
      className={`h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-brass-soft ${className}`}
    >
      <span className="block h-full rounded-full bg-brass" style={{ width: `${percent}%` }} />
    </span>
  );
}
