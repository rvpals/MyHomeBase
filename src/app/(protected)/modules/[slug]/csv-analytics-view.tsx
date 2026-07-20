"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import { FileDropzone } from "@/components/file-dropzone";
import type { CsvAnalyticEntry, CsvColumnDefinition, CsvColumnType, IngestMode } from "@/lib/csv-analytics";
import {
  createCsvAnalyticsEntryAction,
  deleteCsvAnalyticsEntryAction,
  previewCsvAnalyticsFileAction,
  updateCsvAnalyticsEntryAction,
} from "./csv-analytics-actions";

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
        <div className="flex gap-2">
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
    </div>
  );
}
