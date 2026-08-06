"use client";

// The CSV Import section. You pick what kind of file it is, browse for it, map its
// columns, and save that mapping under the broker's name so the next export is one
// dropdown away. Modelled on the Expense importer and sharing its CsvMappingTable.
//
// One screen for all three import types rather than three stacked panels: the type
// decides which fields are on offer and which extra controls appear, so it belongs
// at the top as a choice, not as a section you scroll past.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { CSV_MAPPING_OPTION_INPUT_CLASS, CsvMappingTable } from "@/components/csv-mapping-table";
import { FileDropzone } from "@/components/file-dropzone";
import { constantValuesByField, mapRow } from "@/lib/csv-import";
import type {
  AccountNameMapping,
  ColumnMapping,
  CsvPreview,
  FieldOptionsMap,
  ImportSummary,
  NamedMapping,
} from "@/lib/csv-import";
import { PERFORMANCE_IMPORT_FIELDS } from "@/lib/investment-accounts";
import {
  POSITION_IMPORT_FIELDS,
  POSITION_TYPES,
  TRANSACTION_IMPORT_FIELDS,
  UNASSIGNED_ACCOUNT_ID,
  resolvePositionType,
  type PositionType,
} from "@/lib/stock-positions";
import {
  deleteNamedMappingAction,
  executeImportAction,
  previewAccountNamesAction,
  previewCsvAction,
  saveNamedMappingAction,
  type StockImportType,
} from "./csv-import-actions";

const INPUT_CLASS =
  "rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

/** Matches the mapping table's own dropdowns, which sit in the row above. */
const SMALL_SELECT_CLASS =
  "w-full rounded-md border border-line bg-paper px-2 py-1 text-xs text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

/** Fields whose column needs a source date format. Only Transactions has one. */
const DATE_FIELDS = new Set(["date"]);

const IMPORT_TYPES: { value: StockImportType; label: string; blurb: string }[] = [
  {
    value: "Position",
    label: "Positions",
    blurb:
      "One row per holding. Imported into the account you choose, so the same ticker at two brokers stays two positions.",
  },
  {
    value: "Transaction",
    label: "Transactions",
    blurb:
      "One row per buy or sell. Rows matching an existing date/action/ticker/total are skipped, so re-importing is safe.",
  },
  {
    value: "Performance",
    label: "Account Performance",
    blurb:
      "One row per account value snapshot. If you map an Account Name column, you'll be asked to match those names to your accounts.",
  },
];

const FIELDS_BY_TYPE: Record<StockImportType, readonly { value: string; label: string }[]> = {
  Position: POSITION_IMPORT_FIELDS,
  Transaction: TRANSACTION_IMPORT_FIELDS,
  Performance: PERFORMANCE_IMPORT_FIELDS,
};

export interface ImportAccountOption {
  id: number;
  name: string;
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read the file."));
    reader.readAsText(file);
  });
}

/**
 * Where a row's currently-selected account came from, so the match step can say
 * so rather than presenting a guess and a saved choice as the same thing.
 *
 * Derived at render from the selection rather than stored, so it updates the
 * moment the dropdown is touched — a guess you accepted unchanged is still a
 * guess, and should keep saying so until you confirm the import.
 */
function accountMatchSource(
  csvName: string,
  chosen: number | undefined,
  step: { remembered: Record<string, number>; guessed: Record<string, number> },
): { label: string; className: string; hint: string } {
  if (chosen === undefined) {
    return {
      label: "Skipped",
      className: "bg-line/60 text-muted",
      hint: `Rows naming "${csvName}" will not be imported.`,
    };
  }
  if (step.remembered[csvName] === chosen) {
    return {
      label: "Remembered",
      className: "bg-brass-soft text-brass-dark",
      hint: "What you chose last time, saved with this mapping.",
    };
  }
  if (step.guessed[csvName] === chosen) {
    return {
      label: "Guessed",
      className: "bg-line/60 text-ink",
      hint: "Worked out from the text — check it before importing.",
    };
  }
  return {
    label: "Your choice",
    className: "bg-brass-soft text-brass-dark",
    hint: "Set by you just now. Save the mapping to reuse it next time.",
  };
}

function guessAccountId(csvName: string, accounts: ImportAccountOption[]): number | undefined {
  const lower = csvName.toLowerCase();
  const exact = accounts.find((account) => account.name.toLowerCase() === lower);
  if (exact) return exact.id;
  const partial = accounts.find(
    (account) => account.name.toLowerCase().includes(lower) || lower.includes(account.name.toLowerCase()),
  );
  return partial?.id;
}

export function StockImportView({ accounts }: { accounts: ImportAccountOption[] }) {
  const router = useRouter();
  const [importType, setImportType] = useState<StockImportType>("Position");
  const [fileName, setFileName] = useState<string | undefined>(undefined);
  const [fileText, setFileText] = useState<string | undefined>(undefined);
  const [preview, setPreview] = useState<CsvPreview | undefined>(undefined);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [fieldOptions, setFieldOptions] = useState<FieldOptionsMap>({});
  const [namedMappings, setNamedMappings] = useState<NamedMapping[]>([]);
  const [selectedMappingId, setSelectedMappingId] = useState<number | undefined>(undefined);
  const [mappingName, setMappingName] = useState("");
  const [targetAccountId, setTargetAccountId] = useState<number>(UNASSIGNED_ACCOUNT_ID);
  const [accountStep, setAccountStep] = useState<
    | {
        csvAccountNames: string[];
        accounts: ImportAccountOption[];
        /** Matches the saved mapping supplied, `csvName -> accountId`. */
        remembered: Record<string, number>;
        /** Matches worked out from the text, which are only ever a suggestion. */
        guessed: Record<string, number>;
      }
    | undefined
  >(undefined);
  const [accountNameMapping, setAccountNameMapping] = useState<Record<string, number>>({});
  // What the applied named mapping remembers, kept raw until import time: the
  // saved matches can only be resolved against the accounts that exist now, and
  // those aren't fetched until the account step runs.
  const [savedAccountMatches, setSavedAccountMatches] = useState<AccountNameMapping>({});
  // Row indexes the user has removed from this file. Reset whenever the file or
  // type changes — an index only means something against one parse.
  const [excludedRows, setExcludedRows] = useState<Set<number>>(new Set());
  // Per-row Type, set by hand for a file that mixes ETFs and stocks. Keyed by row
  // index, so it resets with the file like the exclusions do.
  const [rowTypes, setRowTypes] = useState<Record<number, PositionType>>({});
  const [summary, setSummary] = useState<ImportSummary | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isBusy, setIsBusy] = useState(false);

  const fields = FIELDS_BY_TYPE[importType];
  const typeInfo = IMPORT_TYPES.find((entry) => entry.value === importType)!;

  /** Everything derived from a file or a type belongs to that pairing — drop it all together. */
  function resetPreviewState() {
    setPreview(undefined);
    setFileText(undefined);
    setFileName(undefined);
    setMapping({});
    setFieldOptions({});
    setNamedMappings([]);
    setSelectedMappingId(undefined);
    setMappingName("");
    setAccountStep(undefined);
    setAccountNameMapping({});
    setSavedAccountMatches({});
    setExcludedRows(new Set());
    setRowTypes({});
    setSummary(undefined);
    setError(undefined);
  }

  async function loadPreview(type: StockImportType, text: string, name: string) {
    setIsBusy(true);
    setError(undefined);
    setSummary(undefined);
    setAccountStep(undefined);
    try {
      const result = await previewCsvAction(type, text);
      if (!result.ok || !result.preview) {
        setError(result.error ?? "Failed to preview the CSV.");
        return;
      }
      setFileText(text);
      setFileName(name);
      setPreview(result.preview);
      // The saved mapping for this type wins over the header guess; the guess is
      // already filtered to fields this type understands.
      setMapping(result.currentMapping ?? result.preview.autoMapping);
      setNamedMappings(result.namedMappings ?? []);
      setSelectedMappingId(undefined);
      setMappingName("");
      setExcludedRows(new Set());
      setRowTypes({});
    } finally {
      setIsBusy(false);
    }
  }

  async function handleFile(file: File) {
    const text = await readFileAsText(file);
    await loadPreview(importType, text, file.name);
  }

  async function handleTypeChange(nextType: StockImportType) {
    setImportType(nextType);
    // A mapping is per-type: column 5 means "quantity" for positions and nothing
    // for performance. Re-preview the same file under the new type rather than
    // carrying a mapping across that can't apply.
    if (fileText && fileName) await loadPreview(nextType, fileText, fileName);
    else resetPreviewState();
  }

  /** Sets one per-column option, dropping it entirely when cleared to blank. */
  function updateFieldOption(
    columnIndex: number,
    option: "dateFormat" | "constantValue",
    value: string,
  ) {
    const key = String(columnIndex);
    setFieldOptions((current) => {
      const next = { ...current, [key]: { ...current[key], [option]: value } };
      // An options entry with nothing set is noise in the saved mapping.
      if (!next[key].dateFormat && !next[key].constantValue) delete next[key];
      return next;
    });
  }

  function updateMapping(columnIndex: number, field: string) {
    const key = String(columnIndex);
    setMapping((current) => {
      const next = { ...current };
      if (field === "") delete next[key];
      else next[key] = field;
      return next;
    });
    // The old field's options are meaningless under a new field.
    setFieldOptions((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function setRowType(rowIndex: number, type: PositionType) {
    setRowTypes((current) => ({ ...current, [rowIndex]: type }));
  }

  /** Stamps every row, so the common case is one click plus a few corrections. */
  function setAllRowTypes(type: PositionType) {
    const rowCount = preview?.rows.length ?? 0;
    setRowTypes(Object.fromEntries(Array.from({ length: rowCount }, (_, index) => [index, type])));
  }

  function toggleRowExcluded(rowIndex: number) {
    setExcludedRows((current) => {
      const next = new Set(current);
      if (next.has(rowIndex)) next.delete(rowIndex);
      else next.add(rowIndex);
      return next;
    });
  }

  function loadMapping(id: number) {
    const named = namedMappings.find((entry) => entry.id === id);
    if (!named) return;
    setMapping(named.columnMapping);
    setFieldOptions(named.fieldOptions);
    setSavedAccountMatches(named.accountNameMapping);
    setSelectedMappingId(named.id);
    setMappingName(named.name);
  }

  async function refreshMappings() {
    if (!fileText) return;
    const refreshed = await previewCsvAction(importType, fileText);
    if (refreshed.ok) setNamedMappings(refreshed.namedMappings ?? []);
  }

  async function handleSaveMapping(asNew: boolean) {
    const name = mappingName.trim();
    if (name === "") return;
    setError(undefined);
    const result = await saveNamedMappingAction(
      asNew ? undefined : selectedMappingId,
      name,
      importType,
      mapping,
      fieldOptions,
      accountNameMapping,
    );
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await refreshMappings();
  }

  async function handleDeleteMapping(id: number) {
    const result = await deleteNamedMappingAction(id);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (id === selectedMappingId) setSelectedMappingId(undefined);
    setNamedMappings((current) => current.filter((entry) => entry.id !== id));
  }

  async function runImport(resolvedAccountNameMapping: Record<string, number>) {
    if (!fileText) return;
    setIsBusy(true);
    setError(undefined);
    try {
      const result = await executeImportAction(
        importType,
        fileText,
        mapping,
        fieldOptions,
        targetAccountId,
        resolvedAccountNameMapping,
        [...excludedRows],
        rowValueOverrides,
      );
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSummary(result.summary);
      setAccountStep(undefined);
      router.refresh();
    } finally {
      setIsBusy(false);
    }
  }

  async function handleImportClick() {
    if (!fileText) return;
    setError(undefined);

    // Performance rows can name their own account. Resolve those names to real
    // accounts before writing anything, rather than guessing silently.
    const accountNameIsMapped = Object.values(mapping).includes("accountName");
    if (importType === "Performance" && accountNameIsMapped && !accountStep) {
      setIsBusy(true);
      try {
        const result = await previewAccountNamesAction(fileText, mapping, savedAccountMatches);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        const csvAccountNames = result.csvAccountNames ?? [];
        const csvAccounts = result.accounts ?? [];
        const remembered = result.remembered ?? {};
        if (csvAccountNames.length > 0 && csvAccounts.length > 0) {
          // Every label is preselected but nothing is decided: the step always
          // shows, so what the app worked out is on screen and adjustable before
          // any row is written. Auto-importing on a confident guess would put
          // money against the wrong account without anyone having seen it.
          const guessed: Record<string, number> = {};
          const preselect: Record<string, number> = {};
          for (const csvName of csvAccountNames) {
            const guess = guessAccountId(csvName, csvAccounts);
            if (guess !== undefined) guessed[csvName] = guess;
            // A remembered match wins: it's what you chose last time for this
            // broker, where the guess is only ever a heuristic on the text.
            const resolved = remembered[csvName] ?? guess;
            if (resolved !== undefined) preselect[csvName] = resolved;
          }

          setAccountStep({ csvAccountNames, accounts: csvAccounts, remembered, guessed });
          setAccountNameMapping(preselect);
          return; // wait for the user to confirm the account matches below
        }
      } finally {
        setIsBusy(false);
      }
    }

    await runImport(accountNameMapping);
  }

  const mappedFieldCount = Object.keys(mapping).length;
  const rowsToImport = (preview?.totalRows ?? 0) - excludedRows.size;

  // The per-row Type column only makes sense for a positions import.
  const showTypeColumn = importType === "Position";

  /**
   * What a row's Type would be with nothing set by hand — resolved by the same lib
   * function the importer uses, so the dropdown shows what would actually be stored
   * rather than a guess that could drift from it.
   */
  const constants = constantValuesByField(mapping, fieldOptions);
  function resolvedTypeFor(row: string[]): PositionType {
    return resolvePositionType({ ...mapRow(row, mapping), ...constants });
  }

  /** Per-row values for the importer: only Type today, and only where it was set. */
  const rowValueOverrides: Record<number, Record<string, string>> = Object.fromEntries(
    Object.entries(rowTypes).map(([rowIndex, type]) => [rowIndex, { type }]),
  );

  /** Which fields are pinned to a literal, for the confirmation banner. */
  const fixedValueSummary = Object.entries(mapping)
    .map(([columnIndex, field]) => ({
      label: fields.find((entry) => entry.value === field)?.label ?? field,
      value: fieldOptions[columnIndex]?.constantValue?.trim() ?? "",
    }))
    .filter((entry) => entry.value !== "");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 rounded-xl border border-line p-4">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">What kind of file is this?</span>
          <select
            value={importType}
            onChange={(event) => handleTypeChange(event.target.value as StockImportType)}
            disabled={isBusy}
            className={INPUT_CLASS}
          >
            {IMPORT_TYPES.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        <p className="text-sm text-muted">{typeInfo.blurb}</p>
      </div>

      <FileDropzone
        onFile={handleFile}
        accept=".csv"
        disabled={isBusy}
        label={
          fileName
            ? `${fileName} — drop another CSV to replace it`
            : "Drag a broker CSV here, or click to browse"
        }
      />

      {error && <p className="text-sm text-red-400">{error}</p>}

      {preview && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">
            {preview.totalRows} row(s) found, {mappedFieldCount} column(s) mapped — set the rest to
            Ignore and they&apos;re skipped. Use <span className="text-ink">&times;</span> on a row to
            leave it out of the import.
          </p>

          <div className="flex flex-wrap items-end gap-3">
            {importType === "Position" && (
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-ink">Import into account</span>
                <select
                  value={targetAccountId}
                  onChange={(event) => setTargetAccountId(Number(event.target.value))}
                  className={INPUT_CLASS}
                >
                  <option value={UNASSIGNED_ACCOUNT_ID}>Unassigned</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {namedMappings.length > 0 && (
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-ink">Saved mapping</span>
                <select
                  value={selectedMappingId ?? ""}
                  onChange={(event) => event.target.value && loadMapping(Number(event.target.value))}
                  className={INPUT_CLASS}
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
          </div>

          <CsvMappingTable
            className="max-h-[32rem]"
            headers={preview.headers}
            // Every row, not the random sample: you cannot remove a row you cannot see.
            sampleRows={preview.rows}
            excludedRowIndexes={excludedRows}
            onToggleRowExcluded={toggleRowExcluded}
            rowNumberHeader="Row"
            extraColumn={
              showTypeColumn
                ? {
                    header: "Type",
                    // Bulk-set first, then correct the odd row — faster than
                    // touching all 34 dropdowns on a file that's mostly one kind.
                    renderHeaderControl: () => (
                      <select
                        value=""
                        onChange={(event) => {
                          if (event.target.value) setAllRowTypes(event.target.value as PositionType);
                        }}
                        aria-label="Set every row's type"
                        className={SMALL_SELECT_CLASS}
                      >
                        <option value="">Set all…</option>
                        {POSITION_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {type}
                          </option>
                        ))}
                      </select>
                    ),
                    renderCell: (rowIndex, row) => (
                      <select
                        value={rowTypes[rowIndex] ?? resolvedTypeFor(row)}
                        onChange={(event) =>
                          setRowType(rowIndex, event.target.value as PositionType)
                        }
                        aria-label={`Type for row ${rowIndex + 1}`}
                        className={SMALL_SELECT_CLASS}
                      >
                        {POSITION_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {type}
                          </option>
                        ))}
                      </select>
                    ),
                  }
                : undefined
            }
            fields={fields}
            mapping={mapping}
            onMappingChange={updateMapping}
            renderFieldOptions={(index, field) => {
              // Nothing to configure on an ignored column.
              if (field === "") return null;
              return (
                <div className="flex flex-col gap-1">
                  {DATE_FIELDS.has(field) && (
                    <input
                      value={fieldOptions[String(index)]?.dateFormat ?? ""}
                      onChange={(event) => updateFieldOption(index, "dateFormat", event.target.value)}
                      placeholder="MM/DD/YYYY"
                      aria-label="Date format"
                      className={CSV_MAPPING_OPTION_INPUT_CLASS}
                    />
                  )}
                  <input
                    value={fieldOptions[String(index)]?.constantValue ?? ""}
                    onChange={(event) => updateFieldOption(index, "constantValue", event.target.value)}
                    placeholder="= fixed value"
                    aria-label={`Fixed value for ${field}`}
                    title="Type a value here to use it for every row, ignoring this column's cells"
                    className={CSV_MAPPING_OPTION_INPUT_CLASS}
                  />
                </div>
              );
            }}
          />

          {fixedValueSummary.length > 0 && (
            <div className="rounded-md border border-brass bg-brass-soft p-3 text-sm text-brass-dark">
              <span className="font-medium">Fixed for every row:</span>{" "}
              {fixedValueSummary.map((entry) => `${entry.label} = "${entry.value}"`).join(" · ")}
              <span className="text-xs"> — these columns&apos; own cells are ignored.</span>
            </div>
          )}

          <div className="flex flex-wrap items-end gap-2">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-ink">Mapping name</span>
              <input
                value={mappingName}
                onChange={(event) => setMappingName(event.target.value)}
                placeholder="e.g. Chase Positions"
                className={INPUT_CLASS}
              />
            </label>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => handleSaveMapping(true)}
              disabled={mappingName.trim() === ""}
            >
              Save as new
            </Button>
            {selectedMappingId !== undefined && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => handleSaveMapping(false)}
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

          {accountStep && (
            <div className="rounded-md border border-line bg-paper p-3">
              <p className="text-sm font-medium text-ink">Match CSV account names to your accounts</p>
              <p className="mb-3 mt-1 text-xs text-muted">
                Every name in the file is listed with what this import will do with it. Nothing is
                written until you confirm, and each row can be changed &mdash; including to{" "}
                <span className="text-ink">Skip this name</span>, which leaves those rows out.
              </p>
              <div className="flex flex-col gap-2">
                {accountStep.csvAccountNames.map((csvName) => {
                  const chosen = accountNameMapping[csvName];
                  const source = accountMatchSource(csvName, chosen, accountStep);
                  return (
                    <div key={csvName} className="flex items-center gap-2 text-sm">
                      <span className="flex-1 truncate font-mono text-xs text-ink" title={csvName}>
                        {csvName}
                      </span>
                      <span className="text-muted">&rarr;</span>
                      <select
                        value={chosen ?? ""}
                        onChange={(event) =>
                          setAccountNameMapping((current) => {
                            const next = { ...current };
                            // "" is a real choice — leave the name out entirely —
                            // so it deletes the entry rather than storing NaN.
                            if (event.target.value === "") delete next[csvName];
                            else next[csvName] = Number(event.target.value);
                            return next;
                          })
                        }
                        className="flex-1 rounded-md border border-line bg-paper px-2 py-1 text-sm text-ink"
                      >
                        <option value="">Skip this name</option>
                        {accountStep.accounts.map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.name}
                          </option>
                        ))}
                      </select>
                      <span
                        title={source.hint}
                        className={`w-28 shrink-0 rounded px-1.5 py-0.5 text-center text-xs font-medium ${source.className}`}
                      >
                        {source.label}
                      </span>
                    </div>
                  );
                })}
              </div>
              {/* Skipping is a legitimate choice, but it silently drops rows, so
                  say how many names it applies to before the button is pressed. */}
              {accountStep.csvAccountNames.some((csvName) => accountNameMapping[csvName] === undefined) && (
                <p className="mt-3 text-xs text-muted">
                  {accountStep.csvAccountNames.filter((csvName) => accountNameMapping[csvName] === undefined).length}{" "}
                  of {accountStep.csvAccountNames.length} name(s) are set to skip — rows naming them
                  will not be imported.
                </p>
              )}
              <Button className="mt-3" onClick={() => runImport(accountNameMapping)} disabled={isBusy}>
                {isBusy ? "Importing…" : "Confirm & Import"}
              </Button>
            </div>
          )}

          {excludedRows.size > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-paper p-3 text-sm">
              <span className="text-ink">
                {excludedRows.size} row(s) removed — {rowsToImport} will be imported.
              </span>
              <button
                type="button"
                onClick={() => setExcludedRows(new Set())}
                className="text-xs font-medium text-brass-dark hover:underline"
              >
                Restore all
              </button>
            </div>
          )}

          {!accountStep && (
            <div>
              <Button
                onClick={handleImportClick}
                disabled={isBusy || mappedFieldCount === 0 || rowsToImport === 0}
              >
                {isBusy ? "Importing…" : `Import ${rowsToImport} row(s)`}
              </Button>
            </div>
          )}

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
