"use client";

import type { ReactElement } from "react";
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

/** What a custom dot renderer is told about the point it's drawing. */
export interface ChartLineDotContext {
  /** Centre of the point, in SVG user units. */
  cx: number;
  cy: number;
  /** Position in `data`, so a renderer can key off the row it came from. */
  index: number;
  /** The whole row this point was read from — carry extra fields on it to switch on. */
  payload: Record<string, number | string>;
  /** The series' resolved colour, so a custom mark can match its line by default. */
  color: string;
}

export interface ChartLineSeries {
  /** Key into each row of `data`. */
  key: string;
  /** Legend/tooltip label. */
  label: string;
  /** Overrides the default categorical slot for this series' position. */
  color?: string;
  /**
   * Draws this series' points yourself, instead of the default filled circle.
   * Return an SVG element, or `null` to draw nothing at that point.
   *
   * Use it when the *shape* of a point carries meaning the line can't — a buy
   * against a sell, say. Prefer a second series when the extra thing is its own
   * quantity; a shape is for annotating the points you already have. Recharts
   * needs an element back, so a plain fragment won't do.
   */
  renderDot?: (context: ChartLineDotContext) => ReactElement | null;
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
          {series.map((item, index) => {
            const color =
              item.color ?? CHART_CATEGORICAL_COLORS[index % CHART_CATEGORICAL_COLORS.length];

            return (
              <Line
                key={item.key}
                type="monotone"
                dataKey={item.key}
                name={item.label}
                stroke={color}
                strokeWidth={2}
                dot={
                  item.renderDot
                    ? // Recharts hands the renderer its own props and expects an
                      // element back; the cast narrows those to the fields a caller
                      // should care about rather than leaking the library's shape.
                      (props: unknown) => {
                        const dot = props as {
                          cx?: number;
                          cy?: number;
                          index?: number;
                          payload?: Record<string, number | string>;
                        };
                        if (dot.cx == null || dot.cy == null) return <g key="empty" />;
                        return (
                          item.renderDot?.({
                            cx: dot.cx,
                            cy: dot.cy,
                            index: dot.index ?? 0,
                            payload: dot.payload ?? {},
                            color,
                          }) ?? <g key="empty" />
                        );
                      }
                    : { r: 4, strokeWidth: 0 }
                }
                activeDot={{ r: 6 }}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
