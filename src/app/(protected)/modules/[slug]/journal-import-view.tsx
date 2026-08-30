"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { FileDropzone } from "@/components/file-dropzone";
import type {
  ColumnMapping,
  CsvPreview,
  FieldOptionsMap,
  ImportSummary,
  NamedMapping,
} from "@/lib/csv-import";
import { JOURNAL_IMPORT_FIELDS } from "@/lib/journal";
import {
  deleteJournalMappingAction,
  previewJournalCsvAction,
  runJournalImportAction,
  saveJournalMappingAction,
  updateJournalMappingAction,
} from "./journal-import-actions";

// Shared form-input styling from design.md.
const INPUT_CLASS =
  "rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";
const SMALL_INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-2 py-1 text-xs text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

const DELIMITER_CHOICES = [
  { value: ",", label: "Comma" },
  { value: " ", label: "Space" },
  { value: ";", label: "Semicolon" },
];

// Fields whose cell can hold several values, so they expose a delimiter choice.
const LIST_FIELDS = new Set(["categories", "tags"]);

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file."));
    reader.readAsText(file);
  });
}

export function JournalImportView({ namedMappings: initialNamedMappings }: { namedMappings: NamedMapping[] }) {
  const router = useRouter();
  const [fileText, setFileText] = useState<string | undefined>(undefined);
  const [preview, setPreview] = useState<CsvPreview | undefined>(undefined);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [fieldOptions, setFieldOptions] = useState<FieldOptionsMap>({});
  const [namedMappings, setNamedMappings] = useState<NamedMapping[]>(initialNamedMappings);
  const [selectedMappingId, setSelectedMappingId] = useState<number | undefined>(undefined);
  const [mappingName, setMappingName] = useState("");
  const [summary, setSummary] = useState<ImportSummary | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isBusy, setIsBusy] = useState(false);
  // Default on: re-importing a file you already imported should be a no-op, not
  // a second copy of every entry. Unticking it is the deliberate escape hatch
  // for a file that really does hold another copy of something.
  const [skipDuplicates, setSkipDuplicates] = useState(true);

  async function handleFile(file: File) {
    setIsBusy(true);
    setError(undefined);
    setSummary(undefined);
    try {
      const text = await readFileAsText(file);
      const result = await previewJournalCsvAction(text);
      if (!result.ok || !result.preview) {
        setError(result.error ?? "Failed to preview CSV.");
        return;
      }
      setFileText(text);
      setPreview(result.preview);
      setMapping(result.autoMapping ?? {});
      setFieldOptions(result.autoFieldOptions ?? {});
      setNamedMappings(result.namedMappings ?? []);
      setSelectedMappingId(undefined);
      setMappingName("");
    } finally {
      setIsBusy(false);
    }
  }

  function updateMapping(columnIndex: number, field: string) {
    const key = String(columnIndex);
    setMapping((current) => {
      const next = { ...current };
      if (field === "") delete next[key];
      else next[key] = field;
      return next;
    });
    // Drop options that no longer apply to the newly chosen field.
    setFieldOptions((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function updateOption(columnIndex: number, patch: { delimiter?: string; dateFormat?: string }) {
    const key = String(columnIndex);
    setFieldOptions((current) => ({ ...current, [key]: { ...current[key], ...patch } }));
  }

  function loadNamedMapping(id: number) {
    const named = namedMappings.find((entry) => entry.id === id);
    if (!named) return;
    setMapping(named.columnMapping);
    setFieldOptions(named.fieldOptions);
    setSelectedMappingId(named.id);
    setMappingName(named.name);
  }

  async function refreshNamedMappings() {
    const refreshed = await previewJournalCsvAction(fileText ?? "");
    if (refreshed.ok) setNamedMappings(refreshed.namedMappings ?? []);
  }

  async function handleSaveMapping() {
    const name = mappingName.trim();
    if (name === "") return;
    setError(undefined);
    const result = await saveJournalMappingAction(name, mapping, fieldOptions);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await refreshNamedMappings();
  }

  async function handleUpdateMapping() {
    if (selectedMappingId === undefined) return;
    const name = mappingName.trim();
    if (name === "") return;
    setError(undefined);
    const result = await updateJournalMappingAction(selectedMappingId, name, mapping, fieldOptions);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await refreshNamedMappings();
  }

  async function handleDeleteMapping(id: number) {
    const result = await deleteJournalMappingAction(id);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (id === selectedMappingId) setSelectedMappingId(undefined);
    setNamedMappings((current) => current.filter((entry) => entry.id !== id));
  }

  async function handleImport() {
    if (!fileText) return;
    setIsBusy(true);
    setError(undefined);
    try {
      const result = await runJournalImportAction(fileText, mapping, fieldOptions, skipDuplicates);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSummary(result.summary);
      router.refresh(); // re-fetch the entries list on the server
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <FileDropzone onFile={handleFile} accept=".csv" disabled={isBusy} label="Drag a journal CSV here, or click to browse" />

      {error && <p className="text-sm text-red-400">{error}</p>}

      {preview && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">
            {preview.totalRows} data row(s) found. Showing {preview.sampleRows.length} random sample row(s) to help
            you map each column. Set each column&apos;s target field (or leave it &quot;Ignore&quot;).
          </p>

          {namedMappings.length > 0 && (
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-ink">Load a saved mapping</span>
              <select
                value={selectedMappingId ?? ""}
                onChange={(event) => event.target.value && loadNamedMapping(Number(event.target.value))}
                className={`${INPUT_CLASS} max-w-xs`}
              >
                <option value="">Select…</option>
                {namedMappings.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line bg-paper-raised">
                  {preview.headers.map((header) => (
                    <th key={header} className="px-3 py-2 font-medium text-muted">
                      {header}
                    </th>
                  ))}
                </tr>
                <tr className="border-b border-line">
                  {preview.headers.map((header, index) => (
                    <th key={header} className="px-3 py-2 align-top">
                      <select
                        value={mapping[String(index)] ?? ""}
                        onChange={(event) => updateMapping(index, event.target.value)}
                        className={SMALL_INPUT_CLASS}
                      >
                        <option value="">Ignore</option>
                        {JOURNAL_IMPORT_FIELDS.map((field) => (
                          <option key={field.value} value={field.value}>
                            {field.label}
                          </option>
                        ))}
                      </select>
                    </th>
                  ))}
                </tr>
                <tr className="border-b border-line">
                  {preview.headers.map((header, index) => {
                    const field = mapping[String(index)];
                    const options = fieldOptions[String(index)] ?? {};
                    return (
                      <th key={header} className="px-3 py-2 align-top font-normal">
                        {field === "date" && (
                          <input
                            value={options.dateFormat ?? ""}
                            onChange={(event) => updateOption(index, { dateFormat: event.target.value })}
                            placeholder="Date format, e.g. M/D/YY"
                            className={SMALL_INPUT_CLASS}
                          />
                        )}
                        {field && LIST_FIELDS.has(field) && (
                          <select
                            value={options.delimiter ?? ","}
                            onChange={(event) => updateOption(index, { delimiter: event.target.value })}
                            className={SMALL_INPUT_CLASS}
                          >
                            {DELIMITER_CHOICES.map((choice) => (
                              <option key={choice.label} value={choice.value}>
                                Split on: {choice.label}
                              </option>
                            ))}
                          </select>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {preview.sampleRows.map((row, rowIndex) => (
                  <tr key={rowIndex} className="border-b border-line last:border-b-0 align-top">
                    {preview.headers.map((_, cellIndex) => (
                      <td key={cellIndex} className="max-w-xs truncate px-3 py-2 text-ink" title={row[cellIndex] ?? ""}>
                        {row[cellIndex] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-ink">Mapping name</span>
              <input
                value={mappingName}
                onChange={(event) => setMappingName(event.target.value)}
                placeholder="e.g. Diary export"
                className={INPUT_CLASS}
              />
            </label>
            <Button size="sm" variant="secondary" onClick={handleSaveMapping} disabled={mappingName.trim() === ""}>
              Save as new
            </Button>
            {selectedMappingId !== undefined && (
              <Button size="sm" variant="secondary" onClick={handleUpdateMapping} disabled={mappingName.trim() === ""}>
                Update selected
              </Button>
            )}
          </div>

          {namedMappings.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {namedMappings.map((entry) => (
                <span
                  key={entry.id}
                  className="flex items-center gap-1 rounded-full bg-line/60 px-2 py-0.5 text-xs text-ink"
                >
                  {entry.name}
                  <button
                    type="button"
                    onClick={() => handleDeleteMapping(entry.id)}
                    aria-label={`Delete ${entry.name}`}
                    className="text-muted hover:text-red-400"
                  >
                    &times;
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-3">
            <label className="flex items-start gap-2 text-sm text-ink max-lg:py-1">
              <input
                type="checkbox"
                checked={skipDuplicates}
                onChange={(event) => setSkipDuplicates(event.target.checked)}
                disabled={isBusy}
                className="mt-0.5 accent-brass"
                aria-describedby="journal-import-dedupe-hint"
              />
              <span>
                Skip entries that already exist
                <span id="journal-import-dedupe-hint" className="mt-0.5 block text-xs text-muted">
                  An entry counts as existing when its date, time and title all match. Untick to
                  import every row, even ones already in the journal.
                </span>
              </span>
            </label>

            <div>
              <Button onClick={handleImport} disabled={isBusy}>
                {isBusy ? "Importing…" : "Import"}
              </Button>
            </div>
          </div>

          {summary && (
            <div className="rounded-md border border-line bg-paper p-3 text-sm">
              <p className="font-medium text-ink">
                Imported {summary.importedCount}, skipped {summary.skippedCount}.
              </p>
              {summary.skippedCount > 0 && (
                <ul className="mt-2 flex max-h-48 flex-col gap-1 overflow-y-auto text-xs text-muted">
                  {summary.results
                    .filter((result) => result.status === "skipped")
                    .map((result) => (
                      <li key={result.rowNumber}>
                        Row {result.rowNumber}: {result.reason}
                      </li>
                    ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
