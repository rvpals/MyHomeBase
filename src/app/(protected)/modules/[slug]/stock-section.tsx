// Composes one Stocks & ETFs section: the section nav, a heading with
// the section's description, and the section's own view. Data is loaded per section
// rather than all at once, so opening the dashboard doesn't read every watch list
// and analytics cache.
//
// A server component, so it can talk to `deps` directly and hand plain data to the
// client views. Mirrors expense-section.tsx.

import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { SlotIcon } from "@/components/slot-icon";
import { getIconSlot } from "@/lib/icons";
import { listAccounts, listPerformanceRecords } from "@/lib/investment-accounts";
import { listModuleSettingsFor } from "@/lib/module-settings";
import { getModuleBySlug } from "@/lib/modules";
import { resolveThresholds } from "@/lib/next-day-actions";
import { startOfYearIso, todayIsoLocal } from "@/lib/shared/date";
import { centsToDollars } from "@/lib/shared/money";
import { getCorrelationCache, getSharpeCache, listVolatilityCache } from "@/lib/stock-analytics";
import { buildPortfolioExport } from "@/lib/portfolio-export";
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
import {
  analyzeAdhocLots,
  analyzeMultipleTickers,
  analyzeTicker,
  decodeAdhocLots,
  decodeTickerLots,
  listTaxLotTickers,
  listTaxLots,
  lotsFromTrades,
  multiTickerLotsSchema,
  type AdhocLotInput,
  type MultiTickerAnalysis,
  type TickerPricing,
} from "@/lib/tax-lots";
import { loadSectorMap, resolveSector } from "@/lib/ticker-profiles";
import { deps } from "@/lib/wiring";
import { NextDayActionsView } from "./next-day-actions-view";
import { StockAccountsView, type AccountEntry } from "./stock-accounts-view";
import { StockAiExportView } from "./stock-ai-export-view";
import { StockAnalyticsView } from "./stock-analytics-view";
import { StockConfigurationView } from "./stock-configuration-view";
import { StockDashboardView } from "./stock-dashboard-view";
import { StockImportView } from "./stock-import-view";
import { StockInstructions } from "./stock-instructions";
import { StockPositionsView } from "./stock-positions-view";
import { StockRefreshControl } from "./stock-refresh-control";
import { StockRefreshProgressProvider } from "./stock-refresh-progress-context";
import { STOCK_SECTION_INFO, stockSectionHref, type StockSection } from "./stock-sections";
import { StockShell } from "./stock-shell";
import { StockSimulationView } from "./stock-simulation-view";
import { StockTaxLotsMultiView } from "./stock-tax-lots-multi-view";
import type { TaxLotTickerOption } from "./stock-tax-lots-ticker-picker";
import {
  StockTaxLotsSummary,
  StockTaxLotsTable,
  type TaxLotsViewProps,
} from "./stock-tax-lots-view";
import { StockFavoritesMenu } from "./stock-favorites-menu";
import { StockTickerSearch } from "./stock-ticker-search";
import { StockTransactionsView } from "./stock-transactions-view";
import { StockWatchlistView, type WatchListEntry } from "./stock-watchlist-view";

const STOCK_ETFS_MODULE_SLUG = "stock-etfs";

// The three Watch & Test card badges. Resolved once at module scope; the registry is
// static, so this is not I/O. Non-null because the ids are registered right here in the
// repo — an unregistered one is a build-time mistake, not a runtime condition.
const TAX_LOT_SUMMARY_SLOT = getIconSlot("stock_card_tax_lot_summary")!;
const TAX_LOT_TABLE_SLOT = getIconSlot("stock_card_tax_lot_table")!;
const WATCH_LISTS_SLOT = getIconSlot("stock_card_watch_lists")!;
const NEXT_DAY_SLOT = getIconSlot("stock_card_next_day_signals")!;
const SIMULATION_SLOT = getIconSlot("stock_card_simulation")!;

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

/**
 * Every ticker that has at least one BUY transaction, for the "Add by tickers"
 * picker.
 *
 * Sourced from the ledger rather than from held positions, because the aggregate is
 * built from transactions — a symbol sold out of last year still has lots worth
 * analyzing, and excluding it would make the picker quietly narrower than the
 * feature behind it. Held symbols carry a flag so the picker can mark them.
 */
function loadTickerOptions(): TaxLotTickerOption[] {
  const held = new Set(
    listPositions(deps.stockPositionRepo).map((position) => position.ticker),
  );
  const byTicker = new Map<string, number>();

  for (const transaction of listTransactions(deps.stockPositionRepo)) {
    if (transaction.action.trim().toUpperCase() !== "BUY") continue;
    if (transaction.numberOfShares <= 0) continue;
    byTicker.set(transaction.ticker, (byTicker.get(transaction.ticker) ?? 0) + 1);
  }

  return [...byTicker.entries()]
    .map(([ticker, buyCount]) => ({ ticker, buyCount, isHeld: held.has(ticker) }))
    .sort((left, right) => left.ticker.localeCompare(right.ticker));
}

/**
 * Resolves each ticker's market price and dividend rate from its held position.
 *
 * One pass over the position rows rather than a query per ticker: the multi-ticker
 * screen can be showing thirty symbols, and this is a local SQLite read either way,
 * but a single scan keeps it one read regardless of how many were picked.
 */
function loadPricing(tickers: string[]): Map<string, TickerPricing> {
  const wanted = new Set(tickers);
  const positions = listPositions(deps.stockPositionRepo).filter((position) =>
    wanted.has(position.ticker),
  );
  const pricing = new Map<string, TickerPricing>();

  for (const ticker of tickers) {
    const forTicker = positions.filter((position) => position.ticker === ticker);
    const livePriceCents = forTicker.find((position) => position.currentPriceCents > 0)
      ?.currentPriceCents;
    const dividendRateCents =
      forTicker.find((position) => position.dividendRateCents > 0)?.dividendRateCents ?? 0;

    pricing.set(ticker, {
      ticker,
      // 0 tells `analyzeMultipleTickers` to fall back to the newest lot passed in.
      currentMarketPrice: livePriceCents ? centsToDollars(livePriceCents) : 0,
      hasLivePrice: livePriceCents !== undefined,
      trailingEPS: centsToDollars(dividendRateCents),
    });
  }

  return pricing;
}

/**
 * Builds each picked ticker's lots from its recorded buys.
 *
 * `?seedTickers=NVDA,AAPL` carries only the symbols, so a link stays short however
 * many transactions are behind it and always reflects the CURRENT ledger rather than
 * a snapshot — re-opening a bookmarked selection after importing new trades picks
 * them up. The mapping is `lotsFromTrades`, so which rows count is a `lib` decision.
 *
 * Tickers with no usable buys are dropped rather than rendered as empty sections;
 * `undefined` comes back when that leaves nothing at all.
 */
function loadSeededMultiTickerData(
  requestedSeedTickers: string | undefined,
): MultiTickerAnalysis | undefined {
  if (!requestedSeedTickers) return undefined;

  // De-duplicated, so a hand-edited URL can't render the same ticker twice (and
  // double it inside the grand total).
  const symbols = [
    ...new Set(
      requestedSeedTickers
        .split(",")
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
  if (symbols.length === 0) return undefined;

  const entries = symbols
    .map((ticker) => ({
      ticker,
      lots: lotsFromTrades(listTransactions(deps.stockPositionRepo, ticker)).lots,
    }))
    .filter((entry) => entry.lots.length > 0);
  if (entries.length === 0) return undefined;

  const parsed = multiTickerLotsSchema.safeParse({
    today: todayIsoLocal(),
    tickers: entries,
  });
  if (!parsed.success) return undefined;

  return analyzeMultipleTickers(parsed.data, loadPricing(symbols));
}

/**
 * The multi-ticker analysis, when `?tickers=` carried several symbols' lots.
 *
 * Returns undefined on an unusable payload, so the caller falls back exactly as it
 * does for a bad `?lots=` — a stale bookmark should land on the stored screen, not
 * an error page.
 */
function loadMultiTickerData(requestedTickers: string | undefined): MultiTickerAnalysis | undefined {
  const decoded = decodeTickerLots(requestedTickers);
  if (!decoded) return undefined;

  // Parsed through the schema even though the decoder already validated each lot:
  // the ticker *count* cap and the min(1) live here, and this is the boundary.
  const parsed = multiTickerLotsSchema.safeParse({ today: todayIsoLocal(), tickers: decoded });
  if (!parsed.success) return undefined;

  const symbols = parsed.data.tickers.map((entry) => entry.ticker);
  return analyzeMultipleTickers(parsed.data, loadPricing(symbols));
}

/**
 * The Tax Lots section's data when the transactions came in on the URL.
 *
 * The market context is resolved the same way the stored path resolves it — from the
 * held position when there is one — so an ad-hoc set and a saved one are scored
 * against the same price. Where they differ is the fallback: with nothing stored to
 * fall back to, an unheld ticker is priced at the newest transaction PASSED IN, and
 * `hasLivePrice: false` makes the card say so rather than implying a quote.
 */
function loadAdhocTaxLotsData(
  tickers: string[],
  requestedTicker: string | undefined,
  adhocLots: AdhocLotInput[],
): TaxLotsViewProps {
  // Unlike the stored path, the ticker is NOT resolved against what has lots — the
  // whole point is analyzing a symbol you have not recorded yet. It only has to be
  // present; the schema uppercases and length-checks it.
  const ticker = requestedTicker?.trim().toUpperCase() ?? "";

  const positions = listPositions(deps.stockPositionRepo).filter(
    (position) => position.ticker === ticker,
  );
  const livePriceCents = positions.find((position) => position.currentPriceCents > 0)
    ?.currentPriceCents;
  const hasLivePrice = livePriceCents !== undefined;
  // Newest passed-in lot wins, matching the stored path's `at(-1)` on buy date.
  const newestPassedIn = [...adhocLots].sort((left, right) =>
    left.buyDate.localeCompare(right.buyDate),
  ).at(-1);
  const dividendRateCents =
    positions.find((position) => position.dividendRateCents > 0)?.dividendRateCents ?? 0;
  const trailingEPS = centsToDollars(dividendRateCents);

  const analysis = analyzeAdhocLots({
    ticker,
    currentMarketPrice: livePriceCents
      ? centsToDollars(livePriceCents)
      : (newestPassedIn?.pricePerShare ?? 0),
    trailingEPS,
    today: todayIsoLocal(),
    lots: adhocLots,
  });

  return {
    tickers,
    selectedTicker: ticker,
    // Empty, and that is the signal the view keys off: an ad-hoc lot has no stored
    // row, so Edit and Delete have nothing to act on and are not offered.
    storedLots: [],
    hasLivePrice,
    trailingEPS,
    lots: analysis.lots,
    summary: analysis.summary,
    adhocLots,
  };
}

/**
 * The Tax Lots section's data.
 *
 * The current price and the per-share dividend come from the held position when
 * there is one, summed across accounts the same way the rest of the module reads
 * them. When the ticker isn't held (a lot kept after the position was closed, or
 * entered ahead of buying), the price falls back to the newest lot's own price so
 * the screen still renders — reported as `hasLivePrice: false` so the card says so
 * rather than implying a quote.
 *
 * `trailingEPS` is fed the position's per-share annual DIVIDEND rate, which is what
 * "yield on cost" conventionally measures. The library parameter keeps the name the
 * spec gave it; nothing here stores an earnings figure.
 */
function loadTaxLotsData(
  requestedTicker: string | undefined,
  requestedLots: string | undefined,
): TaxLotsViewProps {
  const tickers = listTaxLotTickers(deps.taxLotRepo);

  // Ad-hoc mode: transactions arrived in the URL, so they are what gets scored and
  // nothing is read from storage. A payload that fails to decode — a stale
  // bookmark, a truncated paste — falls through to the stored view rather than
  // erroring, which is why `decodeAdhocLots` returns undefined instead of throwing.
  const adhocLots = decodeAdhocLots(requestedLots);
  if (adhocLots) return loadAdhocTaxLotsData(tickers, requestedTicker, adhocLots);

  // A requested ticker only wins if it actually has lots, so a stale bookmark
  // falls back to the first stored one instead of rendering an empty screen.
  const normalized = requestedTicker?.trim().toUpperCase();
  const selectedTicker =
    normalized && tickers.includes(normalized) ? normalized : tickers[0];

  if (!selectedTicker) {
    return { tickers, lots: [], storedLots: [], hasLivePrice: false, trailingEPS: 0 };
  }

  const positions = listPositions(deps.stockPositionRepo).filter(
    (position) => position.ticker === selectedTicker,
  );
  const storedLots = listTaxLots(deps.taxLotRepo, selectedTicker);

  const livePriceCents = positions.find((position) => position.currentPriceCents > 0)
    ?.currentPriceCents;
  const hasLivePrice = livePriceCents !== undefined;
  // Newest lot last, so `at(-1)` is the most recent price paid.
  const fallbackPriceCents = storedLots.at(-1)?.pricePerShareCents ?? 0;
  const dividendRateCents =
    positions.find((position) => position.dividendRateCents > 0)?.dividendRateCents ?? 0;

  const trailingEPS = centsToDollars(dividendRateCents);
  const analysis = analyzeTicker(deps.taxLotRepo, {
    ticker: selectedTicker,
    currentMarketPrice: centsToDollars(livePriceCents ?? fallbackPriceCents),
    trailingEPS,
    today: todayIsoLocal(),
  });

  return {
    tickers,
    selectedTicker,
    storedLots,
    hasLivePrice,
    trailingEPS,
    lots: analysis.lots,
    summary: analysis.summary,
  };
}

function SectionBody({
  section,
  requestedTicker,
  requestedLots,
  requestedTickerLots,
  requestedSeedTickers,
}: {
  section: StockSection;
  requestedTicker: string | undefined;
  requestedLots: string | undefined;
  requestedTickerLots: string | undefined;
  requestedSeedTickers: string | undefined;
}) {
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
          <CollapsibleCard
            title="Watch Lists"
            titleIcon={<SlotIcon slot={WATCH_LISTS_SLOT} className="h-4 w-4" />}
            defaultOpen
          >
            <StockWatchlistView entries={watchListEntries} />
          </CollapsibleCard>
          <CollapsibleCard
            title="Next-Day Signals"
            titleIcon={<SlotIcon slot={NEXT_DAY_SLOT} className="h-4 w-4" />}
            defaultOpen
          >
            <NextDayActionsView initialThresholds={loadThresholds()} />
          </CollapsibleCard>
          <CollapsibleCard
            title="Simulation"
            titleIcon={<SlotIcon slot={SIMULATION_SLOT} className="h-4 w-4" />}
            defaultOpen
          >
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

    case "tax-lots": {
      // Multi-ticker wins when present: an explicit selection is what the reader
      // just asked for, and it carries its own grand total rather than one
      // ticker's summary. `?tickers=` (full payload) is checked before
      // `?seedTickers=` (symbols only) so an edited set survives a refresh.
      const multi =
        loadMultiTickerData(requestedTickerLots) ??
        loadSeededMultiTickerData(requestedSeedTickers);
      if (multi) {
        return (
          <CollapsibleCard
            title="Positions Summary"
            titleIcon={<SlotIcon slot={TAX_LOT_SUMMARY_SLOT} className="h-4 w-4" />}
            defaultOpen
          >
            <StockTaxLotsMultiView sections={multi.sections} totals={multi.totals} />
          </CollapsibleCard>
        );
      }

      const data = loadTaxLotsData(requestedTicker, requestedLots);
      return (
        <div className="flex flex-col gap-6">
          <CollapsibleCard
            title="Position Summary"
            titleIcon={<SlotIcon slot={TAX_LOT_SUMMARY_SLOT} className="h-4 w-4" />}
            defaultOpen
          >
            <StockTaxLotsSummary {...data} tickerOptions={loadTickerOptions()} />
          </CollapsibleCard>
          {/* Only worth a card once there is something in it — an empty grid under
              a heading reads as broken, and the summary half already explains that
              nothing is recorded. */}
          {data.lots.length > 0 && (
            <CollapsibleCard
              title="Lot Breakdown"
              titleIcon={<SlotIcon slot={TAX_LOT_TABLE_SLOT} className="h-4 w-4" />}
              defaultOpen
            >
              <StockTaxLotsTable {...data} />
            </CollapsibleCard>
          )}
        </div>
      );
    }

    case "ai-export": {
      // The counts are the exported scope, not the whole ledger: the view says
      // "49 positions across 3 accounts", and that has to agree with what the
      // export actually contains once the retirement plans are dropped.
      const preview = buildPortfolioExport({
        positions: listPositions(deps.stockPositionRepo),
        accounts: listAccounts(deps.investmentAccountRepo).map((account) => ({
          id: account.id,
          name: account.name,
        })),
        sectorsByTicker: new Map(),
        asOf: todayIsoLocal(),
        focus: [],
      });
      return (
        <StockAiExportView
          holdingCount={preview.summary.holdingCount}
          accountCount={preview.summary.accountCount}
          totalMarketValue={preview.summary.totalMarketValue}
        />
      );
    }

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

export async function StockSection({
  section,
  requestedTicker,
  requestedLots,
  requestedTickerLots,
  requestedSeedTickers,
}: {
  section: StockSection;
  /** ?ticker= — which position the Tax Lots analyzer shows. */
  requestedTicker?: string;
  /**
   * ?lots= — an encoded set of transactions to analyze WITHOUT storing them, which
   * puts the Tax Lots screen in ad-hoc mode. Left raw here: the section decodes it
   * with the module's own function, and an unusable payload falls back to the
   * stored lots rather than 404ing a link someone bookmarked.
   */
  requestedLots?: string;
  /** ?tickers= — several symbols each with their own encoded lots. */
  requestedTickerLots?: string;
  /**
   * ?seedTickers= — a comma-separated symbol list whose lots are built from the
   * recorded buys. What the "Add by tickers" picker emits.
   */
  requestedSeedTickers?: string;
}) {
  // Defensive: an unknown section would otherwise crash on info.label. The route
  // already validates, so this only catches a future caller getting it wrong.
  const info = STOCK_SECTION_INFO[section] ?? STOCK_SECTION_INFO.main;
  // Dashboard only: Refresh All acts on the portfolio as a whole, and on
  // Configuration or CSV Import the same icon beside the heading would read as
  // "reload this screen". Positions keeps its own Refresh All in its toolbar.
  const snapshots = section === "main" ? loadSnapshots(todayIsoLocal()) : [];
  // The seed for the refresh's running total. Computed here as well as in
  // `SectionBody` because the refresh icon and the summary card sit on opposite
  // sides of that call — it's a reduce over already-loaded rows, not a second
  // query, so the duplicate costs nothing.
  const seedSummary =
    section === "main" ? computePortfolioSummary(listPositions(deps.stockPositionRepo)) : undefined;

  return (
    // The two-tier shell: a module rail, a section panel and a utility header,
    // all placed by `StockShell`. This module is the first one off `TreeNav` —
    // see design.md, "Navigation: the two-tier shell".
    //
    // `async` because the shell reads cookies for the session and the pinned
    // layout, which `next/headers` only exposes as a promise.
    <StockShell>
      {/* Wraps the heading and the body together so the refresh icon's running
          total reaches the Portfolio Summary card, which is inside `SectionBody`
          and so can't be handed a prop from here. Harmless on other sections —
          nothing reads the context there. */}
      <StockRefreshProgressProvider>
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
                summary={seedSummary}
              />
              {/* The dashboard's way into the export screen. A link rather than a
                  second copy of the dialog: one implementation, one place it can
                  drift from. */}
              <Button
                href={stockSectionHref("ai-export")}
                variant="secondary"
                size="sm"
                className="ml-auto"
              >
                Export for AI
              </Button>
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
          <SectionBody
            section={section}
            requestedTicker={requestedTicker}
            requestedLots={requestedLots}
            requestedTickerLots={requestedTickerLots}
            requestedSeedTickers={requestedSeedTickers}
          />
        </div>
      </StockRefreshProgressProvider>
    </StockShell>
  );
}
