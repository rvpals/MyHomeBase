"use client";

// A sparkline: one series' shape, at row height, with no axes and no labels.
//
// Deliberately *not* a Recharts chart. `ChartLine` and friends carry axes, a
// tooltip, a legend and a toolbar, and default to 280px tall — everything a
// sparkline is defined by not having. At 120x24 inside a table row, the whole
// job is one `<path>`, so this is plain inline SVG with no dependency at all.
//
// Reach for `ChartLine` when the reader needs to *read values off* the chart.
// Reach for this when the shape is the message and the numbers are already
// printed beside it.

/** A baseline to draw the series against — typically the previous close. */
export interface SparklineBaseline {
  value: number;
  /** Shown as a dashed rule. The series is coloured by where it ends up. */
  label?: string;
}

export interface SparklineProps {
  /**
   * The series, in order. Fewer than two points draws nothing — one point has
   * no shape, and an empty array is a normal answer from a provider.
   */
  values: number[];
  /**
   * Optional reference level. When given, the line is drawn green above it and
   * red below it, matching the dashboard's up/down convention, and a dashed
   * rule marks the level itself.
   */
  baseline?: SparklineBaseline;
  /** Drawn width in px. The SVG scales, so this is also the viewBox width. */
  width?: number;
  height?: number;
  /**
   * Describes the trend for a screen reader. A sparkline with no accessible
   * name is decoration; one with a name is data, and these always are.
   */
  ariaLabel: string;
  className?: string;
}

/**
 * Map values into the viewBox.
 *
 * Self-scaling to its own min/max is the point: each row's window differs (a
 * 24/7 crypto series spans midnight to now, a US index spans the open to now),
 * so a shared scale would flatten most of them into a line. The consequence —
 * that two sparklines are not comparable to each other — is why the card says
 * so in its footnote.
 *
 * A flat series (every value identical) has a zero range, which would divide by
 * zero; it's drawn as a centred horizontal line instead, which is what it is.
 */
function toPoints(
  values: number[],
  baseline: number | undefined,
  width: number,
  height: number,
): { path: string; baselineY: number | null } {
  // Pad by a hair so a peak or trough isn't clipped by the stroke's own width.
  const inset = 1.5;
  const usableHeight = height - inset * 2;

  const candidates = baseline === undefined ? values : [...values, baseline];
  const min = Math.min(...candidates);
  const max = Math.max(...candidates);
  const range = max - min;

  const y = (value: number) =>
    range === 0 ? height / 2 : inset + ((max - value) / range) * usableHeight;
  const x = (index: number) =>
    values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;

  const path = values.map((value, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(2)},${y(value).toFixed(2)}`).join(" ");

  return { path, baselineY: baseline === undefined ? null : y(baseline) };
}

export function Sparkline({
  values,
  baseline,
  width = 112,
  height = 24,
  ariaLabel,
  className = "",
}: SparklineProps) {
  // One point has no shape to draw. Render the box anyway so a table of rows
  // doesn't reflow when one symbol's history is missing.
  if (values.length < 2) {
    return <span className={`inline-block ${className}`} style={{ width, height }} aria-hidden="true" />;
  }

  const { path, baselineY } = toPoints(values, baseline?.value, width, height);

  // Coloured by close-versus-baseline, not by the overall slope: a series that
  // fell all day but is still above the previous close had an up day, and the
  // printed percentage beside it will say so. With no baseline, first-to-last.
  const reference = baseline?.value ?? values[0];
  const last = values[values.length - 1];
  const strokeClass =
    last > reference ? "text-emerald-400" : last < reference ? "text-red-400" : "text-muted";

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={ariaLabel}
      preserveAspectRatio="none"
      className={`${strokeClass} ${className}`}
    >
      {baselineY !== null && (
        <line
          x1={0}
          y1={baselineY}
          x2={width}
          y2={baselineY}
          stroke="currentColor"
          strokeWidth={1}
          strokeDasharray="2 2"
          className="text-line"
          opacity={0.9}
        />
      )}
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
