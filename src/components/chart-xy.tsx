"use client";

// Lazy boundary for `ChartXY` — see `chart-line.tsx` for why every chart has one.
//
// The implementation is `memo`'d; the memo now sits behind the lazy boundary, which
// changes nothing once the chunk has loaded.

import dynamic from "next/dynamic";

export type {
  ChartReferenceLine,
  ChartType,
  ChartXYProps,
  ChartXYSeries,
} from "./chart-xy-chart";

export const ChartXY = dynamic(
  () => import("./chart-xy-chart").then((module) => module.ChartXY),
  {
    ssr: false,
    loading: () => <div className="animate-pulse rounded-lg bg-paper-raised" style={{ height: 320 }} />,
  },
);
