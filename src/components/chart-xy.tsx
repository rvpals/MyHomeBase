"use client";

// Configurable X/Y chart supporting line, bar, scatter, and area, with zoom
// in/out/reset and optional data-point markers. Pure presentation: the caller
// supplies already-shaped data + the chosen encoding; this component only draws.
//
// Follows the dataviz skill: one shared y-scale (never dual-axis), the fixed
// categorical palette from chart-colors (assigned by series order, never
// re-derived), a legend only for >1 series, thin 2px marks, and recessive
// grid/axis chrome. Zoom is a windowed slice over the (pre-sorted) data.

import { memo, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
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
import { pointLabelContent } from "./chart-point-labels";
import { ChartToolbar, useChartDisplay } from "./chart-toolbar";
import { selectLabeledIndexes, type ChartDisplayDefaults } from "@/lib/shared/chart-options";

export type ChartType = "line" | "bar" | "scatter" | "area";

export interface ChartXYSeries {
  /** Key into each row of `data` (values should be numeric). */
  key: string;
  /** Legend/tooltip label. */
  label: string;
  /** Overrides the default categorical slot for this series' position. */
  color?: string;
}

export interface ChartXYProps extends ChartDisplayDefaults {
  type: ChartType;
  /** Rows sharing one `xKey` field plus one numeric field per series key. */
  data: Record<string, number | string | null>[];
  xKey: string;
  series: ChartXYSeries[];
  formatValue?: (value: number) => string;
  formatX?: (value: string | number) => string;
  height?: number;
  /** How a line/area is drawn between points. Default `monotone` (smoothed). */
  curve?: "monotone" | "linear";
  className?: string;
}

const ZOOM_FACTOR = 0.6;
const MIN_WINDOW = 2;

function ChartXYComponent({
  type,
  data,
  xKey,
  series,
  formatValue = (value) => String(value),
  formatX = (value) => String(value),
  height = 320,
  curve = "monotone",
  pointLabels,
  showDots = false,
  showLegend,
  showGrid,
  showToolbar = true,
  displayStorageKey,
  className = "",
}: ChartXYProps) {
  const { display, setDisplay, maxPointLabels } = useChartDisplay(
    { pointLabels, showDots, showLegend: showLegend ?? series.length > 1, showGrid },
    displayStorageKey,
  );
  const total = data.length;
  const [zoomWindow, setZoomWindow] = useState<{ start: number; end: number }>({ start: 0, end: total });

  // Reset the zoom window whenever the dataset or encoding changes shape.
  //
  // Adjusted during render rather than in an effect: an effect would commit one frame
  // showing the previous window against the new data before correcting itself, and
  // React flags a synchronous setState in an effect for exactly that reason.
  const shape = `${total}|${xKey}|${series.map((item) => item.key).join(",")}`;
  const [renderedShape, setRenderedShape] = useState(shape);
  if (renderedShape !== shape) {
    setRenderedShape(shape);
    setZoomWindow({ start: 0, end: total });
  }

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
        {display.showGrid && (
          <CartesianGrid stroke={CHART_CHROME.grid} vertical={type === "scatter"} />
        )}
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
        {display.showLegend && <Legend />}
      </>
    );
  }

  // The value labels for one series, over the zoom window that's actually drawn —
  // so zooming in re-picks the visible extremes rather than pointing off-screen.
  // Scatter is excluded: its marks are the points, with no free end to print on.
  function labelsFor(key: string) {
    if (type === "scatter") return null;
    const indexes = selectLabeledIndexes(
      visibleData.map((row) => row[key]),
      display.pointLabels,
      maxPointLabels,
    );
    if (indexes.length === 0) return null;

    return (
      <LabelList
        dataKey={key}
        content={pointLabelContent({
          indexes,
          formatValue,
          placement: type === "bar" ? "cap" : "above",
          lastIndex: visibleData.length - 1,
          matchField: xKey,
          allowedKeys: indexes
            .map((index) => visibleData[index][xKey])
            .filter((value): value is string | number => value != null),
        })}
      />
    );
  }

  function renderChart() {
    const margin = { top: 14, right: 24, bottom: 0, left: 0 };
    switch (type) {
      case "bar":
        return (
          <BarChart data={visibleData} margin={margin}>
            {commonChildren(xKey)}
            {series.map((item, index) => (
              <Bar key={item.key} dataKey={item.key} name={item.label} fill={colorFor(index, item.color)} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                {labelsFor(item.key)}
              </Bar>
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
                type={curve}
                dataKey={item.key}
                name={item.label}
                stroke={colorFor(index, item.color)}
                fill={colorFor(index, item.color)}
                fillOpacity={0.2}
                strokeWidth={2}
                // Explicit fill: Recharts defaults a dot to white, which reads as a
                // dashed line once the points are dense.
                dot={display.showDots ? { r: 4, strokeWidth: 0, fill: colorFor(index, item.color) } : false}
                activeDot={{ r: 6 }}
                isAnimationActive={false}
              >
                {labelsFor(item.key)}
              </Area>
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
                type={curve}
                dataKey={item.key}
                name={item.label}
                stroke={colorFor(index, item.color)}
                strokeWidth={2}
                // Explicit fill: Recharts defaults a dot to white, which reads as a
                // dashed line once the points are dense.
                dot={display.showDots ? { r: 4, strokeWidth: 0, fill: colorFor(index, item.color) } : false}
                activeDot={{ r: 6 }}
                isAnimationActive={false}
              >
                {labelsFor(item.key)}
              </Line>
            ))}
          </LineChart>
        );
    }
  }

  return (
    <div className={className}>
      {/* The zoom controls ride in the shared toolbar rather than a row of their
          own, so a chart has one strip of controls instead of two stacked. */}
      <ChartToolbar
        className="mb-2"
        value={display}
        onChange={setDisplay}
        showOptions={showToolbar}
        labelModes={type === "scatter" ? ["none"] : undefined}
        canToggleDots={type === "line" || type === "area"}
        canToggleLegend={series.length > 1}
        pointCount={visibleData.length}
        maxPointLabels={maxPointLabels}
      >
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
      </ChartToolbar>
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
