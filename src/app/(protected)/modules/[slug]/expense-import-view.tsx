"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { CSV_MAPPING_OPTION_INPUT_CLASS, CsvMappingTable } from "@/components/csv-mapping-table";
import { FileDropzone } from "@/components/file-dropzone";
import type { ColumnMapping, CsvPreview, FieldOptionsMap, NamedMapping } from "@/lib/csv-import";
import { EXPENSE_IMPORT_FIELDS, type CreditCardAccount, type ExpenseImportSummary } from "@/lib/expense";
import {
  deleteExpenseMappingAction,
  previewExpenseCsvAction,
  runExpenseImportAction,
  saveExpenseMappingAction,
} from "./expense-actions";

const INPUT_CLASS =
  "rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";
/** Fields whose column needs a date format. */
const DATE_FIELDS = new Set(["transactionDate", "postingDate"]);

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read the file."));
    reader.readAsText(file);
  });
}

export function ExpenseImportView({
  accounts,
  namedMappings: initialMappings,
}: {
  accounts: CreditCardAccount[];
  namedMappings: NamedMapping[];
}) {
  const router = useRouter();
  const [fileText, setFileText] = useState<string | undefined>(undefined);
  const [preview, setPreview] = useState<CsvPreview | undefined>(undefined);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [fieldOptions, setFieldOptions] = useState<FieldOptionsMap>({});
  const [namedMappings, setNamedMappings] = useState<NamedMapping[]>(initialMappings);
  const [selectedMappingId, setSelectedMappingId] = useState<number | undefined>(undefined);
  const [mappingName, setMappingName] = useState("");
  const [accountId, setAccountId] = useState<number>(accounts[0]?.id ?? 0);
  const [invertAmounts, setInvertAmounts] = useState(false);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [applyRules, setApplyRules] = useState(true);
  const [summary, setSummary] = useState<ExpenseImportSummary | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isBusy, setIsBusy] = useState(false);

  async function handleFile(file: File) {
    setIsBusy(true);
    setError(undefined);
    setSummary(undefined);
    try {
      const text = await readFileAsText(file);
      const result = await previewExpenseCsvAction(text);
      if (!result.ok || !result.preview) {
        setError(result.error ?? "Failed to preview the CSV.");
        return;
      }
      setFileText(text);
      setPreview(result.preview);
      setNamedMappings(result.namedMappings ?? []);
      setMapping({});
      setFieldOptions({});
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
    setFieldOptions((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function loadMapping(id: number) {
    const named = namedMappings.find((entry) => entry.id === id);
    if (!named) return;
    setMapping(named.columnMapping);
    setFieldOptions(named.fieldOptions);
    setSelectedMappingId(named.id);
    setMappingName(named.name);
  }

  async function refreshMappings() {
    const refreshed = await previewExpenseCsvAction(fileText ?? "");
    if (refreshed.ok) setNamedMappings(refreshed.namedMappings ?? []);
  }

  async function handleSaveMapping(asNew: boolean) {
    const name = mappingName.trim();
    if (name === "") return;
    setError(undefined);
    const result = await saveExpenseMappingAction(
      asNew ? undefined : selectedMappingId,
      name,
      mapping,
      fieldOptions,
    );
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await refreshMappings();
  }

  async function handleImport() {
    if (!fileText) return;
    if (accountId === 0) {
      setError("Add a credit-card account first, then choose it here.");
      return;
    }
    setIsBusy(true);
    setError(undefined);
    try {
      const result = await runExpenseImportAction(fileText, mapping, fieldOptions, {
        transactionAccountId: accountId,
        invertAmounts,
        skipDuplicates,
        applyRules,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSummary(result.summary);
      router.refresh();
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        Each card company formats its export differently, so map the columns once and save it under
        that company&apos;s name — next time, just pick it from the dropdown.
      </p>

      <FileDropzone
        onFile={handleFile}
        accept=".csv"
        disabled={isBusy}
        label="Drag a statement CSV here, or click to browse"
      />

      {error && <p className="text-sm text-red-400">{error}</p>}

      {preview && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">
            {preview.totalRows} row(s) found. {preview.sampleRows.length} random sample row(s) shown
            to help you map the columns.
          </p>

          <div className="flex flex-wrap items-end gap-3">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-ink">Import into card</span>
              <select
                value={accountId}
                onChange={(event) => setAccountId(Number(event.target.value))}
                className={INPUT_CLASS}
              >
                {accounts.length === 0 && <option value={0}>No accounts yet</option>}
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>

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
            headers={preview.headers}
            sampleRows={preview.sampleRows}
            fields={EXPENSE_IMPORT_FIELDS}
            mapping={mapping}
            onMappingChange={updateMapping}
            renderFieldOptions={(index, field) =>
              DATE_FIELDS.has(field) ? (
                <input
                  value={fieldOptions[String(index)]?.dateFormat ?? ""}
                  onChange={(event) =>
                    setFieldOptions((current) => ({
                      ...current,
                      [String(index)]: {
                        ...current[String(index)],
                        dateFormat: event.target.value,
                      },
                    }))
                  }
                  placeholder="MM/DD/YYYY"
                  aria-label="Date format"
                  className={CSV_MAPPING_OPTION_INPUT_CLASS}
                />
              ) : null
            }
          />

          <div className="flex flex-col gap-2 rounded-md border border-line bg-paper p-3 text-sm">
            <label className="flex items-center gap-2 text-ink">
              <input
                type="checkbox"
                checked={invertAmounts}
                onChange={(event) => setInvertAmounts(event.target.checked)}
              />
              Flip the sign of every amount
              <span className="text-xs text-muted">
                — tick this if your statement writes purchases as negative
              </span>
            </label>
            <label className="flex items-center gap-2 text-ink">
              <input
                type="checkbox"
                checked={skipDuplicates}
                onChange={(event) => setSkipDuplicates(event.target.checked)}
              />
              Skip rows already imported
              <span className="text-xs text-muted">— same card, date, description and amount</span>
            </label>
            <label className="flex items-center gap-2 text-ink">
              <input
                type="checkbox"
                checked={applyRules}
                onChange={(event) => setApplyRules(event.target.checked)}
              />
              Auto-categorise using the rules
            </label>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-ink">Mapping name</span>
              <input
                value={mappingName}
                onChange={(event) => setMappingName(event.target.value)}
                placeholder="e.g. Chase Sapphire"
                className={INPUT_CLASS}
              />
            </label>
            <Button size="sm" variant="secondary" onClick={() => handleSaveMapping(true)} disabled={mappingName.trim() === ""}>
              Save as new
            </Button>
            {selectedMappingId !== undefined && (
              <Button size="sm" variant="secondary" onClick={() => handleSaveMapping(false)} disabled={mappingName.trim() === ""}>
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
                    onClick={async () => {
                      const result = await deleteExpenseMappingAction(entry.id);
                      if (result.ok) {
                        if (entry.id === selectedMappingId) setSelectedMappingId(undefined);
                        setNamedMappings((current) => current.filter((m) => m.id !== entry.id));
                      } else setError(result.error);
                    }}
                    aria-label={`Delete ${entry.name}`}
                    className="text-muted hover:text-red-400"
                  >
                    &times;
                  </button>
                </span>
              ))}
            </div>
          )}

          <div>
            <Button onClick={handleImport} disabled={isBusy}>
              {isBusy ? "Importing…" : "Import"}
            </Button>
          </div>

          {summary && (
            <div className="rounded-md border border-line bg-paper p-3 text-sm">
              <p className="font-medium text-ink">
                Imported {summary.importedCount}, skipped {summary.skippedCount} (
                {summary.duplicateCount} already imported), auto-categorised{" "}
                {summary.categorisedCount}.
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
