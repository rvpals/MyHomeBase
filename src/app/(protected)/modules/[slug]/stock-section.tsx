// Composes one Stocks & ETFs section: the tree nav down the side, a heading with
// the section's description, and the section's own view. Data is loaded per section
// rather than all at once, so opening the dashboard doesn't read every watch list
// and analytics cache.
//
// A server component, so it can talk to `deps` directly and hand plain data to the
// client views. Mirrors expense-section.tsx.

import { CollapsibleCard } from "@/components/collapsible-card";
import { listAccounts, listPerformanceRecords } from "@/lib/investment-accounts";
import { listModuleSettingsFor } from "@/lib/module-settings";
import { getModuleBySlug } from "@/lib/modules";
import { resolveThresholds } from "@/lib/next-day-actions";
import { startOfYearIso, todayIsoLocal } from "@/lib/shared/date";
import { getCorrelationCache, getSharpeCache, listVolatilityCache } from "@/lib/stock-analytics";
import { resolveDashboardWidgets, visibleDashboardWidgets } from "@/lib/stock-dashboard";
import { listSnapshots, summarizeToDate } from "@/lib/stock-daily-snapshot";
import {
  computeAllocation,
  computeDayMovesByType,
  computePortfolioSummary,
  computeTickerDayMoves,
  listPositions,
  listTransactions,
  UNASSIGNED_ACCOUNT_ID,
} from "@/lib/stock-positions";
import { listItems, listWatchLists } from "@/lib/stock-watchlist";
import { deps } from "@/lib/wiring";
import { NextDayActionsView } from "./next-day-actions-view";
import { StockAccountsView, type AccountEntry } from "./stock-accounts-view";
import { StockAnalyticsView } from "./stock-analytics-view";
import { StockConfigurationView } from "./stock-configuration-view";
import { StockDashboardView } from "./stock-dashboard-view";
import { StockImportView } from "./stock-import-view";
import { StockInstructions } from "./stock-instructions";
import { StockNav } from "./stock-nav";
import { StockPositionsView } from "./stock-positions-view";
import { STOCK_SECTION_INFO, type StockSection } from "./stock-sections";
import { StockTransactionsView } from "./stock-transactions-view";
import { StockWatchlistView, type WatchListEntry } from "./stock-watchlist-view";

const STOCK_ETFS_MODULE_SLUG = "stock-etfs";

/**
 * The account list every section that needs one shares. `iconMimeType` and
 * `updatedAt` come along so a picker can show the icon; the bytes never do — those
 * are served by /api/stocks/accounts/[id]/icon.
 */
function loadAccountOptions() {
  return listAccounts(deps.investmentAccountRepo).map((account) => ({
    id: account.id,
    name: account.name,
    iconMimeType: account.iconMimeType,
    updatedAt: account.updatedAt,
  }));
}

/** This module's settings rows, or none when the module row is somehow missing. */
function loadModuleSettings() {
  const stockModule = getModuleBySlug(deps.moduleRepo, STOCK_ETFS_MODULE_SLUG);
  return stockModule ? listModuleSettingsFor(deps.moduleSettingsRepo, stockModule.id) : [];
}

function loadThresholds() {
  return resolveThresholds(loadModuleSettings());
}

function loadDashboardWidgets() {
  return resolveDashboardWidgets(loadModuleSettings());
}

function SectionBody({ section }: { section: StockSection }) {
  switch (section) {
    case "main": {
      const positions = listPositions(deps.stockPositionRepo);
      // One read covers the chart and all three rollups — week and month are slices
      // of the year, so re-querying per period would be three round trips for the
      // same rows.
      const today = todayIsoLocal();
      const snapshots = listSnapshots(deps.stockDailySnapshotRepo, {
        fromDate: startOfYearIso(today),
        toDate: today,
      });

      return (
        <StockDashboardView
          summary={computePortfolioSummary(positions)}
          byType={computeAllocation(positions, (position) => position.type)}
          byStrategy={computeAllocation(positions, (position) => position.assetStrategy)}
          dayMoves={computeDayMovesByType(positions)}
          // Summed per ticker here, not in the view: a holding split across two
          // accounts is still one security, and that rollup is domain logic.
          tickerMoves={computeTickerDayMoves(positions)}
          transactionCount={listTransactions(deps.stockPositionRepo).length}
          accountCount={listAccounts(deps.investmentAccountRepo).length}
          unassignedCount={
            positions.filter((position) => position.accountId === UNASSIGNED_ACCOUNT_ID).length
          }
          snapshots={snapshots}
          toDate={summarizeToDate(snapshots, today)}
          widgets={visibleDashboardWidgets(loadDashboardWidgets())}
        />
      );
    }

    case "positions":
      return (
        <StockPositionsView
          positions={listPositions(deps.stockPositionRepo)}
          accounts={loadAccountOptions()}
        />
      );

    case "transactions":
      return <StockTransactionsView transactions={listTransactions(deps.stockPositionRepo)} />;

    case "accounts": {
      const entries: AccountEntry[] = listAccounts(deps.investmentAccountRepo).map((account) => ({
        account,
        history: listPerformanceRecords(deps.investmentAccountRepo, account.id),
      }));
      return <StockAccountsView entries={entries} />;
    }

    case "actionables": {
      const watchListEntries: WatchListEntry[] = listWatchLists(deps.stockWatchListRepo).map(
        (list) => ({ list, items: listItems(deps.stockWatchListRepo, list.id) }),
      );
      return (
        <div className="flex flex-col gap-10">
          <StockWatchlistView entries={watchListEntries} />
          <NextDayActionsView initialThresholds={loadThresholds()} />
        </div>
      );
    }

    case "charts":
      return (
        <StockAnalyticsView
          volatilityResults={listVolatilityCache(deps.stockAnalyticsRepo)}
          correlationResult={getCorrelationCache(deps.stockAnalyticsRepo)}
          sharpeResult={getSharpeCache(deps.stockAnalyticsRepo)}
        />
      );

    case "import":
      return <StockImportView accounts={loadAccountOptions()} />;

    case "settings":
      return (
        <StockConfigurationView
          thresholds={loadThresholds()}
          widgets={loadDashboardWidgets()}
        />
      );

    default:
      return null;
  }
}

export function StockSection({ section }: { section: StockSection }) {
  // Defensive: an unknown section would otherwise crash on info.label. The route
  // already validates, so this only catches a future caller getting it wrong.
  const info = STOCK_SECTION_INFO[section] ?? STOCK_SECTION_INFO.main;

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      {/* No width here — a collapsible TreeNav owns its own (w-64 / w-16), and a
          fixed width on the wrapper would stop the collapsed rail shrinking. */}
      <div className="lg:sticky lg:top-6 lg:shrink-0">
        <StockNav />
      </div>

      <div className="min-w-0 flex-1">
        <h2 className="font-display text-2xl font-semibold text-ink">{info.label}</h2>
        <p className="mt-1 text-sm text-muted">{info.description}</p>
        <div className="mt-3 h-px w-full bg-line" />

        {/* Each section gets only the guidance that applies to it — the whole
            document above every screen was noise between heading and content. */}
        <div className="mt-6">
          <CollapsibleCard title="Instruction">
            <StockInstructions section={section} />
          </CollapsibleCard>
        </div>

        <div className="mt-6">
          <SectionBody section={section} />
        </div>
      </div>
    </div>
  );
}
