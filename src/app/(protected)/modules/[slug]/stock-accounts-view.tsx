"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { ChartLine } from "@/components/chart-line";
import { CollapsibleCard } from "@/components/collapsible-card";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import type { InvestmentAccount, PerformanceRecord } from "@/lib/investment-accounts";
import { centsToDollars, formatCents } from "@/lib/shared/money";
import {
  addPerformanceRecordAction,
  createAccountAction,
  deleteAccountAction,
  deletePerformanceRecordAction,
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
    { key: "name", header: "Name", render: (entry) => entry.account.name },
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
      key: "actions",
      header: "Actions",
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
