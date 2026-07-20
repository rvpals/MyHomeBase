"use client";

import { useState } from "react";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import type { NextDayActionSignal, NextDayActionThresholds, NextDayActionType } from "@/lib/next-day-actions";
import { formatCents } from "@/lib/shared/money";
import { runNextDayActionsScanAction } from "./next-day-actions-actions";

const ACTION_STYLES: Record<NextDayActionType, { label: string; color: string }> = {
  StopLoss: { label: "STOP LOSS", color: "#d03b3b" },
  TrimProfit: { label: "TRIM PROFITS", color: "#eb6834" },
  Rebalance: { label: "REBALANCE", color: "#2a78d6" },
  StrongBuy: { label: "STRONG BUY", color: "#0ca30c" },
  Hold: { label: "HOLD", color: "#898781" },
};

function ActionBadge({ action }: { action: NextDayActionType }) {
  const style = ACTION_STYLES[action];
  return (
    <span
      className="rounded-full px-2 py-0.5 text-xs font-semibold text-white"
      style={{ backgroundColor: style.color }}
    >
      {style.label}
    </span>
  );
}

export function NextDayActionsView({ initialThresholds }: { initialThresholds: NextDayActionThresholds }) {
  const [signals, setSignals] = useState<NextDayActionSignal[] | undefined>(undefined);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  async function handleRunScan() {
    setIsScanning(true);
    setError(undefined);
    try {
      const result = await runNextDayActionsScanAction();
      if (!result.ok) {
        setError(result.error ?? "Failed to run scan.");
        return;
      }
      setSignals(result.signals);
    } finally {
      setIsScanning(false);
    }
  }

  const counts = (signals ?? []).reduce<Partial<Record<NextDayActionType, number>>>((acc, signal) => {
    if (signal.action === "Hold") return acc;
    acc[signal.action] = (acc[signal.action] ?? 0) + 1;
    return acc;
  }, {});

  const columns: DataGridColumn<NextDayActionSignal>[] = [
    { key: "ticker", header: "Ticker", render: (signal) => signal.ticker },
    { key: "shares", header: "Shares", render: (signal) => signal.shares },
    { key: "price", header: "Price", render: (signal) => formatCents(signal.currentPriceCents) },
    { key: "value", header: "Value", render: (signal) => formatCents(signal.positionValueCents) },
    { key: "allocation", header: "Alloc%", render: (signal) => `${signal.allocationPct.toFixed(1)}%` },
    {
      key: "return",
      header: "Return%",
      render: (signal) => (
        <span className={signal.totalReturnPct < 0 ? "text-[#d03b3b]" : "text-[#0ca30c]"}>
          {signal.totalReturnPct >= 0 ? "+" : ""}
          {signal.totalReturnPct.toFixed(1)}%
        </span>
      ),
    },
    { key: "action", header: "Action", render: (signal) => <ActionBadge action={signal.action} /> },
    {
      key: "reasoning",
      header: "Reasoning",
      render: (signal) => <span className="text-sm text-muted">{signal.reasoning}</span>,
    },
  ];

  return (
    <div>
      <h2 className="font-display text-xl text-ink">Next Day Actions</h2>
      <p className="mt-1 text-sm text-muted">
        Scans every position with shares for a Stop Loss (price below the 20-day SMA), Trim Profit
        (return above target), Rebalance (allocation over its concentration cap), or Strong Buy
        (1.5x+ volume spike) signal. Thresholds — profit target {initialThresholds.profitTargetPct}%,
        stock cap {initialThresholds.stockConcentrationCapPct}%, ETF cap{" "}
        {initialThresholds.etfConcentrationCapPct}% — are editable under Administration &rarr; Module
        Configuration &rarr; Stocks &amp; ETFs.
      </p>

      <div className="mt-4">
        <Button type="button" onClick={handleRunScan} disabled={isScanning}>
          {isScanning ? "Scanning…" : "Run Scan"}
        </Button>
      </div>

      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}

      {signals && (
        <div className="mt-6 flex flex-col gap-4">
          {Object.keys(counts).length > 0 && (
            <div className="flex flex-wrap gap-3">
              {(Object.entries(counts) as [NextDayActionType, number][]).map(([action, count]) => (
                <div
                  key={action}
                  className="rounded-xl border-l-4 p-3 text-center"
                  style={{ borderLeftColor: ACTION_STYLES[action].color }}
                >
                  <p className="font-display text-lg" style={{ color: ACTION_STYLES[action].color }}>
                    {count}
                  </p>
                  <p className="text-xs text-muted">{ACTION_STYLES[action].label}</p>
                </div>
              ))}
            </div>
          )}

          <DataGrid
            columns={columns}
            rows={signals}
            getRowKey={(signal) => signal.ticker}
            emptyMessage="No positions with shares to scan."
          />

          {signals.length > 0 && (
            <CollapsibleCard title="Detail on Analysis">
              <div className="flex flex-col gap-2">
                {signals.map((signal) => (
                  <details key={signal.ticker} className="rounded-md border border-line">
                    <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-ink">
                      {signal.ticker} — <ActionBadge action={signal.action} />
                    </summary>
                    <pre className="whitespace-pre-wrap border-t border-line bg-paper px-3 py-2 text-xs text-muted">
                      {signal.detailLog}
                    </pre>
                  </details>
                ))}
              </div>
            </CollapsibleCard>
          )}
        </div>
      )}
    </div>
  );
}
