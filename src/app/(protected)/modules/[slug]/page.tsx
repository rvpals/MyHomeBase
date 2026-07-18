import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { listAccounts, listPerformanceRecords } from "@/lib/investment-accounts";
import { listModuleSettingsFor } from "@/lib/module-settings";
import { getModuleBySlug, getModuleCode } from "@/lib/modules";
import { resolveThresholds } from "@/lib/next-day-actions";
import { getWatchlistHistory, listWatchlist } from "@/lib/property-watch";
import { listProperties } from "@/lib/real-estate";
import { getCorrelationCache, getSharpeCache, listVolatilityCache } from "@/lib/stock-analytics";
import { listPositions, listTransactions } from "@/lib/stock-positions";
import { listItems, listWatchLists } from "@/lib/stock-watchlist";
import { userHasModuleAccess } from "@/lib/user";
import { deps } from "@/lib/wiring";
import { CsvImportView } from "./csv-import-view";
import { PropertyWatchView, type WatchlistEntry } from "./property-watch-view";
import { RealEstateView } from "./real-estate-view";
import { NextDayActionsView } from "./next-day-actions-view";
import { StockAccountsView, type AccountEntry } from "./stock-accounts-view";
import { StockAnalyticsView } from "./stock-analytics-view";
import { StockPositionsView } from "./stock-positions-view";
import { StockWatchlistView, type WatchListEntry } from "./stock-watchlist-view";

const REAL_ESTATE_MODULE_SLUG = "real-estate-investment";
const STOCK_ETFS_MODULE_SLUG = "stock-etfs";

function RealEstateModuleBody() {
  const watchlist: WatchlistEntry[] = listWatchlist(deps.watchedPropertyRepo).map((watchedProperty) => ({
    watchedProperty,
    history: getWatchlistHistory(deps.watchedPropertyRepo, watchedProperty.id),
  }));

  return (
    <div className="flex flex-col gap-10">
      <RealEstateView properties={listProperties(deps.propertyRepo)} />
      <PropertyWatchView watchlist={watchlist} propertyLookupEnabled={deps.propertyLookupClient !== undefined} />
    </div>
  );
}

function StockEtfsModuleBody() {
  const accountEntries: AccountEntry[] = listAccounts(deps.investmentAccountRepo).map((account) => ({
    account,
    history: listPerformanceRecords(deps.investmentAccountRepo, account.id),
  }));

  const watchListEntries: WatchListEntry[] = listWatchLists(deps.stockWatchListRepo).map((list) => ({
    list,
    items: listItems(deps.stockWatchListRepo, list.id),
  }));

  const stockEtfsModule = getModuleBySlug(deps.moduleRepo, STOCK_ETFS_MODULE_SLUG);
  const thresholds = resolveThresholds(
    stockEtfsModule ? listModuleSettingsFor(deps.moduleSettingsRepo, stockEtfsModule.id) : [],
  );

  return (
    <div className="flex flex-col gap-10">
      <StockPositionsView
        positions={listPositions(deps.stockPositionRepo)}
        transactions={listTransactions(deps.stockPositionRepo)}
      />
      <StockWatchlistView entries={watchListEntries} />
      <NextDayActionsView initialThresholds={thresholds} />
      <StockAnalyticsView
        volatilityResults={listVolatilityCache(deps.stockAnalyticsRepo)}
        correlationResult={getCorrelationCache(deps.stockAnalyticsRepo)}
        sharpeResult={getSharpeCache(deps.stockAnalyticsRepo)}
      />
      <StockAccountsView entries={accountEntries} />
      <CsvImportView />
    </div>
  );
}

function ModuleBody({ slug }: { slug: string }) {
  if (slug === REAL_ESTATE_MODULE_SLUG) {
    return <RealEstateModuleBody />;
  }

  if (slug === STOCK_ETFS_MODULE_SLUG) {
    return <StockEtfsModuleBody />;
  }

  return (
    <div className="rounded-xl border border-dashed border-line p-8 text-center">
      <p className="font-display text-lg text-ink">Coming soon</p>
      <p className="mt-1 text-sm text-muted">This module hasn&apos;t been built out yet.</p>
    </div>
  );
}

export default async function ModulePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const appModule = getModuleBySlug(deps.moduleRepo, slug);

  if (!appModule) notFound();

  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  // The (protected) layout already guarantees a logged-in user by this point;
  // this only guards against navigating straight to an unassigned module's URL.
  if (!currentUser || !userHasModuleAccess(currentUser, appModule.id, deps.userRepo)) notFound();

  return (
    <div
      className={
        slug === REAL_ESTATE_MODULE_SLUG || slug === STOCK_ETFS_MODULE_SLUG
          ? "mx-auto max-w-6xl"
          : "mx-auto max-w-3xl"
      }
    >
      <p className="font-mono text-xs font-medium uppercase tracking-widest text-brass-dark">
        {getModuleCode(appModule.slug)}
      </p>
      <h1 className="mt-2 font-display text-3xl font-semibold text-ink">{appModule.longName}</h1>
      <div className="mt-3 h-px w-full bg-line" />
      <div className="mt-8">
        <ModuleBody slug={slug} />
      </div>
    </div>
  );
}
