/**
 * Every widget the Stocks & ETFs dashboard can show, in its default order.
 *
 * Two are deliberately absent. Daily Glance (`glance`) lives at the top of the
 * home landing screen now, not on this dashboard. Refresh & snapshot (`refresh`)
 * stopped being a widget at all: it's the icon beside the section heading, which
 * is always available and so has nothing to configure. A saved layout still
 * naming either is dropped by `resolveDashboardWidgets`, which already ignores
 * unknown ids — that's why neither retirement needed a migration.
 */
export const DASHBOARD_WIDGET_IDS = [
  "summary",
  "statistics",
  "allocationType",
  "allocationStrategy",
  "allocationSector",
] as const;

export type DashboardWidgetId = (typeof DASHBOARD_WIDGET_IDS)[number];

/** What a widget is called and what it holds, for the Configuration list. */
export interface DashboardWidgetInfo {
  id: DashboardWidgetId;
  label: string;
  description: string;
}

export const DASHBOARD_WIDGET_INFO: Record<DashboardWidgetId, DashboardWidgetInfo> = {
  summary: {
    id: "summary",
    label: "Portfolio Summary",
    description: "Total value, today's move, the value-over-time chart and the snapshot history.",
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
  allocationSector: {
    id: "allocationSector",
    label: "Allocation by sector",
    description:
      "Value split across market sectors, e.g. Technology. Sectors are looked up per ticker on Refresh All; funds have none and are grouped as 'ETFs & funds'.",
  },
};

/** One widget's place in the dashboard and whether it's drawn. */
export interface DashboardWidgetPreference {
  id: DashboardWidgetId;
  visible: boolean;
}
