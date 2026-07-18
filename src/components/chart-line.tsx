"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART_CATEGORICAL_COLORS, CHART_CHROME } from "./chart-colors";

export interface ChartLineSeries {
  /** Key into each row of `data`. */
  key: string;
  /** Legend/tooltip label. */
  label: string;
  /** Overrides the default categorical slot for this series' position. */
  color?: string;
}

export interface ChartLineProps {
  /** Rows sharing one `xKey` field plus one numeric field per series key. */
  data: Record<string, number | string>[];
  /** One entry per line. A single series renders with no legend box. */
  series: ChartLineSeries[];
  /** Field in `data` used for the x-axis. */
  xKey: string;
  /** Formats a y-axis tick / tooltip value. */
  formatValue?: (value: number) => string;
  /** Formats an x-axis tick. */
  formatX?: (value: string | number) => string;
  height?: number;
  className?: string;
}

export function ChartLine({
  data,
  series,
  xKey,
  formatValue = (value) => String(value),
  formatX = (value) => String(value),
  height = 280,
  className = "",
}: ChartLineProps) {
  return (
    <div className={className} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={CHART_CHROME.grid} vertical={false} />
          <XAxis
            dataKey={xKey}
            tickFormatter={formatX}
            stroke={CHART_CHROME.axis}
            tick={{ fill: CHART_CHROME.mutedText, fontSize: 12 }}
            tickLine={false}
            axisLine={{ stroke: CHART_CHROME.axis }}
          />
          <YAxis
            tickFormatter={(value: number) => formatValue(value)}
            stroke={CHART_CHROME.axis}
            tick={{ fill: CHART_CHROME.mutedText, fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            width={72}
          />
          <Tooltip
            formatter={(value, name) => [formatValue(Number(value)), String(name)]}
            labelFormatter={(label) => formatX(label as string | number)}
            cursor={{ stroke: CHART_CHROME.axis, strokeWidth: 1 }}
          />
          {series.length > 1 && <Legend />}
          {series.map((item, index) => (
            <Line
              key={item.key}
              type="monotone"
              dataKey={item.key}
              name={item.label}
              stroke={item.color ?? CHART_CATEGORICAL_COLORS[index % CHART_CATEGORICAL_COLORS.length]}
              strokeWidth={2}
              dot={{ r: 4, strokeWidth: 0 }}
              activeDot={{ r: 6 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
