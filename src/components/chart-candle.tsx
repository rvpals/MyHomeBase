"use client";

// Lazy boundary for `ChartCandle` — see `chart-line.tsx` for why every chart has one.

import dynamic from "next/dynamic";

export type { ChartCandlePoint, ChartCandleProps } from "./chart-candle-chart";

export const ChartCandle = dynamic(
  () => import("./chart-candle-chart").then((module) => module.ChartCandle),
  {
    ssr: false,
    loading: () => <div className="animate-pulse rounded-lg bg-paper-raised" style={{ height: 280 }} />,
  },
);
