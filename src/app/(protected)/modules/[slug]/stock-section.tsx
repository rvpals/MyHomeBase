// Composes one Stocks & ETFs section: the section nav, a heading with
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
  computePortfolioSummary,
  listPositions,
  listTransactions,
  UNASSIGNED_ACCOUNT_ID,
} from "@/lib/stock-positions";
import { listItems, listWatchLists } from "@/lib/stock-watchlist";
import { loadSectorMap, resolveSector } from "@/lib/ticker-profiles";
import { deps } from "@/lib/wiring";
import { NextDayActionsView } from "./next-day-actions-view";
import { StockAccountsView, type AccountEntry } from "./stock-accounts-view";
import { StockAnalyticsView } from "./stock-analytics-view";
import { StockConfigurationView } from "./stock-configuration-view";
import { StockDashboardView } from "./stock-dashboard-view";
import { StockImportView } from "./stock-import-view";
import { StockInstructions } from "./stock-instructions";
import { StockPositionsView } from "./stock-positions-view";
import { StockRefreshControl } from "./stock-refresh-control";
import { STOCK_SECTION_INFO, type StockSection } from "./stock-sections";
import { StockShell } from "./stock-shell";
import { StockSimulationView } from "./stock-simulation-view";
import { StockFavoritesMenu } from "./stock-favorites-menu";
import { StockTickerSearch } from "./stock-ticker-search";
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

/**
 * This year's snapshots, oldest first. One read covers the chart and all three
 * rollups — week and month are slices of the year, so re-querying per period
 * would be three round trips for the same rows.
 *
 * Called by both the heading (for the refresh control's "last captured" date) and
 * the dashboard body. Two reads per request, which is a cheap indexed range scan
 * on a local SQLite file; threading one result through would mean the shell
 * loading dashboard data for every section, including the seven that don't want it.
 */
function loadSnapshots(today: string) {
  return listSnapshots(deps.stockDailySnapshotRepo, {
    fromDate: startOfYearIso(today),
    toDate: today,
  });
}

function SectionBody({ section }: { section: StockSection }) {
  switch (section) {
    case "main": {
      const positions = listPositions(deps.stockPositionRepo);
      const today = todayIsoLocal();
      const snapshots = loadSnapshots(today);

      // One read of the profile cache for the whole roll-up, rather than a query
      // per position. Nothing is fetched here — a page render never calls out.
      const sectors = loadSectorMap(deps.tickerProfileRepo);

      return (
        <StockDashboardView
          summary={computePortfolioSummary(positions)}
          byType={computeAllocation(positions, (position) => position.type)}
          byStrategy={computeAllocation(positions, (position) => position.assetStrategy)}
          bySector={computeAllocation(positions, (position) =>
            resolveSector(sectors.get(position.ticker)),
          )}
          sectorsPending={positions.length > 0 && sectors.size === 0}
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

    // Watching and back-testing are one workflow: both are about tickers you're
    // considering rather than ones you hold. The three parts each get an outer
    // CollapsibleCard so a long screen can be folded down to the part in use.
    case "watch-test": {
      const watchListEntries: WatchListEntry[] = listWatchLists(deps.stockWatchListRepo).map(
        (list) => ({ list, items: listItems(deps.stockWatchListRepo, list.id) }),
      );
      return (
        <div className="flex flex-col gap-6">
          <CollapsibleCard title="Watch Lists" defaultOpen>
            <StockWatchlistView entries={watchListEntries} />
          </CollapsibleCard>
          <CollapsibleCard title="Next-Day Signals" defaultOpen>
            <NextDayActionsView initialThresholds={loadThresholds()} />
          </CollapsibleCard>
          <CollapsibleCard title="Simulation" defaultOpen>
            <StockSimulationView />
          </CollapsibleCard>
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

export async function StockSection({ section }: { section: StockSection }) {
  // Defensive: an unknown section would otherwise crash on info.label. The route
  // already validates, so this only catches a future caller getting it wrong.
  const info = STOCK_SECTION_INFO[section] ?? STOCK_SECTION_INFO.main;
  // Dashboard only: Refresh All acts on the portfolio as a whole, and on
  // Configuration or CSV Import the same icon beside the heading would read as
  // "reload this screen". Positions keeps its own Refresh All in its toolbar.
  const snapshots = section === "main" ? loadSnapshots(todayIsoLocal()) : [];

  return (
    // The two-tier shell: a module rail, a section panel and a utility header,
    // all placed by `StockShell`. This module is the first one off `TreeNav` —
    // see design.md, "Navigation: the two-tier shell".
    //
    // `async` because the shell reads cookies for the session and the pinned
    // layout, which `next/headers` only exposes as a promise.
    <StockShell>
      {/* The three controls are icon-width closed, so they share the title's line
          at 390px. `flex-wrap` is still what lets the progress strip (`basis-full`)
          and an opened search field or menu take a line of their own. */}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-2xl font-semibold text-ink">{info.label}</h2>
        {section === "main" && (
          <>
            <StockTickerSearch />
            <StockFavoritesMenu />
            <StockRefreshControl
              lastSnapshotDate={snapshots[snapshots.length - 1]?.snapshotDate}
            />
          </>
        )}
      </div>
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
    </StockShell>
  );
}
