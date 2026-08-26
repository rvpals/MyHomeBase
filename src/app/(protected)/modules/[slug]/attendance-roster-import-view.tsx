"use client";

// Import a roster from a CSV: pick a file, check the column mapping, name the
// class it lands in, import. The mapping table and the dropzone are the
// registered shared components; everything about what a column *means* lives in
// @/lib/attendance/csv-import.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { CsvMappingTable } from "@/components/csv-mapping-table";
import { FileDropzone } from "@/components/file-dropzone";
import { ATTENDANCE_IMPORT_FIELDS, type RosterImportResult } from "@/lib/attendance";
import type {
  ColumnMapping,
  CsvPreview,
  FieldOptionsMap,
  NamedMapping,
} from "@/lib/csv-import";
import {
  deleteRosterMappingAction,
  previewRosterCsvAction,
  runRosterImportAction,
  saveRosterMappingAction,
  updateRosterMappingAction,
} from "./attendance-import-actions";

// Shared form-input styling from design.md.
const INPUT_CLASS =
  "rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";
const SMALL_INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-2 py-1 text-xs text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

// The one field with a per-column option worth offering: a constant lets you tag
// every imported student with the same note ("Fall 2026") without the file
// carrying a column for it.
const CONSTANT_VALUE_FIELDS = new Set(["note"]);

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file."));
    reader.readAsText(file);
  });
}

/**
 * A class name guessed from the file name: `ACC212section1.csv` -> `ACC212
 * section1`. Only a starting point for the required input — the teacher can type
 * over it, and a name that doesn't split usefully just arrives as-is.
 */
function classNameFromFileName(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, "") // drop the extension
    .replace(/[_-]+/g, " ")
    // Split a letters/digits boundary, so ACC212section1 reads as words.
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

export function AttendanceRosterImportView({
  namedMappings: initialNamedMappings,
}: {
  namedMappings: NamedMapping[];
}) {
  const router = useRouter();
  const [fileText, setFileText] = useState<string>();
  const [preview, setPreview] = useState<CsvPreview>();
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [fieldOptions, setFieldOptions] = useState<FieldOptionsMap>({});
  const [className, setClassName] = useState("");
  const [namedMappings, setNamedMappings] = useState<NamedMapping[]>(initialNamedMappings);
  const [selectedMappingId, setSelectedMappingId] = useState<number>();
  const [mappingName, setMappingName] = useState("");
  const [summary, setSummary] = useState<RosterImportResult>();
  const [error, setError] = useState<string>();
  const [isBusy, setIsBusy] = useState(false);

  async function handleFile(file: File) {
    setIsBusy(true);
    setError(undefined);
    setSummary(undefined);
    try {
      const text = await readFileAsText(file);
      const result = await previewRosterCsvAction(text);
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
      // Only a suggestion, and only if the teacher hasn't already typed one.
      setClassName((current) => (current.trim() === "" ? classNameFromFileName(file.name) : current));
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

  function updateOption(columnIndex: number, patch: { constantValue?: string }) {
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
    const refreshed = await previewRosterCsvAction(fileText ?? "");
    if (refreshed.ok) setNamedMappings(refreshed.namedMappings ?? []);
  }

  async function handleSaveMapping() {
    const name = mappingName.trim();
    if (name === "") return;
    setError(undefined);
    const result = await saveRosterMappingAction(name, mapping, fieldOptions);
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
    const result = await updateRosterMappingAction(selectedMappingId, name, mapping, fieldOptions);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await refreshNamedMappings();
  }

  async function handleDeleteMapping(id: number) {
    const result = await deleteRosterMappingAction(id);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (id === selectedMappingId) setSelectedMappingId(undefined);
    setNamedMappings((current) => current.filter((entry) => entry.id !== id));
  }

  async function handleImport() {
    if (!fileText) return;
    const targetClass = className.trim();
    if (targetClass === "") {
      setError("Name the class these students should go into.");
      return;
    }

    setIsBusy(true);
    setError(undefined);
    try {
      const result = await runRosterImportAction(fileText, targetClass, mapping, fieldOptions);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSummary(result.summary);
      router.refresh(); // re-fetch the roster and class lists on the server
    } finally {
      setIsBusy(false);
    }
  }

  const hasNameMapped = Object.values(mapping).some((field) =>
    ["fullName", "firstName", "lastName"].includes(field),
  );

  return (
    <div className="flex flex-col gap-4">
      <FileDropzone
        onFile={handleFile}
        accept=".csv"
        disabled={isBusy}
        label="Drag a roster CSV here, or click to browse"
      />

      {error && <p className="text-sm text-red-400">{error}</p>}

      {preview && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">
            {preview.totalRows} data row(s) found. Set each column&apos;s target field (or leave
            it &quot;Ignore&quot;). A single <span className="font-medium">Name</span> column
            holding <span className="font-mono text-xs">Last,First</span> maps to{" "}
            <span className="font-medium">Full name</span> — it is split on the first comma.
          </p>

          {namedMappings.length > 0 && (
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-ink">Load a saved mapping</span>
              <select
                value={selectedMappingId ?? ""}
                onChange={(event) =>
                  event.target.value && loadNamedMapping(Number(event.target.value))
                }
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

          <CsvMappingTable
            headers={preview.headers}
            sampleRows={preview.previewRows}
            fields={ATTENDANCE_IMPORT_FIELDS}
            mapping={mapping}
            onMappingChange={updateMapping}
            renderFieldOptions={(columnIndex, field) =>
              CONSTANT_VALUE_FIELDS.has(field) ? (
                <input
                  value={fieldOptions[String(columnIndex)]?.constantValue ?? ""}
                  onChange={(event) =>
                    updateOption(columnIndex, { constantValue: event.target.value })
                  }
                  placeholder="Same for every row (optional)"
                  className={SMALL_INPUT_CLASS}
                />
              ) : null
            }
          />

          {/* The class is required, so it sits directly above the Import button
              rather than among the optional mapping controls. Stacks on a phone. */}
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-ink">Class to create</span>
            <input
              value={className}
              onChange={(event) => setClassName(event.target.value)}
              placeholder="e.g. ACC212 Section 1"
              className={`${INPUT_CLASS} w-full max-w-sm`}
            />
            <span className="mt-1 block text-xs text-muted">
              Everyone imported is enrolled into this class. It is created now, or reused if a
              class already has this name.
            </span>
          </label>

          <div className="flex flex-wrap items-end gap-2">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-ink">Mapping name</span>
              <input
                value={mappingName}
                onChange={(event) => setMappingName(event.target.value)}
                placeholder="e.g. School roster export"
                className={INPUT_CLASS}
              />
            </label>
            <Button
              size="sm"
              variant="secondary"
              onClick={handleSaveMapping}
              disabled={mappingName.trim() === ""}
            >
              Save as new
            </Button>
            {selectedMappingId !== undefined && (
              <Button
                size="sm"
                variant="secondary"
                onClick={handleUpdateMapping}
                disabled={mappingName.trim() === ""}
              >
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

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={handleImport} disabled={isBusy || !hasNameMapped}>
              {isBusy ? "Importing…" : "Import roster"}
            </Button>
            {!hasNameMapped && (
              <span className="text-sm text-muted">
                Map a name column before importing.
              </span>
            )}
          </div>

          {summary && (
            <div className="rounded-md border border-line bg-paper p-3 text-sm">
              <p className="font-medium text-ink">
                Imported {summary.importedCount} student(s), skipped {summary.skippedCount}.
              </p>
              {summary.attendanceClass && (
                <p className="mt-1 text-muted">
                  {summary.enrolledCount} enrolled into{" "}
                  <span className="text-ink">{summary.attendanceClass.name}</span>
                  {summary.createdClass ? " (new class)." : " (existing class)."}
                </p>
              )}
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
