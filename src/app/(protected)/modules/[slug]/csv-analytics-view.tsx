"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { ChartXY, type ChartType } from "@/components/chart-xy";
import { CollapsibleCard } from "@/components/collapsible-card";
import { DataGrid, type CellValue, type DataGridColumn } from "@/components/data-grid";
import { FileDropzone } from "@/components/file-dropzone";
import type {
  CsvAnalyticEntry,
  CsvChartPreset,
  CsvColumnDefinition,
  CsvColumnType,
  CsvEntryData,
  IngestMode,
} from "@/lib/csv-analytics";
import {
  createCsvAnalyticsEntryAction,
  deleteChartPresetAction,
  deleteCsvAnalyticsEntryAction,
  listChartPresetsAction,
  previewCsvAnalyticsFileAction,
  readCsvAnalyticsDataAction,
  saveChartPresetAction,
  updateCsvAnalyticsEntryAction,
} from "./csv-analytics-actions";

const NUMERIC_COLUMN_TYPES: CsvColumnType[] = ["integer", "real", "boolean"];
const CHART_TYPES: ChartType[] = ["line", "bar", "scatter", "area"];
const MAX_Y_SERIES = 8;

function formatCell(value: string | number | null): string {
  return value === null || value === undefined ? "—" : String(value);
}

function toChartNumber(value: string | number | null): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Renders an entry's table rows in a sortable, exportable grid. */
function DataPanel({ data, exportName }: { data: CsvEntryData; exportName: string }) {
  const rowKeys = useMemo(
    () => new Map(data.rows.map((row, index) => [row, index] as const)),
    [data],
  );
  const columns: DataGridColumn<(string | number | null)[]>[] = data.columns.map((column, index) => ({
    key: column.name,
    header: column.sourceHeader,
    value: (row) => row[index] as CellValue,
    render: (row) => formatCell(row[index]),
  }));

  return (
    <DataGrid
      columns={columns}
      rows={data.rows}
      getRowKey={(row) => rowKeys.get(row) ?? 0}
      emptyMessage="This table has no rows."
      exportFileName={exportName}
    />
  );
}

const ROW_LIMIT_OPTIONS = [5000, 10000, 40000] as const;
type RowLimit = number | "ALL";

/** The full chart-builder configuration persisted in a saved preset's optionsJson. */
interface ChartOptions {
  chartType: ChartType;
  xKey: string;
  yKeys: string[];
  showDots: boolean;
  showTable: boolean;
  decimals: number;
  rowLimit: RowLimit;
}

/**
 * Axis/type/formatting pickers over an entry's data, feeding the reusable ChartXY.
 * Builds its pickers from the entry's column metadata immediately and fetches the
 * row data itself, capped by the "Rows to include" selector (default 5,000) so an
 * oversized table never over-fetches or over-renders.
 */
function ChartBuilder({ entry }: { entry: CsvAnalyticEntry }) {
  const exportName = entry.tableName;
  const numericColumns = entry.columns.filter((column) => NUMERIC_COLUMN_TYPES.includes(column.type));
  const [chartType, setChartType] = useState<ChartType>("line");
  const [xKey, setXKey] = useState(entry.columns[0]?.name ?? "");
  const [yKeys, setYKeys] = useState<string[]>(numericColumns.slice(0, 1).map((column) => column.name));
  const [showDots, setShowDots] = useState(false);
  const [showTable, setShowTable] = useState(false);
  const [decimals, setDecimals] = useState(2);
  const [rowLimit, setRowLimit] = useState<RowLimit>(5000);

  const [data, setData] = useState<CsvEntryData | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const [presets, setPresets] = useState<CsvChartPreset[]>([]);
  const [presetName, setPresetName] = useState("");
  const [selectedPresetId, setSelectedPresetId] = useState<number | undefined>(undefined);
  const [presetError, setPresetError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    readCsvAnalyticsDataAction(entry.id, rowLimit === "ALL" ? undefined : rowLimit).then((result) => {
      if (cancelled) return;
      if (!result.ok || !result.data) setError(result.error ?? "Failed to read table data.");
      else setData(result.data);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [entry.id, rowLimit]);

  const loadPresets = useCallback(async () => {
    const result = await listChartPresetsAction(entry.id);
    if (result.ok && result.presets) setPresets(result.presets);
  }, [entry.id]);

  useEffect(() => {
    loadPresets();
  }, [loadPresets]);

  function applyOptions(raw: unknown) {
    if (!raw || typeof raw !== "object") return;
    const options = raw as Partial<ChartOptions>;
    if (options.chartType && CHART_TYPES.includes(options.chartType)) setChartType(options.chartType);
    if (typeof options.xKey === "string" && entry.columns.some((column) => column.name === options.xKey)) {
      setXKey(options.xKey);
    }
    if (Array.isArray(options.yKeys)) {
      // Drop any saved column that no longer exists (schema may have changed since save).
      setYKeys(
        options.yKeys
          .filter((key) => entry.columns.some((column) => column.name === key && NUMERIC_COLUMN_TYPES.includes(column.type)))
          .slice(0, MAX_Y_SERIES),
      );
    }
    if (typeof options.showDots === "boolean") setShowDots(options.showDots);
    if (typeof options.showTable === "boolean") setShowTable(options.showTable);
    if (typeof options.decimals === "number") setDecimals(options.decimals);
    if (options.rowLimit === "ALL" || typeof options.rowLimit === "number") setRowLimit(options.rowLimit);
  }

  function handleLoadPreset(id: number) {
    setSelectedPresetId(id);
    setPresetError(undefined);
    const preset = presets.find((item) => item.id === id);
    if (!preset) return;
    try {
      applyOptions(JSON.parse(preset.optionsJson));
    } catch {
      setPresetError("This saved chart's options couldn't be read.");
    }
  }

  async function handleSavePreset() {
    const name = presetName.trim();
    if (name === "") return;
    setPresetError(undefined);
    const optionsJson = JSON.stringify({ chartType, xKey, yKeys, showDots, showTable, decimals, rowLimit });
    const result = await saveChartPresetAction(entry.id, name, optionsJson);
    if (!result.ok) {
      setPresetError(result.error ?? "Failed to save chart.");
      return;
    }
    setPresetName("");
    await loadPresets();
  }

  async function handleDeletePreset() {
    if (selectedPresetId === undefined) return;
    await deleteChartPresetAction(selectedPresetId);
    setSelectedPresetId(undefined);
    await loadPresets();
  }

  const rows = data?.rows ?? [];
  const records = useMemo(() => {
    const xIndex = entry.columns.findIndex((column) => column.name === xKey);
    const yIndexes = yKeys.map((key) => entry.columns.findIndex((column) => column.name === key));
    return rows.map((row) => {
      const record: Record<string, number | string | null> = {};
      const xRaw = xIndex >= 0 ? row[xIndex] : null;
      record[xKey] = chartType === "scatter" ? toChartNumber(xRaw) : xRaw;
      yKeys.forEach((key, i) => {
        record[key] = toChartNumber(yIndexes[i] >= 0 ? row[yIndexes[i]] : null);
      });
      return record;
    });
  }, [rows, entry.columns, xKey, yKeys, chartType]);

  const series = useMemo(
    () =>
      yKeys.map((key) => ({
        key,
        label: entry.columns.find((column) => column.name === key)?.sourceHeader ?? key,
      })),
    [yKeys, entry.columns],
  );

  const formatValue = useCallback(
    (value: number) =>
      Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: decimals }) : "",
    [decimals],
  );

  function toggleY(name: string) {
    setYKeys((current) => {
      if (current.includes(name)) return current.filter((key) => key !== name);
      if (current.length >= MAX_Y_SERIES) return current;
      return [...current, name];
    });
  }

  const controlClass =
    "rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

  if (numericColumns.length === 0) {
    return <p className="text-sm text-muted">This table has no numeric columns to chart.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3 rounded-md border border-line bg-paper-raised p-3">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Saved charts</span>
          <select
            value={selectedPresetId ?? ""}
            onChange={(event) => event.target.value && handleLoadPreset(Number(event.target.value))}
            className={controlClass}
          >
            <option value="">{presets.length ? "Load a saved chart…" : "No saved charts yet"}</option>
            {presets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
        </label>
        {selectedPresetId !== undefined && (
          <Button size="sm" variant="danger" onClick={handleDeletePreset}>
            Delete
          </Button>
        )}
        <div className="ml-auto flex items-end gap-2">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-ink">Save current as</span>
            <input
              value={presetName}
              onChange={(event) => setPresetName(event.target.value)}
              placeholder="Chart name"
              className={controlClass}
            />
          </label>
          <Button size="sm" onClick={handleSavePreset} disabled={presetName.trim() === ""}>
            Save
          </Button>
        </div>
      </div>
      {presetError && <p className="text-sm text-red-400">{presetError}</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Chart type</span>
          <select value={chartType} onChange={(event) => setChartType(event.target.value as ChartType)} className={`w-full ${controlClass}`}>
            {CHART_TYPES.map((type) => (
              <option key={type} value={type} className="capitalize">
                {type}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">X axis</span>
          <select value={xKey} onChange={(event) => setXKey(event.target.value)} className={`w-full ${controlClass}`}>
            {entry.columns.map((column) => (
              <option key={column.name} value={column.name}>
                {column.sourceHeader}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Rows to include</span>
          <select
            value={String(rowLimit)}
            onChange={(event) => setRowLimit(event.target.value === "ALL" ? "ALL" : Number(event.target.value))}
            className={`w-full ${controlClass}`}
          >
            {ROW_LIMIT_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option.toLocaleString()}
              </option>
            ))}
            <option value="ALL">ALL</option>
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Decimal places</span>
          <select
            value={decimals}
            onChange={(event) => setDecimals(Number(event.target.value))}
            className={`w-full ${controlClass}`}
          >
            {[0, 1, 2, 3, 4].map((digits) => (
              <option key={digits} value={digits}>
                {digits}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div>
        <span className="mb-1 block text-sm font-medium text-ink">
          Y axis series {yKeys.length >= MAX_Y_SERIES && <span className="text-muted">(max {MAX_Y_SERIES})</span>}
        </span>
        <div className="flex flex-wrap gap-3">
          {numericColumns.map((column) => {
            const checked = yKeys.includes(column.name);
            return (
              <label key={column.name} className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!checked && yKeys.length >= MAX_Y_SERIES}
                  onChange={() => toggleY(column.name)}
                  className="h-4 w-4 rounded border-line text-brass focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass disabled:opacity-50"
                />
                <span>{column.sourceHeader}</span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={showDots} onChange={(event) => setShowDots(event.target.checked)} className="h-4 w-4 rounded border-line text-brass" />
          <span>Show data points</span>
        </label>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={showTable} onChange={(event) => setShowTable(event.target.checked)} className="h-4 w-4 rounded border-line text-brass" />
          <span>Show data table</span>
        </label>
      </div>

      {loading ? (
        <p className="text-sm text-muted">Loading data…</p>
      ) : error ? (
        <p className="text-sm text-red-400">{error}</p>
      ) : xKey === "" || yKeys.length === 0 ? (
        <p className="text-sm text-muted">Pick an X axis and at least one Y series to draw the chart.</p>
      ) : (
        <ChartXY
          type={chartType}
          data={records}
          xKey={xKey}
          series={series}
          showDots={showDots}
          formatValue={formatValue}
        />
      )}

      {showTable && data && <DataPanel data={data} exportName={exportName} />}
    </div>
  );
}

const COLUMN_TYPE_OPTIONS: CsvColumnType[] = ["text", "integer", "real", "date", "datetime", "boolean"];
const INGEST_MODES: IngestMode[] = ["append", "truncate", "overwrite"];

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file."));
    reader.readAsText(file);
  });
}

function EntryForm({ entry, onDone }: { entry?: CsvAnalyticEntry; onDone: () => void }) {
  const [name, setName] = useState(entry?.name ?? "");
  const [description, setDescription] = useState(entry?.description ?? "");
  const [tableBaseName, setTableBaseName] = useState(entry ? entry.tableName.replace(/^csv_/, "") : "");
  const [fileName, setFileName] = useState<string | undefined>(undefined);
  const [fileText, setFileText] = useState<string | undefined>(undefined);
  const [headers, setHeaders] = useState<string[]>([]);
  const [previewRows, setPreviewRows] = useState<string[][]>([]);
  const [columns, setColumns] = useState<CsvColumnDefinition[]>(entry?.columns ?? []);
  const [primaryKeyFields, setPrimaryKeyFields] = useState<string[]>(entry?.primaryKeyFields ?? []);
  const [ingestMode, setIngestMode] = useState<IngestMode>("overwrite");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<string | undefined>(undefined);

  const hasNewFile = fileText !== undefined;
  const canEditSchema = !entry || ingestMode === "overwrite";
  // For append/truncate, the schema shown must be the entry's real existing schema —
  // not whatever the just-dropped file's headers happened to suggest.
  const displayedColumns = entry && hasNewFile && ingestMode !== "overwrite" ? entry.columns : columns;
  const displayedPrimaryKeyFields =
    entry && hasNewFile && ingestMode !== "overwrite" ? entry.primaryKeyFields : primaryKeyFields;

  async function handleFile(file: File) {
    setError(undefined);
    setStatus(undefined);
    setIsBusy(true);
    try {
      const text = await readFileAsText(file);
      const result = await previewCsvAnalyticsFileAction(text);
      if (!result.ok || !result.preview) {
        setError(result.error ?? "Failed to read that file.");
        return;
      }
      setFileName(file.name);
      setFileText(text);
      setHeaders(result.preview.headers);
      setPreviewRows(result.preview.previewRows);
      if (!entry || ingestMode === "overwrite") {
        setColumns(result.preview.suggestedColumns);
        setPrimaryKeyFields([]);
      }
    } finally {
      setIsBusy(false);
    }
  }

  function updateColumn(index: number, field: "name" | "type", value: string) {
    setColumns((current) => current.map((column, i) => (i === index ? { ...column, [field]: value } : column)));
  }

  function togglePrimaryKey(columnName: string) {
    setPrimaryKeyFields((current) =>
      current.includes(columnName) ? current.filter((name) => name !== columnName) : [...current, columnName],
    );
  }

  async function handleSubmit() {
    setError(undefined);
    setStatus(undefined);
    setIsBusy(true);
    try {
      if (!entry) {
        if (!fileText) {
          setError("Drop a CSV file first.");
          return;
        }
        const result = await createCsvAnalyticsEntryAction({
          name,
          description: description || undefined,
          tableBaseName,
          columns,
          primaryKeyFields,
          fileText,
        });
        if (!result.ok) {
          setError(result.error ?? "Failed to create entry.");
          return;
        }
      } else {
        const result = await updateCsvAnalyticsEntryAction(entry.id, {
          name,
          description: description || undefined,
          ingest: hasNewFile
            ? {
                mode: ingestMode,
                fileText: fileText!,
                tableBaseName: ingestMode === "overwrite" ? tableBaseName : undefined,
                columns: ingestMode === "overwrite" ? columns : undefined,
                primaryKeyFields: ingestMode === "overwrite" ? primaryKeyFields : undefined,
              }
            : undefined,
        });
        if (!result.ok) {
          setError(result.error ?? "Failed to save changes.");
          return;
        }
        if (result.ingestResult) {
          setStatus(`Inserted ${result.ingestResult.inserted}, skipped ${result.ingestResult.skipped}.`);
        }
      }
      onDone();
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Table name</span>
          <div className="flex items-center gap-1 rounded-md border border-line bg-paper px-3 py-1.5 text-sm">
            <span className="text-muted">csv_</span>
            <input
              value={tableBaseName}
              disabled={!canEditSchema}
              onChange={(event) => setTableBaseName(event.target.value)}
              className="w-full bg-transparent text-ink focus-visible:outline-none disabled:opacity-50"
            />
          </div>
        </label>
        <label className="block text-sm sm:col-span-2">
          <span className="mb-1 block font-medium text-ink">Description</span>
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
          />
        </label>
      </div>

      <FileDropzone
        accept=".csv"
        disabled={isBusy}
        label={
          fileName ? `Loaded ${fileName} — drop another file to replace it` : "Drag a CSV file here, or click to browse"
        }
        onFile={handleFile}
      />

      {entry && hasNewFile && (
        <div className="flex flex-wrap gap-4">
          {INGEST_MODES.map((mode) => (
            <label key={mode} className="flex items-center gap-2 text-sm text-ink">
              <input
                type="radio"
                name="ingest-mode"
                checked={ingestMode === mode}
                onChange={() => setIngestMode(mode)}
              />
              <span className="capitalize">{mode}</span>
            </label>
          ))}
        </div>
      )}

      {displayedColumns.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-line">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-paper text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-3 py-2">Source header</th>
                <th className="px-3 py-2">Column name</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Primary key</th>
              </tr>
            </thead>
            <tbody>
              {displayedColumns.map((column, index) => (
                <tr key={column.sourceHeader} className="border-b border-line last:border-b-0">
                  <td className="px-3 py-2 text-muted">{column.sourceHeader}</td>
                  <td className="px-3 py-2">
                    <input
                      value={column.name}
                      disabled={!canEditSchema}
                      onChange={(event) => updateColumn(index, "name", event.target.value)}
                      className="w-full rounded-md border border-line bg-paper px-2 py-1 text-ink disabled:opacity-50"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={column.type}
                      disabled={!canEditSchema}
                      onChange={(event) => updateColumn(index, "type", event.target.value)}
                      className="w-full rounded-md border border-line bg-paper px-2 py-1 text-ink disabled:opacity-50"
                    >
                      {COLUMN_TYPE_OPTIONS.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      disabled={!canEditSchema}
                      checked={displayedPrimaryKeyFields.includes(column.name)}
                      onChange={() => togglePrimaryKey(column.name)}
                      className="h-4 w-4 rounded border-line text-brass disabled:opacity-50"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {previewRows.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-line">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-paper text-left text-xs uppercase tracking-wide text-muted">
                {headers.map((header) => (
                  <th key={header} className="px-3 py-2">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-b border-line last:border-b-0">
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className="px-3 py-2 text-ink">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}
      {status && <p className="text-sm text-emerald-400">{status}</p>}

      <div className="flex gap-2">
        <Button onClick={handleSubmit} disabled={isBusy || name.trim() === "" || tableBaseName.trim() === ""}>
          {isBusy ? "Saving…" : entry ? "Save Changes" : "Create Entry"}
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function CsvAnalyticsView({ entries }: { entries: CsvAnalyticEntry[] }) {
  const router = useRouter();
  const [showNewForm, setShowNewForm] = useState(false);
  const [editingId, setEditingId] = useState<number | undefined>(undefined);
  const [activePanel, setActivePanel] = useState<{ entryId: number; mode: "data" | "chart" } | undefined>(undefined);
  const [panelData, setPanelData] = useState<CsvEntryData | undefined>(undefined);
  const [panelLoading, setPanelLoading] = useState(false);
  const [panelError, setPanelError] = useState<string | undefined>(undefined);

  async function openPanel(entry: CsvAnalyticEntry, mode: "data" | "chart") {
    setActivePanel({ entryId: entry.id, mode });
    if (mode !== "data") return; // the chart builder fetches its own (row-limited) data
    setPanelData(undefined);
    setPanelError(undefined);
    setPanelLoading(true);
    try {
      const result = await readCsvAnalyticsDataAction(entry.id);
      if (!result.ok || !result.data) setPanelError(result.error ?? "Failed to read table data.");
      else setPanelData(result.data);
    } finally {
      setPanelLoading(false);
    }
  }

  async function handleDelete(entry: CsvAnalyticEntry) {
    const confirmed = window.confirm(
      `Delete "${entry.name}"? This also drops its data table (${entry.tableName}). This cannot be undone.`,
    );
    if (!confirmed) return;
    const result = await deleteCsvAnalyticsEntryAction(entry.id);
    if (result.ok) router.refresh();
    else window.alert(result.error);
  }

  const columns: DataGridColumn<CsvAnalyticEntry>[] = [
    { key: "name", header: "Name", render: (entry) => entry.name },
    {
      key: "description",
      header: "Description",
      render: (entry) => <span className="text-muted">{entry.description ?? "—"}</span>,
    },
    {
      key: "tableName",
      header: "Table",
      render: (entry) => <span className="font-mono text-xs">{entry.tableName}</span>,
    },
    { key: "columns", header: "Columns", render: (entry) => entry.columns.length },
    { key: "rowCount", header: "Rows", render: (entry) => entry.rowCount },
    {
      key: "actions",
      header: "Actions",
      render: (entry) => (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => openPanel(entry, "data")}
            className="text-xs font-medium text-brass-dark hover:underline"
          >
            Show Data
          </button>
          <button
            type="button"
            onClick={() => openPanel(entry, "chart")}
            className="text-xs font-medium text-brass-dark hover:underline"
          >
            Chart
          </button>
          <button
            type="button"
            onClick={() => setEditingId(entry.id)}
            className="text-xs font-medium text-brass-dark hover:underline"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => handleDelete(entry)}
            className="text-xs font-medium text-red-400 hover:underline"
          >
            Delete
          </button>
        </div>
      ),
    },
  ];

  const editingEntry = entries.find((entry) => entry.id === editingId);
  const activeEntry = activePanel ? entries.find((entry) => entry.id === activePanel.entryId) : undefined;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted">
          Define a CSV Analytic entry to load a CSV file into its own table for analysis.
        </p>
        <Button size="sm" onClick={() => setShowNewForm((value) => !value)}>
          {showNewForm ? "Close" : "New Entry"}
        </Button>
      </div>

      {showNewForm && (
        <CollapsibleCard title="New CSV Analytic Entry" defaultOpen>
          <EntryForm
            onDone={() => {
              setShowNewForm(false);
              router.refresh();
            }}
          />
        </CollapsibleCard>
      )}

      {editingEntry && (
        <CollapsibleCard title={`Edit: ${editingEntry.name}`} defaultOpen>
          <EntryForm
            entry={editingEntry}
            onDone={() => {
              setEditingId(undefined);
              router.refresh();
            }}
          />
        </CollapsibleCard>
      )}

      <DataGrid
        columns={columns}
        rows={entries}
        getRowKey={(entry) => entry.id}
        emptyMessage="No CSV analytic entries yet."
      />

      {activePanel && activeEntry && (
        <CollapsibleCard
          title={`${activePanel.mode === "data" ? "Data" : "Chart"} — ${activeEntry.name}`}
          defaultOpen
        >
          <div className="flex flex-col gap-3">
            <div className="flex justify-end">
              <Button size="sm" variant="secondary" onClick={() => setActivePanel(undefined)}>
                Close
              </Button>
            </div>
            {activePanel.mode === "chart" ? (
              <ChartBuilder entry={activeEntry} />
            ) : panelLoading ? (
              <p className="text-sm text-muted">Loading…</p>
            ) : panelError ? (
              <p className="text-sm text-red-400">{panelError}</p>
            ) : panelData ? (
              <DataPanel data={panelData} exportName={activeEntry.tableName} />
            ) : null}
          </div>
        </CollapsibleCard>
      )}
    </div>
  );
}
