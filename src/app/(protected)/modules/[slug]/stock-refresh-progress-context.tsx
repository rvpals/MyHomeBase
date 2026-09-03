"use client";

// Shares the dashboard refresh's running portfolio total between the heading's
// refresh icon and the Portfolio Summary card.
//
// A context rather than a prop because the two live on opposite sides of a server
// boundary: `StockSection` is a server component that renders the already-loaded
// `SectionBody` alongside `StockRefreshControl`, so neither can pass state to the
// other. Same shape as journal-new-entry-context.tsx.
//
// Only the total and today's move are shared. The rest of the dashboard — the
// allocation bars, the period tiles, the statistics grid — settles on the
// server's recompute when the run finishes, because re-sorting a bar chart on
// every quote is noise, and the snapshot-derived tiles genuinely can't move until
// the snapshot is written.

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { PortfolioSummary } from "@/lib/stock-positions";

interface StockRefreshProgressState {
  /**
   * The summary as of the last quote that landed, or undefined when no refresh
   * has run this page load. Undefined means "use the server's numbers".
   */
  liveSummary: PortfolioSummary | undefined;
  setLiveSummary: (summary: PortfolioSummary | undefined) => void;
  /** True while the walk is in flight, so the card can mark the figure as moving. */
  isRefreshing: boolean;
  setIsRefreshing: (refreshing: boolean) => void;
}

// Defaults to no live summary with no-op setters, so a dashboard rendered outside
// the provider still works — it just shows the server's numbers, which is exactly
// the pre-refresh behavior.
const StockRefreshProgressContext = createContext<StockRefreshProgressState>({
  liveSummary: undefined,
  setLiveSummary: () => {},
  isRefreshing: false,
  setIsRefreshing: () => {},
});

export function StockRefreshProgressProvider({ children }: { children: ReactNode }) {
  const [liveSummary, setLiveSummary] = useState<PortfolioSummary | undefined>(undefined);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const value = useMemo(
    () => ({ liveSummary, setLiveSummary, isRefreshing, setIsRefreshing }),
    [liveSummary, isRefreshing],
  );
  return (
    <StockRefreshProgressContext.Provider value={value}>
      {children}
    </StockRefreshProgressContext.Provider>
  );
}

export function useStockRefreshProgress(): StockRefreshProgressState {
  return useContext(StockRefreshProgressContext);
}
