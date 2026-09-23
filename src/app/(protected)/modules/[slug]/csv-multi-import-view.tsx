// CSV Analysis -> Import Files. Drop several CSVs from the same kind of device, label
// each one, and land them all in a single dataset.
//
// Presentation only: every rule about what may be pooled (headers must match, what a
// source name defaults to, how a row is tagged) lives in `src/lib/csv-analytics`. This
// file reads files into text, shows the plan the library computed, and posts it back.

"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/button";
import { MultiFileDropzone } from "@/components/multi-file-dropzone";
import { useIsCompact } from "@/components/viewport-context";
import { MAX_SOURCE_LABEL_COLUMNS, type CsvAnalyticEntry, type MultiFileImportPlan } from "@/lib/csv-analytics";
import {
  appendPooledFilesAction,
  importPooledFilesAction,
  planPooledImportAction,
} from "./csv-analytics-actions";

const CONTROL_CLASS =
  "rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

/** One file as the reader has configured it: its text, plus a value per label column. */
interface ConfiguredFile {
  fileName: string;
  fileText: string;
  labelValues: Record<string, string>;
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsText(file);
  });
}

export function CsvMultiImportView({ entries }: { entries: CsvAnalyticEntry[] }) {
  const isCompact = useIsCompact();

  // Pooled datasets only — appending to a single-file entry has nowhere to record
  // which file a row came from, and the use-case refuses it.
  const pooledEntries = entries.filter((entry) => entry.sourceColumns.length > 0);

  const [mode, setMode] = useState<"new" | "append">("new");
  const [appendEntryId, setAppendEntryId] = useState<number | undefined>(pooledEntries[0]?.id);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tableBaseName, setTableBaseName] = useState("");
  const [labels, setLabels] = useState<string[]>(["Source"]);

  const [files, setFiles] = useState<File[]>([]);
  const [configured, setConfigured] = useState<ConfiguredFile[]>([]);
  const [plan, setPlan] = useState<MultiFileImportPlan | undefined>(undefined);

  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<string | undefined>(undefined);

  const appendEntry = pooledEntries.find((entry) => entry.id === appendEntryId);
  // When appending, the label columns are the dataset's, not the reader's to redefine.
  const activeLabels =
    mode === "append" && appendEntry
      ? appendEntry.sourceColumns.filter((column) => column.kind === "label")
      : labels
          .map((label) => label.trim())
          .filter((label) => label !== "")
          .map((label) => ({ name: label.toLowerCase().replace(/[^a-z0-9]+/g, "_"), label }));

  /** Reads every dropped file and asks the library what importing them would do. */
  const refreshPlan = useCallback(async () => {
    if (files.length === 0) {
      setConfigured([]);
      setPlan(undefined);
      return;
    }
    setIsBusy(true);
    setError(undefined);
    try {
      const texts = await Promise.all(files.map(readFileAsText));
      const next = files.map((file, index) => ({
        fileName: file.name,
        fileText: texts[index],
        // Keep whatever the reader already typed for a file still in the list.
        labelValues:
          configured.find((entry) => entry.fileName === file.name)?.labelValues ?? {},
      }));
      setConfigured(next);

      const result = await planPooledImportAction(
        next.map((file) => ({ fileName: file.fileName, fileText: file.fileText })),
        activeLabels.map((label) => label.label),
      );
      if (!result.ok || !result.plan) {
        setError(result.error ?? "Failed to read those files.");
        setPlan(undefined);
        return;
      }
      setPlan(result.plan);

      // Seed each label with the name suggested from the filename, so the common case
      // ("Master Bathroom_export_….csv" -> "Master Bathroom") needs no typing at all.
      setConfigured((current) =>
        current.map((file) => {
          const suggested = result.plan?.files.find(
            (planned) => planned.fileName === file.fileName,
          )?.suggestedSourceName;
          if (!suggested) return file;
          const seeded = { ...file.labelValues };
          activeLabels.forEach((label) => {
            if (!seeded[label.name]?.trim()) seeded[label.name] = suggested;
          });
          return { ...file, labelValues: seeded };
        }),
      );
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : "Failed to read those files.");
    } finally {
      setIsBusy(false);
    }
    // `configured` is deliberately not a dependency: it is read only to preserve typed
    // values, and including it would re-run the plan on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, labels, mode, appendEntryId]);

  useEffect(() => {
    void refreshPlan();
  }, [refreshPlan]);

  function setLabelValue(fileName: string, columnName: string, value: string) {
    setConfigured((current) =>
      current.map((file) =>
        file.fileName === fileName
          ? { ...file, labelValues: { ...file.labelValues, [columnName]: value } }
          : file,
      ),
    );
  }

  async function handleImport() {
    setError(undefined);
    setStatus(undefined);
    setIsBusy(true);
    try {
      if (mode === "append") {
        if (appendEntryId === undefined) {
          setError("Pick a dataset to add these files to.");
          return;
        }
        const result = await appendPooledFilesAction(appendEntryId, configured);
        if (!result.ok) {
          setError(result.error ?? "Failed to add those files.");
          return;
        }
        setStatus(
          `Added ${result.ingestResult?.inserted ?? 0} rows from ${configured.length} file(s).`,
        );
      } else {
        const result = await importPooledFilesAction({
          name,
          description: description || undefined,
          tableBaseName,
          files: configured,
          labels: activeLabels.map((label) => label.label),
        });
        if (!result.ok) {
          setError(result.error ?? "Failed to import those files.");
          return;
        }
        setStatus(`Imported ${plan?.totalRows ?? 0} rows from ${configured.length} file(s).`);
      }
      setFiles([]);
      setConfigured([]);
      setPlan(undefined);
    } finally {
      setIsBusy(false);
    }
  }

  const blocked = (plan?.headerMismatches.length ?? 0) > 0;
  const canImport =
    !isBusy &&
    !blocked &&
    configured.length > 0 &&
    (mode === "append"
      ? appendEntryId !== undefined
      : name.trim() !== "" && tableBaseName.trim() !== "");

  return (
    <div className="flex flex-col gap-4">
      {/* Where the rows are going: a new pooled dataset, or one that already exists. */}
      <div className="flex flex-wrap items-end gap-3 rounded-md border border-line bg-paper-raised p-3">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Import into</span>
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value as "new" | "append")}
            className={CONTROL_CLASS}
          >
            <option value="new">A new dataset</option>
            <option value="append" disabled={pooledEntries.length === 0}>
              {pooledEntries.length === 0 ? "No pooled datasets yet" : "An existing dataset"}
            </option>
          </select>
        </label>

        {mode === "append" && pooledEntries.length > 0 && (
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-ink">Dataset</span>
            <select
              value={appendEntryId ?? ""}
              onChange={(event) => setAppendEntryId(Number(event.target.value))}
              className={CONTROL_CLASS}
            >
              {pooledEntries.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {mode === "new" && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-ink">Dataset name</span>
            <input
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                // Mirror the name into the table base until the reader edits it.
                if (tableBaseName === "" || tableBaseName === name) {
                  setTableBaseName(event.target.value);
                }
              }}
              placeholder="Humidity meters"
              className={`w-full ${CONTROL_CLASS}`}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-ink">Table name</span>
            <div className="flex items-center gap-1">
              <span className="text-sm text-muted">csv_</span>
              <input
                value={tableBaseName}
                onChange={(event) => setTableBaseName(event.target.value)}
                placeholder="humidity_meters"
                className={`w-full ${CONTROL_CLASS}`}
              />
            </div>
          </label>
          <label className="block text-sm sm:col-span-2">
            <span className="mb-1 block font-medium text-ink">Description</span>
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Twice-daily readings from every humidity meter"
              className={`w-full ${CONTROL_CLASS}`}
            />
          </label>
        </div>
      )}

      {/* The label columns. Fixed once the dataset exists, so append only reads them. */}
      {mode === "new" && (
        <div className="rounded-md border border-line bg-paper-raised p-3">
          <p className="mb-1 text-sm font-medium text-ink">Describe each file</p>
          <p className="mb-3 text-sm text-muted">
            Every row records the file it came from. Add up to {MAX_SOURCE_LABEL_COLUMNS} of your
            own columns — &ldquo;Room&rdquo;, say — and fill one in per file below.
          </p>
          <div className="flex flex-wrap gap-2">
            {labels.map((label, index) => (
              <input
                key={index}
                value={label}
                onChange={(event) =>
                  setLabels((current) =>
                    current.map((existing, i) => (i === index ? event.target.value : existing)),
                  )
                }
                placeholder="Room"
                className={CONTROL_CLASS}
              />
            ))}
            {labels.length < MAX_SOURCE_LABEL_COLUMNS && (
              <Button size="sm" variant="secondary" onClick={() => setLabels((c) => [...c, ""])}>
                Add a column
              </Button>
            )}
            {labels.length > 0 && (
              <Button size="sm" variant="secondary" onClick={() => setLabels((c) => c.slice(0, -1))}>
                Remove last
              </Button>
            )}
          </div>
        </div>
      )}

      <MultiFileDropzone
        files={files}
        onFilesChange={setFiles}
        accept=".csv,text/csv"
        disabled={isBusy}
        label="Drag several CSV files here, or click to browse"
      />

      {blocked && plan && (
        <div className="rounded-md border border-red-400 bg-paper-raised p-3">
          <p className="mb-2 text-sm font-medium text-red-400">
            These files don&rsquo;t have the same columns, so they can&rsquo;t be pooled:
          </p>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-ink">
            {plan.headerMismatches.map((mismatch) => (
              <li key={mismatch.fileName}>
                <span className="font-medium">{mismatch.fileName}</span> {mismatch.reason}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-muted">
            Remove it from the list above, or import it as its own dataset.
          </p>
        </div>
      )}

      {/* Per-file labels. A table on a wide screen; one card per file on a phone,
          because five columns of inputs cannot be read at 390px. */}
      {configured.length > 0 && activeLabels.length > 0 && !blocked && (
        <div className="rounded-md border border-line bg-paper-raised p-3">
          <p className="mb-3 text-sm font-medium text-ink">Label each file</p>

          {isCompact ? (
            <div className="flex flex-col gap-3">
              {configured.map((file) => (
                <div key={file.fileName} className="rounded-md border border-line bg-paper p-3">
                  <p className="mb-2 truncate text-sm font-medium text-ink" title={file.fileName}>
                    {file.fileName}
                  </p>
                  <p className="mb-2 text-xs text-muted">
                    {plan?.files.find((planned) => planned.fileName === file.fileName)?.rowCount ?? 0}{" "}
                    rows
                  </p>
                  <div className="flex flex-col gap-2">
                    {activeLabels.map((label) => (
                      <label key={label.name} className="block text-sm">
                        <span className="mb-1 block text-muted">{label.label}</span>
                        <input
                          value={file.labelValues[label.name] ?? ""}
                          onChange={(event) =>
                            setLabelValue(file.fileName, label.name, event.target.value)
                          }
                          className={`w-full ${CONTROL_CLASS}`}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-line">
                    <th className="px-3 py-2 font-medium text-muted">File</th>
                    <th className="px-3 py-2 font-medium text-muted">Rows</th>
                    {activeLabels.map((label) => (
                      <th key={label.name} className="px-3 py-2 font-medium text-muted">
                        {label.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {configured.map((file) => (
                    <tr key={file.fileName} className="border-b border-line last:border-b-0">
                      <td className="max-w-xs truncate px-3 py-2 text-ink" title={file.fileName}>
                        {file.fileName}
                      </td>
                      <td className="px-3 py-2 text-muted">
                        {plan?.files.find((planned) => planned.fileName === file.fileName)
                          ?.rowCount ?? 0}
                      </td>
                      {activeLabels.map((label) => (
                        <td key={label.name} className="px-3 py-2">
                          <input
                            value={file.labelValues[label.name] ?? ""}
                            onChange={(event) =>
                              setLabelValue(file.fileName, label.name, event.target.value)
                            }
                            className={`w-full ${CONTROL_CLASS}`}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {plan && !blocked && (
        <p className="text-sm text-muted">
          {plan.totalRows.toLocaleString()} rows from {plan.files.length} file(s), across{" "}
          {plan.dataColumns.length} data column(s) plus {plan.sourceColumns.length} source column(s).
        </p>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}
      {status && <p className="text-sm text-emerald-400">{status}</p>}

      <div className="flex gap-2">
        <Button onClick={handleImport} disabled={!canImport}>
          {isBusy ? "Working…" : mode === "append" ? "Add to dataset" : "Import files"}
        </Button>
        {files.length > 0 && (
          <Button variant="secondary" onClick={() => setFiles([])} disabled={isBusy}>
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}
