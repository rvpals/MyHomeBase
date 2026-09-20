"use client";

// One number, shown large, while something animates beside or below it.
//
// The case this exists for: a value that *changes on its own* — a playback
// stepping through history, a running total climbing during a refresh — where
// the number is the thing being watched rather than a figure sitting in a card.
// That's why it isn't `StatTile`: a tile labels a static fact in a grid of other
// facts, this dominates and moves.
//
// Presentation only. The caller owns the timer and decides which value is
// current; this decides how a changing number should look and sound.

export interface BigValueReadoutProps {
  /** The number itself, already formatted — "$1,284,300.00". */
  value: string;
  /** Small line above, naming what's being shown. Also the accessible label. */
  label?: string;
  /** Small line below — a date, a period, a count. */
  caption?: string;
  /** Tints the value. Pass a gain/loss class; defaults to plain ink. */
  valueClassName?: string;
  /**
   * True while the value is still moving. Softens it slightly, the same way the
   * Portfolio Summary's total reads during a refresh, so a settled number is
   * visibly distinct from one mid-flight.
   */
  live?: boolean;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

/**
 * `aria-live="polite"` rather than `assertive`: these values change many times a
 * second during a playback, and an assertive region would interrupt the reader
 * on every frame. Polite waits for a pause, which in practice announces the
 * value it settles on — the one that matters.
 *
 * `tabular-nums` throughout, so digits keep their columns as the figure grows
 * and shrinks instead of shuffling sideways mid-animation.
 */
export function BigValueReadout({
  value,
  label,
  caption,
  valueClassName = "text-ink",
  live = false,
  className = "",
}: BigValueReadoutProps) {
  return (
    <div className={`flex flex-col items-center text-center ${className}`}>
      {label && (
        <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      )}
      <p
        className={`font-display tabular-nums transition-opacity text-5xl max-lg:text-3xl ${valueClassName} ${
          live ? "opacity-90" : ""
        }`}
        aria-live="polite"
        aria-label={label ? `${label}: ${value}` : undefined}
      >
        {value}
      </p>
      {caption && <p className="mt-1 text-xs tabular-nums text-muted">{caption}</p>}
    </div>
  );
}
