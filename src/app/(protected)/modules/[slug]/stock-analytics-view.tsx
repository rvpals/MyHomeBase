"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { ChartLine } from "@/components/chart-line";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import { Tabs, type TabItem } from "@/components/tabs";
import type { CorrelationResult, SharpeResult, VolatilityResult } from "@/lib/stock-analytics";
import { formatCents } from "@/lib/shared/money";
import {
  clearCorrelationCacheAction,
  clearVolatilityCacheAction,
  computeCorrelationAction,
  computeSharpeAction,
  recomputeAllVolatilityAction,
} from "./stock-analytics-actions";

function formatPct(value: number): string {
  return `${value.toFixed(2)}%`;
}

function VolatilityTab({ initialResults }: { initialResults: VolatilityResult[] }) {
  const router = useRouter();
  const [isBusy, setIsBusy] = useState(false);

  async function handleRecompute() {
    setIsBusy(true);
    try {
      const result = await recomputeAllVolatilityAction();
      if (!result.ok) {
        window.alert(result.error);
        return;
      }
      if (result.failed && result.failed.length > 0) {
        window.alert(
          `Computed ${result.computedCount}. Failed: ${result.failed.map((f) => `${f.ticker} (${f.error})`).join(", ")}`,
        );
      }
      router.refresh();
    } finally {
      setIsBusy(false);
    }
  }

  async function handleClear() {
    if (!window.confirm("Clear the volatility cache?")) return;
    const result = await clearVolatilityCacheAction();
    if (result.ok) router.refresh();
    else window.alert(result.error);
  }

  const columns: DataGridColumn<VolatilityResult>[] = [
    { key: "ticker", header: "Ticker", render: (item) => item.ticker },
    { key: "company", header: "Company", render: (item) => item.companyName || "—" },
    { key: "type", header: "Type", render: (item) => item.type },
    { key: "price", header: "Price", render: (item) => formatCents(item.currentPriceCents) },
    {
      key: "range",
      header: "52-Week Range",
      render: (item) => `${formatCents(item.low52wCents)} – ${formatCents(item.high52wCents)} (${item.rangePositionPct.toFixed(0)}%)`,
    },
    { key: "vol", header: "Annualized Vol", render: (item) => formatPct(item.annualizedVolPct) },
    { key: "label", header: "Label", render: (item) => item.volatilityLabel },
  ];

  return (
    <div>
      <div className="mb-4 flex justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={handleClear}
          disabled={isBusy || initialResults.length === 0}
        >
          Clear Cache
        </Button>
        <Button type="button" onClick={handleRecompute} disabled={isBusy}>
          {isBusy ? "Computing…" : "Recompute All"}
        </Button>
      </div>
      <DataGrid columns={columns} rows={initialResults} getRowKey={(item) => item.ticker} emptyMessage="Not yet computed." />
    </div>
  );
}

function CorrelationTab({ initialResult }: { initialResult?: CorrelationResult }) {
  const router = useRouter();
  const [result, setResult] = useState(initialResult);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  async function handleCompute() {
    setIsBusy(true);
    setError(undefined);
    try {
      const response = await computeCorrelationAction();
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setResult(response.result);
      router.refresh();
    } finally {
      setIsBusy(false);
    }
  }

  async function handleClear() {
    if (!window.confirm("Clear the correlation cache?")) return;
    const response = await clearCorrelationCacheAction();
    if (response.ok) {
      setResult(undefined);
      router.refresh();
    } else {
      window.alert(response.error);
    }
  }

  const columns: DataGridColumn<{ ticker: string; correlations: number[]; marketCorrelation: number | null }>[] = result
    ? [
        { key: "ticker", header: "", render: (row) => <span className="font-medium text-ink">{row.ticker}</span> },
        ...result.tickers.map((ticker, columnIndex) => ({
          key: ticker,
          header: ticker,
          render: (row: { correlations: number[] }) => row.correlations[columnIndex].toFixed(2),
        })),
        {
          key: "market",
          header: "vs SPY",
          render: (row) => (row.marketCorrelation === null ? "—" : row.marketCorrelation.toFixed(2)),
        },
      ]
    : [];

  const rows = result
    ? result.tickers.map((ticker, rowIndex) => ({
        ticker,
        correlations: result.matrix[rowIndex],
        marketCorrelation: result.marketCorrelation[ticker] ?? null,
      }))
    : [];

  return (
    <div>
      <div className="mb-4 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={handleClear} disabled={isBusy || !result}>
          Clear Cache
        </Button>
        <Button type="button" onClick={handleCompute} disabled={isBusy}>
          {isBusy ? "Computing…" : "Recompute"}
        </Button>
      </div>
      {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
      {result && result.failedTickers.length > 0 && (
        <p className="mb-2 text-sm text-muted">Skipped (insufficient data): {result.failedTickers.join(", ")}</p>
      )}
      <DataGrid columns={columns} rows={rows} getRowKey={(row) => row.ticker} emptyMessage="Not yet computed." />
    </div>
  );
}

function SharpeTab({ initialResult }: { initialResult?: SharpeResult }) {
  const router = useRouter();
  const [result, setResult] = useState(initialResult);
  const [riskFreeRatePct, setRiskFreeRatePct] = useState(String((initialResult?.riskFreeRate ?? 0.05) * 100));
  const [lookbackDays, setLookbackDays] = useState(String(initialResult?.lookbackDays ?? 365));
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsBusy(true);
    setError(undefined);
    try {
      const response = await computeSharpeAction(riskFreeRatePct, lookbackDays);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setResult(response.result);
      router.refresh();
    } finally {
      setIsBusy(false);
    }
  }

  const detailColumns: DataGridColumn<NonNullable<SharpeResult["tickerDetails"]>[number]>[] = [
    { key: "ticker", header: "Ticker", render: (row) => row.ticker },
    { key: "weight", header: "Weight", render: (row) => formatPct(row.weight * 100) },
    { key: "return", header: "Ann. Return", render: (row) => formatPct(row.annualizedReturn * 100) },
    { key: "vol", header: "Ann. Volatility", render: (row) => formatPct(row.annualizedVolatility * 100) },
    { key: "days", header: "Trading Days", render: (row) => row.tradingDays },
  ];

  const chartData = result?.portfolioReturnSeries.map((point) => ({
    date: new Date(point.timestamp * 1000).toISOString().slice(0, 10),
    return: point.dailyReturn * 100,
  }));

  return (
    <div>
      <form onSubmit={handleSubmit} className="mb-4 flex flex-wrap items-end gap-3">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Risk-free rate (%)</span>
          <input
            value={riskFreeRatePct}
            onChange={(event) => setRiskFreeRatePct(event.target.value)}
            className="w-28 rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Lookback (days)</span>
          <input
            value={lookbackDays}
            onChange={(event) => setLookbackDays(event.target.value)}
            className="w-28 rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
          />
        </label>
        <Button type="submit" disabled={isBusy}>
          {isBusy ? "Computing…" : "Compute"}
        </Button>
      </form>
      {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
      {!result ? (
        <p className="text-sm text-muted">Not yet computed.</p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-line p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Sharpe Ratio</p>
              <p className="mt-1 font-display text-xl text-ink">{result.sharpeRatio ?? "—"}</p>
            </div>
            <div className="rounded-xl border border-line p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Annualized Return</p>
              <p className="mt-1 font-display text-xl text-ink">{formatPct(result.annualizedReturn * 100)}</p>
            </div>
            <div className="rounded-xl border border-line p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Annualized Volatility</p>
              <p className="mt-1 font-display text-xl text-ink">{formatPct(result.annualizedVolatility * 100)}</p>
            </div>
          </div>
          {result.insufficientDataReason && <p className="text-sm text-muted">{result.insufficientDataReason}</p>}
          {result.skippedTickers.length > 0 && (
            <p className="text-sm text-muted">
              Skipped: {result.skippedTickers.map((ticker) => `${ticker} (${result.skipReasons[ticker]})`).join(", ")}
            </p>
          )}
          {chartData && chartData.length >= 2 && (
            <ChartLine
              data={chartData}
              series={[{ key: "return", label: "Daily portfolio return (%)" }]}
              xKey="date"
              formatValue={(value) => `${value.toFixed(2)}%`}
            />
          )}
          {result.tickerDetails.length > 0 && (
            <DataGrid columns={detailColumns} rows={result.tickerDetails} getRowKey={(row) => row.ticker} />
          )}
        </div>
      )}
    </div>
  );
}

export function StockAnalyticsView({
  volatilityResults,
  correlationResult,
  sharpeResult,
}: {
  volatilityResults: VolatilityResult[];
  correlationResult?: CorrelationResult;
  sharpeResult?: SharpeResult;
}) {
  const tabs: TabItem[] = [
    { key: "volatility", label: "Volatility", content: <VolatilityTab initialResults={volatilityResults} /> },
    { key: "correlation", label: "Correlation", content: <CorrelationTab initialResult={correlationResult} /> },
    { key: "sharpe", label: "Sharpe Ratio", content: <SharpeTab initialResult={sharpeResult} /> },
  ];

  return (
    <div>
      <h2 className="font-display text-xl text-ink">Analytics</h2>
      <div className="mt-4">
        <Tabs items={tabs} />
      </div>
    </div>
  );
}
