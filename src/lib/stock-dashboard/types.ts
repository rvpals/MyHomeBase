/** Every widget the Stocks & ETFs dashboard can show, in its default order. */
export const DASHBOARD_WIDGET_IDS = [
  "refresh",
  "summary",
  "glance",
  "statistics",
  "allocationType",
  "allocationStrategy",
] as const;

export type DashboardWidgetId = (typeof DASHBOARD_WIDGET_IDS)[number];

/** What a widget is called and what it holds, for the Configuration list. */
export interface DashboardWidgetInfo {
  id: DashboardWidgetId;
  label: string;
  description: string;
}

export const DASHBOARD_WIDGET_INFO: Record<DashboardWidgetId, DashboardWidgetInfo> = {
  refresh: {
    id: "refresh",
    label: "Refresh & snapshot",
    description:
      "The Refresh All button and its progress log. Hiding it leaves no way to capture a daily snapshot.",
  },
  summary: {
    id: "summary",
    label: "Portfolio Summary",
    description: "Total value, today's move, the value-over-time chart and the snapshot history.",
  },
  glance: {
    id: "glance",
    label: "Daily Glance",
    description: "Stock and ETF moves, plus the top five gainers and losers with news.",
  },
  statistics: {
    id: "statistics",
    label: "Statistics",
    description: "Week/month/year to date, position and transaction counts, cost basis, income.",
  },
  allocationType: {
    id: "allocationType",
    label: "Allocation by type",
    description: "Value split across Stock / ETF / Bond / other.",
  },
  allocationStrategy: {
    id: "allocationStrategy",
    label: "Allocation by strategy",
    description: "Value split across the broker's strategy buckets, e.g. US Large Cap.",
  },
};

/** One widget's place in the dashboard and whether it's drawn. */
export interface DashboardWidgetPreference {
  id: DashboardWidgetId;
  visible: boolean;
}
