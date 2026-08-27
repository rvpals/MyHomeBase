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
          {/* Ties the row to its line in the overlay below. */}
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
 * The overlay's rows.
 *
 * `normalizeSeries` has already resampled every range onto the same fixed grid
 * of progress steps, so joining them is a straight zip: one row per step,
 * carrying every selected range's percent change at that step. That shared grid
 * is what makes the chart honest — its x-axis is categorical, laying rows out
 * evenly by position, so series on different grids would each be drawn at the
 * wrong x.
 */
function buildOverlayRows(simulations: RangeSimulation[]): Record<string, number>[] {
  // The longest series defines the grid. Taking the first would collapse the
  // whole chart to one row if that range happened to hold a single close.
  const steps = Math.max(0, ...simulations.map((simulation) => simulation.series.length));

  return Array.from({ length: steps }, (_, step) => {
    const row: Record<string, number> = { progressPct: (step / Math.max(1, steps - 1)) * 100 };
    for (const simulation of simulations) {
      const point = simulation.series[step];
      if (point) row[simulation.range] = point.changePct;
    }
    return row;
  });
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

  const overlayRows = useMemo(
    () => (result ? buildOverlayRows(result.simulations) : []),
    [result],
  );

  const overlaySeries: ChartLineSeries[] = useMemo(
    () =>
      (result?.simulations ?? []).map((simulation) => ({
        key: simulation.range,
        label: SIMULATION_RANGE_LABELS[simulation.range],
        color: colorForRange(simulation.range),
      })),
    [result],
  );

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
            <CollapsibleCard title="Price Overlay" defaultOpen>
              <p className="mb-3 text-xs text-muted">
                Each line is one time range, plotted as percent change from its own buy price
                against how far through that range it is — so a 1-week line and a 10-year line
                can be compared on one axis. Every line starts at 0%.
              </p>
              <ChartLine
                data={overlayRows}
                series={overlaySeries}
                xKey="progressPct"
                curve="linear"
                // Only a single-close range leaves a gap in the shared grid;
                // joining across it beats breaking the line into dots.
                connectNulls
                showLegend
                height={340}
                formatValue={(value) => `${value.toFixed(1)}%`}
                formatX={(value) => `${Number(value).toFixed(0)}%`}
                displayStorageKey="myhomebase:stock-simulation-overlay"
              />
            </CollapsibleCard>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
