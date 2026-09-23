/**
 * Every widget the Investments dashboard can show, in its default order.
 *
 * Several ids are deliberately absent. Daily Glance (`glance`) lives at the top of
 * the home landing screen now, not on this dashboard. Refresh & snapshot
 * (`refresh`) stopped being a widget at all: it's the icon beside the section
 * heading, which is always available and so has nothing to configure. And the
 * three per-chart allocation ids (`allocationType`, `allocationStrategy`,
 * `allocationSector`) became the single `allocation` card, which draws all three
 * splits together — they were never useful apart, and one card is one collapse.
 *
 * `statistics` and `allocation` are the latest to go. Portfolio Summary now holds
 * three tabs — Summary, History and Playback — and those two cards are what the
 * Summary tab is made of. A tab inside a card can't also be an independently
 * hidden, independently ordered top-level widget, so the ids retire rather than
 * becoming settings that only half work.
 *
 * A saved layout still naming any of them is dropped by
 * `resolveDashboardWidgets`, which ignores unknown ids and inserts genuinely new
 * ones as visible — that's why none of these retirements needed a migration. The
 * one visible consequence: a reader who had hidden Statistics or Allocation sees
 * them again, inside the Summary tab, because the widget list can no longer
 * express that preference.
 */
export const DASHBOARD_WIDGET_IDS = ["indexes", "summary"] as const;

export type DashboardWidgetId = (typeof DASHBOARD_WIDGET_IDS)[number];

/** What a widget is called and what it holds, for the Configuration list. */
export interface DashboardWidgetInfo {
  id: DashboardWidgetId;
  label: string;
  description: string;
}

export const DASHBOARD_WIDGET_INFO: Record<DashboardWidgetId, DashboardWidgetInfo> = {
  indexes: {
    id: "indexes",
    label: "Indexes",
    description:
      "The major market benchmarks — S&P 500, NASDAQ, Dow, Russell, VIX, gold, silver, oil, the 10-year yield, the dollar index and bitcoin. Fetched on demand by the card's own Refresh all button, never on page load.",
  },
  summary: {
    id: "summary",
    label: "Portfolio Summary",
    description:
      "Total value and today's move, over three tabs. Summary holds the week/month/year rollups, the stat tiles and the three allocation splits; History holds the value-over-time chart and the snapshot table; Playback replays that history one period at a time.",
  },
};

/** One widget's place in the dashboard and whether it's drawn. */
export interface DashboardWidgetPreference {
  id: DashboardWidgetId;
  visible: boolean;
}

/**
 * How coarsely a playback steps through history: one frame per captured day, per
 * week, per month or per year.
 *
 * This is a *step size*, not a window — "yearly" plays the whole history one
 * year at a time, it does not mean "the last year". With a short history the
 * coarser steps therefore yield very few frames, which is why the view checks
 * `canPlayBack` before offering the button, and why "daily" is the step that
 * actually looks like an animation until several years have accumulated.
 */
export const PLAYBACK_STEPS = ["daily", "weekly", "monthly", "yearly"] as const;

export type PlaybackStep = (typeof PLAYBACK_STEPS)[number];

/** What one period contributes to a playback: a real captured close, never an average. */
export interface PlaybackFrame {
  /** Sortable bucket identity — "2026-08-04" (w/c), "2026-08" or "2026". */
  periodKey: string;
  /** Short x-axis label for the frame. */
  periodLabel: string;
  /** The day inside the period this frame's values were actually recorded on. */
  snapshotDate: string;
  totalValueCents: number;
  stockValueCents: number;
  etfValueCents: number;
  /** That day's move, signed. */
  totalGainLossCents: number;
}
