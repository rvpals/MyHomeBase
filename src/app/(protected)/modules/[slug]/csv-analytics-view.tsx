"use client";

import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { CHART_CHROME, CHART_REFERENCE_COLORS } from "@/components/chart-colors";
import { ChartXY, type ChartType } from "@/components/chart-xy";
import { CollapsibleCard } from "@/components/collapsible-card";
import { DataGrid, type CellValue, type DataGridColumn } from "@/components/data-grid";
import { FileDropzone } from "@/components/file-dropzone";
import { Modal } from "@/components/modal";
import {
  CSV_AGGREGATE_FUNCTIONS,
  CSV_AGGREGATE_LABELS,
  aggregateReferenceLines,
  buildSplitChartData,
  columnsForFunction,
  computeAggregates,
  describeAggregate,
  describeCriteria,
  describeOrderBy,
  groupableSourceColumns,
  nonEditableColumns,
  type CsvAggregateDefinition,
  type CsvAggregateFunction,
  type CsvAggregateResult,
  type CsvAnalyticEntry,
  type CsvChartPreset,
  type CsvBulkEditChanges,
  type CsvColumnDefinition,
  type CsvColumnType,
  type CsvCustomView,
  type CsvEntryData,
  type CsvViewPage,
  type IngestMode,
} from "@/lib/csv-analytics";
import {
  bulkEditCsvRowsAction,
  createCsvAnalyticsEntryAction,
  deleteChartPresetAction,
  deleteCsvAnalyticsEntryAction,
  listChartPresetsAction,
  previewCsvAnalyticsFileAction,
  readCsvAnalyticsDataAction,
  readCsvCustomViewPageAction,
  saveChartPresetAction,
  updateCsvAnalyticsEntryAction,
} from "./csv-analytics-actions";

const NUMERIC_COLUMN_TYPES: CsvColumnType[] = ["integer", "real", "boolean"];
const CHART_TYPES: ChartType[] = ["line", "bar", "scatter", "area"];
// Scatter needs a numeric x, which a split pivot's shared category axis is not.
const SPLIT_CHART_TYPES: ChartType[] = ["line", "bar", "area"];
// Past this many series the legend stops being readable. Advisory, not enforced: the
// reader may genuinely have twelve devices, and refusing to draw them would be worse
// than drawing a crowded chart they asked for.
const MAX_SPLIT_SERIES = 12;
const MAX_Y_SERIES = 8;

function formatCell(value: string | number | null): string {
  return value === null || value === undefined ? "—" : String(value);
}

function toChartNumber(value: string | number | null): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const BULK_INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass disabled:opacity-40";

/**
 * Bulk edit for the selected rows: tick a column to include it, type the value every
 * selected row should get. A ticked column left blank clears it — that is what "apply
 * this value to all" has to mean.
 *
 * Local to this view rather than a shared component, exactly as the Expense dialog is:
 * the field list here is *derived from the dataset's own columns*, which no other grid
 * can reuse. Promote it if a third grid needs the same shape.
 *
 * Primary-key columns are listed but disabled. Setting the same value on every selected
 * row would collide the key the moment two rows are selected, so `bulkEditRows` refuses
 * them outright — this only surfaces that rule instead of letting the user find it in a
 * constraint error.
 */
function BulkEditDialog({
  entry,
  columns,
  rowIds,
  onCancel,
  onApplied,
}: {
  entry: CsvAnalyticEntry;
  columns: CsvColumnDefinition[];
  rowIds: number[];
  onCancel: () => void;
  onApplied: (updated: number) => void;
}) {
  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);

  const locked = useMemo(() => new Set(nonEditableColumns(entry)), [entry]);

  function toggleColumn(name: string) {
    setEnabled((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  async function handleApply() {
    // Only the ticked columns go into the change set; every other column on every
    // selected row is left untouched.
    const changes: CsvBulkEditChanges = {};
    for (const column of columns) {
      if (!enabled.has(column.name) || locked.has(column.name)) continue;
      changes[column.name] = values[column.name] ?? "";
    }

    setIsSaving(true);
    setError(undefined);
    try {
      const result = await bulkEditCsvRowsAction(entry.id, rowIds, changes);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onApplied(result.updated ?? 0);
    } finally {
      setIsSaving(false);
    }
  }

  /**
   * The control per column type. Coercion is the server's job either way
   * (`coerceCellValue`, the same path an import takes), so these only make the common
   * case easier to type — they are not the validation.
   */
  function renderControl(column: CsvColumnDefinition) {
    const isEnabled = enabled.has(column.name);
    const shared = {
      disabled: !isEnabled,
      className: BULK_INPUT_CLASS,
      value: values[column.name] ?? "",
      "aria-label": column.sourceHeader,
      onChange: (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
        setValues((current) => ({ ...current, [column.name]: event.target.value })),
    };

    if (column.type === "boolean") {
      return (
        <select {...shared}>
          <option value="">— clear this column —</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      );
    }

    const placeholder = isEnabled ? "Leave blank to clear this column" : "";
    if (column.type === "integer" || column.type === "real") {
      return (
        <input
          {...shared}
          type="number"
          step={column.type === "integer" ? "1" : "any"}
          placeholder={placeholder}
        />
      );
    }
    if (column.type === "date") return <input {...shared} type="date" />;
    return <input {...shared} placeholder={placeholder} />;
  }

  const editableTicked = [...enabled].filter((name) => !locked.has(name));

  return (
    <Modal
      title={`Bulk edit ${rowIds.length} row(s)`}
      description="Tick a column to apply its value to every selected row. Unticked columns are left as they are, and a ticked column left blank clears it. Values are coerced to the column's type, exactly as an import would."
      onClose={onCancel}
      isBusy={isSaving}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleApply} disabled={isSaving || editableTicked.length === 0}>
            {isSaving ? "Applying…" : `Apply to ${rowIds.length}`}
          </Button>
        </>
      }
    >
      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

      <div className="flex flex-col gap-3">
        {columns.map((column) => {
          const isLocked = locked.has(column.name);
          return (
            <div
              key={column.name}
              className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[12rem_1fr]"
            >
              <label className="flex items-center gap-2 text-sm font-medium text-ink">
                <input
                  type="checkbox"
                  checked={enabled.has(column.name)}
                  disabled={isLocked}
                  onChange={() => toggleColumn(column.name)}
                  className="h-4 w-4 rounded border-line text-brass disabled:opacity-40"
                />
                <span className={isLocked ? "text-muted" : undefined}>
                  {column.sourceHeader}
                  <span className="ml-1 font-mono text-xs text-muted">{column.type}</span>
                </span>
              </label>
              {isLocked ? (
                <p className="text-xs text-muted">
                  Primary key — every selected row would get the same key.
                </p>
              ) : (
                renderControl(column)
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

/**
 * Renders an entry's table rows in a sortable, exportable grid, with selection and
 * bulk edit when the panel is showing the raw table.
 *
 * Rows are keyed by their real SQLite rowid (`data.rowIds`, parallel to `data.rows`)
 * rather than by array position: position is not identity, and a bulk edit has to name
 * the rows it writes. That is also why selection is offered here and not in
 * `ViewDataPanel` — a custom view's compiled SELECT carries no rowid, so its rows
 * aren't addressable.
 */
function DataPanel({
  data,
  exportName,
  entry,
  onEdited,
}: {
  data: CsvEntryData;
  exportName: string;
  /** Omit for a read-only grid — selection and bulk edit disappear with it. */
  entry?: CsvAnalyticEntry;
  onEdited?: () => void;
}) {
  const [bulkEdit, setBulkEdit] = useState<
    { rowIds: number[]; clearSelection: () => void } | undefined
  >(undefined);
  // What the last bulk edit did. Kept after the selection clears, so the confirmation
  // outlives the ticks it refers to.
  const [bulkResult, setBulkResult] = useState<string | undefined>(undefined);

  const rowKeys = useMemo(
    () => new Map(data.rows.map((row, index) => [row, data.rowIds[index]] as const)),
    [data],
  );
  const columns: DataGridColumn<(string | number | null)[]>[] = data.columns.map((column, index) => ({
    key: column.name,
    header: column.sourceHeader,
    value: (row) => row[index] as CellValue,
    render: (row) => formatCell(row[index]),
  }));

  /**
   * The rowids for a set of picked rows, dropping any the map doesn't know.
   *
   * The filter is not defensive noise: sending a placeholder id for a row we can't
   * identify would edit whatever row happens to own that id. Better to edit fewer
   * rows than the wrong ones, and the count in the dialog title shows what will
   * actually be written.
   */
  function rowIdsOf(picked: (string | number | null)[][]): number[] {
    return picked
      .map((row) => rowKeys.get(row))
      .filter((rowId): rowId is number => rowId !== undefined);
  }

  return (
    <div className="flex flex-col gap-2">
      <DataGrid
        columns={columns}
        rows={data.rows}
        // -1 can't collide with a real rowid (SQLite's are positive), so an
        // unidentifiable row is inert rather than aliasing another row's key.
        getRowKey={(row) => rowKeys.get(row) ?? -1}
        emptyMessage="This table has no rows."
        exportFileName={exportName}
        enableSelection={entry !== undefined}
        renderSelectionActions={
          entry === undefined
            ? undefined
            : (selectedRows, clearSelection) => {
                const rowIds = rowIdsOf(selectedRows);
                return (
                  <Button
                    size="sm"
                    // Nothing ticked means nothing to edit: the use-case rejects an
                    // empty selection, so opening the dialog could only end in an
                    // error the user can't act on.
                    disabled={rowIds.length === 0}
                    onClick={() => setBulkEdit({ rowIds, clearSelection })}
                  >
                    Bulk edit
                  </Button>
                );
              }
        }
      />

      {entry && (
        <p className="text-xs text-muted">
          Tick rows to bulk edit them — search and the column filters narrow what
          {" "}
          &ldquo;select all&rdquo; covers.
          {bulkResult && <span className="ml-2 font-medium text-brass-dark">{bulkResult}</span>}
        </p>
      )}

      {bulkEdit && entry && (
        <BulkEditDialog
          entry={entry}
          columns={data.columns}
          rowIds={bulkEdit.rowIds}
          onCancel={() => setBulkEdit(undefined)}
          onApplied={(updated) => {
            setBulkResult(`Updated ${updated} row(s).`);
            bulkEdit.clearSelection();
            setBulkEdit(undefined);
            onEdited?.();
          }}
        />
      )}
    </div>
  );
}

/**
 * An entry's rows read through a custom view, with the view's own pager.
 *
 * Paging is server-side here, unlike `DataPanel`: the view carries a records-per-page
 * and the whole point is not to pull the entire table to show 25 rows. So the grid
 * gets one page at a time (`defaultPageSize="ALL"`, `showStatusBar={false}`) and the
 * pager below is the view's, not the grid's — two pagers over the same rows would
 * disagree about what page you are on.
 */
function ViewDataPanel({ view, exportName }: { view: CsvCustomView; exportName: string }) {
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<CsvViewPage | undefined>(undefined);
  // Starts true: a fetch is always in flight from first mount, so false would render
  // one frame of "no rows" before the loading indicator appeared.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);

  // Same pattern as ChartBuilder above: entering the loading state (and resetting to
  // page 1 when the view changes) is a reaction to the request key changing, so it is
  // adjusted during render rather than in the effect. In an effect it committed one
  // frame of the previous view's rows with no loading indicator, which is why React
  // flags a synchronous setState there.
  //
  // The page is deliberately NOT part of the key that resets it — page 4 of a
  // different view is meaningless, but page 4 of this one is exactly what was asked for.
  const [requestedViewId, setRequestedViewId] = useState(view.id);
  const effectivePage = requestedViewId === view.id ? page : 1;
  if (requestedViewId !== view.id) {
    setRequestedViewId(view.id);
    setPage(1);
    setLoading(true);
    setError(undefined);
  }

  useEffect(() => {
    let cancelled = false;
    readCsvCustomViewPageAction(view.id, effectivePage).then((response) => {
      if (cancelled) return;
      if (!response.ok || !response.page) setError(response.error ?? "Failed to read the view.");
      else setResult(response.page);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [view.id, effectivePage]);

  /** Turning a page enters the loading state from the event, not from an effect. */
  function goToPage(next: number) {
    setPage(next);
    setLoading(true);
    setError(undefined);
  }

  const rowKeys = useMemo(
    () => new Map((result?.rows ?? []).map((row, index) => [row, index] as const)),
    [result],
  );

  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (!result) return <p className="text-sm text-muted">Loading…</p>;

  const columns: DataGridColumn<(string | number | null)[]>[] = result.columns.map(
    (column, index) => ({
      key: column.name,
      header: column.sourceHeader,
      value: (row) => row[index] as CellValue,
      render: (row) => formatCell(row[index]),
    }),
  );

  const firstOnPage = result.totalRows === 0 ? 0 : (result.page - 1) * result.recordsPerPage + 1;
  const lastOnPage = Math.min(result.page * result.recordsPerPage, result.totalRows);

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-md border border-line bg-paper-raised p-3 text-xs text-muted">
        <p className="font-medium text-ink">{view.name}</p>
        <p className="font-mono">{describeCriteria(view.criteria)}</p>
        <p className="font-mono">Ordered by: {describeOrderBy(view.orderBy)}</p>
        <p className="mt-1">Read-only — clear the view to select and bulk edit rows.</p>
      </div>

      <DataGrid
        columns={columns}
        rows={result.rows}
        getRowKey={(row) => rowKeys.get(row) ?? 0}
        emptyMessage="No rows match this view."
        exportFileName={exportName}
        defaultPageSize="ALL"
        showStatusBar={false}
      />

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-paper-raised px-3 py-2 text-xs text-muted">
        <span>
          {result.totalRows === 0
            ? "No records"
            : `${firstOnPage}–${lastOnPage} of ${result.totalRows} records`}
          {loading && " · loading…"}
        </span>
        <div className="flex items-center gap-2">
          <span>
            Page {result.page} of {result.pageCount}
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={loading || result.page <= 1}
            onClick={() => goToPage(Math.max(1, result.page - 1))}
          >
            Prev
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={loading || result.page >= result.pageCount}
            onClick={() => goToPage(result.page + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}

const ROW_LIMIT_OPTIONS = [5000, 10000, 40000] as const;
type RowLimit = number | "ALL";

/**
 * The full chart-builder configuration persisted in a saved preset's optionsJson.
 *
 * Encoding and data only. Display options — point markers, value labels, legend,
 * gridlines — are the reader's and live in `ChartXY`'s own gear control, remembered
 * in `localStorage` across sessions, so they're deliberately not part of a preset.
 * `showDots` used to be saved here; an older preset that still carries it is
 * ignored rather than being an error.
 */
interface ChartOptions {
  chartType: ChartType;
  xKey: string;
  yKeys: string[];
  showTable: boolean;
  decimals: number;
  rowLimit: RowLimit;
  /**
   * Which column's values become separate series, or "" for none.
   *
   * Only meaningful on a pooled dataset. An older preset saved before splitting
   * existed simply has no `splitColumn` and loads as "none", which is what it drew.
   */
  splitColumn?: string;
  /**
   * Reader-defined aggregates — "average of relative_humidity" — and whether each is
   * drawn as a reference line. Absent on a preset saved before they existed.
   */
  chart_functions?: CsvAggregateDefinition[];
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
  const [showTable, setShowTable] = useState(false);
  const [decimals, setDecimals] = useState(2);
  const [rowLimit, setRowLimit] = useState<RowLimit>(5000);
  // "" is "don't split". Defaults to the dataset's first source column when it has
  // one, because a pooled dataset drawn UNsplit is the misleading view: every device's
  // readings alternate along one line, which reads as violent oscillation rather than
  // several steady rooms.
  const splitOptions = groupableSourceColumns(entry.sourceColumns, entry.columns);
  const [splitColumn, setSplitColumn] = useState<string>(splitOptions[0]?.name ?? "");

  // Aggregates are DEFINED here but only evaluated when Calculate is pressed, so a
  // half-built function (a fresh row with no column yet) never computes, and a big
  // table isn't re-scanned on every keystroke.
  const [chartFunctions, setChartFunctions] = useState<CsvAggregateDefinition[]>([]);
  const [aggregateResults, setAggregateResults] = useState<CsvAggregateResult[]>([]);

  const [data, setData] = useState<CsvEntryData | undefined>(undefined);
  // Starts true: a fetch is always in flight from first mount, so false would render
  // one frame of "no rows" before the loading indicator appeared.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);

  const [presets, setPresets] = useState<CsvChartPreset[]>([]);
  const [presetName, setPresetName] = useState("");
  const [selectedPresetId, setSelectedPresetId] = useState<number | undefined>(undefined);
  const [presetError, setPresetError] = useState<string | undefined>(undefined);

  // Entering the loading state is a reaction to the request key changing, so it is
  // adjusted during render rather than in the effect below. Doing it in the effect
  // committed one frame of the previous table's rows with no loading indicator, and
  // React flags a synchronous setState in an effect for that reason.
  const requestKey = `${entry.id}|${rowLimit}`;
  const [requestedKey, setRequestedKey] = useState(requestKey);
  if (requestedKey !== requestKey) {
    setRequestedKey(requestKey);
    setLoading(true);
    setError(undefined);
  }

  useEffect(() => {
    let cancelled = false;
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

  // The initial load goes through a promise callback rather than calling the async
  // `loadPresets` directly: React flags a setState it can reach synchronously from an
  // effect body. `loadPresets` stays for the imperative reloads after a save or delete.
  useEffect(() => {
    let cancelled = false;
    listChartPresetsAction(entry.id).then((result) => {
      if (cancelled) return;
      if (result.ok && result.presets) setPresets(result.presets);
    });
    return () => {
      cancelled = true;
    };
  }, [entry.id]);

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
    if (typeof options.showTable === "boolean") setShowTable(options.showTable);
    if (typeof options.decimals === "number") setDecimals(options.decimals);
    if (options.rowLimit === "ALL" || typeof options.rowLimit === "number") setRowLimit(options.rowLimit);
    // "" (don't split) is a valid saved value, so an empty string must still apply.
    // A saved column that has since been dropped falls back to not splitting.
    if (Array.isArray(options.chart_functions)) {
      // Keep only definitions whose column still exists — the same read-time
      // forgiveness `computeAggregates` applies, done here too so the BUILDER doesn't
      // show a row pointing at a dropped column.
      const restored = options.chart_functions.filter(
        (definition): definition is CsvAggregateDefinition =>
          !!definition &&
          typeof definition.column === "string" &&
          entry.columns.some((column) => column.name === definition.column),
      );
      setChartFunctions(restored);
      // Results belong to the previous chart, not this one.
      setAggregateResults([]);
    }
    if (typeof options.splitColumn === "string") {
      setSplitColumn(
        options.splitColumn === "" ||
          entry.columns.some((column) => column.name === options.splitColumn)
          ? options.splitColumn
          : "",
      );
    }
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
    const optionsJson = JSON.stringify({
      chartType,
      xKey,
      yKeys,
      showTable,
      decimals,
      rowLimit,
      splitColumn,
      chart_functions: chartFunctions,
    });
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

  // Splitting is only possible once the column exists AND the data has been read.
  const isSplit = splitColumn !== "" && entry.columns.some((column) => column.name === splitColumn);

  /**
   * Chart rows and their series, either plain (one series per Y column) or split
   * (one series per Y column × source value).
   *
   * Computed together rather than as two memos because in split mode the series list
   * is *derived from the data* — you don't know the sources until the rows are read —
   * so deriving them apart would let the chart render a series key no record carries.
   */
  const { records, series } = useMemo(() => {
    if (isSplit && yKeys.length > 0 && xKey !== "") {
      const split = buildSplitChartData({
        columns: entry.columns,
        rows,
        xColumn: xKey,
        splitColumn,
        measureColumns: yKeys,
      });
      return {
        records: split.rows,
        series: split.series.map((one) => ({ key: one.key, label: one.label })),
      };
    }

    const xIndex = entry.columns.findIndex((column) => column.name === xKey);
    const yIndexes = yKeys.map((key) => entry.columns.findIndex((column) => column.name === key));
    return {
      records: rows.map((row) => {
        const record: Record<string, number | string | null> = {};
        const xRaw = xIndex >= 0 ? row[xIndex] : null;
        record[xKey] = chartType === "scatter" ? toChartNumber(xRaw) : xRaw;
        yKeys.forEach((key, i) => {
          record[key] = toChartNumber(yIndexes[i] >= 0 ? row[yIndexes[i]] : null);
        });
        return record;
      }),
      series: yKeys.map((key) => ({
        key,
        label: entry.columns.find((column) => column.name === key)?.sourceHeader ?? key,
      })),
    };
  }, [rows, entry.columns, xKey, yKeys, chartType, isSplit, splitColumn]);

  // Turning splitting ON while scatter is selected would leave an encoding the split
  // data can't honour, so fall back to a line. Done as an effect rather than inside
  // the split handler because a preset can also load scatter + a split column.
  useEffect(() => {
    if (isSplit && chartType === "scatter") setChartType("line");
  }, [isSplit, chartType]);

  const formatValue = useCallback(
    (value: number) =>
      Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: decimals }) : "",
    [decimals],
  );

  // --- Aggregate functions ---------------------------------------------------

  function addFunction() {
    // Seeded with "average" over the first numeric column, so a fresh row is already
    // valid and Calculate works without touching the pickers.
    const first = columnsForFunction("average", entry.columns)[0];
    setChartFunctions((current) => [
      ...current,
      {
        // Unique within this list only — it keys the row and identifies what to
        // remove when two aggregates are otherwise identical.
        id: `fn-${Date.now()}-${current.length}`,
        fn: "average",
        column: first?.name ?? entry.columns[0]?.name ?? "",
        chartIt: false,
      },
    ]);
  }

  function updateFunction(id: string, patch: Partial<CsvAggregateDefinition>) {
    setChartFunctions((current) =>
      current.map((definition) => {
        if (definition.id !== id) return definition;
        const next = { ...definition, ...patch };
        // Switching to a numeric-only function while a text column is selected would
        // leave a pair that silently computes nothing, so re-point it at a column the
        // new function can actually take.
        if (patch.fn !== undefined) {
          const allowed = columnsForFunction(next.fn, entry.columns);
          if (!allowed.some((column) => column.name === next.column)) {
            next.column = allowed[0]?.name ?? "";
          }
        }
        return next;
      }),
    );
  }

  function removeFunction(id: string) {
    setChartFunctions((current) => current.filter((definition) => definition.id !== id));
    setAggregateResults((current) => current.filter((result) => result.id !== id));
  }

  /**
   * Evaluates every defined aggregate over the rows the chart is currently showing.
   *
   * Deliberately over `rows` — the same capped, same read the chart draws — so a
   * figure always describes what is on screen. Changing "Rows to include" changes the
   * number, which is the honest behaviour even though it means the figure moves.
   */
  function handleCalculate() {
    setAggregateResults(
      computeAggregates({
        columns: entry.columns,
        rows,
        definitions: chartFunctions,
        splitColumn: isSplit ? splitColumn : undefined,
      }),
    );
  }

  /**
   * The reference lines the chart draws. Memoized because `ChartXY` is `memo`-wrapped
   * with a shallow comparator — a fresh array each render would defeat it.
   */
  const referenceLines = useMemo(
    () =>
      aggregateReferenceLines(aggregateResults).map((line) => ({
        key: line.key,
        value: line.value,
        label: line.label,
        // Several benchmarks all drawn in one near-black would be indistinguishable,
        // so each takes its own hue from the reserved annotation ramp. The first one
        // is the plain ink, which is the common case (a single average).
        color:
          line.index === 0
            ? CHART_CHROME.reference
            : CHART_REFERENCE_COLORS[(line.index - 1) % CHART_REFERENCE_COLORS.length],
      })),
    [aggregateResults],
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

      {/* Chart type used to be a select here. It's in the chart's own gear popover
          now — the same control every chart in the app offers, rather than one this
          view invented. The state stays here because `records` below depends on it:
          scatter needs a numeric x. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
        {/* Only a pooled dataset has anything to split by, so the control is absent
            rather than disabled on a single-file entry — see modules.md. */}
        {splitOptions.length > 0 && (
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-ink">Split by</span>
            <select
              value={splitColumn}
              onChange={(event) => setSplitColumn(event.target.value)}
              className={`w-full ${controlClass}`}
            >
              <option value="">Don&rsquo;t split</option>
              {splitOptions.map((column) => (
                <option key={column.name} value={column.name}>
                  {column.label}
                </option>
              ))}
            </select>
          </label>
        )}
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

      {/* Aggregate functions. Defined here, evaluated only on Calculate. */}
      <div className="rounded-md border border-line bg-paper-raised p-3">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-ink">Functions</span>
          <Button size="sm" variant="secondary" onClick={addFunction} ariaLabel="Add a function">
            + Add
          </Button>
          {chartFunctions.length > 0 && (
            <Button size="sm" onClick={handleCalculate} disabled={loading}>
              Calculate
            </Button>
          )}
        </div>

        {chartFunctions.length === 0 ? (
          <p className="text-sm text-muted">
            Add a function to compute an average, minimum, maximum, sum, count or distinct
            count over a column — and optionally draw it on the chart.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {chartFunctions.map((definition) => {
              const allowed = columnsForFunction(definition.fn, entry.columns);
              const result = aggregateResults.find((one) => one.id === definition.id);
              return (
                <div
                  key={definition.id}
                  className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-paper p-2"
                >
                  <select
                    value={definition.fn}
                    onChange={(event) =>
                      updateFunction(definition.id, {
                        fn: event.target.value as CsvAggregateFunction,
                      })
                    }
                    className={controlClass}
                    aria-label="Function"
                  >
                    {CSV_AGGREGATE_FUNCTIONS.map((fn) => (
                      <option key={fn} value={fn}>
                        {CSV_AGGREGATE_LABELS[fn]}
                      </option>
                    ))}
                  </select>

                  {/* Only columns the chosen function can take — average never offers
                      a text column, so an impossible pair can't be built. */}
                  <select
                    value={definition.column}
                    onChange={(event) =>
                      updateFunction(definition.id, { column: event.target.value })
                    }
                    className={controlClass}
                    aria-label="Column"
                  >
                    {allowed.map((column) => (
                      <option key={column.name} value={column.name}>
                        {column.sourceHeader}
                      </option>
                    ))}
                  </select>

                  <label className="flex items-center gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={definition.chartIt}
                      onChange={(event) =>
                        updateFunction(definition.id, { chartIt: event.target.checked })
                      }
                      className="h-4 w-4 rounded border-line text-brass focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
                    />
                    <span>Chart it</span>
                  </label>

                  {result && (
                    <span className="text-sm text-ink">
                      ={" "}
                      <span className="font-medium">
                        {result.value === null ? "—" : formatValue(result.value)}
                      </span>
                      {result.bySource.length > 0 && (
                        <span className="ml-2 text-muted">
                          (
                          {result.bySource
                            .map(
                              (entryBySource) =>
                                `${entryBySource.source || "(none)"}: ${
                                  entryBySource.value === null
                                    ? "—"
                                    : formatValue(entryBySource.value)
                                }`,
                            )
                            .join(", ")}
                          )
                        </span>
                      )}
                    </span>
                  )}

                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => removeFunction(definition.id)}
                    ariaLabel={`Remove ${describeAggregate(definition, entry.columns)}`}
                    title="Remove this function"
                    className="ml-auto"
                  >
                    ×
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* "Show data points" used to live here; it's now the chart's own gear
          control, alongside value labels, the legend and the gridlines, so every
          chart in the app offers it the same way. */}
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={showTable} onChange={(event) => setShowTable(event.target.checked)} className="h-4 w-4 rounded border-line text-brass" />
          <span>Show data table</span>
        </label>
      </div>

      {isSplit && series.length > MAX_SPLIT_SERIES && (
        <p className="text-sm text-muted">
          {series.length} series — that is a lot for one legend. Pick a single Y series, or
          filter the dataset with a custom view, to make this readable.
        </p>
      )}

      {loading ? (
        <p className="text-sm text-muted">Loading data…</p>
      ) : error ? (
        <p className="text-sm text-red-400">{error}</p>
      ) : xKey === "" || yKeys.length === 0 ? (
        <p className="text-sm text-muted">Pick an X axis and at least one Y series to draw the chart.</p>
      ) : (
        <ChartXY
          type={chartType}
          // Scatter is offered only when NOT splitting. Unsplit, this view casts its x
          // to a number on demand (see `records`), which is what scatter requires; a
          // split pivot keeps the x as the shared category the sources are aligned on,
          // so offering scatter there would promise a numeric axis the data isn't.
          chartTypes={isSplit ? SPLIT_CHART_TYPES : CHART_TYPES}
          onTypeChange={setChartType}
          data={records}
          xKey={xKey}
          series={series}
          formatValue={formatValue}
          referenceLines={referenceLines}
          displayStorageKey="myhomebase:chart:csv-analytics"
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
  // "append" when EDITING an existing entry, "overwrite" only when creating.
  //
  // This used to default to "overwrite" in both cases, which quietly destroyed data:
  // editing an entry to add a second file, without noticing the radio, dropped and
  // recreated the table — losing every row already imported AND any extra column that
  // had been added to hold a per-file value. Adding to a dataset is the overwhelmingly
  // common reason to edit one, so it is the safe default; overwrite is still one click
  // away and is now an explicit choice.
  const [ingestMode, setIngestMode] = useState<IngestMode>(entry ? "append" : "overwrite");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<string | undefined>(undefined);
  // How many of `columns` came from the file / already exist on the entry. Anything at
  // or past this index is a column the reader added here.
  //
  // This used to be a Set of `sourceHeader` strings, which broke: `updateColumn`
  // rewrites a new column's sourceHeader as its name is typed, so renaming one either
  // made it stop counting as new (if the typed name collided with a real header) or
  // orphaned the value already entered for it — the input blanked and submit then
  // failed asking for a value the reader had already given. A count is stable because
  // new columns are only ever APPENDED (see addColumn), never inserted.
  const [existingColumnCount, setExistingColumnCount] = useState<number>(
    entry?.columns.length ?? 0,
  );
  const isNewColumnAt = (index: number) => index >= existingColumnCount;
  // Values for new columns when appending/truncating (applied to all CSV rows)
  const [newColumnValues, setNewColumnValues] = useState<Record<string, string>>({});

  const hasNewFile = fileText !== undefined;
  const canEditSchema = !entry || ingestMode === "overwrite";
  // Append/truncate can't redefine existing columns, but the user can still add brand-new
  // ones (with a per-row typed value applied to every imported row) — see addColumn/removeColumn.
  const canAddColumns = canEditSchema || hasNewFile;
  // For append/truncate, `columns` state is seeded from entry.columns and only ever grows by
  // appending new columns (see addColumn) — so it already holds "existing + new" in order.
  const displayedColumns = columns;
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
        // Creating, or redefining the schema: the dropped file IS the column list, so
        // every one of its columns is "existing" and none is reader-added yet.
        setColumns(result.preview.suggestedColumns);
        setPrimaryKeyFields([]);
        setExistingColumnCount(result.preview.headers.length);
      } else {
        // Append/truncate keeps the entry's schema; the file supplies values for the
        // columns already there, and anything past them is reader-added.
        setExistingColumnCount(entry.columns.length);
      }
    } finally {
      setIsBusy(false);
    }
  }

  function updateColumn(index: number, field: "name" | "type", value: string) {
    setColumns((current) =>
      current.map((column, i) => {
        if (i !== index) return column;
        // A brand-new column has no real file header — sourceHeader is just its display
        // label, so keep it in sync with the name the user types.
        const isNewColumn = isNewColumnAt(i);
        const sourceHeader = field === "name" && isNewColumn ? value : column.sourceHeader;
        return { ...column, [field]: value, sourceHeader };
      }),
    );
  }

  function togglePrimaryKey(columnName: string) {
    setPrimaryKeyFields((current) =>
      current.includes(columnName) ? current.filter((name) => name !== columnName) : [...current, columnName],
    );
  }

  function addColumn() {
    setColumns((current) => [
      ...current,
      { name: "new_column", sourceHeader: "New Column", type: "text" as CsvColumnType },
    ]);
  }

  function removeColumn(index: number) {
    setColumns((current) => current.filter((_, i) => i !== index));
    // Also remove from primary key if it was selected
    const columnName = columns[index]?.name;
    if (columnName) {
      setPrimaryKeyFields((current) => current.filter((name) => name !== columnName));
    }
  }

  async function handleSubmit() {
    setError(undefined);
    setStatus(undefined);
    setIsBusy(true);
    try {
      // Columns the user added locally that have no header in the file — one typed value is
      // applied to every imported row for these. Not applicable to overwrite of an existing
      // entry, which redefines the whole schema from the dropped file instead.
      const newColumns =
        entry && ingestMode === "overwrite"
          ? []
          : columns.filter((_col, index) => isNewColumnAt(index));
      if (newColumns.length > 0) {
        const missingValues = newColumns.filter((col) => !newColumnValues[col.name]?.trim());
        if (missingValues.length > 0) {
          setError(
            `Please enter a value for all new columns: ${missingValues.map((col) => col.sourceHeader).join(", ")}`
          );
          return;
        }
      }

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
          newColumnValues: Object.keys(newColumnValues).length > 0 ? newColumnValues : undefined,
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
                columns: ingestMode === "overwrite" ? columns : newColumns,
                primaryKeyFields: ingestMode === "overwrite" ? primaryKeyFields : undefined,
                newColumnValues:
                  ingestMode !== "overwrite" && Object.keys(newColumnValues).length > 0
                    ? newColumnValues
                    : undefined,
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
        <div className="flex flex-col gap-3">
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-paper text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-3 py-2">Source header</th>
                  <th className="px-3 py-2">Column name</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Primary key</th>
                  {(canEditSchema || canAddColumns) && <th className="px-3 py-2 w-10"></th>}
                </tr>
              </thead>
              <tbody>
                {displayedColumns.map((column, index) => {
                  const isNewColumn = isNewColumnAt(index);
                  const canEditRow = canEditSchema || isNewColumn;
                  return (
                    <tr
                      key={`${column.sourceHeader}-${index}`}
                      className={`border-b border-line last:border-b-0 ${isNewColumn ? "bg-paper-raised" : ""}`}
                    >
                      <td className={`px-3 py-2 ${isNewColumn ? "text-brass font-medium" : "text-muted"}`}>
                        {isNewColumn ? `${column.sourceHeader} (new)` : column.sourceHeader}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={column.name}
                          disabled={!canEditRow}
                          onChange={(event) => updateColumn(index, "name", event.target.value)}
                          className="w-full rounded-md border border-line bg-paper px-2 py-1 text-ink disabled:opacity-50"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={column.type}
                          disabled={!canEditRow}
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
                      {(canEditSchema || canAddColumns) && (
                        <td className="px-3 py-2">
                          {isNewColumn && (
                            <button
                              type="button"
                              onClick={() => removeColumn(index)}
                              className="text-xs font-medium text-red-400 hover:underline"
                            >
                              Remove
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {canAddColumns && (
            <Button size="sm" variant="secondary" onClick={addColumn}>
              Add Column
            </Button>
          )}
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

      {/* When creating, or appending/truncating, with new columns, prompt for a value for each */}
      {hasNewFile && (!entry || ingestMode !== "overwrite") && displayedColumns.length > 0 && (
        (() => {
          const newColumns = displayedColumns.filter((_col, index) => isNewColumnAt(index));
          return newColumns.length > 0 ? (
            <div className="rounded-md border border-brass bg-paper-raised p-4">
              <p className="mb-3 text-sm font-medium text-ink">
                New columns detected. Enter a value for each new column — it will be applied to every row being imported:
              </p>
              <div className="flex flex-col gap-3">
                {newColumns.map((column) => (
                  <label key={column.name} className="block text-sm">
                    <span className="mb-1 block font-medium text-ink">{column.sourceHeader}</span>
                    <input
                      value={newColumnValues[column.name] ?? ""}
                      onChange={(event) =>
                        setNewColumnValues((current) => ({ ...current, [column.name]: event.target.value }))
                      }
                      placeholder={`Enter value for ${column.name}`}
                      className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
                    />
                  </label>
                ))}
              </div>
            </div>
          ) : null;
        })()
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

export function CsvAnalyticsView({
  entries,
  customViews = [],
}: {
  entries: CsvAnalyticEntry[];
  /** Every enabled view across every entry — the dropdown filters to its own row. */
  customViews?: CsvCustomView[];
}) {
  const router = useRouter();
  const [showNewForm, setShowNewForm] = useState(false);
  const [editingId, setEditingId] = useState<number | undefined>(undefined);
  const [activePanel, setActivePanel] = useState<{ entryId: number; mode: "data" | "chart" } | undefined>(undefined);
  const [panelData, setPanelData] = useState<CsvEntryData | undefined>(undefined);
  const [panelLoading, setPanelLoading] = useState(false);
  const [panelError, setPanelError] = useState<string | undefined>(undefined);
  // The view each entry's dropdown is currently set to, keyed by entry id. Absent
  // means "raw table" — which is also where a now-disabled selection lands, since a
  // disabled view is no longer in `viewsByEntry`.
  const [selectedViewByEntry, setSelectedViewByEntry] = useState<Record<number, number>>({});

  const viewsByEntry = useMemo(() => {
    const grouped = new Map<number, CsvCustomView[]>();
    for (const view of customViews) {
      grouped.set(view.entryId, [...(grouped.get(view.entryId) ?? []), view]);
    }
    return grouped;
  }, [customViews]);

  /**
   * Reads one entry's raw table into the panel. Shared by opening the panel, clearing
   * a view off it, and re-reading it after a bulk edit — all three want exactly this,
   * and a bulk edit has to re-read: the rows on screen are now stale, and so are the
   * rowids if the write changed a primary key column (it can't, but the read is the
   * thing that proves it).
   */
  const loadPanelData = useCallback(async (entryId: number, keepRows = false) => {
    if (!keepRows) setPanelData(undefined);
    setPanelError(undefined);
    setPanelLoading(true);
    try {
      const result = await readCsvAnalyticsDataAction(entryId);
      if (!result.ok || !result.data) setPanelError(result.error ?? "Failed to read table data.");
      else setPanelData(result.data);
    } finally {
      setPanelLoading(false);
    }
  }, []);

  async function openPanel(entry: CsvAnalyticEntry, mode: "data" | "chart") {
    setActivePanel({ entryId: entry.id, mode });
    if (mode !== "data") return; // the chart builder fetches its own (row-limited) data
    // A view-backed panel fetches its own page in ViewDataPanel, so there's nothing
    // to read here.
    if (selectedViewByEntry[entry.id] !== undefined) return;
    await loadPanelData(entry.id);
  }

  /**
   * Applies (or clears) a view on one entry's card. Opening the Data panel is part of
   * choosing a view — picking one and then having to click "Show Data" separately reads
   * as the selection not having taken.
   */
  async function applyView(entry: CsvAnalyticEntry, rawValue: string) {
    const viewId = rawValue === "" ? undefined : Number(rawValue);
    setSelectedViewByEntry((current) => {
      const next = { ...current };
      if (viewId === undefined) delete next[entry.id];
      else next[entry.id] = viewId;
      return next;
    });

    setActivePanel({ entryId: entry.id, mode: "data" });
    if (viewId !== undefined) return; // ViewDataPanel reads its own page

    // Cleared back to the raw table — fetch it, since ViewDataPanel is going away.
    await loadPanelData(entry.id);
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
      key: "customView",
      header: "View",
      excludeFromRecordView: true,
      render: (entry) => {
        const available = viewsByEntry.get(entry.id) ?? [];
        if (available.length === 0) {
          return <span className="text-xs text-muted">No views</span>;
        }
        return (
          <select
            value={selectedViewByEntry[entry.id] ?? ""}
            onChange={(event) => applyView(entry, event.target.value)}
            aria-label={`Custom view for ${entry.name}`}
            className="rounded-md border border-line bg-paper px-2 py-1 text-xs text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
          >
            <option value="">Whole table</option>
            {available.map((view) => (
              <option key={view.id} value={view.id}>
                {view.name}
              </option>
            ))}
          </select>
        );
      },
    },
    {
      key: "actions",
      header: "Actions",
      excludeFromRecordView: true,
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
  // Resolved against `viewsByEntry` (enabled views only), so a view disabled since it
  // was picked simply isn't found here and the panel falls back to the whole table.
  const activeView =
    activeEntry && activePanel?.mode === "data"
      ? (viewsByEntry.get(activeEntry.id) ?? []).find(
          (view) => view.id === selectedViewByEntry[activeEntry.id],
        )
      : undefined;

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
          title={`${activePanel.mode === "data" ? "Data" : "Chart"} — ${activeEntry.name}${
            activeView ? ` · ${activeView.name}` : ""
          }`}
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
            ) : activeView ? (
              // The view reads its own page, so the card's shared loading/error state
              // doesn't apply — ViewDataPanel owns both.
              <ViewDataPanel view={activeView} exportName={activeEntry.tableName} />
            ) : panelLoading ? (
              <p className="text-sm text-muted">Loading…</p>
            ) : panelError ? (
              <p className="text-sm text-red-400">{panelError}</p>
            ) : panelData ? (
              <DataPanel
                data={panelData}
                exportName={activeEntry.tableName}
                entry={activeEntry}
                // Re-read the rows the edit just changed. `keepRows` holds the old
                // rows on screen through the fetch: blanking them would collapse the
                // card to "Loading…" and lose the scroll position right after an
                // edit, which reads as the edit having wiped the table.
                onEdited={() => loadPanelData(activeEntry.id, true)}
              />
            ) : null}
          </div>
        </CollapsibleCard>
      )}
    </div>
  );
}
