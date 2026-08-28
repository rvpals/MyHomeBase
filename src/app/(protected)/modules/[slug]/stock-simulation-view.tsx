"use client";

// The Simulation screen: one ticker, a share count, a set of time ranges, and a
// "what if I had bought then" answer for each.
//
// All state is view state — nothing here is saved. The result comes back from
// one server action and lives in `useState` until the next run, which is why
// this screen reads no server data and the section renders it with no props.

import { useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/button";
import { ChartLine, type ChartLineSeries } from "@/components/chart-line";
import { CHART_CATEGORICAL_COLORS } from "@/components/chart-colors";
import { CollapsibleCard } from "@/components/collapsible-card";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import { TickerLogo } from "@/components/ticker-logo";
import { formatCents } from "@/lib/shared/money";
import {
  SIMULATION_RANGES,
  SIMULATION_RANGE_LABELS,
  type RangeSimulation,
  type SimulationRange,
  type SimulationResult,
} from "@/lib/stock-simulation";
import { runSimulationAction } from "./stock-simulation-actions";

const INPUT_CLASS =
  "rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

/** Sensible opening pick — the three windows most people reach for first. */
const DEFAULT_RANGES: SimulationRange[] = ["1mo", "6mo", "1y"];

/**
 * A range's colour comes from its position in `SIMULATION_RANGES`, not from its
 * position in the *selected* list — otherwise unticking one range would recolour
 * every line after it. The palette is 8 long and there are 10 ranges, so 10Y and
 * MAX reuse the first two hues; they're the two least likely to be compared
 * side by side, and the legend names every line regardless.
 */
function colorForRange(range: SimulationRange): string {
  const index = SIMULATION_RANGES.indexOf(range);
  return CHART_CATEGORICAL_COLORS[index % CHART_CATEGORICAL_COLORS.length];
}

function formatPct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatSignedCents(cents: number): string {
  return `${cents >= 0 ? "+" : "-"}${formatCents(Math.abs(cents))}`;
}

/** Epoch seconds → a short local date, for a card's entry point. */
function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Green for a gain, red for a loss — paired with a sign, never colour alone. */
function toneFor(cents: number): string {
  if (cents > 0) return "text-emerald-400";
  if (cents < 0) return "text-red-400";
  return "text-ink";
}

/**
 * One row per selected range, all five figures as columns.
 *
 * A `DataGrid` rather than a hand-built table (`components.md`: "do not build
 * another table") — and rather than the per-range cards this screen first had.
 * Every range reports exactly the same five figures, so columns line up and the
 * ranges become directly comparable down a column, which is the whole reason to
 * tick several at once. It also brings sorting, CSV export and the phone layout
 * for free: below 1024px `DataGrid` delegates to `DataGridCompact`, so each
 * range becomes a card again where a five-column table wouldn't fit.
 */
function buildResultColumns(): DataGridColumn<RangeSimulation>[] {
  return [
    {
      key: "range",
      header: "Range",
      value: (row) => SIMULATION_RANGES.indexOf(row.range),
      render: (row) => (
        <span className="inline-flex items-center gap-2">
          {/* Ties the row to its own chart card below. */}
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: colorForRange(row.range) }}
          />
          <span className="text-ink">{SIMULATION_RANGE_LABELS[row.range]}</span>
        </span>
      ),
    },
    {
      key: "buyDate",
      header: "Bought",
      value: (row) => row.buyTimestamp,
      render: (row) => formatDate(row.buyTimestamp),
    },
    {
      key: "buyPrice",
      header: "Buy Price",
      value: (row) => row.buyPriceCents,
      render: (row) => formatCents(row.buyPriceCents),
    },
    {
      key: "currentPrice",
      header: "Current Price",
      value: (row) => row.currentPriceCents,
      render: (row) => formatCents(row.currentPriceCents),
    },
    {
      key: "totalCost",
      header: "Total Cost",
      value: (row) => row.totalCostCents,
      render: (row) => formatCents(row.totalCostCents),
    },
    {
      key: "currentValue",
      header: "Current Value",
      value: (row) => row.currentValueCents,
      render: (row) => formatCents(row.currentValueCents),
    },
    {
      key: "gainLoss",
      header: "Gain / Loss",
      value: (row) => row.gainLossCents,
      render: (row) => (
        <span className={toneFor(row.gainLossCents)}>{formatSignedCents(row.gainLossCents)}</span>
      ),
    },
    {
      key: "gainLossPct",
      header: "Gain / Loss %",
      value: (row) => row.gainLossPct,
      render: (row) => (
        <span className={toneFor(row.gainLossCents)}>{formatPct(row.gainLossPct)}</span>
      ),
    },
  ];
}

/**
 * One range's own chart rows.
 *
 * Each range now gets its own card, so there's no shared grid to zip onto — the
 * series is already normalized to 0-100 progress by `normalizeSeries`, and the
 * x-axis can just be the real close date, which reads better than a progress
 * percentage once a chart only has one range in it.
 */
function buildRangeRows(simulation: RangeSimulation): Record<string, number>[] {
  return simulation.series.map((point) => ({
    timestamp: point.timestamp,
    changePct: point.changePct,
  }));
}

/** Epoch seconds → a compact axis tick. Year only, once a range spans years. */
function formatAxisDate(value: string | number, spansYears: boolean): string {
  const date = new Date(Number(value) * 1000);
  return spansYears
    ? date.toLocaleDateString(undefined, { year: "numeric", month: "short" })
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * One range, one card, one chart.
 *
 * Split out of the view so each card owns its own memoized rows — a ten-range
 * run would otherwise rebuild every chart's data whenever any one of them
 * changed.
 */
function RangeChartCard({ simulation }: { simulation: RangeSimulation }) {
  const rows = useMemo(() => buildRangeRows(simulation), [simulation]);

  const series: ChartLineSeries[] = useMemo(
    () => [
      {
        key: "changePct",
        label: SIMULATION_RANGE_LABELS[simulation.range],
        color: colorForRange(simulation.range),
      },
    ],
    [simulation.range],
  );

  // Roughly a year of seconds — enough to decide between "Mar 4" and "Mar 2024".
  const spansYears = simulation.currentTimestamp - simulation.buyTimestamp > 400 * 24 * 60 * 60;

  return (
    <CollapsibleCard
      title={`${SIMULATION_RANGE_LABELS[simulation.range]} — bought ${formatDate(simulation.buyTimestamp)}`}
      defaultOpen
      headerAction={
        <span className={`text-sm ${toneFor(simulation.gainLossCents)}`}>
          {formatSignedCents(simulation.gainLossCents)} ({formatPct(simulation.gainLossPct)})
        </span>
      }
    >
      <ChartLine
        data={rows}
        series={series}
        xKey="timestamp"
        curve="linear"
        height={260}
        formatValue={(value) => `${value.toFixed(1)}%`}
        formatX={(value) => formatAxisDate(value, spansYears)}
        displayStorageKey={`myhomebase:stock-simulation-overlay:${simulation.range}`}
      />
    </CollapsibleCard>
  );
}

export function StockSimulationView() {
  const [ticker, setTicker] = useState("");
  const [shares, setShares] = useState("10");
  const [ranges, setRanges] = useState<SimulationRange[]>(DEFAULT_RANGES);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [result, setResult] = useState<SimulationResult | undefined>(undefined);

  function toggleRange(range: SimulationRange) {
    setRanges((current) =>
      current.includes(range) ? current.filter((item) => item !== range) : [...current, range],
    );
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    setIsRunning(true);
    try {
      const response = await runSimulationAction({
        ticker,
        shares: Number(shares),
        ranges,
      });
      if (!response.ok || !response.result) {
        setError(response.error ?? "Failed to run the simulation.");
        setResult(undefined);
        return;
      }
      setResult(response.result);
    } finally {
      setIsRunning(false);
    }
  }

  const resultColumns = useMemo(() => buildResultColumns(), []);

  return (
    <div className="flex flex-col gap-6">
      <form
        onSubmit={handleSubmit}
        className="rounded-xl border border-line p-4"
        aria-label="Simulation parameters"
      >
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-muted">Ticker</span>
            <input
              value={ticker}
              onChange={(event) => setTicker(event.target.value)}
              placeholder="AAPL"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              className={`${INPUT_CLASS} w-32 uppercase`}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-muted">Shares</span>
            <input
              value={shares}
              onChange={(event) => setShares(event.target.value)}
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              className={`${INPUT_CLASS} w-28`}
            />
          </label>
        </div>

        <fieldset className="mt-4">
          <legend className="text-xs font-medium uppercase tracking-wide text-muted">
            Time ranges
          </legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {SIMULATION_RANGES.map((range) => {
              const isSelected = ranges.includes(range);
              return (
                <label
                  key={range}
                  className={`cursor-pointer rounded-md border px-3 py-1.5 text-sm ${
                    isSelected
                      ? "border-brass bg-brass-soft text-brass-dark"
                      : "border-line bg-paper text-muted hover:border-brass hover:text-ink"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleRange(range)}
                    className="sr-only"
                  />
                  {SIMULATION_RANGE_LABELS[range]}
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={isRunning || ranges.length === 0}>
            {isRunning ? "Running…" : "Run Sim"}
          </Button>
          <p className="text-xs text-muted">
            Each range assumes you bought at that window&apos;s starting close and held to
            today. Price return only — dividends and fees aren&apos;t counted.
          </p>
        </div>

        {error ? <p className="mt-3 text-sm text-red-400">{error}</p> : null}
      </form>

      {result ? (
        <>
          <CollapsibleCard
            title="Results"
            defaultOpen
            headerAction={
              <span className="flex items-center gap-2 text-sm text-muted">
                <TickerLogo ticker={result.ticker} size={20} />
                {result.ticker} · {result.shares} {result.shares === 1 ? "share" : "shares"}
              </span>
            }
          >
            {result.simulations.length === 0 ? (
              <p className="text-sm text-muted">No range returned usable price history.</p>
            ) : (
              <DataGrid
                columns={resultColumns}
                rows={result.simulations}
                getRowKey={(row) => row.range}
                // Ten rows at most, and every one is meant to be read against
                // the others — so no paging, no search, and no toolbar of
                // controls for a table this size. Sorting a column still works.
                defaultPageSize="ALL"
                showToolbar={false}
                enableRecordView={false}
                exportFileName={`${result.ticker}-simulation`}
                storageKey="myhomebase:stock-simulation-results"
              />
            )}

            {result.failures.length > 0 ? (
              <ul className="mt-4 flex flex-col gap-1 border-t border-line pt-3 text-xs text-muted">
                {result.failures.map((failure) => (
                  <li key={failure.range}>
                    <strong className="text-ink">{SIMULATION_RANGE_LABELS[failure.range]}</strong>{" "}
                    — {failure.reason}
                  </li>
                ))}
              </ul>
            ) : null}
          </CollapsibleCard>

          {result.simulations.length > 0 ? (
            <section className="flex flex-col gap-3" aria-label="Price charts">
              <p className="text-xs text-muted">
                One chart per selected time range, each plotted as percent change from that
                range&apos;s own buy price — so every chart starts at 0% and shows only its own
                window. Read the table above to compare ranges against each other.
              </p>
              {/* Two charts abreast on a desktop; one per row below 1024px, where a
                  half-width chart would be too narrow to read. */}
              <div className="grid grid-cols-2 gap-4 max-lg:grid-cols-1">
                {result.simulations.map((simulation) => (
                  <RangeChartCard key={simulation.range} simulation={simulation} />
                ))}
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
