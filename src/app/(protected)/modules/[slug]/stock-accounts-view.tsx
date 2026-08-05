"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { ChartLine } from "@/components/chart-line";
import { CollapsibleCard } from "@/components/collapsible-card";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import type { InvestmentAccount, PerformanceRecord } from "@/lib/investment-accounts";
import { IMAGE_UPLOAD_MIME_TYPES } from "@/lib/shared/image-upload";
import { centsToDollars, formatCents } from "@/lib/shared/money";
import {
  addPerformanceRecordAction,
  clearAccountIconAction,
  createAccountAction,
  deleteAccountAction,
  deletePerformanceRecordAction,
  saveAccountIconAction,
  updateAccountAction,
  type AccountFormInput,
  type PerformanceRecordFormInput,
} from "./investment-accounts-actions";

export interface AccountEntry {
  account: InvestmentAccount;
  history: PerformanceRecord[];
}

const EMPTY_ACCOUNT_FORM: AccountFormInput = { name: "", description: "", initialValue: "" };
const EMPTY_RECORD_FORM: PerformanceRecordFormInput = { recordDate: "", totalValue: "", note: "" };

/** Reads a File as bare base64 (no data-URL prefix), which is what the action wants. */
function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read the image."));
    reader.readAsDataURL(file);
  });
}

/**
 * The account's icon, or its initial in a tile when it has none. `updatedAt` is
 * the cache-buster: the route sends a 5-minute max-age, so without it a replaced
 * icon would keep showing the old bytes.
 */
export function AccountIconImage({
  account,
  size = 24,
}: {
  // Only what's needed to render, so the Positions view can pass its lighter
  // account option rather than a whole InvestmentAccount.
  account: { id: number; name: string; iconMimeType?: string; updatedAt?: string };
  size?: number;
}) {
  if (!account.iconMimeType) {
    return (
      <span
        aria-hidden
        style={{ width: size, height: size }}
        className="flex shrink-0 items-center justify-center rounded-md bg-brass-soft text-xs font-medium text-brass-dark"
      >
        {account.name.trim().charAt(0).toUpperCase() || "?"}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- DB-backed route, not a static asset next/image can optimize.
    <img
      src={`/api/stocks/accounts/${account.id}/icon?v=${encodeURIComponent(account.updatedAt ?? "")}`}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      className="shrink-0 rounded-md object-contain"
      style={{ width: size, height: size }}
    />
  );
}

/** Upload / replace / remove the icon that distinguishes this account. */
function AccountIconControls({
  account,
  onError,
}: {
  account: InvestmentAccount;
  onError: (message: string | undefined) => void;
}) {
  const router = useRouter();
  const [isBusy, setIsBusy] = useState(false);

  async function handleFile(file: File) {
    onError(undefined);
    setIsBusy(true);
    try {
      const base64Data = await readFileAsBase64(file);
      const result = await saveAccountIconAction(account.id, file.type, base64Data);
      if (!result.ok) onError(result.error);
      else router.refresh();
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <label className="cursor-pointer text-xs font-medium text-brass-dark hover:underline">
        {account.iconMimeType ? "Replace icon" : "Add icon"}
        <input
          type="file"
          accept={IMAGE_UPLOAD_MIME_TYPES.join(",")}
          disabled={isBusy}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) handleFile(file);
            // Clear it, or picking the same file twice in a row fires no change event.
            event.target.value = "";
          }}
        />
      </label>
      {account.iconMimeType && (
        <button
          type="button"
          disabled={isBusy}
          onClick={async () => {
            onError(undefined);
            const result = await clearAccountIconAction(account.id);
            if (result.ok) router.refresh();
            else onError(result.error);
          }}
          className="text-xs text-muted hover:text-red-400"
        >
          Remove
        </button>
      )}
    </span>
  );
}

function toAccountFormInput(account: InvestmentAccount): AccountFormInput {
  return {
    name: account.name,
    description: account.description,
    initialValue: centsToDollars(account.initialValueCents).toFixed(2),
  };
}

function AccountForm({
  title,
  initialValue,
  onSave,
  onCancel,
}: {
  title: string;
  initialValue: AccountFormInput;
  onSave: (input: AccountFormInput) => Promise<string | undefined>;
  onCancel?: () => void;
}) {
  const [form, setForm] = useState(initialValue);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(undefined);
    try {
      const failure = await onSave(form);
      if (failure) {
        setError(failure);
        return;
      }
      setForm(EMPTY_ACCOUNT_FORM);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Name</span>
        <input
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
          className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Initial value ($)</span>
        <input
          value={form.initialValue}
          onChange={(event) => setForm({ ...form, initialValue: event.target.value })}
          className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        />
      </label>
      <label className="block text-sm sm:col-span-2">
        <span className="mb-1 block font-medium text-ink">Description</span>
        <input
          value={form.description}
          onChange={(event) => setForm({ ...form, description: event.target.value })}
          className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        />
      </label>
      {error && <p className="text-sm text-red-400 sm:col-span-2">{error}</p>}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" disabled={isSaving}>
          {isSaving ? "Saving…" : title}
        </Button>
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

function PerformanceRecordForm({
  onSave,
}: {
  onSave: (input: PerformanceRecordFormInput) => Promise<string | undefined>;
}) {
  const [form, setForm] = useState(EMPTY_RECORD_FORM);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(undefined);
    try {
      const failure = await onSave(form);
      if (failure) {
        setError(failure);
        return;
      }
      setForm(EMPTY_RECORD_FORM);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Date</span>
        <input
          type="date"
          value={form.recordDate}
          onChange={(event) => setForm({ ...form, recordDate: event.target.value })}
          className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Total value ($)</span>
        <input
          value={form.totalValue}
          onChange={(event) => setForm({ ...form, totalValue: event.target.value })}
          className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Note</span>
        <input
          value={form.note}
          onChange={(event) => setForm({ ...form, note: event.target.value })}
          className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        />
      </label>
      {error && <p className="text-sm text-red-400 sm:col-span-3">{error}</p>}
      <div className="sm:col-span-3">
        <Button type="submit" disabled={isSaving}>
          {isSaving ? "Saving…" : "Add record"}
        </Button>
      </div>
    </form>
  );
}

function AccountHistory({ entry }: { entry: AccountEntry }) {
  const router = useRouter();

  async function handleDeleteRecord(recordId: number) {
    if (!window.confirm("Delete this performance record?")) return;
    const result = await deletePerformanceRecordAction(recordId);
    if (result.ok) router.refresh();
    else window.alert(result.error);
  }

  async function handleAddRecord(input: PerformanceRecordFormInput) {
    const result = await addPerformanceRecordAction(entry.account.id, input);
    if (!result.ok) return result.error ?? "Failed to add performance record.";
    router.refresh();
    return undefined;
  }

  const columns: DataGridColumn<PerformanceRecord>[] = [
    { key: "recordDate", header: "Date", render: (record) => record.recordDate },
    { key: "totalValue", header: "Total Value", render: (record) => formatCents(record.totalValueCents) },
    { key: "note", header: "Note", render: (record) => <span className="text-muted">{record.note || "—"}</span> },
    {
      key: "actions",
      header: "Actions",
      excludeFromRecordView: true,
      render: (record) => (
        <button
          type="button"
          onClick={() => handleDeleteRecord(record.id)}
          className="text-xs font-medium text-red-400 hover:underline"
        >
          Delete
        </button>
      ),
    },
  ];

  return (
    <div className="mt-4 flex flex-col gap-4">
      {entry.history.length >= 2 && (
        <ChartLine
          data={entry.history.map((record) => ({
            date: record.recordDate,
            value: centsToDollars(record.totalValueCents),
          }))}
          series={[{ key: "value", label: entry.account.name }]}
          xKey="date"
          formatValue={(value) => formatCents(Math.round(value * 100))}
        />
      )}
      <PerformanceRecordForm onSave={handleAddRecord} />
      <DataGrid columns={columns} rows={entry.history} getRowKey={(record) => record.id} emptyMessage="No performance records yet." />
    </div>
  );
}

export function StockAccountsView({ entries }: { entries: AccountEntry[] }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<number | undefined>(undefined);
  const [expandedId, setExpandedId] = useState<number | undefined>(undefined);
  // Icon upload failures surface here rather than in a per-row alert: the file
  // picker is in a grid cell, and an alert() would interrupt a bulk tidy-up.
  const [error, setError] = useState<string | undefined>(undefined);

  async function handleCreate(input: AccountFormInput) {
    const result = await createAccountAction(input);
    if (!result.ok) return result.error ?? "Failed to add account.";
    router.refresh();
    return undefined;
  }

  async function handleUpdate(accountId: number, input: AccountFormInput) {
    const result = await updateAccountAction(accountId, input);
    if (!result.ok) return result.error ?? "Failed to update account.";
    setEditingId(undefined);
    router.refresh();
    return undefined;
  }

  async function handleDelete(account: InvestmentAccount) {
    if (!window.confirm(`Delete "${account.name}"? This removes its performance history too.`)) return;
    const result = await deleteAccountAction(account.id);
    if (result.ok) router.refresh();
    else window.alert(result.error);
  }

  const columns: DataGridColumn<AccountEntry>[] = [
    {
      key: "name",
      header: "Name",
      value: (entry) => entry.account.name,
      render: (entry) => (
        <span className="flex items-center gap-2">
          <AccountIconImage account={entry.account} size={20} />
          {entry.account.name}
        </span>
      ),
    },
    {
      key: "description",
      header: "Description",
      render: (entry) => <span className="text-muted">{entry.account.description || "—"}</span>,
    },
    {
      key: "initialValue",
      header: "Initial Value",
      render: (entry) => formatCents(entry.account.initialValueCents),
    },
    {
      key: "lastValue",
      header: "Last Value",
      render: (entry) =>
        entry.account.lastValueCents !== undefined ? formatCents(entry.account.lastValueCents) : "—",
    },
    {
      key: "lastUpdated",
      header: "Last Updated",
      render: (entry) => entry.account.lastUpdatedAt ?? "—",
    },
    {
      key: "icon",
      header: "Icon",
      excludeFromRecordView: true,
      render: (entry) => <AccountIconControls account={entry.account} onError={setError} />,
    },
    {
      key: "actions",
      header: "Actions",
      excludeFromRecordView: true,
      render: (entry) => (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setExpandedId((current) => (current === entry.account.id ? undefined : entry.account.id))}
            className="text-xs font-medium text-brass-dark hover:underline"
          >
            {expandedId === entry.account.id ? "Hide History" : "History"}
          </button>
          <button
            type="button"
            onClick={() => setEditingId(entry.account.id)}
            className="text-xs font-medium text-brass-dark hover:underline"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => handleDelete(entry.account)}
            className="text-xs font-medium text-red-400 hover:underline"
          >
            Delete
          </button>
        </div>
      ),
    },
  ];

  const editingEntry = entries.find((entry) => entry.account.id === editingId);
  const expandedEntry = entries.find((entry) => entry.account.id === expandedId);

  return (
    <div>
      <h2 className="font-display text-xl text-ink">Accounts</h2>

      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}

      <div className="mt-4">
        <CollapsibleCard title="Add Account">
          <AccountForm title="Add account" initialValue={EMPTY_ACCOUNT_FORM} onSave={handleCreate} />
        </CollapsibleCard>
      </div>

      {editingEntry && (
        <div className="mt-4">
          <CollapsibleCard title={`Edit: ${editingEntry.account.name}`} defaultOpen>
            <AccountForm
              title="Save changes"
              initialValue={toAccountFormInput(editingEntry.account)}
              onSave={(input) => handleUpdate(editingEntry.account.id, input)}
              onCancel={() => setEditingId(undefined)}
            />
          </CollapsibleCard>
        </div>
      )}

      <div className="mt-4">
        <DataGrid columns={columns} rows={entries} getRowKey={(entry) => entry.account.id} emptyMessage="No accounts yet." />
      </div>

      {expandedEntry && (
        <div className="mt-2">
          <p className="text-sm font-medium text-ink">History for {expandedEntry.account.name}</p>
          <AccountHistory entry={expandedEntry} />
        </div>
      )}
    </div>
  );
}
