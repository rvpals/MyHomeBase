"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import {
  TRANSACTION_STATUSES,
  parseMoneyToCents,
  type CreditCardAccount,
  type ExpenseCategory,
  type ExpenseTransaction,
  type TransactionStatus,
} from "@/lib/expense";
import { deleteTransactionAction, saveTransactionAction } from "./expense-actions";
import { CardThumbnail, formatCents, todayIso } from "./expense-shared";

const INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

const emptyForm = (accountId: number) => ({
  transactionDate: todayIso(),
  postingDate: "",
  transactionAccountId: accountId,
  transactionDescription: "",
  categoryName: "",
  vendor: "",
  amountText: "",
  note: "",
  status: "new" as TransactionStatus,
});

function TransactionForm({
  accounts,
  categories,
  editing,
  onDone,
}: {
  accounts: CreditCardAccount[];
  categories: ExpenseCategory[];
  editing?: ExpenseTransaction;
  onDone: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState(() =>
    editing
      ? {
          transactionDate: editing.transactionDate,
          postingDate: editing.postingDate,
          transactionAccountId: editing.transactionAccountId,
          transactionDescription: editing.transactionDescription,
          categoryName: editing.categoryName,
          vendor: editing.vendor,
          amountText: (editing.amountCents / 100).toFixed(2),
          note: editing.note,
          status: editing.status,
        }
      : emptyForm(accounts[0]?.id ?? 0),
  );
  const [error, setError] = useState<string | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);

  function update<K extends keyof ReturnType<typeof emptyForm>>(
    field: K,
    value: ReturnType<typeof emptyForm>[K],
  ) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSave() {
    const amountCents = parseMoneyToCents(form.amountText);
    if (amountCents === undefined) {
      setError("Enter an amount, e.g. 20.33 (negative for a refund).");
      return;
    }
    setIsSaving(true);
    setError(undefined);
    try {
      const result = await saveTransactionAction(editing?.id, {
        transactionDate: form.transactionDate,
        postingDate: form.postingDate,
        transactionAccountId: form.transactionAccountId,
        transactionDescription: form.transactionDescription,
        categoryName: form.categoryName,
        vendor: form.vendor,
        amountCents,
        note: form.note,
        status: form.status,
        // Typed in by hand, so it hasn't been through the rules yet.
        processed: editing?.processed ?? false,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (!editing) setForm(emptyForm(form.transactionAccountId));
      onDone();
      router.refresh();
    } finally {
      setIsSaving(false);
    }
  }

  if (accounts.length === 0) {
    return (
      <p className="text-sm text-muted">
        Add a credit-card account under Meta Data first — every transaction belongs to one.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Transaction date</span>
          <input
            type="date"
            value={form.transactionDate}
            onChange={(event) => update("transactionDate", event.target.value)}
            className={INPUT_CLASS}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Posting date</span>
          <input
            type="date"
            value={form.postingDate}
            onChange={(event) => update("postingDate", event.target.value)}
            className={INPUT_CLASS}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Account</span>
          <select
            value={form.transactionAccountId}
            onChange={(event) => update("transactionAccountId", Number(event.target.value))}
            className={INPUT_CLASS}
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm sm:col-span-2">
          <span className="mb-1 block font-medium text-ink">Description</span>
          <input
            value={form.transactionDescription}
            onChange={(event) => update("transactionDescription", event.target.value)}
            placeholder="Vendor as it appears on the statement"
            className={INPUT_CLASS}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Amount</span>
          <input
            value={form.amountText}
            onChange={(event) => update("amountText", event.target.value)}
            placeholder="20.33"
            className={INPUT_CLASS}
          />
          <span className="mt-1 block text-xs text-muted">Negative for a refund or payment</span>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Vendor</span>
          <input
            value={form.vendor}
            onChange={(event) => update("vendor", event.target.value)}
            placeholder="Tidy name, e.g. TGI Friday"
            className={INPUT_CLASS}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Category</span>
          <input
            list="expense-category-options"
            value={form.categoryName}
            onChange={(event) => update("categoryName", event.target.value)}
            placeholder="Leave blank to categorise later"
            className={INPUT_CLASS}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Status</span>
          <select
            value={form.status}
            onChange={(event) => update("status", event.target.value as TransactionStatus)}
            className={INPUT_CLASS}
          >
            {TRANSACTION_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm sm:col-span-3">
          <span className="mb-1 block font-medium text-ink">Note</span>
          <input
            value={form.note}
            onChange={(event) => update("note", event.target.value)}
            className={INPUT_CLASS}
          />
        </label>
      </div>

      <datalist id="expense-category-options">
        {categories.map((category) => (
          <option key={category.name} value={category.name} />
        ))}
      </datalist>

      <div className="flex gap-2">
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? "Saving…" : editing ? "Save changes" : "Add transaction"}
        </Button>
        {editing && (
          <Button variant="secondary" onClick={onDone} disabled={isSaving}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

export function ExpenseTransactionsView({
  transactions,
  accounts,
  categories,
}: {
  transactions: ExpenseTransaction[];
  accounts: CreditCardAccount[];
  categories: ExpenseCategory[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<ExpenseTransaction | undefined>(undefined);

  const accountName = (id: number) => accounts.find((account) => account.id === id)?.name ?? "—";

  const columns: DataGridColumn<ExpenseTransaction>[] = [
    {
      key: "transactionDate",
      header: "Date",
      value: (row) => row.transactionDate,
      render: (row) => row.transactionDate,
    },
    {
      key: "postingDate",
      header: "Posted",
      value: (row) => row.postingDate,
      render: (row) => row.postingDate,
    },
    {
      key: "description",
      header: "Description",
      value: (row) => row.transactionDescription,
      render: (row) => row.transactionDescription,
    },
    { key: "vendor", header: "Vendor", value: (row) => row.vendor, render: (row) => row.vendor },
    {
      key: "category",
      header: "Category",
      value: (row) => row.categoryName,
      render: (row) =>
        row.categoryName === "" ? (
          <span className="text-muted">uncategorised</span>
        ) : (
          <span className="rounded-full bg-brass-soft px-2 py-0.5 text-xs font-semibold text-brass-dark">
            {row.categoryName}
          </span>
        ),
    },
    {
      key: "amount",
      header: "Amount",
      value: (row) => row.amountCents,
      render: (row) => (
        <span className={row.amountCents < 0 ? "text-emerald-400" : "text-ink"}>
          {formatCents(row.amountCents)}
        </span>
      ),
      className: "text-right",
    },
    { key: "status", header: "Status", value: (row) => row.status, render: (row) => row.status },
    {
      key: "processed",
      header: "Processed",
      value: (row) => (row.processed ? "yes" : "no"),
      render: (row) =>
        row.processed ? (
          <span className="text-muted">yes</span>
        ) : (
          <span className="text-brass-dark">no</span>
        ),
    },
    {
      key: "account",
      header: "Account",
      value: (row) => accountName(row.transactionAccountId),
      render: (row) => {
        const account = accounts.find((candidate) => candidate.id === row.transactionAccountId);
        return (
          <span className="flex items-center gap-2">
            {account && <CardThumbnail account={account} />}
            {accountName(row.transactionAccountId)}
          </span>
        );
      },
    },
    { key: "note", header: "Note", value: (row) => row.note, render: (row) => row.note },
    {
      key: "actions",
      header: "Actions",
      render: (row) => (
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setEditing(row)}
            className="text-xs font-medium text-brass-dark hover:underline"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={async () => {
              if (!window.confirm("Delete this transaction?")) return;
              const result = await deleteTransactionAction(row.id);
              if (result.ok) router.refresh();
              else window.alert(result.error);
            }}
            className="text-xs font-medium text-red-400 hover:underline"
          >
            Delete
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <CollapsibleCard
        title={editing ? `Edit transaction #${editing.id}` : "Add a transaction"}
        defaultOpen={Boolean(editing) || transactions.length === 0}
      >
        <TransactionForm
          key={editing?.id ?? "new"}
          accounts={accounts}
          categories={categories}
          editing={editing}
          onDone={() => setEditing(undefined)}
        />
      </CollapsibleCard>

      <div>
        <p className="mb-3 text-sm text-muted">
          {transactions.length} transaction(s). Use the search and filters to narrow the list.
        </p>
        <DataGrid
          columns={columns}
          rows={transactions}
          getRowKey={(row) => row.id}
          emptyMessage="No transactions yet. Add one above, or import a statement."
          enableExport
          exportFileName="expense-transactions"
          storageKey="expense-transactions"
        />
      </div>
    </div>
  );
}
