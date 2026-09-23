"use server";

import {
  buildPortfolioExport,
  exportFileName,
  portfolioExportOptionsSchema,
  renderExport,
} from "@/lib/portfolio-export";
import { todayIsoLocal } from "@/lib/shared/date";
import { computeCorrelationMatrix, getCorrelationCache } from "@/lib/stock-analytics";
import { listPositions } from "@/lib/stock-positions";
import { listAccounts } from "@/lib/investment-accounts";
import { loadSectorMap, resolveSector } from "@/lib/ticker-profiles";
import { deps } from "@/lib/wiring";
import { requireModuleAccess } from "../../require-access";

/** The module these actions belong to, matched exactly by `requireModuleAccess`. */
const ACCESS_MODULE_SLUG = "investments";

export interface GenerateExportResult {
  ok: boolean;
  error?: string;
  /** The rendered prompt + payload, ready to copy. */
  content?: string;
  /** What a download should be called. */
  fileName?: string;
  /** A few figures the view shows above the preview. */
  stats?: {
    holdingCount: number;
    accountCount: number;
    totalMarketValue: number;
    excludedCount: number;
    /**
     * What the correlation section is built from, so the modal can say whether
     * the numbers are there and how old they are without parsing the text.
     */
    correlation?: {
      tickerCount: number;
      calculatedAt: string;
      ageDays: number | null;
      isStale: boolean;
    };
  };
}

/**
 * Renders the portfolio as an AI prompt in the requested format.
 *
 * Read-only: it writes nothing and revalidates nothing, so there is no
 * `revalidatePath` here. Everything it returns is derived on the fly from
 * positions the reader can already see.
 */
export async function generatePortfolioExportAction(input: unknown): Promise<GenerateExportResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);

  const parsed = portfolioExportOptionsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid export options." };
  }
  const options = parsed.data;

  const profiles = loadSectorMap(deps.tickerProfileRepo);
  const sectorsByTicker = new Map<string, string>();
  for (const [ticker, record] of profiles) {
    sectorsByTicker.set(ticker.toUpperCase(), resolveSector(record));
  }

  const payload = buildPortfolioExport({
    positions: listPositions(deps.stockPositionRepo),
    accounts: listAccounts(deps.investmentAccountRepo).map((account) => ({
      id: account.id,
      name: account.name,
    })),
    sectorsByTicker,
    asOf: todayIsoLocal(),
    focus: options.focus,
    includeKinds: options.includeKinds,
    // Read from the cache, never computed here: a fresh matrix is ~50 Yahoo
    // calls, which is not something a preview that regenerates on every
    // checkbox tick should trigger. `refreshPortfolioCorrelationsAction` is
    // the explicit way to recompute.
    correlation: getCorrelationCache(deps.stockAnalyticsRepo),
  });

  return {
    ok: true,
    content: renderExport(payload, options.format),
    fileName: exportFileName(payload, options.format),
    stats: {
      holdingCount: payload.summary.holdingCount,
      accountCount: payload.summary.accountCount,
      totalMarketValue: payload.summary.totalMarketValue,
      excludedCount: payload.excludedAccounts.length,
      correlation: payload.correlation
        ? {
            tickerCount: payload.correlation.tickerCount,
            calculatedAt: payload.correlation.calculatedAt,
            ageDays: payload.correlation.ageDays,
            isStale: payload.correlation.isStale,
          }
        : undefined,
    },
  };
}

export interface RefreshCorrelationsResult {
  ok: boolean;
  error?: string;
  /** How many holdings the new matrix covers, for the confirmation message. */
  tickerCount?: number;
}

/**
 * Recomputes the correlation matrix, then leaves it in the cache for the next
 * export to read.
 *
 * Separate from generating the export because it is the expensive half: one
 * Yahoo history request per eligible holding. The reader asks for it by
 * pressing a button, and the same cache backs the Chart & Analysis section, so
 * refreshing here refreshes there too.
 */
export async function refreshPortfolioCorrelationsAction(): Promise<RefreshCorrelationsResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);

  try {
    const result = await computeCorrelationMatrix(
      deps.stockAnalyticsRepo,
      deps.marketDataClient,
      listPositions(deps.stockPositionRepo),
    );
    return { ok: true, tickerCount: result.tickers.length };
  } catch (error) {
    // The use-case throws a readable message for the two cases that matter —
    // too few eligible positions, and too little price history — so surface it.
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to refresh correlations.",
    };
  }
}
