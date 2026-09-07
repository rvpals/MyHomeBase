"use client";

// The Tax Lots screen. Pure presentation: every number on it was computed by
// `analyzeTicker` in src/lib/tax-lots and arrived as a prop. The only logic here is
// formatting and view state (which ticker is selected, which dialog is open).

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import { Modal } from "@/components/modal";
import { dollarsToCents } from "@/lib/shared/money";
import type { LotPerformance, PortfolioLotSummary, TaxLot } from "@/lib/tax-lots";
import {
  createTaxLotAction,
  deleteTaxLotAction,
  updateTaxLotAction,
} from "./stock-tax-lots-actions";

/** Everything the section loaded for one ticker. */
export interface TaxLotsViewProps {
  /** Tickers that have at least one stored lot. */
  tickers: string[];
  /** The ticker being analyzed, or undefined when nothing is stored yet. */
  selectedTicker?: string;
  lots: LotPerformance[];
  summary?: PortfolioLotSummary;
  /** The stored rows, for the edit form — the scored lots hold derived figures. */
  storedLots: TaxLot[];
  /** True when the price came from a held position rather than being assumed. */
  hasLivePrice: boolean;
  trailingEPS: number;
}

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function formatDollars(value: number): string {
  return currency.format(value);
}

/** Signed to the cent, with an explicit + so a gain reads as one at a glance. */
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
  // Whole shares read better without trailing zeros; fractional ones need them.
  return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(4);
}

/** Green for a gain, red for a loss, muted at exactly flat. */
function gainClass(value: number): string {
  if (value > 0) return "text-emerald-400";
  if (value < 0) return "text-red-400";
  return "text-muted";
}

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
 * The holding-period badge. A plain span rather than a shared component: it is two
 * words and a border, used only on this screen, and `components.md` has no badge to
 * reuse. Promote it if a second screen wants one.
 */
function TaxStatusBadge({ lot }: { lot: LotPerformance }) {
  const isLongTerm = lot.taxClassification === "LONG_TERM";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${
        isLongTerm
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
          : "border-amber-500/40 bg-amber-500/10 text-amber-300"
      }`}
      title={
        isLongTerm
          ? `Held ${lot.yearsHeld.toFixed(2)} years — qualifies for long-term capital-gains rates.`
          : `Held ${lot.yearsHeld.toFixed(2)} years — sells at the higher short-term rate until it reaches 1.00.`
      }
    >
      {isLongTerm ? "Long term" : "Short term"}
      {/* The trim marker. Only a long-term lot IN PROFIT earns it: a long-term lot
          at a loss is a harvesting candidate, which is a different decision. */}
      {lot.isTrimCandidate && <span title="Tax-efficient trimming candidate">✓</span>}
    </span>
  );
}

/** The add/edit dialog. Shares and price go in as typed; the lib does the maths. */
function LotFormDialog({
  ticker,
  editing,
  onClose,
}: {
  ticker: string;
  /** The stored lot being edited, or undefined to add a new one. */
  editing?: TaxLot;
  onClose: () => void;
}) {
  const router = useRouter();
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const [tickerValue, setTickerValue] = useState(editing?.ticker ?? ticker);
  const [buyDate, setBuyDate] = useState(editing?.buyDate ?? "");
  const [shares, setShares] = useState(editing ? String(editing.shares) : "");
  const [price, setPrice] = useState(
    editing ? (editing.pricePerShareCents / 100).toFixed(2) : "",
  );
  const [isSplitAdjusted, setIsSplitAdjusted] = useState(editing?.isSplitAdjusted ?? false);
  const [brokerageFirm, setBrokerageFirm] = useState(editing?.brokerageFirm ?? "");
  const [note, setNote] = useState(editing?.note ?? "");

  // The event is optional because two things submit this form: pressing Enter in a
  // field (which passes one, and must be prevented from navigating) and the footer's
  // Save button, which sits outside the <form> and calls this directly.
  async function handleSubmit(event?: FormEvent) {
    event?.preventDefault();
    setIsBusy(true);
    setError(undefined);

    // Dollars → cents at the boundary, since the schema takes integer cents. A
    // non-numeric entry throws here and is reported rather than posted as NaN.
    let input;
    try {
      input = {
        ticker: tickerValue,
        buyDate,
        shares: Number(shares),
        pricePerShareCents: dollarsToCents(price),
        isSplitAdjusted,
        brokerageFirm,
        note,
      };
    } catch {
      setError("Enter the price as a number, e.g. 180.50.");
      setIsBusy(false);
      return;
    }

    const result = editing
      ? await updateTaxLotAction(editing.id, input)
      : await createTaxLotAction(input);

    setIsBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Something went wrong.");
      return;
    }
    router.refresh();
    onClose();
  }

  return (
    <Modal
      title={editing ? "Edit lot" : "Add a lot"}
      description="Enter the purchase as your confirmation printed it. Splits are applied for you."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isBusy}>
            Cancel
          </Button>
          {/* `Button` takes no `form` attribute, and the footer renders outside the
              <form>, so submitting is wired through the same handler by hand rather
              than by an implicit submit. */}
          <Button onClick={() => void handleSubmit()} disabled={isBusy}>
            {isBusy ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <form id="tax-lot-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* One column on a phone, two from `sm` up — the fields are short, so
            pairing them wastes no space on a desktop. */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">Ticker</span>
            <input
              value={tickerValue}
              onChange={(event) => setTickerValue(event.target.value)}
              required
              className="rounded-md border border-line bg-transparent px-3 py-2 text-ink"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">Purchase date</span>
            <input
              type="date"
              value={buyDate}
              onChange={(event) => setBuyDate(event.target.value)}
              required
              className="rounded-md border border-line bg-transparent px-3 py-2 text-ink"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">Shares</span>
            <input
              type="number"
              step="any"
              min="0"
              value={shares}
              onChange={(event) => setShares(event.target.value)}
              required
              className="rounded-md border border-line bg-transparent px-3 py-2 text-ink"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">Price per share</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              required
              className="rounded-md border border-line bg-transparent px-3 py-2 text-ink"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">Brokerage (optional)</span>
            <input
              value={brokerageFirm}
              onChange={(event) => setBrokerageFirm(event.target.value)}
              className="rounded-md border border-line bg-transparent px-3 py-2 text-ink"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">Note (optional)</span>
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="rounded-md border border-line bg-transparent px-3 py-2 text-ink"
            />
          </label>
        </div>

        {/* The flag that decides whether the split table is applied. Worth a full
            sentence rather than a bare label — getting it wrong is the one input
            error that produces plausible-looking nonsense. */}
        <label className="flex items-start gap-2 rounded-md border border-line p-3 text-sm">
          <input
            type="checkbox"
            checked={isSplitAdjusted}
            onChange={(event) => setIsSplitAdjusted(event.target.checked)}
            className="mt-1"
          />
          <span>
            <span className="text-ink">These numbers are already split-adjusted</span>
            <span className="mt-1 block text-xs text-muted">
              Leave this off for figures copied from an old confirmation — the analyzer
              will apply every split since the purchase date. Turn it on when your broker
              has already restated the lot in today&apos;s shares.
            </span>
          </span>
        </label>

        {error && <p className="text-sm text-red-400">{error}</p>}
      </form>
    </Modal>
  );
}

/**
 * The ticker picker, the metric cards and the trimming call-out.
 *
 * Split from the lot table below so the section can put each in its own
 * CollapsibleCard — a long screen folds down to the half in use, the same shape
 * Watch & Test uses. The two halves share no state; both are driven entirely by
 * the props the section loaded.
 */
/**
 * The lot table's columns.
 *
 * At module scope, taking its callbacks as arguments, so both halves of the screen
 * can build the same grid without one importing the other's state.
 */
function buildLotColumns(
  storedLots: TaxLot[],
  onEdit: (lot: TaxLot | undefined) => void,
  onDelete: (lot: LotPerformance) => void,
): DataGridColumn<LotPerformance>[] {
  return [
    {
      key: "buyDate",
      header: "Purchase Date",
      value: (lot) => lot.buyDate,
      render: (lot) => (
        <span className="tabular-nums">
          {lot.buyDate}
          {/* Only shown when the split table actually did something, so an
              unsplit lot's row stays quiet. */}
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
      // Sorted by percent, since that is the comparable figure across lots of
      // different sizes — the dollar amount rides along in the cell.
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
      key: "cagr",
      header: "CAGR",
      value: (lot) => lot.cagr,
      render: (lot) => (
        <span className={`tabular-nums ${gainClass(lot.cagr)}`}>
          {lot.yearsHeld > 0 ? formatRate(lot.cagr) : "—"}
        </span>
      ),
    },
    {
      key: "yieldOnCost",
      header: "Yield on Cost",
      value: (lot) => lot.yieldOnCost,
      render: (lot) => (
        <span className="tabular-nums">
          {lot.yieldOnCost > 0 ? `${lot.yieldOnCost.toFixed(2)}%` : "—"}
        </span>
      ),
    },
    {
      key: "yearsHeld",
      header: "Years Held",
      value: (lot) => lot.yearsHeld,
      render: (lot) => <span className="tabular-nums">{lot.yearsHeld.toFixed(2)}</span>,
    },
    {
      key: "taxStatus",
      header: "Tax Status",
      // Sorts long-term together rather than alphabetically by chance.
      value: (lot) => lot.taxClassification,
      render: (lot) => <TaxStatusBadge lot={lot} />,
    },
    {
      key: "actions",
      header: "",
      excludeFromRecordView: true,
      render: (lot) => (
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onEdit(storedLots.find((stored) => stored.id === lot.id))}
            disabled={lot.id === undefined}
          >
            Edit
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onDelete(lot)}>
            Delete
          </Button>
        </div>
      ),
    },
  ];
}

export function StockTaxLotsSummary({
  tickers,
  selectedTicker,
  lots,
  summary,
  hasLivePrice,
  trailingEPS,
}: TaxLotsViewProps) {
  const router = useRouter();
  const [isAdding, setIsAdding] = useState(false);


  const trimCandidates = lots.filter((lot) => lot.isTrimCandidate);

  return (
    <div className="flex flex-col gap-6">
      {/* Ticker picker and Add. `flex-wrap` so the two sit on one line on a
          desktop and stack on a narrow screen without a viewport query. */}
      <div className="flex flex-wrap items-center gap-3">
        {tickers.length > 0 && (
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted">Ticker</span>
            <select
              value={selectedTicker ?? ""}
              onChange={(event) => {
                const next = event.target.value;
                router.push(`/modules/stock-etfs/tax-lots?ticker=${encodeURIComponent(next)}`);
              }}
              className="rounded-md border border-line bg-transparent px-3 py-2 text-ink"
            >
              {tickers.map((ticker) => (
                <option key={ticker} value={ticker}>
                  {ticker}
                </option>
              ))}
            </select>
          </label>
        )}
        <Button onClick={() => setIsAdding(true)}>Add a lot</Button>
      </div>

      {!summary || lots.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-muted">
          No purchase lots recorded yet. Add one to see its split-adjusted basis, return
          and holding period.
        </p>
      ) : (
        <>
          {/* The executive metric row: 1 column on a phone, 2 from `sm`, 3 from
              `lg`. Six cards divide evenly into all three. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <MetricCard
              label="Total Invested"
              value={formatDollars(summary.totalCapitalInvested)}
              hint={`${summary.lotCount} lot${summary.lotCount === 1 ? "" : "s"} · ${formatShares(summary.totalAdjustedShares)} adj. shares`}
            />
            <MetricCard
              label="Current Value"
              value={formatDollars(summary.totalCurrentValue)}
              hint={
                hasLivePrice
                  ? `at ${formatDollars(summary.currentMarketPrice)}/share`
                  : `at an assumed ${formatDollars(summary.currentMarketPrice)}/share — not a held position`
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
            <MetricCard
              label="Position XIRR"
              // undefined is rendered as "—", never as 0 — see computeXirr.
              value={summary.xirr === undefined ? "—" : formatRate(summary.xirr)}
              hint={
                summary.xirr === undefined
                  ? "needs purchases on more than one date"
                  : "money-weighted annual return"
              }
              valueClassName={summary.xirr === undefined ? "text-muted" : gainClass(summary.xirr)}
            />
            <MetricCard
              label="Blended Yield on Cost"
              value={trailingEPS > 0 ? `${summary.blendedYieldOnCost.toFixed(2)}%` : "—"}
              hint={
                trailingEPS > 0
                  ? `on ${formatDollars(trailingEPS)} trailing EPS`
                  : "no trailing EPS available"
              }
            />
          </div>

          {/* The trimming call-out. Above the table, because it is the screen's
              actual conclusion — the table is the evidence for it. */}
          {trimCandidates.length > 0 && (
            <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-4">
              <p className="text-sm font-medium text-emerald-300">
                {trimCandidates.length} lot{trimCandidates.length === 1 ? "" : "s"} can be
                trimmed at long-term rates
              </p>
              <p className="mt-1 text-xs text-muted">
                {formatDollars(summary.longTermValue)} of the position is past the one-year
                line, carrying{" "}
                {formatSignedDollars(
                  trimCandidates.reduce((sum, lot) => sum + lot.unrealizedGainDollars, 0),
                )}{" "}
                in long-term gains. Lots marked ✓ are in profit and eligible; a long-term
                lot at a loss is a harvesting candidate instead.
                {summary.shortTermLotCount > 0 &&
                  ` ${summary.shortTermLotCount} lot${summary.shortTermLotCount === 1 ? "" : "s"} (${formatDollars(summary.shortTermValue)}) would still sell at short-term rates.`}
              </p>
            </div>
          )}

        </>
      )}

      {isAdding && (
        <LotFormDialog ticker={selectedTicker ?? ""} onClose={() => setIsAdding(false)} />
      )}
    </div>
  );
}

/** The sortable per-lot breakdown. `DataGrid` gives sorting, CSV export and the
 *  one-card-per-lot compact layout below 1024px for free. */
export function StockTaxLotsTable({ lots, storedLots }: TaxLotsViewProps) {
  const router = useRouter();
  const [editing, setEditing] = useState<TaxLot | undefined>(undefined);

  async function handleDelete(lot: LotPerformance) {
    if (lot.id === undefined) return;
    if (!window.confirm(`Delete the ${lot.buyDate} lot of ${lot.ticker}?`)) return;
    const result = await deleteTaxLotAction(lot.id);
    if (result.ok) router.refresh();
    else window.alert(result.error);
  }

  const columns = buildLotColumns(storedLots, setEditing, handleDelete);

  return (
    <>
      <DataGrid
        columns={columns}
        rows={lots}
        getRowKey={(lot) => String(lot.id ?? `${lot.buyDate}-${lot.adjustedShares}`)}
        emptyMessage="No lots recorded for this ticker."
      />
      {editing && (
        <LotFormDialog
          ticker={editing.ticker}
          editing={editing}
          onClose={() => setEditing(undefined)}
        />
      )}
    </>
  );
}
