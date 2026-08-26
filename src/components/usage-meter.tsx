// A stat tile whose number is a part of a known total, so the tile carries a
// slim filled track as well as the figure. Use it for used/total pairs —
// memory, disk, a quota. For comparing several unrelated categories reach for
// `ChartBar` instead; a meter answers "how full is this one thing".
//
// Pure presentation: the caller formats the values, because only it knows
// whether the unit is bytes, rows or dollars.
//
// The track itself is `Progress3D` — this component is the tile around it (the
// label row, the used/total figure, the caption). It had its own flat bar until
// `Progress3D` existed; there's no reason for two progress tracks in the app.

import { Progress3D } from "@/components/progress-3d";

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
          text relief, so the fill never has to carry the value on its own.

          `formatValue` here feeds the *accessible* readout, not a visible one —
          the tile already prints both figures above, so `showValue` stays off
          and a screen reader still gets "6.1 GB of 32 GB" rather than "19%". */}
      <Progress3D
        value={total > 0 ? used : 0}
        max={total > 0 ? total : 100}
        size="sm"
        ariaLabel={label}
        formatValue={() => `${formatValue(used)} of ${formatValue(total)}`}
        className="mt-3"
      />

      {caption ? <p className="mt-2 text-xs text-muted">{caption}</p> : null}
    </div>
  );
}
