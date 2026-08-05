"use client";

// The Stocks & ETFs dashboard: what the portfolio is worth, how it moved today,
// what it has returned since you bought in, and how the value is spread. Every
// number arrives already computed by the lib — this file only formats and lays out.

import { ChartBar } from "@/components/chart-bar";
import { ChartLine } from "@/components/chart-line";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import { snapshotChangePct } from "@/lib/stock-daily-snapshot";
import type { DailySnapshot, PeriodSummary, ToDateSummaries } from "@/lib/stock-daily-snapshot";
import type {
  AllocationSlice,
  DayMovesByType,
  PortfolioSummary,
  TickerDayMove,
} from "@/lib/stock-positions";
import { centsToDollars, formatCents } from "@/lib/shared/money";
import { StockDailyGlance } from "./stock-daily-glance";
import { StockRefreshPanel } from "./stock-refresh-panel";

function gainClass(cents: number): string {
  return cents < 0 ? "text-red-400" : "text-emerald-400";
}

function StatTile({
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
      <p className={`mt-1 font-display text-xl ${valueClassName}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

function AllocationChart({ title, slices }: { title: string; slices: AllocationSlice[] }) {
  if (slices.length === 0) return null;
  return (
    <div>
      <h3 className="font-display text-lg text-ink">{title}</h3>
      <ChartBar
        items={slices.map((slice) => ({
          key: slice.label,
          label: slice.label,
          value: centsToDollars(slice.valueCents),
        }))}
        formatValue={(value) => formatCents(Math.round(value * 100))}
        className="mt-2"
      />
    </div>
  );
}

/**
 * The headline card: what the portfolio is worth right now, how it moved today,
 * the value curve, and the day-by-day history behind it.
 *
 * The two big numbers come from the live positions rather than the newest
 * snapshot, so they're right even before today's Refresh All — the snapshots feed
 * the chart and the table below them.
 */
function PortfolioSummaryCard({
  summary,
  snapshots,
}: {
  summary: PortfolioSummary;
  snapshots: DailySnapshot[];
}) {
  const history = snapshots.map((snapshot) => ({
    date: snapshot.snapshotDate,
    total: centsToDollars(snapshot.totalValueCents),
    stock: centsToDollars(snapshot.stockValueCents),
    etf: centsToDollars(snapshot.etfValueCents),
  }));

  // Newest first: the history table is read as "what happened lately", unlike the
  // chart, which reads left-to-right in time.
  const tableRows = [...snapshots].reverse();

  const columns: DataGridColumn<DailySnapshot>[] = [
    {
      key: "date",
      header: "Date",
      value: (row) => row.snapshotDate,
      render: (row) => row.snapshotDate,
    },
    {
      key: "stock",
      header: "Stock",
      value: (row) => row.stockValueCents,
      render: (row) => formatCents(row.stockValueCents),
    },
    {
      key: "etf",
      header: "ETF",
      value: (row) => row.etfValueCents,
      render: (row) => formatCents(row.etfValueCents),
    },
    {
      key: "other",
      header: "Other",
      value: (row) => row.otherValueCents,
      render: (row) => (row.otherValueCents > 0 ? formatCents(row.otherValueCents) : "—"),
    },
    {
      key: "total",
      header: "Total",
      value: (row) => row.totalValueCents,
      render: (row) => <span className="font-medium text-ink">{formatCents(row.totalValueCents)}</span>,
    },
    {
      key: "gainLoss",
      header: "Day G/L",
      value: (row) => row.totalGainLossCents,
      render: (row) => (
        <span className={gainClass(row.totalGainLossCents)}>{formatCents(row.totalGainLossCents)}</span>
      ),
      // Summed across the filtered range, which makes the footer a period total:
      // filter to a month and this cell is that month's P&L.
      aggregate: "sum",
      formatAggregate: (cents) => formatCents(cents),
    },
    {
      key: "gainLossPct",
      header: "Day G/L %",
      value: (row) => snapshotChangePct(row),
      render: (row) => {
        const pct = snapshotChangePct(row);
        return (
          <span className={gainClass(row.totalGainLossCents)}>
            {pct >= 0 ? "+" : ""}
            {pct.toFixed(2)}%
          </span>
        );
      },
    },
    {
      key: "positionCount",
      header: "Positions",
      value: (row) => row.positionCount,
      render: (row) => row.positionCount,
    },
  ];

  return (
    <div className="rounded-xl border border-line p-4">
      <h3 className="font-display text-lg text-ink">Portfolio Summary</h3>

      <p className="mt-2 font-display text-3xl text-ink">{formatCents(summary.totalValueCents)}</p>
      <p className={`mt-1 text-sm font-medium ${gainClass(summary.totalDayGainLossCents)}`}>
        {summary.totalDayGainLossCents >= 0 ? "▲" : "▼"} {formatCents(summary.totalDayGainLossCents)} (
        {summary.dayChangePct >= 0 ? "+" : ""}
        {summary.dayChangePct.toFixed(2)}%) today
      </p>
      <p className="mt-1 text-xs text-muted">
        {summary.positionCount} position(s) ·{" "}
        {snapshots.length > 0
          ? `${snapshots.length} day(s) of history since ${snapshots[0].snapshotDate}`
          : "no history captured yet — press Refresh All"}
      </p>

      {history.length > 0 ? (
        <>
          <div className="mt-6">
            <h4 className="text-xs font-medium uppercase tracking-wide text-muted">
              Value over time
            </h4>
            <ChartLine
              className="mt-2"
              data={history}
              series={[
                { key: "total", label: "Total" },
                { key: "stock", label: "Stock" },
                { key: "etf", label: "ETF" },
              ]}
              xKey="date"
              formatValue={(value) => formatCents(Math.round(value * 100))}
            />
            <p className="mt-1 text-xs text-muted">
              One point per day you pressed Refresh All. A day with no capture is absent rather than
              flat-lined, so a gap in the line is a day that wasn&apos;t recorded.
            </p>
          </div>

          <div className="mt-6">
            <h4 className="text-xs font-medium uppercase tracking-wide text-muted">History</h4>
            <div className="mt-2">
              <DataGrid
                columns={columns}
                rows={tableRows}
                getRowKey={(row) => row.snapshotDate}
                emptyMessage="No snapshots captured yet."
                exportFileName="portfolio-history"
                storageKey="myhomebase:stock-snapshot-history-grid"
                recordViewTitle={(row) => `Portfolio on ${row.snapshotDate}`}
                defaultPageSize={30}
              />
            </div>
          </div>
        </>
      ) : (
        <p className="mt-4 rounded-md border border-dashed border-line p-4 text-center text-sm text-muted">
          The value chart and history appear once you&apos;ve captured a day. Press{" "}
          <span className="text-ink">Refresh All</span> above to record today.
        </p>
      )}
    </div>
  );
}

/**
 * One week/month/year rollup. Shows the day count because a period with a missed
 * capture is under-reported, and that should be visible rather than smoothed over.
 */
function PeriodTile({ label, summary }: { label: string; summary: PeriodSummary }) {
  if (summary.dayCount === 0) {
    return (
      <div className="rounded-xl border border-line p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
        <p className="mt-1 font-display text-xl text-muted">—</p>
        <p className="mt-1 text-xs text-muted">no days captured yet</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-line p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-1 font-display text-xl ${gainClass(summary.gainLossCents)}`}>
        {formatCents(summary.gainLossCents)} ({summary.gainLossPct.toFixed(2)}%)
      </p>
      <p className="mt-1 text-xs text-muted">
        {summary.dayCount} day(s) · {summary.upDays} up / {summary.downDays} down
      </p>
    </div>
  );
}

export function StockDashboardView({
  summary,
  byType,
  byStrategy,
  dayMoves,
  tickerMoves,
  transactionCount,
  accountCount,
  unassignedCount,
  snapshots,
  toDate,
}: {
  summary: PortfolioSummary;
  byType: AllocationSlice[];
  byStrategy: AllocationSlice[];
  /** Today's move split into Stock / ETF / Other. */
  dayMoves: DayMovesByType;
  /** Today's move per ticker, already summed across accounts. */
  tickerMoves: TickerDayMove[];
  transactionCount: number;
  accountCount: number;
  /** Positions still sitting in the "Unassigned" pseudo-account. */
  unassignedCount: number;
  /** This year's captured snapshots, oldest first. */
  snapshots: DailySnapshot[];
  toDate: ToDateSummaries;
}) {
  const hasCostBasis = summary.totalCostCents > 0;

  const lastSnapshotDate = snapshots[snapshots.length - 1]?.snapshotDate;

  return (
    <div className="flex flex-col gap-8">
      <StockRefreshPanel lastSnapshotDate={lastSnapshotDate} />

      <PortfolioSummaryCard summary={summary} snapshots={snapshots} />

      <StockDailyGlance moves={dayMoves} tickerMoves={tickerMoves} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <PeriodTile label="Week to date" summary={toDate.week} />
        <PeriodTile label="Month to date" summary={toDate.month} />
        <PeriodTile label="Year to date" summary={toDate.year} />
      </div>

      {/* Total Value and Day Change deliberately absent — the Portfolio Summary
          card above leads with both, and the same figure twice on one screen reads
          as two different measurements. */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatTile label="Positions" value={String(summary.positionCount)} hint={`${accountCount} account(s)`} />
        <StatTile
          label="Total Return"
          // A zero cost basis means "not imported yet", not "free" — say so rather
          // than printing a fake 0.00%.
          value={
            hasCostBasis
              ? `${formatCents(summary.totalUnrealizedGainLossCents)} (${summary.totalReturnPct.toFixed(2)}%)`
              : "—"
          }
          hint={hasCostBasis ? `on ${formatCents(summary.totalCostCents)} cost` : "import a positions CSV with cost basis"}
          valueClassName={hasCostBasis ? gainClass(summary.totalUnrealizedGainLossCents) : "text-muted"}
        />
        <StatTile label="Cost Basis" value={hasCostBasis ? formatCents(summary.totalCostCents) : "—"} />
        <StatTile
          label="Annual Income"
          value={formatCents(summary.annualDividendIncomeCents)}
          hint="forward dividends"
        />
        <StatTile label="Transactions" value={String(transactionCount)} />
        <StatTile
          label="Unassigned"
          value={String(unassignedCount)}
          hint={unassignedCount > 0 ? "positions with no account" : "every position has an account"}
          valueClassName={unassignedCount > 0 ? "text-brass-dark" : "text-ink"}
        />
      </div>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
        <AllocationChart title="Allocation by type" slices={byType} />
        <AllocationChart title="Allocation by strategy" slices={byStrategy} />
      </div>

    </div>
  );
}
