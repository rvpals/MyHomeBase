"use client";

import { useState } from "react";
import * as React from "react";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import { Tabs } from "@/components/tabs";
import { TreeIcon } from "@/components/tree-icons";
import type { PositionChange, PeriodType } from "@/lib/stock-positions";
import type { StockPosition } from "@/lib/stock-positions";
import { formatCents } from "@/lib/shared/money";

interface StockBiggestChangesProps {
  positions: StockPosition[];
}

function gainClass(cents: number): string {
  return cents < 0 ? "text-red-400" : "text-emerald-400";
}

function PeriodSelector({
  selected,
  onChange,
}: {
  selected: PeriodType;
  onChange: (period: PeriodType) => void;
}) {
  const periods: { value: PeriodType; label: string }[] = [
    { value: "week", label: "This Week" },
    { value: "month", label: "This Month" },
    { value: "year", label: "This Year" },
  ];

  return (
    <div className="flex gap-2 mb-4">
      {periods.map((period) => (
        <button
          key={period.value}
          onClick={() => onChange(period.value)}
          className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
            selected === period.value
              ? "bg-brass text-paper"
              : "bg-paper-raised text-ink border border-line hover:bg-paper-raised/60"
          }`}
        >
          {period.label}
        </button>
      ))}
    </div>
  );
}

function ChangeTable({
  changes,
  title,
  isGainer,
}: {
  changes: PositionChange[];
  title: string;
  isGainer: boolean;
}) {
  if (changes.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-line p-4 text-center text-sm text-muted">
        No {isGainer ? "gainers" : "losers"} found for this period.
      </div>
    );
  }

  const columns: DataGridColumn<PositionChange>[] = [
    {
      key: "ticker",
      header: "Ticker",
      value: (row) => row.ticker,
      render: (row) => (
        <div className="flex items-center gap-2">
          <span className="font-medium text-ink">{row.ticker}</span>
          <span className="text-xs text-muted">{row.name}</span>
        </div>
      ),
    },
    {
      key: "type",
      header: "Type",
      value: (row) => row.type,
      render: (row) => <span className="text-xs text-muted">{row.type}</span>,
    },
    {
      key: "currentValue",
      header: "Current Value",
      value: (row) => row.currentValueCents,
      render: (row) => <span className="font-mono">{formatCents(row.currentValueCents)}</span>,
    },
    {
      key: "periodGainLoss",
      header: "Change",
      value: (row) => row.periodGainLossCents,
      render: (row) => (
        <span className={`font-mono font-medium ${gainClass(row.periodGainLossCents)}`}>
          {row.periodGainLossCents >= 0 ? "+" : ""}
          {formatCents(row.periodGainLossCents)}
        </span>
      ),
    },
    {
      key: "periodGainLossPct",
      header: "Change %",
      value: (row) => row.periodGainLossPct,
      render: (row) => (
        <span className={`font-mono font-medium ${gainClass(row.periodGainLossCents)}`}>
          {row.periodGainLossPct >= 0 ? "+" : ""}
          {row.periodGainLossPct.toFixed(2)}%
        </span>
      ),
    },
    {
      key: "quantity",
      header: "Shares",
      value: (row) => row.quantity,
      render: (row) => <span className="font-mono text-sm text-muted">{row.quantity}</span>,
    },
  ];

  return (
    <div>
      <h4 className="text-sm font-medium text-ink mb-3">{title}</h4>
      <DataGrid
        columns={columns}
        rows={changes}
        getRowKey={(row) => `${row.ticker}`}
        emptyMessage={`No ${isGainer ? "gainers" : "losers"} found.`}
        defaultPageSize={10}
      />
    </div>
  );
}

export function StockBiggestChanges({ positions }: StockBiggestChangesProps) {
  const [period, setPeriod] = useState<PeriodType>("month");
  const [gainers, setGainers] = useState<PositionChange[]>([]);
  const [losers, setLosers] = useState<PositionChange[]>([]);
  const [loading, setLoading] = useState(false);

  async function loadChanges() {
    setLoading(true);
    try {
      const response = await fetch("/api/stocks/biggest-changes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period }),
      });
      const data = await response.json();
      if (data.ok) {
        setGainers(data.gainers);
        setLosers(data.losers);
      }
    } catch (error) {
      console.error("Failed to load changes:", error);
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    void loadChanges();
  }, [period]);

  return (
    <div className="flex flex-col gap-6">
      <PeriodSelector selected={period} onChange={setPeriod} />

      {loading ? (
        <p className="text-center text-sm text-muted py-8">Calculating changes...</p>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <ChangeTable changes={gainers} title="Top 10 Gainers" isGainer={true} />
          <ChangeTable changes={losers} title="Top 10 Losers" isGainer={false} />
        </div>
      )}

      <p className="text-xs text-muted">
        Changes are calculated using actual daily closing prices over the selected period.
        Gain/Loss = shares × (current price - period start price).
      </p>
    </div>
  );
}
