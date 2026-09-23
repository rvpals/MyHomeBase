// CSV Analysis -> Compare. Combined and per-source statistics over a pooled dataset,
// ranked, with every source drawn on one chart.
//
// Presentation only. Every figure on this screen comes from `computeSourceStats` /
// `buildSourceSeries` in `src/lib/csv-analytics` — this file picks the columns, calls
// the action, and lays the numbers out.

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChartXY } from "@/components/chart-xy";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import {
  groupableSourceColumns,
  measurableColumns,
  type CsvAnalyticEntry,
  type SourceStats,
  type SourceStatsResult,
} from "@/lib/csv-analytics";
import { readCsvAnalyticsDataAction, readSourceStatsAction } from "./csv-analytics-actions";

const CONTROL_CLASS =
  "rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

/** Read cap, matching the chart builder's default so neither over-fetches. */
const ROW_LIMIT = 40000;

function formatNumber(value: number | null, decimals: number): string {
  if (value === null) return "—";
  return value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** One headline figure. Four of these sit above the table. */
function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border border-line bg-paper-raised p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 font-display text-2xl text-ink">{value}</p>
      {hint && <p className="mt-0.5 truncate text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function CsvCompareView({ entries }: { entries: CsvAnalyticEntry[] }) {
  // Only pooled datasets can be compared — a single-file entry has no source column.
  const pooled = entries.filter((entry) => entry.sourceColumns.length > 0);

  const [entryId, setEntryId] = useState<number | undefined>(pooled[0]?.id);
  const entry = pooled.find((candidate) => candidate.id === entryId);

  const groupOptions = useMemo(
    () => (entry ? groupableSourceColumns(entry.sourceColumns, entry.columns) : []),
    [entry],
  );
  const measureOptions = useMemo(() => (entry ? measurableColumns(entry.columns) : []), [entry]);

  const [groupColumn, setGroupColumn] = useState("");
  const [measureColumn, setMeasureColumn] = useState("");
  const [xColumn, setXColumn] = useState("");
  const [decimals, setDecimals] = useState(2);

  const [stats, setStats] = useState<SourceStatsResult | undefined>(undefined);
  const [chartRows, setChartRows] = useState<Record<string, number | string | null>[]>([]);
  const [chartSeries, setChartSeries] = useState<{ key: string; label: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  // Re-seed the pickers whenever the dataset changes, so a stale column name from the
  // previous entry can never be sent to the action.
  useEffect(() => {
    setGroupColumn(groupOptions[0]?.name ?? "");
    setMeasureColumn(measureOptions[0]?.name ?? "");
    setXColumn(entry?.columns[0]?.name ?? "");
  }, [entry, groupOptions, measureOptions]);

  const load = useCallback(async () => {
    if (!entry || groupColumn === "" || measureColumn === "") {
      setStats(undefined);
      setChartRows([]);
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      const statsResult = await readSourceStatsAction({
        entryId: entry.id,
        groupColumn,
        measureColumn,
        limit: ROW_LIMIT,
      });
      if (!statsResult.ok || !statsResult.stats) {
        setError(statsResult.error ?? "Failed to compute statistics.");
        setStats(undefined);
        return;
      }
      setStats(statsResult.stats);

      // The chart needs the rows themselves, pivoted so each source is its own series:
      // one record per x value, carrying a field per source.
      const dataResult = await readCsvAnalyticsDataAction(entry.id, ROW_LIMIT);
      if (!dataResult.ok || !dataResult.data) {
        setError(dataResult.error ?? "Failed to read the rows.");
        return;
      }
      const { columns, rows } = dataResult.data;
      const groupIndex = columns.findIndex((column) => column.name === groupColumn);
      const measureIndex = columns.findIndex((column) => column.name === measureColumn);
      const xIndex = columns.findIndex((column) => column.name === xColumn);
      if (groupIndex < 0 || measureIndex < 0 || xIndex < 0) {
        setChartRows([]);
        setChartSeries([]);
        return;
      }

      const byX = new Map<string, Record<string, number | string | null>>();
      const sources = new Set<string>();
      rows.forEach((row) => {
        const source = String(row[groupIndex] ?? "");
        sources.add(source);
        const xValue = row[xIndex];
        const key = String(xValue ?? "");
        const record = byX.get(key) ?? { [xColumn]: xValue };
        const raw = row[measureIndex];
        const numeric = typeof raw === "number" ? raw : Number(raw);
        record[source] = Number.isFinite(numeric) ? numeric : null;
        byX.set(key, record);
      });

      setChartRows([...byX.values()]);
      setChartSeries([...sources].map((source) => ({ key: source, label: source || "(none)" })));
    } finally {
      setLoading(false);
    }
  }, [entry, groupColumn, measureColumn, xColumn]);

  useEffect(() => {
    void load();
  }, [load]);

  const statColumns: DataGridColumn<SourceStats>[] = [
    {
      key: "source",
      header: "Source",
      render: (row) => <span className="text-ink">{row.source || "(none)"}</span>,
      value: (row) => row.source ?? "",
    },
    {
      key: "rowCount",
      header: "Readings",
      render: (row) => formatNumber(row.rowCount, 0),
      value: (row) => row.rowCount,
      aggregate: "sum",
    },
    {
      key: "mean",
      header: "Average",
      render: (row) => formatNumber(row.mean, decimals),
      value: (row) => row.mean ?? 0,
    },
    {
      key: "median",
      header: "Median",
      render: (row) => formatNumber(row.median, decimals),
      value: (row) => row.median ?? 0,
    },
    {
      key: "min",
      header: "Lowest",
      render: (row) => formatNumber(row.min, decimals),
      value: (row) => row.min ?? 0,
    },
    {
      key: "max",
      header: "Highest",
      render: (row) => formatNumber(row.max, decimals),
      value: (row) => row.max ?? 0,
    },
    {
      key: "stdDev",
      header: "Std dev",
      render: (row) => formatNumber(row.stdDev, decimals),
      value: (row) => row.stdDev ?? 0,
    },
    {
      key: "nullCount",
      header: "Missing",
      render: (row) => formatNumber(row.nullCount, 0),
      value: (row) => row.nullCount,
    },
  ];

  if (pooled.length === 0) {
    return (
      <p className="text-sm text-muted">
        No pooled datasets yet. Import several files at once from the Import Files section, and
        they can be compared here.
      </p>
    );
  }

  const measureLabel =
    entry?.columns.find((column) => column.name === measureColumn)?.sourceHeader ?? measureColumn;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3 rounded-md border border-line bg-paper-raised p-3">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Dataset</span>
          <select
            value={entryId ?? ""}
            onChange={(event) => setEntryId(Number(event.target.value))}
            className={CONTROL_CLASS}
          >
            {pooled.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Compare by</span>
          <select
            value={groupColumn}
            onChange={(event) => setGroupColumn(event.target.value)}
            className={CONTROL_CLASS}
          >
            {groupOptions.map((column) => (
              <option key={column.name} value={column.name}>
                {column.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Measure</span>
          <select
            value={measureColumn}
            onChange={(event) => setMeasureColumn(event.target.value)}
            className={CONTROL_CLASS}
          >
            {measureOptions.map((column) => (
              <option key={column.name} value={column.name}>
                {column.sourceHeader}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Along</span>
          <select
            value={xColumn}
            onChange={(event) => setXColumn(event.target.value)}
            className={CONTROL_CLASS}
          >
            {(entry?.columns ?? []).map((column) => (
              <option key={column.name} value={column.name}>
                {column.sourceHeader}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Decimals</span>
          <input
            type="number"
            min={0}
            max={6}
            value={decimals}
            onChange={(event) => setDecimals(Number(event.target.value))}
            className={`w-20 ${CONTROL_CLASS}`}
          />
        </label>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {loading && <p className="text-sm text-muted">Reading…</p>}

      {stats && (
        <>
          {/* Headline figures. 4-up on a desktop, 2-up on a phone. */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              label="All sources"
              value={formatNumber(stats.combined.mean, decimals)}
              hint={`average ${measureLabel}`}
            />
            <StatTile
              label="Highest"
              value={formatNumber(stats.highest?.mean ?? null, decimals)}
              hint={stats.highest?.source || "—"}
            />
            <StatTile
              label="Lowest"
              value={formatNumber(stats.lowest?.mean ?? null, decimals)}
              hint={stats.lowest?.source || "—"}
            />
            <StatTile
              label="Readings"
              value={formatNumber(stats.combined.rowCount, 0)}
              hint={`${stats.perSource.length} source(s)`}
            />
          </div>

          <DataGrid
            columns={statColumns}
            rows={stats.perSource}
            getRowKey={(row) => row.source ?? ""}
            emptyMessage="No rows in this dataset yet."
            exportFileName={`${entry?.tableName ?? "compare"}_by_source`}
            storageKey="csv-compare-by-source"
            defaultPageSize={25}
          />

          {chartRows.length > 0 && chartSeries.length > 0 && (
            <ChartXY
              type="line"
              data={chartRows}
              xKey={xColumn}
              series={chartSeries}
              formatValue={(value) => formatNumber(value, decimals)}
              height={360}
            />
          )}
        </>
      )}
    </div>
  );
}
