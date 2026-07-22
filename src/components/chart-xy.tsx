"use client";

// Configurable X/Y chart supporting line, bar, scatter, and area, with zoom
// in/out/reset and optional data-point markers. Pure presentation: the caller
// supplies already-shaped data + the chosen encoding; this component only draws.
//
// Follows the dataviz skill: one shared y-scale (never dual-axis), the fixed
// categorical palette from chart-colors (assigned by series order, never
// re-derived), a legend only for >1 series, thin 2px marks, and recessive
// grid/axis chrome. Zoom is a windowed slice over the (pre-sorted) data.

import { memo, useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/button";
import { CHART_CATEGORICAL_COLORS, CHART_CHROME } from "./chart-colors";

export type ChartType = "line" | "bar" | "scatter" | "area";

export interface ChartXYSeries {
  /** Key into each row of `data` (values should be numeric). */
  key: string;
  /** Legend/tooltip label. */
  label: string;
  /** Overrides the default categorical slot for this series' position. */
  color?: string;
}

export interface ChartXYProps {
  type: ChartType;
  /** Rows sharing one `xKey` field plus one numeric field per series key. */
  data: Record<string, number | string | null>[];
  xKey: string;
  series: ChartXYSeries[];
  /** Draw a marker at each data point (line/area). Default false. */
  showDots?: boolean;
  formatValue?: (value: number) => string;
  formatX?: (value: string | number) => string;
  height?: number;
  className?: string;
}

const ZOOM_FACTOR = 0.6;
const MIN_WINDOW = 2;

function ChartXYComponent({
  type,
  data,
  xKey,
  series,
  showDots = false,
  formatValue = (value) => String(value),
  formatX = (value) => String(value),
  height = 320,
  className = "",
}: ChartXYProps) {
  const total = data.length;
  const [zoomWindow, setZoomWindow] = useState<{ start: number; end: number }>({ start: 0, end: total });

  // Reset the zoom window whenever the dataset or encoding changes shape.
  const seriesKeys = series.map((item) => item.key).join(",");
  useEffect(() => {
    setZoomWindow({ start: 0, end: total });
  }, [total, xKey, seriesKeys]);

  const visibleData = useMemo(
    () => data.slice(zoomWindow.start, zoomWindow.end),
    [data, zoomWindow],
  );
  const width = zoomWindow.end - zoomWindow.start;
  const canZoomIn = width > MIN_WINDOW;
  const canZoomOut = width < total;

  function rewindow(newWidth: number) {
    const clampedWidth = Math.max(MIN_WINDOW, Math.min(total, newWidth));
    const center = Math.floor((zoomWindow.start + zoomWindow.end) / 2);
    const start = Math.max(0, Math.min(center - Math.floor(clampedWidth / 2), total - clampedWidth));
    setZoomWindow({ start, end: start + clampedWidth });
  }

  const axisProps = {
    stroke: CHART_CHROME.axis,
    tick: { fill: CHART_CHROME.mutedText, fontSize: 12 },
    tickLine: false,
  } as const;

  function colorFor(index: number, override?: string) {
    return override ?? CHART_CATEGORICAL_COLORS[index % CHART_CATEGORICAL_COLORS.length];
  }

  // Grid + axes + tooltip + legend, shared across chart types. Scatter passes its
  // own synthetic x/y axis keys ("__x"/"__y"); the others key the x-axis off `xKey`
  // and let each series' mark supply the y via its own dataKey.
  function commonChildren(xAxisDataKey: string, yAxisDataKey?: string) {
    return (
      <>
        <CartesianGrid stroke={CHART_CHROME.grid} vertical={type === "scatter"} />
        <XAxis
          dataKey={xAxisDataKey}
          type={type === "scatter" ? "number" : "category"}
          tickFormatter={(value) => formatX(value as string | number)}
          axisLine={{ stroke: CHART_CHROME.axis }}
          {...axisProps}
        />
        <YAxis
          dataKey={yAxisDataKey}
          type="number"
          tickFormatter={(value: number) => formatValue(value)}
          axisLine={false}
          width={72}
          {...axisProps}
        />
        <Tooltip
          formatter={(value, name) => [formatValue(Number(value)), String(name)]}
          labelFormatter={(label) => formatX(label as string | number)}
          cursor={{ stroke: CHART_CHROME.axis, strokeWidth: 1 }}
        />
        {series.length > 1 && <Legend />}
      </>
    );
  }

  function renderChart() {
    const margin = { top: 8, right: 16, bottom: 0, left: 0 };
    switch (type) {
      case "bar":
        return (
          <BarChart data={visibleData} margin={margin}>
            {commonChildren(xKey)}
            {series.map((item, index) => (
              <Bar key={item.key} dataKey={item.key} name={item.label} fill={colorFor(index, item.color)} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            ))}
          </BarChart>
        );
      case "area":
        return (
          <AreaChart data={visibleData} margin={margin}>
            {commonChildren(xKey)}
            {series.map((item, index) => (
              <Area
                key={item.key}
                type="monotone"
                dataKey={item.key}
                name={item.label}
                stroke={colorFor(index, item.color)}
                fill={colorFor(index, item.color)}
                fillOpacity={0.2}
                strokeWidth={2}
                dot={showDots ? { r: 4, strokeWidth: 0 } : false}
                activeDot={{ r: 6 }}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        );
      case "scatter":
        return (
          <ScatterChart margin={margin}>
            {commonChildren("__x", "__y")}
            {series.map((item, index) => (
              <Scatter
                key={item.key}
                name={item.label}
                data={visibleData.map((row) => ({ __x: row[xKey], __y: row[item.key] }))}
                fill={colorFor(index, item.color)}
                isAnimationActive={false}
              />
            ))}
          </ScatterChart>
        );
      case "line":
      default:
        return (
          <LineChart data={visibleData} margin={margin}>
            {commonChildren(xKey)}
            {series.map((item, index) => (
              <Line
                key={item.key}
                type="monotone"
                dataKey={item.key}
                name={item.label}
                stroke={colorFor(index, item.color)}
                strokeWidth={2}
                dot={showDots ? { r: 4, strokeWidth: 0 } : false}
                activeDot={{ r: 6 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        );
    }
  }

  return (
    <div className={className}>
      <div className="mb-2 flex items-center justify-end gap-2">
        <span className="mr-auto text-xs text-muted">
          Showing {visibleData.length.toLocaleString()} of {total.toLocaleString()} points
        </span>
        <Button size="sm" variant="secondary" disabled={!canZoomOut} onClick={() => rewindow(Math.ceil(width / ZOOM_FACTOR))}>
          − Zoom out
        </Button>
        <Button size="sm" variant="secondary" disabled={!canZoomIn} onClick={() => rewindow(Math.floor(width * ZOOM_FACTOR))}>
          + Zoom in
        </Button>
        <Button size="sm" variant="secondary" disabled={width === total} onClick={() => setZoomWindow({ start: 0, end: total })}>
          Reset
        </Button>
      </div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          {renderChart()}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// Memoized so unrelated parent re-renders (e.g. toggling a sibling control) don't
// re-render the chart — only a genuine prop change does. Relies on the caller
// passing stable `data`/`series`/`formatValue` identities (see ChartBuilder).
export const ChartXY = memo(ChartXYComponent);
