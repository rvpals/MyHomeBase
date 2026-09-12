"use server";

import {
  buildPortfolioExport,
  exportFileName,
  portfolioExportOptionsSchema,
  renderExport,
} from "@/lib/portfolio-export";
import { todayIsoLocal } from "@/lib/shared/date";
import { listPositions } from "@/lib/stock-positions";
import { listAccounts } from "@/lib/investment-accounts";
import { loadSectorMap, resolveSector } from "@/lib/ticker-profiles";
import { deps } from "@/lib/wiring";
import { requireModuleAccess } from "../../require-access";

/** The module these actions belong to, matched exactly by `requireModuleAccess`. */
const ACCESS_MODULE_SLUG = "stock-etfs";

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
    },
  };
}
