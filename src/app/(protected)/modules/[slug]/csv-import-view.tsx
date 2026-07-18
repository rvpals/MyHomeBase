"use client";

import { useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { CollapsibleCard } from "@/components/collapsible-card";
import type { ColumnMapping, CsvPreview, ImportSummary, ImportType, NamedMapping } from "@/lib/csv-import";
import {
  deleteNamedMappingAction,
  executeImportAction,
  previewAccountNamesAction,
  previewCsvAction,
  saveNamedMappingAction,
} from "./csv-import-actions";

interface FieldOption {
  value: string;
  label: string;
}

const POSITION_FIELDS: FieldOption[] = [
  { value: "ticker", label: "Ticker" },
  { value: "name", label: "Name" },
  { value: "type", label: "Type" },
  { value: "currentPrice", label: "Current Price" },
  { value: "quantity", label: "Quantity" },
];

const TRANSACTION_FIELDS: FieldOption[] = [
  { value: "date", label: "Date" },
  { value: "action", label: "Action (Buy/Sell)" },
  { value: "ticker", label: "Ticker" },
  { value: "numberOfShares", label: "Shares" },
  { value: "pricePerShare", label: "Price/Share" },
  { value: "note", label: "Note" },
];

const PERFORMANCE_FIELDS: FieldOption[] = [
  { value: "date", label: "Date" },
  { value: "accountName", label: "Account Name" },
  { value: "accountId", label: "Account ID" },
  { value: "totalValue", label: "Total Value" },
  { value: "note", label: "Note" },
];

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file."));
    reader.readAsText(file);
  });
}

function guessAccountId(csvName: string, accounts: { id: number; name: string }[]): number | undefined {
  const lower = csvName.toLowerCase();
  const exact = accounts.find((account) => account.name.toLowerCase() === lower);
  if (exact) return exact.id;
  const partial = accounts.find(
    (account) => account.name.toLowerCase().includes(lower) || lower.includes(account.name.toLowerCase()),
  );
  return partial?.id;
}

function CsvImportPanel({
  importType,
  fieldOptions,
}: {
  importType: ImportType;
  fieldOptions: FieldOption[];
}) {
  const router = useRouter();
  const [fileText, setFileText] = useState<string | undefined>(undefined);
  const [preview, setPreview] = useState<CsvPreview | undefined>(undefined);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [namedMappings, setNamedMappings] = useState<NamedMapping[]>([]);
  const [newMappingName, setNewMappingName] = useState("");
  const [accountStep, setAccountStep] = useState<
    { csvAccountNames: string[]; accounts: { id: number; name: string }[] } | undefined
  >(undefined);
  const [accountNameMapping, setAccountNameMapping] = useState<Record<string, number>>({});
  const [summary, setSummary] = useState<ImportSummary | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isBusy, setIsBusy] = useState(false);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsBusy(true);
    setError(undefined);
    setSummary(undefined);
    setAccountStep(undefined);
    try {
      const text = await readFileAsText(file);
      const result = await previewCsvAction(importType, text);
      if (!result.ok || !result.preview) {
        setError(result.error ?? "Failed to preview CSV.");
        return;
      }
      setFileText(text);
      setPreview(result.preview);
      setMapping(result.currentMapping ?? result.preview.autoMapping);
      setNamedMappings(result.namedMappings ?? []);
    } finally {
      setIsBusy(false);
      event.target.value = "";
    }
  }

  function updateMapping(columnIndex: number, fieldName: string) {
    setMapping((current) => {
      const next = { ...current };
      if (fieldName === "") delete next[String(columnIndex)];
      else next[String(columnIndex)] = fieldName;
      return next;
    });
  }

  function applyNamedMapping(id: number) {
    const named = namedMappings.find((entry) => entry.id === id);
    if (named) setMapping(named.columnMapping);
  }

  async function handleSaveNamedMapping() {
    const name = newMappingName.trim();
    if (name === "") return;
    const result = await saveNamedMappingAction(name, importType, mapping);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNewMappingName("");
    const refreshed = await previewCsvAction(importType, fileText ?? "");
    if (refreshed.ok) setNamedMappings(refreshed.namedMappings ?? []);
  }

  async function handleDeleteNamedMapping(id: number) {
    const result = await deleteNamedMappingAction(id);
    if (result.ok) setNamedMappings((current) => current.filter((entry) => entry.id !== id));
    else setError(result.error);
  }

  async function runImport(resolvedAccountNameMapping: Record<string, number>) {
    if (!fileText) return;
    setIsBusy(true);
    setError(undefined);
    try {
      const result = await executeImportAction(importType, fileText, mapping, resolvedAccountNameMapping);
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

    const accountNameIsMapped = Object.values(mapping).includes("accountName");
    if (importType === "Performance" && accountNameIsMapped && !accountStep) {
      setIsBusy(true);
      try {
        const result = await previewAccountNamesAction(fileText, mapping);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        const csvAccountNames = result.csvAccountNames ?? [];
        const accounts = result.accounts ?? [];
        if (csvAccountNames.length > 0 && accounts.length > 0) {
          const preselect: Record<string, number> = {};
          for (const csvName of csvAccountNames) {
            const guess = guessAccountId(csvName, accounts);
            if (guess !== undefined) preselect[csvName] = guess;
          }
          setAccountStep({ csvAccountNames, accounts });
          setAccountNameMapping(preselect);
          return; // wait for the user to confirm the account mapping below
        }
      } finally {
        setIsBusy(false);
      }
    }

    await runImport(accountNameMapping);
  }

  return (
    <div className="rounded-xl border border-line p-4">
      <input type="file" accept=".csv" onChange={handleFileChange} disabled={isBusy} className="text-sm" />

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      {preview && (
        <div className="mt-4 flex flex-col gap-4">
          <p className="text-sm text-muted">
            {preview.totalRows} data row(s) found. Map each column below (or leave it as "Ignore").
          </p>

          {namedMappings.length > 0 && (
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-ink">Load a saved mapping</span>
              <select
                onChange={(event) => event.target.value && applyNamedMapping(Number(event.target.value))}
                defaultValue=""
                className="w-full max-w-xs rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
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
                    <th key={header} className="px-3 py-2">
                      <select
                        value={mapping[String(index)] ?? ""}
                        onChange={(event) => updateMapping(index, event.target.value)}
                        className="w-full rounded-md border border-line bg-paper px-2 py-1 text-xs text-ink"
                      >
                        <option value="">Ignore</option>
                        {fieldOptions.map((field) => (
                          <option key={field.value} value={field.value}>
                            {field.label}
                          </option>
                        ))}
                      </select>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.previewRows.map((row, rowIndex) => (
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

          <div className="flex flex-wrap items-end gap-2">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-ink">Save this mapping as</span>
              <input
                value={newMappingName}
                onChange={(event) => setNewMappingName(event.target.value)}
                placeholder="e.g. Fidelity Export"
                className="rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
              />
            </label>
            <button
              type="button"
              onClick={handleSaveNamedMapping}
              disabled={newMappingName.trim() === ""}
              className="rounded-full border border-line px-3 py-1.5 text-xs font-medium text-brass-dark hover:bg-paper-raised disabled:opacity-50"
            >
              Save Mapping
            </button>
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
                      onClick={() => handleDeleteNamedMapping(entry.id)}
                      aria-label={`Delete ${entry.name}`}
                      className="text-muted hover:text-red-600"
                    >
                      &times;
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {accountStep && (
            <div className="rounded-md border border-line bg-paper p-3">
              <p className="mb-2 text-sm font-medium text-ink">Map CSV account names to your accounts</p>
              <div className="flex flex-col gap-2">
                {accountStep.csvAccountNames.map((csvName) => (
                  <div key={csvName} className="flex items-center gap-2 text-sm">
                    <span className="flex-1 font-medium text-ink">{csvName}</span>
                    <span className="text-muted">&rarr;</span>
                    <select
                      value={accountNameMapping[csvName] ?? ""}
                      onChange={(event) =>
                        setAccountNameMapping((current) => ({ ...current, [csvName]: Number(event.target.value) }))
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
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => runImport(accountNameMapping)}
                disabled={isBusy}
                className="mt-3 rounded-full bg-brass px-4 py-2 text-sm font-medium text-white hover:bg-brass-dark disabled:opacity-50"
              >
                {isBusy ? "Importing…" : "Confirm & Import"}
              </button>
            </div>
          )}

          {!accountStep && (
            <div>
              <button
                type="button"
                onClick={handleImportClick}
                disabled={isBusy}
                className="rounded-full bg-brass px-4 py-2 text-sm font-medium text-white hover:bg-brass-dark disabled:opacity-50"
              >
                {isBusy ? "Importing…" : "Import"}
              </button>
            </div>
          )}

          {summary && (
            <div className="rounded-md border border-line bg-paper p-3 text-sm">
              <p className="font-medium text-ink">
                Imported {summary.importedCount}, skipped {summary.skippedCount}.
              </p>
              {summary.skippedCount > 0 && (
                <ul className="mt-2 flex flex-col gap-1 text-xs text-muted">
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

export function CsvImportView() {
  return (
    <div>
      <h2 className="font-display text-xl text-ink">Import Data</h2>
      <p className="mt-1 text-sm text-muted">
        Import positions, transactions, or account performance records from a CSV export. Re-importing
        the same file is safe — transactions and performance records that already exist are skipped, not
        duplicated.
      </p>

      <div className="mt-4 flex flex-col gap-4">
        <CollapsibleCard title="Positions">
          <CsvImportPanel importType="Position" fieldOptions={POSITION_FIELDS} />
        </CollapsibleCard>
        <CollapsibleCard title="Transactions">
          <CsvImportPanel importType="Transaction" fieldOptions={TRANSACTION_FIELDS} />
        </CollapsibleCard>
        <CollapsibleCard title="Account Performance">
          <CsvImportPanel importType="Performance" fieldOptions={PERFORMANCE_FIELDS} />
        </CollapsibleCard>
      </div>
    </div>
  );
}
