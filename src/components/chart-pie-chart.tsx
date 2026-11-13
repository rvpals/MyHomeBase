"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { CHART_CATEGORICAL_COLORS, CHART_CHROME } from "./chart-colors";
import type { PartToWholeSlice } from "@/lib/shared/chart-options";

/**
 * A slice smaller than this prints no percentage — the text would collide with its
 * neighbours and overflow a thin wedge. 5%.
 */
const MIN_LABELLED_SHARE = 0.05;

export interface ChartPieProps {
  /**
   * The slices, biggest first. **At most `MAX_PART_TO_WHOLE_SLICES`** — run them
   * through `foldToOther` first; this component doesn't fold, so that the caller
   * chooses the wording of the folded slice.
   */
  items: PartToWholeSlice[];
  formatValue?: (value: number) => string;
  height?: number;
  className?: string;
  /**
   * Raised with the slice that was clicked. The component raises intent and
   * nothing more — whether a slice is *worth* clicking (a pooled "others", a
   * drillable category) is the caller's call, and so is what happens next.
   *
   * Supplying this makes every slice clickable, so pair it with `isSliceEnabled`
   * when only some are. Slices are only keyboard-reachable through the companion
   * list the caller renders — see the note on the component.
   */
  onSliceClick?: (slice: PartToWholeSlice) => void;
  /** Which slices `onSliceClick` applies to. Defaults to all of them. */
  isSliceEnabled?: (slice: PartToWholeSlice) => boolean;
}

/**
 * A pie: one categorical share of a whole, read at a glance.
 *
 * Deliberately the most constrained chart in the set, because the form is the most
 * constrained. Three things are fixed rather than exposed as props:
 *
 * 1. **No more than a handful of slices.** A pie is an *all-pairs* form — any slice
 *    can sit beside any other — so every colour pair must be separable. Six slots of
 *    `CHART_CATEGORICAL_COLORS` fail the dataviz validator's normal-vision floor
 *    under `--pairs all`; five pass. `foldToOther` enforces it upstream.
 * 2. **Each slice ≥5% carries its percentage inside the ring**, and there is no
 *    legend box — outside labels clipped off a narrow card and the legend merely
 *    repeated them. Three of the palette's hues sit below 3:1 against the paper
 *    surface, which the validator only lets go with "visible labels or a table
 *    view", so **the caller must render a companion list** naming each slice. That
 *    list is also where a keyboard reaches a clickable slice.
 * 3. **A 2px surface gap between slices** (`paddingAngle` + a paper stroke), the
 *    spacer the mark spec asks for between adjacent fills.
 *
 * For comparing magnitudes rather than shares — "who did I spend most at" — a
 * `ChartBar` is the better read and stays the default. Reach for this when the
 * question is "what fraction of the whole".
 */
export function ChartPie({
  items,
  formatValue = (value) => String(value),
  height = 260,
  className = "",
  onSliceClick,
  isSliceEnabled = () => true,
}: ChartPieProps) {
  const total = items.reduce((sum, item) => sum + item.value, 0);

  function clickableSlice(item: PartToWholeSlice): boolean {
    return onSliceClick !== undefined && isSliceEnabled(item);
  }

  /**
   * The share, printed *inside* its own slice.
   *
   * Recharts' outside labels were the first attempt and had to go: at a phone's
   * width a vendor name plus its percentage clipped off both edges of the card.
   * Inside the ring the text can't overflow the box no matter how narrow it gets,
   * and the caller's table names the slices.
   *
   * A slice thinner than this prints nothing — a 2% label collides with its
   * neighbours and the table carries the number anyway.
   */
  function renderSliceLabel({
    cx,
    cy,
    midAngle,
    innerRadius,
    outerRadius,
    percent,
  }: {
    cx?: number;
    cy?: number;
    midAngle?: number;
    innerRadius?: number;
    outerRadius?: number;
    percent?: number;
  }) {
    if (
      cx === undefined ||
      cy === undefined ||
      midAngle === undefined ||
      innerRadius === undefined ||
      outerRadius === undefined ||
      percent === undefined ||
      percent < MIN_LABELLED_SHARE
    ) {
      return <text />;
    }

    // Midway through the ring's thickness, so the text sits on the fill.
    const radius = innerRadius + (outerRadius - innerRadius) / 2;
    const radians = -midAngle * (Math.PI / 180);
    return (
      <text
        x={cx + radius * Math.cos(radians)}
        y={cy - radius * Math.sin(radians)}
        textAnchor="middle"
        dominantBaseline="central"
        // On the fill, so it takes the surface colour rather than a text token —
        // the one place that rule bends, because the alternative is unreadable.
        fill="#ffffff"
        fontSize={11}
        fontWeight={600}
      >
        {`${Math.round(percent * 100)}%`}
      </text>
    );
  }

  return (
    <div className={className}>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
            <Pie
              data={items}
              dataKey="value"
              nameKey="label"
              // A donut rather than a full pie: the hole removes the centre, where
              // slice angles are hardest to compare, and gives the labels room.
              //
              // Nothing is drawn outside the arc any more, so the ring can use the
              // box. A thick ring is also what gives the on-slice percentage room.
              innerRadius="52%"
              outerRadius="86%"
              // The 2px spacer between adjacent fills, drawn in the surface colour
              // so it reads as a gap rather than an outline.
              paddingAngle={2}
              stroke={CHART_CHROME.grid}
              strokeWidth={2}
              // Labels are drawn after the entry animation, which made every label
              // arrive a beat late — the same reason ChartBar turns this off.
              isAnimationActive={false}
              // A render function rather than Recharts' object form, which can style
              // the text but can't compute it. Text wears text tokens, never the
              // series colour — the slice beside it carries the identity.
              label={renderSliceLabel}
              // No leader lines: the labels are on the marks now.
              labelLine={false}
            >
              {items.map((item, index) => (
                <Cell
                  key={item.key}
                  // Fixed order, never cycled — a 6th slice would repeat a hue, so
                  // `foldToOther` prevents one from ever arriving.
                  fill={CHART_CATEGORICAL_COLORS[index % CHART_CATEGORICAL_COLORS.length]}
                  // The cursor is the only affordance a wedge can carry — it has no
                  // room for an icon, and tinting it would break the palette.
                  cursor={clickableSlice(item) ? "pointer" : undefined}
                  onClick={clickableSlice(item) ? () => onSliceClick?.(item) : undefined}
                />
              ))}
            </Pie>
            <Tooltip
              formatter={(value, name) => [
                total > 0
                  ? `${formatValue(Number(value))} (${Math.round((Number(value) / total) * 100)}%)`
                  : formatValue(Number(value)),
                String(name),
              ]}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
