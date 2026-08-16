// A stat tile whose number is a part of a known total, so the tile carries a
// slim filled track as well as the figure. Use it for used/total pairs —
// memory, disk, a quota. For comparing several unrelated categories reach for
// `ChartBar` instead; a meter answers "how full is this one thing".
//
// Pure presentation: the caller formats the values, because only it knows
// whether the unit is bytes, rows or dollars.

export interface UsageMeterProps {
  /** Tile label, e.g. "RAM Used / Total". */
  label: string;
  /** The filled portion, in the same unit as `total`. */
  used: number;
  /** The whole. A zero or negative total renders an empty track rather than dividing by it. */
  total: number;
  /** Formats both figures for display. */
  formatValue: (value: number) => string;
  /**
   * Qualifies what the total is when that isn't self-evident from the label —
   * a process's resident memory, say, measured against total system RAM.
   */
  caption?: string;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

export function UsageMeter({
  label,
  used,
  total,
  formatValue,
  caption,
  className = "",
}: UsageMeterProps) {
  const fraction = total > 0 ? Math.min(Math.max(used / total, 0), 1) : 0;
  const percentText = `${Math.round(fraction * 100)}%`;

  return (
    <div className={`rounded-xl border border-line p-4 ${className}`}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
        <p className="font-mono text-xs text-muted">{percentText}</p>
      </div>

      <p className="mt-1 font-display text-lg text-ink">
        {formatValue(used)} <span className="text-muted">/ {formatValue(total)}</span>
      </p>

      {/* The track is the reader's comparison channel; the percentage above is the
          text relief, so the fill never has to carry the value on its own. */}
      <div
        className="mt-3 h-2 overflow-hidden rounded-full bg-line"
        role="meter"
        aria-label={label}
        aria-valuenow={Math.round(fraction * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${formatValue(used)} of ${formatValue(total)}`}
      >
        <div className="h-full rounded-full bg-brass" style={{ width: `${fraction * 100}%` }} />
      </div>

      {caption ? <p className="mt-2 text-xs text-muted">{caption}</p> : null}
    </div>
  );
}
