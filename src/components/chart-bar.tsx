"use client";

import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { CHART_CATEGORICAL_COLORS, CHART_CHROME } from "./chart-colors";

export interface ChartBarItem {
  key: string;
  /** Category name, shown as the axis tick and doubling as the identity label. */
  label: string;
  value: number;
  /** Overrides the default categorical slot for this item's position. */
  color?: string;
}

export interface ChartBarProps {
  /** One bar per item — for part-to-whole or magnitude comparisons across a handful of categories. */
  items: ChartBarItem[];
  formatValue?: (value: number) => string;
  height?: number;
  className?: string;
}

// Horizontal bars: each category is already named by its own axis tick, so no
// legend box is needed — the direct value label at the bar's tip is the relief
// channel for any categorical slot that sits below 3:1 contrast on its own.
export function ChartBar({
  items,
  formatValue = (value) => String(value),
  height = Math.max(120, items.length * 44),
  className = "",
}: ChartBarProps) {
  return (
    <div className={className} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={items}
          layout="vertical"
          margin={{ top: 8, right: 48, bottom: 0, left: 8 }}
        >
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="label"
            width={96}
            tick={{ fill: CHART_CHROME.mutedText, fontSize: 12 }}
            tickLine={false}
            axisLine={false}
          />
          <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={24}>
            {items.map((item, index) => (
              <Cell
                key={item.key}
                fill={item.color ?? CHART_CATEGORICAL_COLORS[index % CHART_CATEGORICAL_COLORS.length]}
              />
            ))}
            <LabelList
              dataKey="value"
              position="right"
              formatter={(value) => formatValue(Number(value))}
              fill={CHART_CHROME.mutedText}
              fontSize={12}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
