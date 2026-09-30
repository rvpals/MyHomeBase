// The whole CSV import screen, as one reusable component: drop a file, map its
// columns onto a module's fields, save that mapping by name, and import — with
// an optional dry run behind a confirmation dialog before anything is
// overwritten.
//
// Reusable because nothing in here knows what a journal entry or a recipe is.
// The caller supplies its field list, its per-field default options, and the
// server actions that do the work; this component owns only the interaction.
// Adding an importer to a module is therefore a lib adapter plus an actions
// file, not another 400 lines of mapping table. See coding-guide.md,
// "CSV import: the reusable importer".
//
// "Props in, events out": every server call arrives as a prop and every result
// is handed back through one. It never imports a module's actions itself.

"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/button";
import {
  CSV_MAPPING_OPTION_INPUT_CLASS,
  CsvMappingTable,
  type CsvMappingField,
} from "@/components/csv-mapping-table";
import { FileDropzone } from "@/components/file-dropzone";
import { Modal } from "@/components/modal";
import type {
  ColumnMapping,
  CsvPreview,
  FieldOptions,
  FieldOptionsMap,
  ImportSummary,
  NamedMapping,
} from "@/lib/csv-import";

/** Shared form-input styling from design.md. Copied, not invented. */
const INPUT_CLASS =
  "rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

/**
 * The delimiters a list-valued column can be split on.
 *
 * `\n` is written as the two-character escape rather than a real newline
 * because that is what a single-line CSV cell actually contains when an export
 * flattens a multi-line block. Each adapter decides what the escape means for
 * its own fields.
 */
const DELIMITER_CHOICES = [
  { value: "\\n", label: "New line" },
  { value: ",", label: "Comma" },
  { value: ";", label: "Semicolon" },
  { value: "|", label: "Pipe" },
  { value: " ", label: "Space" },
];

/**
 * One mappable target field. An alias of the mapping table's own type rather
 * than a second identical interface, so a field list passes straight through.
 */
export type CsvImportField = CsvMappingField;

/** What a caller's result-shaped action returns. Mirrors the module actions. */
export interface CsvImportActionResult {
  ok: boolean;
  error?: string;
}

/**
 * A row of the dry run, rendered in the overwrite confirmation dialog.
 *
 * Deliberately a flat, module-agnostic shape rather than each module's own plan
 * row: all the dialog needs is a label to show and a reason when the row is
 * blocked. The module's action maps its plan onto this.
 */
export interface CsvImportPlanRow {
  rowNumber: number;
  action: "create" | "update" | "skip";
  /** What to show for this row — a title, a name, a date. */
  label: string;
  /** A second, quieter line under the label. Optional. */
  detail?: string;
  blockedReason?: string;
}

export interface CsvImportPlan {
  rows: CsvImportPlanRow[];
  createCount: number;
  updateCount: number;
  skipCount: number;
}

/**
 * One parsed field in the Test dialog: the target field, and what the importer
 * would actually store for it.
 *
 * `value` is the **parsed** value, not the raw cell — that is the whole point.
 * Seeing `"flour\nsugar\neggs"` come back as three lines is how you know the
 * "split on" is right; seeing it as one line is how you catch that it isn't.
 */
export interface CsvImportTestField {
  /** The target field's label, as the mapping dropdown shows it. */
  label: string;
  /** The raw cell text, before any splitting or coercion. */
  rawValue: string;
  /** What would be stored. Multi-line values keep their newlines. */
  value: string;
}

/** One ticked row, parsed. */
export interface CsvImportTestRow {
  /** 1-based row number in the file, counting the header as row 1. */
  rowNumber: number;
  /** A short label for the row — usually whatever the name/title field holds. */
  label: string;
  fields: CsvImportTestField[];
  /** Set when the row would be skipped; `fields` may then be empty. */
  error?: string;
}

/** What `onPreview` gives back once a file has been read. */
export interface CsvImportPreviewResult extends CsvImportActionResult {
  preview?: CsvPreview;
  autoMapping?: ColumnMapping;
  autoFieldOptions?: FieldOptionsMap;
  namedMappings?: NamedMapping[];
}

export interface CsvImportPanelProps {
  /** The fields a column can be mapped to. */
  fields: readonly CsvImportField[];
  /** Fields whose cell holds several values, so they get a delimiter control. */
  listFields?: readonly string[];
  /** Fields that hold a date, so they get a date-format box. */
  dateFields?: readonly string[];
  /**
   * The options a freshly-picked field starts with.
   *
   * These are WRITTEN into the field options, not merely displayed: a
   * `<select>`'s rendered value fires no change event, so a default that lives
   * only in the control is invisible to the import. That is how a
   * space-separated column silently imported as one long value.
   */
  defaultFieldOptions?: (field: string) => FieldOptions | undefined;

  /** Saved mappings for this import type, rendered before a file is dropped. */
  namedMappings: NamedMapping[];

  /** Reads the file's headers and suggests a mapping. */
  onPreview: (fileText: string) => Promise<CsvImportPreviewResult>;
  onSaveMapping: (
    name: string,
    columnMapping: ColumnMapping,
    fieldOptions: FieldOptionsMap,
  ) => Promise<CsvImportActionResult>;
  onUpdateMapping: (
    id: number,
    name: string,
    columnMapping: ColumnMapping,
    fieldOptions: FieldOptionsMap,
  ) => Promise<CsvImportActionResult>;
  onDeleteMapping: (id: number) => Promise<CsvImportActionResult>;
  /**
   * The dry run behind the overwrite dialog. Omit to hide the overwrite toggle
   * entirely — an importer that cannot update in place should not offer it.
   */
  onPlan?: (
    fileText: string,
    columnMapping: ColumnMapping,
    fieldOptions: FieldOptionsMap,
    skipDuplicates: boolean,
    overwrite: boolean,
    excludedRowIndexes: number[],
  ) => Promise<CsvImportActionResult & { plan?: CsvImportPlan }>;
  onImport: (
    fileText: string,
    columnMapping: ColumnMapping,
    fieldOptions: FieldOptionsMap,
    skipDuplicates: boolean,
    overwrite: boolean,
    excludedRowIndexes: number[],
  ) => Promise<CsvImportActionResult & { summary?: ImportSummary }>;
  /**
   * Parses the ticked rows **without writing anything**, for the Test dialog:
   * each row's fields as the importer would actually store them.
   *
   * Omit to hide the Test button. Worth supplying — it is the only way to see
   * what a delimiter or a date format actually did before committing, and a
   * mis-set "split on" is otherwise invisible until the data is already in.
   */
  onTest?: (
    fileText: string,
    columnMapping: ColumnMapping,
    fieldOptions: FieldOptionsMap,
    excludedRowIndexes: number[],
  ) => Promise<CsvImportActionResult & { rows?: CsvImportTestRow[] }>;
  /** Called after a successful import, for the caller to refresh its list. */
  onImported?: () => void;

  /** The noun this importer deals in, for the dialog copy. E.g. "recipe". */
  recordNoun?: string;
  recordNounPlural?: string;
  /** What makes two rows the same record, for the skip-duplicates hint. */
  duplicateHint?: string;
  dropzoneLabel?: string;
  /** Rendered above the dropzone — a module's own notes about its file format. */
  children?: ReactNode;
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file."));
    reader.readAsText(file);
  });
}

export function CsvImportPanel({
  fields,
  listFields = [],
  dateFields = [],
  defaultFieldOptions,
  namedMappings: initialNamedMappings,
  onPreview,
  onSaveMapping,
  onUpdateMapping,
  onDeleteMapping,
  onPlan,
  onImport,
  onTest,
  onImported,
  recordNoun = "record",
  recordNounPlural = "records",
  duplicateHint,
  dropzoneLabel = "Drag a CSV here, or click to browse",
  children,
}: CsvImportPanelProps) {
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
  // a second copy of everything. Unticking it is the deliberate escape hatch
  // for a file that really does hold another copy of something.
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  // Off by default, and deliberately harder to reach than the skip toggle: this
  // is the one path that rewrites records you already have.
  const [overwrite, setOverwrite] = useState(false);
  // The dry run behind the confirmation dialog. Set only while the dialog is up.
  const [plan, setPlan] = useState<CsvImportPlan | undefined>(undefined);
  // Rows the reader has UNTICKED. Stored as the exclusion set rather than the
  // inclusion set so "everything" is the empty set: a freshly dropped file
  // imports in full without the panel having to enumerate every row first, and
  // it matches the `excludedRowIndexes` every importer already takes.
  const [excludedRows, setExcludedRows] = useState<Set<number>>(new Set());
  // The parsed rows behind the Test dialog. Set only while that dialog is up.
  const [testRows, setTestRows] = useState<CsvImportTestRow[] | undefined>(undefined);

  const listFieldSet = new Set(listFields);
  const dateFieldSet = new Set(dateFields);
  const canOverwrite = onPlan !== undefined;
  const selectedCount = (preview?.rows.length ?? 0) - excludedRows.size;

  async function handleFile(file: File) {
    setIsBusy(true);
    setError(undefined);
    setSummary(undefined);
    try {
      const text = await readFileAsText(file);
      const result = await onPreview(text);
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
      // A new file's rows are all ticked: the exclusions belonged to the old
      // file's row numbers and would silently drop unrelated rows here.
      setExcludedRows(new Set());
      setTestRows(undefined);
    } finally {
      setIsBusy(false);
    }
  }

  function toggleRowExcluded(rowIndex: number) {
    setExcludedRows((current) => {
      const next = new Set(current);
      if (next.has(rowIndex)) next.delete(rowIndex);
      else next.add(rowIndex);
      return next;
    });
  }

  function toggleAllRows(include: boolean) {
    setExcludedRows(
      include ? new Set() : new Set((preview?.rows ?? []).map((_, index) => index)),
    );
  }

  function updateMapping(columnIndex: number, field: string) {
    const key = String(columnIndex);
    setMapping((current) => {
      const next = { ...current };
      if (field === "") delete next[key];
      else next[key] = field;
      return next;
    });
    // Replace this column's options with the new field's defaults. Seeding them
    // explicitly (rather than clearing and letting each control render a
    // fallback) is what makes the shown delimiter the one the import will use.
    // Carrying the old options over instead would be worse — a comma left
    // behind from one field would silently apply to the next.
    setFieldOptions((current) => {
      const next = { ...current };
      const defaults = defaultFieldOptions?.(field);
      if (defaults) next[key] = defaults;
      else delete next[key];
      return next;
    });
  }

  function updateOption(columnIndex: number, patch: FieldOptions) {
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
    const refreshed = await onPreview(fileText ?? "");
    if (refreshed.ok) setNamedMappings(refreshed.namedMappings ?? []);
  }

  async function handleSaveMapping() {
    const name = mappingName.trim();
    if (name === "") return;
    setError(undefined);
    const result = await onSaveMapping(name, mapping, fieldOptions);
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
    const result = await onUpdateMapping(selectedMappingId, name, mapping, fieldOptions);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await refreshNamedMappings();
  }

  async function handleDeleteMapping(id: number) {
    const result = await onDeleteMapping(id);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (id === selectedMappingId) setSelectedMappingId(undefined);
    setNamedMappings((current) => current.filter((entry) => entry.id !== id));
  }

  // Overwrite runs a dry pass first and opens the confirmation dialog; every
  // other combination writes straight away.
  async function handleImport() {
    if (!fileText) return;
    if (!overwrite || !onPlan) {
      await runImport();
      return;
    }

    setIsBusy(true);
    setError(undefined);
    setSummary(undefined);
    try {
      const result = await onPlan(
        fileText,
        mapping,
        fieldOptions,
        skipDuplicates,
        true,
        [...excludedRows],
      );
      if (!result.ok || !result.plan) {
        setError(result.error ?? "Failed to inspect CSV.");
        return;
      }
      if (result.plan.updateCount === 0) {
        // Nothing would be overwritten, so there is nothing to confirm — the
        // dialog would just be a speed bump in front of a plain import.
        await runImport();
        return;
      }
      setPlan(result.plan);
    } finally {
      setIsBusy(false);
    }
  }

  // Parses the ticked rows and shows the result. Writes nothing, so it is safe
  // to press repeatedly while adjusting a delimiter.
  async function handleTest() {
    if (!fileText || !onTest) return;
    setIsBusy(true);
    setError(undefined);
    try {
      const result = await onTest(fileText, mapping, fieldOptions, [...excludedRows]);
      if (!result.ok || !result.rows) {
        setError(result.error ?? "Failed to parse the selected rows.");
        return;
      }
      setTestRows(result.rows);
    } finally {
      setIsBusy(false);
    }
  }

  async function runImport() {
    if (!fileText) return;
    setIsBusy(true);
    setError(undefined);
    try {
      const result = await onImport(
        fileText,
        mapping,
        fieldOptions,
        skipDuplicates,
        overwrite,
        [...excludedRows],
      );
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSummary(result.summary);
      setPlan(undefined);
      onImported?.();
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {children}

      <FileDropzone onFile={handleFile} accept=".csv" disabled={isBusy} label={dropzoneLabel} />

      {error && <p className="text-sm text-red-400">{error}</p>}

      {!preview && namedMappings.length > 0 && (
        <p className="text-xs text-muted">
          {namedMappings.length} saved{" "}
          {namedMappings.length === 1 ? "mapping" : "mappings"} for this import — drop a file to
          use one.
        </p>
      )}

      {preview && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">
            {preview.totalRows} data row(s) found. Set each column&apos;s target field (or leave
            it &quot;Ignore&quot;), then untick any row you don&apos;t want. <strong>Test</strong>{" "}
            shows exactly what the ticked rows would store, without saving anything.
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

          {/* The registered mapping table (components.md), not a hand-rolled
              header/select/sample table — it already handles the repeated and
              blank headers real exports ship, keying every cell by column index
              rather than header text. */}
          <CsvMappingTable
            className="max-h-[32rem]"
            headers={preview.headers}
            // Every row, not the random sample: you cannot untick a row you
            // cannot see, and the tick state is keyed by index into this list.
            sampleRows={preview.rows}
            excludedRowIndexes={excludedRows}
            onToggleRowExcluded={toggleRowExcluded}
            onToggleAllRows={toggleAllRows}
            selectionStyle="checkbox"
            rowNumberHeader="Row"
            fields={fields}
            mapping={mapping}
            onMappingChange={updateMapping}
            renderFieldOptions={(index, field) => {
              const options = fieldOptions[String(index)] ?? {};
              if (dateFieldSet.has(field)) {
                return (
                  <input
                    value={options.dateFormat ?? ""}
                    onChange={(event) => updateOption(index, { dateFormat: event.target.value })}
                    placeholder="Date format, e.g. M/D/YY"
                    aria-label="Date format"
                    className={CSV_MAPPING_OPTION_INPUT_CLASS}
                  />
                );
              }
              if (listFieldSet.has(field)) {
                return (
                  <select
                    // No fallback value: the shown option must be the one the
                    // import will actually use, so an unset option shows the
                    // placeholder rather than quietly claiming a delimiter was
                    // chosen.
                    value={options.delimiter ?? ""}
                    onChange={(event) => updateOption(index, { delimiter: event.target.value })}
                    aria-label="Split on"
                    className={CSV_MAPPING_OPTION_INPUT_CLASS}
                  >
                    <option value="">Split on: choose…</option>
                    {DELIMITER_CHOICES.map((choice) => (
                      <option key={choice.label} value={choice.value}>
                        Split on: {choice.label}
                      </option>
                    ))}
                  </select>
                );
              }
              return null;
            }}
          />

          <div className="flex flex-wrap items-end gap-2">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-ink">Mapping name</span>
              <input
                value={mappingName}
                onChange={(event) => setMappingName(event.target.value)}
                placeholder="e.g. Paprika export"
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

          <div className="flex flex-col gap-3">
            {/* Disabled, not hidden, while overwrite is on: the reader can still
                see what the default behaviour would have been. */}
            <label
              className={`flex items-start gap-2 text-sm max-lg:py-1 ${
                overwrite ? "text-muted" : "text-ink"
              }`}
            >
              <input
                type="checkbox"
                checked={skipDuplicates}
                onChange={(event) => setSkipDuplicates(event.target.checked)}
                disabled={isBusy || overwrite}
                className="mt-0.5 accent-brass"
                aria-describedby="csv-import-dedupe-hint"
              />
              <span>
                Skip {recordNounPlural} that already exist
                <span id="csv-import-dedupe-hint" className="mt-0.5 block text-xs text-muted">
                  {overwrite
                    ? "Superseded by “Overwrite database from file” — matching " +
                      recordNounPlural +
                      " are updated, not skipped."
                    : (duplicateHint ? `${duplicateHint} ` : "") +
                      `Untick to import every row, even ones already stored.`}
                </span>
              </span>
            </label>

            {canOverwrite && (
              <label className="flex items-start gap-2 text-sm text-ink max-lg:py-1">
                <input
                  type="checkbox"
                  checked={overwrite}
                  onChange={(event) => setOverwrite(event.target.checked)}
                  disabled={isBusy}
                  className="mt-0.5 accent-brass"
                  aria-describedby="csv-import-overwrite-hint"
                />
                <span>
                  Overwrite database from file
                  <span id="csv-import-overwrite-hint" className="mt-0.5 block text-xs text-muted">
                    Replaces a matching {recordNoun} with the row from the file, instead of
                    leaving it alone. The whole {recordNoun} is replaced, so a blank cell clears
                    that field. You will see exactly what changes before anything is written.
                  </span>
                </span>
              </label>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={handleImport} disabled={isBusy || selectedCount === 0}>
                {isBusy ? "Working…" : overwrite ? "Review changes" : `Import ${selectedCount}`}
              </Button>
              {onTest && (
                <Button
                  variant="secondary"
                  onClick={handleTest}
                  disabled={isBusy || selectedCount === 0}
                >
                  Test
                </Button>
              )}
              <span className="text-xs text-muted">
                {selectedCount} of {preview.rows.length} row
                {preview.rows.length === 1 ? "" : "s"} selected
                {onTest && selectedCount > 0 && " · Test parses them without saving"}
              </span>
            </div>
          </div>

          {summary && (
            <div className="rounded-md border border-line bg-paper p-3 text-sm">
              <p className="font-medium text-ink">
                Imported {summary.importedCount}, updated {summary.updatedCount}, skipped{" "}
                {summary.skippedCount}.
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

      {testRows && (
        <Modal
          title={`Parsed ${testRows.length} selected row${testRows.length === 1 ? "" : "s"}`}
          description="Exactly what would be stored, field by field. Nothing has been written — close this, adjust the mapping, and test again."
          onClose={() => setTestRows(undefined)}
          isBusy={isBusy}
          footer={
            <Button variant="secondary" onClick={() => setTestRows(undefined)}>
              Close
            </Button>
          }
        >
          <div className="flex max-h-[28rem] flex-col gap-4 overflow-y-auto">
            {testRows.length === 0 && (
              <p className="text-sm text-muted">No rows are selected.</p>
            )}
            {testRows.map((row) => (
              <div key={row.rowNumber} className="rounded-md border border-line">
                <div className="flex flex-wrap items-baseline gap-2 border-b border-line bg-paper-raised px-3 py-2">
                  <span className="text-sm font-medium text-ink">
                    {row.label || `(row ${row.rowNumber})`}
                  </span>
                  <span className="text-xs text-muted">row {row.rowNumber}</span>
                </div>

                {row.error ? (
                  <p className="px-3 py-2 text-sm text-red-400">
                    Would be skipped: {row.error}
                  </p>
                ) : (
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-line">
                        <th className="w-1/4 px-3 py-1.5 text-xs font-medium text-muted">
                          Column
                        </th>
                        <th className="px-3 py-1.5 text-xs font-medium text-muted">
                          Parsed value
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {row.fields.map((field) => (
                        <tr key={field.label} className="border-b border-line last:border-b-0">
                          <td className="px-3 py-1.5 align-top text-xs font-medium text-ink">
                            {field.label}
                          </td>
                          <td className="px-3 py-1.5 align-top text-ink">
                            {field.value === "" ? (
                              <span className="text-xs italic text-muted">(empty)</span>
                            ) : (
                              // `whitespace-pre-wrap` is the point of the whole
                              // dialog: a block field that did NOT split shows
                              // as one long line here, which is the symptom.
                              <span className="whitespace-pre-wrap break-words">
                                {field.value}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
          </div>
        </Modal>
      )}

      {plan && (
        <Modal
          title={`Overwrite ${plan.updateCount} existing ${
            plan.updateCount === 1 ? recordNoun : recordNounPlural
          }?`}
          description={`These stored ${recordNounPlural} will be replaced by the matching rows in the file. This cannot be undone.`}
          onClose={() => setPlan(undefined)}
          isBusy={isBusy}
          footer={
            <>
              <Button variant="secondary" onClick={() => setPlan(undefined)} disabled={isBusy}>
                Cancel
              </Button>
              <Button onClick={runImport} disabled={isBusy}>
                {isBusy ? "Overwriting…" : `Overwrite ${plan.updateCount}`}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            <ul className="flex max-h-72 flex-col divide-y divide-line overflow-y-auto rounded-md border border-line">
              {plan.rows
                .filter((row) => row.action === "update")
                .map((row) => (
                  <li key={row.rowNumber} className="flex flex-col gap-0.5 px-3 py-2 text-sm">
                    <span className="text-ink">{row.label || `(untitled ${recordNoun})`}</span>
                    <span className="text-xs text-muted">
                      {row.detail ? `${row.detail} · ` : ""}row {row.rowNumber}
                    </span>
                  </li>
                ))}
            </ul>

            {plan.createCount > 0 && (
              <p className="text-sm text-muted">
                {plan.createCount} new{" "}
                {plan.createCount === 1 ? recordNoun : recordNounPlural} will also be added.
              </p>
            )}

            {plan.skipCount > 0 && (
              <div className="text-sm text-muted">
                <p>
                  {plan.skipCount} {plan.skipCount === 1 ? "row" : "rows"} will be skipped:
                </p>
                <ul className="mt-1 flex max-h-32 flex-col gap-1 overflow-y-auto text-xs">
                  {plan.rows
                    .filter((row) => row.action === "skip")
                    .map((row) => (
                      <li key={row.rowNumber}>
                        Row {row.rowNumber}
                        {row.label ? ` — ${row.label}` : ""}: {row.blockedReason}
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
