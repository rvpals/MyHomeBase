"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART_CATEGORICAL_COLORS, CHART_CHROME } from "./chart-colors";
import { pointLabelContent } from "./chart-point-labels";
import { ChartToolbar, useChartDisplay } from "./chart-toolbar";
import { selectLabeledIndexes, type ChartDisplayDefaults } from "@/lib/shared/chart-options";

export interface ChartBarItem {
  key: string;
  /** Category name, shown as the axis tick and doubling as the identity label. */
  label: string;
  value: number;
  /** Overrides the default categorical slot for this item's position. */
  color?: string;
}

export interface ChartBarProps extends ChartDisplayDefaults {
  /** One bar per item — for part-to-whole or magnitude comparisons across a handful of categories. */
  items: ChartBarItem[];
  formatValue?: (value: number) => string;
  height?: number;
  className?: string;
}

// Horizontal bars: each category is already named by its own axis tick, so no
// legend box is needed — the direct value label at the bar's tip is the relief
// channel for any categorical slot that sits below 3:1 contrast on its own.
//
// Which is why this is the one chart that labels every mark by default. A number
// on every point of a dense line is unreadable; a number at the tip of each of
// half a dozen bars is the endorsed treatment, and each bar has a free end to put
// it on. The reader can still turn them off.
export function ChartBar({
  items,
  formatValue = (value) => String(value),
  height = Math.max(120, items.length * 44),
  pointLabels = "all",
  showLegend,
  showGrid = false,
  showToolbar = true,
  displayStorageKey,
  className = "",
}: ChartBarProps) {
  const { display, setDisplay, maxPointLabels } = useChartDisplay(
    { pointLabels, showLegend, showGrid },
    displayStorageKey,
  );

  const labeledIndexes = selectLabeledIndexes(
    items.map((item) => item.value),
    display.pointLabels,
    // Bars carry one label each and have room for it, so the density cap that
    // protects a line chart doesn't apply — a ten-bar chart still labels ten bars.
    Math.max(items.length, maxPointLabels),
  );

  return (
    <div className={className}>
      {showToolbar && (
        <ChartToolbar
          className="mb-1"
          value={display}
          onChange={setDisplay}
          // "Latest" and "high & low" are time-series ideas; a bar chart's
          // categories have no order to have a latest. Markers and a legend don't
          // exist here either — the axis tick names each bar.
          labelModes={["none", "all"]}
          canToggleDots={false}
          canToggleLegend={false}
          pointCount={items.length}
          maxPointLabels={maxPointLabels}
        />
      )}
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={items} layout="vertical" margin={{ top: 8, right: 48, bottom: 0, left: 8 }}>
            {display.showGrid && <CartesianGrid stroke={CHART_CHROME.grid} horizontal={false} />}
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="label"
              width={96}
              tick={{ fill: CHART_CHROME.mutedText, fontSize: 12 }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              formatter={(value) => [formatValue(Number(value)), "Value"]}
              cursor={{ fill: CHART_CHROME.grid }}
            />
            {/* Labels are only drawn once a mark's entry animation finishes, which
                made the value at each bar tip arrive a beat after the bar. */}
            <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={24} isAnimationActive={false}>
              {items.map((item, index) => (
                <Cell
                  key={item.key}
                  fill={
                    item.color ?? CHART_CATEGORICAL_COLORS[index % CHART_CATEGORICAL_COLORS.length]
                  }
                />
              ))}
              {labeledIndexes.length > 0 && (
                <LabelList
                  dataKey="value"
                  content={pointLabelContent({
                    indexes: labeledIndexes,
                    formatValue,
                    placement: "right",
                    matchField: "label",
                    allowedKeys: labeledIndexes.map((index) => items[index].label),
                  })}
                />
              )}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
