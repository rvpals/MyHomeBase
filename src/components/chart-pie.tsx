"use client";

// Lazy boundary for `ChartPie` — see `chart-line.tsx` for why every chart has one.

import dynamic from "next/dynamic";

export type { ChartPieProps } from "./chart-pie-chart";

export const ChartPie = dynamic(
  () => import("./chart-pie-chart").then((module) => module.ChartPie),
  {
    ssr: false,
    loading: () => <div className="animate-pulse rounded-lg bg-paper-raised" style={{ height: 260 }} />,
  },
);
