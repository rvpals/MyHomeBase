"use client";

// Lazy boundary for `ChartLine`. The chart itself lives in `chart-line-chart.tsx`;
// this file exists only so that importing it doesn't drag Recharts into the page.
//
// Recharts is ~1.4 MB of JS. Statically imported anywhere in the tree it lands in a
// chunk every user downloads on every page, chart or no chart. `next/dynamic` moves
// it into an async chunk that is fetched the first time a chart actually renders.
// `ssr: false` because Recharts measures the DOM and doesn't server-render usefully.
//
// The import path and the props are unchanged — callers still write
// `import { ChartLine } from "@/components/chart-line"`. Keeping the boundary here
// rather than at each call site means a new call site can't quietly undo it.
//
// Type re-exports are erased at compile time, so they cost no runtime import.

import dynamic from "next/dynamic";

export type { ChartLineDotContext, ChartLineProps, ChartLineSeries } from "./chart-line-chart";

export const ChartLine = dynamic(
  () => import("./chart-line-chart").then((module) => module.ChartLine),
  {
    ssr: false,
    // Matches the component's own default height, so the page doesn't jump when
    // the chunk lands.
    loading: () => <div className="animate-pulse rounded-lg bg-paper-raised" style={{ height: 280 }} />,
  },
);
