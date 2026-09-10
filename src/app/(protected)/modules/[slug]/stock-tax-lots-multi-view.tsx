"use client";

// The multi-ticker Tax Lots screen: one section per ticker, and a grand total.
//
// Pure presentation, same as the single-ticker view — every figure was computed by
// `analyzeMultipleTickers` in src/lib/tax-lots and arrived as a prop.
//
// Two things the layout is deliberate about:
//
//   - **The total comes first.** It is the answer to "how is this basket doing?",
//     and the per-ticker sections below are the evidence for it. Same reasoning as
//     the trimming call-out sitting above the lot table on the single-ticker screen.
//   - **Each ticker gets a real divider, not just spacing.** A reader scanning six
//     sections of near-identical metric cards needs an unambiguous boundary, or
//     NVDA's gain gets read as AAPL's.

import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import { TickerLogo } from "@/components/ticker-logo";
import type {
  LotPerformance,
  MultiTickerTotals,
  TickerAnalysisSection,
} from "@/lib/tax-lots";

export interface MultiTickerViewProps {
  sections: TickerAnalysisSection[];
  totals: MultiTickerTotals;
}

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function formatDollars(value: number): string {
  return currency.format(value);
}

function formatSignedDollars(value: number): string {
  return `${value >= 0 ? "+" : "−"}${currency.format(Math.abs(value))}`;
}

function formatPercent(value: number, digits = 2): string {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(digits)}%`;
}

/** A rate stored as a fraction (0.15) shown as a percent (15.00%). */
function formatRate(value: number): string {
  return formatPercent(value * 100);
}

function formatShares(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(4);
}

function gainClass(value: number): string {
  if (value > 0) return "text-emerald-400";
  if (value < 0) return "text-red-400";
  return "text-muted";
}

/** Same card as the single-ticker screen. Local to each view rather than shared:
 *  it is a label, a number and a hint, and `components.md` has no metric card to
 *  reuse. Worth promoting if a third screen wants one. */
function MetricCard({
  label,
  value,
  hint,
  valueClassName = "text-ink",
}: {
  label: string;
  value: string;
  hint?: string;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-xl border border-line p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-1 font-display text-xl tabular-nums ${valueClassName}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

/**
 * The per-lot columns for a ticker's section.
 *
 * A trimmed set compared with the single-ticker table: no actions (nothing is
 * stored), and no ticker column (the section heading already says which symbol it
 * is). Six columns instead of eleven, because this screen is showing several of
 * these tables at once and the wide version would bury the comparison.
 */
function lotColumns(): DataGridColumn<LotPerformance>[] {
  return [
    {
      key: "buyDate",
      header: "Purchase Date",
      value: (lot) => lot.buyDate,
      render: (lot) => (
        <span className="tabular-nums">
          {lot.buyDate}
          {lot.cumulativeSplitFactor !== 1 && (
            <span className="ml-2 text-xs text-muted" title="Cumulative split factor applied">
              ×{lot.cumulativeSplitFactor}
            </span>
          )}
        </span>
      ),
    },
    {
      key: "adjustedShares",
      header: "Adj. Shares",
      value: (lot) => lot.adjustedShares,
      render: (lot) => <span className="tabular-nums">{formatShares(lot.adjustedShares)}</span>,
      aggregate: "sum",
      formatAggregate: (total) => <span className="tabular-nums">{formatShares(total)}</span>,
    },
    {
      key: "adjustedCostPerShare",
      header: "Adj. Cost/Share",
      value: (lot) => lot.adjustedCostPerShare,
      render: (lot) => (
        <span className="tabular-nums">{formatDollars(lot.adjustedCostPerShare)}</span>
      ),
    },
    {
      key: "costBasis",
      header: "Cost Basis",
      value: (lot) => lot.costBasis,
      render: (lot) => <span className="tabular-nums">{formatDollars(lot.costBasis)}</span>,
      aggregate: "sum",
      formatAggregate: (total) => <span className="tabular-nums">{formatDollars(total)}</span>,
    },
    {
      key: "currentValue",
      header: "Current Value",
      value: (lot) => lot.currentValue,
      render: (lot) => <span className="tabular-nums">{formatDollars(lot.currentValue)}</span>,
      aggregate: "sum",
      formatAggregate: (total) => <span className="tabular-nums">{formatDollars(total)}</span>,
    },
    {
      key: "gain",
      header: "Total Gain",
      value: (lot) => lot.unrealizedGainPercent,
      render: (lot) => (
        <span className={`tabular-nums ${gainClass(lot.unrealizedGainDollars)}`}>
          {formatPercent(lot.unrealizedGainPercent)}
          <span className="ml-2 text-xs opacity-80">
            {formatSignedDollars(lot.unrealizedGainDollars)}
          </span>
        </span>
      ),
    },
    {
      key: "taxStatus",
      header: "Tax Status",
      value: (lot) => lot.taxClassification,
      render: (lot) => (
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${
            lot.taxClassification === "LONG_TERM"
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
              : "border-amber-500/40 bg-amber-500/10 text-amber-300"
          }`}
          title={`Held ${lot.yearsHeld.toFixed(2)} years.`}
        >
          {lot.taxClassification === "LONG_TERM" ? "Long term" : "Short term"}
          {lot.isTrimCandidate && <span title="Tax-efficient trimming candidate">✓</span>}
        </span>
      ),
    },
  ];
}

/**
 * One ticker's block: a heading with its headline numbers, then its lots.
 *
 * Collapsible, because the point of picking eight tickers is usually to read the
 * grand total and then drill into one or two — eight expanded tables is a very long
 * page. The heading carries enough (value, gain, lot count) to make the choice of
 * which to open without opening any.
 */
function TickerSection({ section }: { section: TickerAnalysisSection }) {
  const { ticker, analysis, hasLivePrice, currentMarketPrice } = section;
  const { summary, lots } = analysis;

  return (
    <CollapsibleCard
      // A string by contract — `titleIcon` is the slot for the glyph, and the
      // headline numbers go in the body's summary strip rather than widening a
      // shared component's title prop.
      title={`${ticker} — ${summary.lotCount} lot${summary.lotCount === 1 ? "" : "s"}, ${formatDollars(summary.totalCurrentValue)} (${formatPercent(summary.totalGainPercent)})`}
      titleIcon={<TickerLogo ticker={ticker} size={20} />}
      defaultOpen={false}
    >
      <div className="flex flex-col gap-4">
        {/* Four cards, not the single-ticker screen's six: blended yield on cost
            and the share count are per-symbol detail a comparison view doesn't
            need, and dropping them keeps each section short enough to scan. */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="Invested"
            value={formatDollars(summary.totalCapitalInvested)}
            hint={`${formatShares(summary.totalAdjustedShares)} adj. shares`}
          />
          <MetricCard
            label="Current Value"
            value={formatDollars(summary.totalCurrentValue)}
            hint={
              hasLivePrice
                ? `at ${formatDollars(currentMarketPrice)}/share`
                : `at an assumed ${formatDollars(currentMarketPrice)}/share — not a held position`
            }
          />
          <MetricCard
            label="Total Gain"
            value={formatSignedDollars(summary.totalGainDollars)}
            hint={formatPercent(summary.totalGainPercent)}
            valueClassName={gainClass(summary.totalGainDollars)}
          />
          <MetricCard
            label="Blended Cost Basis"
            value={formatDollars(summary.blendedCostBasis)}
            hint="split-adjusted, across every lot"
          />
        </div>

        <DataGrid
          columns={lotColumns()}
          rows={lots}
          // Ad-hoc lots share id 0, so identity comes from the fields. Cost per
          // share is included because two same-day buys of the same size at
          // different prices are ordinary and must not collapse into one row.
          getRowKey={(lot) =>
            `${ticker}-${lot.buyDate}-${lot.adjustedShares}-${lot.adjustedCostPerShare}`
          }
          emptyMessage="No lots for this ticker."
        />
      </div>
    </CollapsibleCard>
  );
}

export function StockTaxLotsMultiView({ sections, totals }: MultiTickerViewProps) {
  const router = useRouter();

  return (
    <div className="flex flex-col gap-6">
      {/* Not saved, and every figure below is a calculation — said once, at the
          top, for the whole screen. */}
      <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
        <p className="text-sm font-medium text-amber-300">
          Calculated across {totals.tickerCount} ticker
          {totals.tickerCount === 1 ? "" : "s"} — not saved
        </p>
        <p className="mt-1 text-xs text-muted">
          Built from your recorded buy transactions. Sells are excluded, so each
          position is gross rather than net — a tax lot is a purchase, and which lots a
          sale consumed is a decision this screen can&apos;t read from the ledger.
        </p>
      </div>

      {/* The grand total. Six cards, one row of three on a desktop.
          Deliberately no blended cost basis: dollars per share across different
          symbols is not a unit, and printing one would be plausible nonsense. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard
          label="Total Invested"
          value={formatDollars(totals.totalCapitalInvested)}
          hint={`${totals.lotCount} lot${totals.lotCount === 1 ? "" : "s"} across ${totals.tickerCount} ticker${totals.tickerCount === 1 ? "" : "s"}`}
        />
        <MetricCard
          label="Current Value"
          value={formatDollars(totals.totalCurrentValue)}
          hint="at each ticker's own price"
        />
        <MetricCard
          label="Total Gain"
          value={formatSignedDollars(totals.totalGainDollars)}
          hint={formatPercent(totals.totalGainPercent)}
          valueClassName={gainClass(totals.totalGainDollars)}
        />
        <MetricCard
          label="Combined XIRR"
          value={totals.xirr === undefined ? "—" : formatRate(totals.xirr)}
          hint={
            totals.xirr === undefined
              ? "needs purchases on more than one date"
              : "money-weighted, every purchase in the selection"
          }
          valueClassName={totals.xirr === undefined ? "text-muted" : gainClass(totals.xirr)}
        />
        <MetricCard
          label="Long-Term Value"
          value={formatDollars(totals.longTermValue)}
          hint={`${totals.longTermLotCount} lot${totals.longTermLotCount === 1 ? "" : "s"} past the one-year line`}
        />
        <MetricCard
          label="Short-Term Value"
          value={formatDollars(totals.shortTermValue)}
          hint={`${totals.shortTermLotCount} lot${totals.shortTermLotCount === 1 ? "" : "s"} still at short-term rates`}
        />
      </div>

      {totals.trimCandidateCount > 0 && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-4">
          <p className="text-sm font-medium text-emerald-300">
            {totals.trimCandidateCount} lot{totals.trimCandidateCount === 1 ? "" : "s"} can
            be trimmed at long-term rates
          </p>
          <p className="mt-1 text-xs text-muted">
            Across every ticker in this selection. Lots marked ✓ are long-term and in
            profit; a long-term lot at a loss is a harvesting candidate instead.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted">
          {sections.length} ticker{sections.length === 1 ? "" : "s"}, oldest lots first
          within each
        </span>
        <Button
          variant="secondary"
          onClick={() => router.push("/modules/stock-etfs/tax-lots")}
        >
          Back to saved lots
        </Button>
      </div>

      {/* One section per ticker, each separated by a rule. `key` is the symbol,
          which is unique by construction — the picker de-duplicates. */}
      <div className="flex flex-col divide-y divide-line">
        {sections.map((section) => (
          <div key={section.ticker} className="py-3 first:pt-0 last:pb-0">
            <TickerSection section={section} />
          </div>
        ))}
      </div>
    </div>
  );
}
