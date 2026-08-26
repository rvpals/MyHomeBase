/**
 * Every widget the Stocks & ETFs dashboard can show, in its default order.
 *
 * Several ids are deliberately absent. Daily Glance (`glance`) lives at the top of
 * the home landing screen now, not on this dashboard. Refresh & snapshot
 * (`refresh`) stopped being a widget at all: it's the icon beside the section
 * heading, which is always available and so has nothing to configure. And the
 * three per-chart allocation ids (`allocationType`, `allocationStrategy`,
 * `allocationSector`) became the single `allocation` card, which draws all three
 * splits together — they were never useful apart, and one card is one collapse.
 *
 * A saved layout still naming any of them is dropped by
 * `resolveDashboardWidgets`, which ignores unknown ids and appends genuinely new
 * ones as visible — that's why none of these retirements needed a migration. The
 * one visible consequence: a layout that hid only *some* allocation charts gets
 * all three back, because the widget list can no longer express that.
 */
export const DASHBOARD_WIDGET_IDS = [
  "summary",
  "statistics",
  "allocation",
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
    description:
      "Total value and today's move, over a Portfolio History child card holding the value-over-time chart and the snapshot table.",
  },
  statistics: {
    id: "statistics",
    label: "Statistics",
    description: "Week/month/year to date, position and transaction counts, cost basis, income.",
  },
  allocation: {
    id: "allocation",
    label: "Portfolio Allocation",
    description:
      "One card holding all three splits of the same total: by type (Stock / ETF / Bond / other), by the broker's strategy buckets, and by market sector. Sectors are looked up per ticker on Refresh All; a fund has none and is grouped as 'ETFs & funds'.",
  },
};

/** One widget's place in the dashboard and whether it's drawn. */
export interface DashboardWidgetPreference {
  id: DashboardWidgetId;
  visible: boolean;
}
