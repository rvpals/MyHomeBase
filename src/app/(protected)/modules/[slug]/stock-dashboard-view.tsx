"use client";

// The Stocks & ETFs dashboard: what the portfolio is worth, how it moved today,
// what it has returned since you bought in, and how the value is spread. Every
// number arrives already computed by the lib — this file only formats and lays out.

import type { ReactNode } from "react";
import { ChartBar } from "@/components/chart-bar";
import { ChartLine } from "@/components/chart-line";
import { CollapsibleCard } from "@/components/collapsible-card";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import type { DashboardWidgetId } from "@/lib/stock-dashboard";
import { snapshotChangePct } from "@/lib/stock-daily-snapshot";
import type { DailySnapshot, PeriodSummary, ToDateSummaries } from "@/lib/stock-daily-snapshot";
import type { AllocationSlice, PortfolioSummary } from "@/lib/stock-positions";
import { centsToDollars, formatCents } from "@/lib/shared/money";
import { StockIndexesCard } from "./stock-indexes-card";

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

function AllocationChart({
  title,
  slices,
  note,
}: {
  title: string;
  slices: AllocationSlice[];
  /** Optional line under the chart, explaining where the labels came from. */
  note?: string;
}) {
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
        displayStorageKey={`myhomebase:chart:stock-allocation:${title}`}
      />
      {note && <p className="mt-1 text-xs text-muted">{note}</p>}
    </div>
  );
}

/**
 * The headline card: what the portfolio is worth right now and how it moved
 * today, over a collapsed Portfolio History child holding the value curve and
 * the day-by-day table.
 *
 * The two big numbers come from the live positions rather than the newest
 * snapshot, so they're right even before today's refresh — the snapshots feed
 * the chart and the table inside the child card.
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
    <CollapsibleCard title="Portfolio Summary" defaultOpen>
      <p className="font-display text-3xl text-ink">{formatCents(summary.totalValueCents)}</p>
      <p className={`mt-1 text-sm font-medium ${gainClass(summary.totalDayGainLossCents)}`}>
        {summary.totalDayGainLossCents >= 0 ? "▲" : "▼"} {formatCents(summary.totalDayGainLossCents)} (
        {summary.dayChangePct >= 0 ? "+" : ""}
        {summary.dayChangePct.toFixed(2)}%) today
      </p>
      <p className="mt-1 text-xs text-muted">
        {summary.positionCount} position(s) ·{" "}
        {snapshots.length > 0
          ? `${snapshots.length} day(s) of history since ${snapshots[0].snapshotDate}`
          : "no history captured yet — press the refresh icon by the heading"}
      </p>

      {/* Both views of the snapshot data live in one child card, collapsed by
          default: the headline numbers above are the daily read, and the chart
          and table are what you open when you want the trend behind them. With
          no snapshots there's nothing to open, so the empty state replaces the
          card rather than sitting inside it. */}
      {history.length > 0 ? (
        <CollapsibleCard title="Portfolio History" className="mt-6">
          <div>
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
              // Three overlaid series: the latest value of each, at its own line's
              // end, and nothing in between.
              pointLabels="last"
              displayStorageKey="myhomebase:chart:stock-dashboard-history"
            />
            <p className="mt-1 text-xs text-muted">
              One point per day you refreshed. A day with no capture is absent rather than
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
        </CollapsibleCard>
      ) : (
        <p className="mt-4 rounded-md border border-dashed border-line p-4 text-center text-sm text-muted">
          The value chart and history appear once you&apos;ve captured a day. Press the{" "}
          <span className="text-ink">refresh icon</span> beside the heading to record today.
        </p>
      )}
    </CollapsibleCard>
  );
}

/**
 * All three ways the same total splits up, in one collapsed card.
 *
 * They were three separately-toggleable widgets once; nobody wanted one without
 * the others, and three collapses to close a single idea was three too many. An
 * individual chart still hides itself when it has no slices (`AllocationChart`
 * returns null), so an empty split costs nothing here — but if all three are
 * empty the card would open onto blank space, hence the explicit empty state.
 */
function PortfolioAllocationCard({
  byType,
  byStrategy,
  bySector,
  sectorsPending,
}: {
  byType: AllocationSlice[];
  byStrategy: AllocationSlice[];
  bySector: AllocationSlice[];
  sectorsPending: boolean;
}) {
  // `sectorsPending` counts as content: it means there ARE positions, they just
  // have no looked-up sector yet, and the "press Refresh All" prompt is the whole
  // point of that state. Without it here an unrefreshed portfolio would fall
  // through to the "nothing to split up" line and never say what to do.
  const hasAny =
    byType.length > 0 || byStrategy.length > 0 || bySector.length > 0 || sectorsPending;

  return (
    <CollapsibleCard title="Portfolio Allocation">
      {hasAny ? (
        // Stacked at every width, as the three charts were before they shared a
        // card: a bar chart reads along its bars, and half-width bars with a
        // ticker label on each one wrap badly on a phone.
        <div className="flex flex-col gap-6">
          <AllocationChart title="Allocation by type" slices={byType} />
          <AllocationChart title="Allocation by strategy" slices={byStrategy} />
          {sectorsPending ? (
            <div>
              <h3 className="font-display text-lg text-ink">Allocation by sector</h3>
              <p className="mt-2 rounded-md border border-dashed border-line p-4 text-center text-sm text-muted">
                Sectors are looked up per ticker. Press{" "}
                <span className="text-ink">Refresh All</span> to fetch them — it happens once per
                symbol, not on every visit.
              </p>
            </div>
          ) : (
            <AllocationChart
              title="Allocation by sector"
              slices={bySector}
              note="A fund has no single sector, so ETFs are grouped rather than split across the industries they hold."
            />
          )}
        </div>
      ) : (
        <p className="rounded-md border border-dashed border-line p-4 text-center text-sm text-muted">
          Nothing to split up yet — import a positions CSV and the three allocation charts appear
          here.
        </p>
      )}
    </CollapsibleCard>
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
  bySector,
  sectorsPending,
  transactionCount,
  accountCount,
  unassignedCount,
  snapshots,
  toDate,
  widgets,
}: {
  summary: PortfolioSummary;
  byType: AllocationSlice[];
  byStrategy: AllocationSlice[];
  bySector: AllocationSlice[];
  /**
   * True when no position has a looked-up sector yet, so the chart would be a
   * single "ETFs & funds" bar. Says why instead of showing that.
   */
  sectorsPending: boolean;
  transactionCount: number;
  accountCount: number;
  /** Positions still sitting in the "Unassigned" pseudo-account. */
  unassignedCount: number;
  /** This year's captured snapshots, oldest first. */
  snapshots: DailySnapshot[];
  toDate: ToDateSummaries;
  /** Which widgets to draw and in what order — from Configuration → Dashboard widgets. */
  widgets: DashboardWidgetId[];
}) {
  const hasCostBasis = summary.totalCostCents > 0;

  /**
   * Every widget, keyed by id, so the render is a lookup over the user's order
   * rather than a fixed sequence of JSX. Building the map costs nothing — these are
   * elements, not renders — and it keeps "what a widget is" in one place.
   */
  const widgetContent: Record<DashboardWidgetId, ReactNode> = {
    // Self-contained: it takes no props because it fetches its own board from its
    // own Refresh all button, so the server loads nothing for it on page render.
    indexes: <StockIndexesCard />,
    summary: <PortfolioSummaryCard summary={summary} snapshots={snapshots} />,
    statistics: (
      <CollapsibleCard title="Statistics">
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <PeriodTile label="Week to date" summary={toDate.week} />
            <PeriodTile label="Month to date" summary={toDate.month} />
            <PeriodTile label="Year to date" summary={toDate.year} />
          </div>

          {/* Total Value and Day Change deliberately absent — the Portfolio Summary
              card leads with both, and the same figure twice on one screen reads as
              two different measurements. */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
            <StatTiles
              summary={summary}
              hasCostBasis={hasCostBasis}
              transactionCount={transactionCount}
              accountCount={accountCount}
              unassignedCount={unassignedCount}
            />
          </div>
        </div>
      </CollapsibleCard>
    ),
    allocation: (
      <PortfolioAllocationCard
        byType={byType}
        byStrategy={byStrategy}
        bySector={bySector}
        sectorsPending={sectorsPending}
      />
    ),
  };

  return (
    <div className="flex flex-col gap-8">
      {widgets.map((id) => (
        <div key={id}>{widgetContent[id]}</div>
      ))}
      {widgets.length === 0 && (
        <p className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-muted">
          Every dashboard widget is hidden. Turn one back on under{" "}
          <span className="text-ink">Configuration &rarr; Dashboard widgets</span>.
        </p>
      )}
    </div>
  );
}

/** Kept out of the component body only to stop the widget map running long. */
function StatTiles({
  summary,
  hasCostBasis,
  transactionCount,
  accountCount,
  unassignedCount,
}: {
  summary: PortfolioSummary;
  hasCostBasis: boolean;
  transactionCount: number;
  accountCount: number;
  unassignedCount: number;
}) {
  return (
    <>
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
    </>
  );
}
