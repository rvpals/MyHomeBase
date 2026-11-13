"use client";

// Lazy boundary for `ChartBar` — see `chart-line.tsx` for why every chart has one.

import dynamic from "next/dynamic";

export type { ChartBarItem, ChartBarProps } from "./chart-bar-chart";

export const ChartBar = dynamic(
  () => import("./chart-bar-chart").then((module) => module.ChartBar),
  {
    ssr: false,
    // `ChartBar` derives its height from the number of items, which a `loading`
    // renderer can't see — so the skeleton is a plausible middle, not the exact
    // final height. The chart is the only one here that may shift on load.
    loading: () => <div className="animate-pulse rounded-lg bg-paper-raised" style={{ height: 160 }} />,
  },
);
