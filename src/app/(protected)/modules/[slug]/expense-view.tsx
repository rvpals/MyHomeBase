"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import type { NamedMapping } from "@/lib/csv-import";
import {
  TRANSACTION_STATUSES,
  parseMoneyToCents,
  type CategoryRule,
  type CategoryTotal,
  type CreditCardAccount,
  type ExpenseCategory,
  type ExpenseTransaction,
  type TransactionStatus,
} from "@/lib/expense";
import { deleteTransactionAction, saveTransactionAction } from "./expense-actions";
import { ExpenseAccountsView } from "./expense-accounts-view";
import { ExpenseImportView } from "./expense-import-view";
import { ExpenseInstructions } from "./expense-instructions";
import { ExpenseRulesView } from "./expense-rules-view";

const INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

/**
 * The small card image, or nothing when the account has none. The bytes come
 * from the image route rather than the page payload; `updatedAt` is appended as
 * a cache-buster so a replaced image appears immediately.
 */
export function CardThumbnail({
  account,
  className = "",
}: {
  account: CreditCardAccount;
  className?: string;
}) {
  if (!account.imageMimeType) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- card image bytes are served from our own DB-backed route, not a static asset next/image can optimize.
    <img
      src={`/api/expense/accounts/${account.id}/image?v=${encodeURIComponent(account.updatedAt)}`}
      alt=""
      className={`h-6 w-9 shrink-0 rounded border border-line object-cover ${className}`}
    />
  );
}

/** Cents to a signed currency string, e.g. -4500 → "-$45.00". */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  return `${sign}$${(absolute / 100).toFixed(2)}`;
}

function todayIso(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const emptyForm = (accountId: number) => ({
  transactionDate: todayIso(),
  postingDate: "",
  transactionAccountId: accountId,
  transactionDescription: "",
  categoryName: "",
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
        amountCents,
        note: form.note,
        status: form.status,
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
        Add a credit-card account first — every transaction belongs to one.
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
        <label className="block text-sm">
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

export function ExpenseView({
  transactions,
  accounts,
  categories,
  rules,
  totals,
  namedMappings,
}: {
  transactions: ExpenseTransaction[];
  accounts: CreditCardAccount[];
  categories: ExpenseCategory[];
  rules: CategoryRule[];
  totals: CategoryTotal[];
  namedMappings: NamedMapping[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<ExpenseTransaction | undefined>(undefined);

  const accountName = (id: number) => accounts.find((account) => account.id === id)?.name ?? "—";

  const totalCents = transactions.reduce((sum, transaction) => sum + transaction.amountCents, 0);
  const uncategorisedCount = transactions.filter((t) => t.categoryName === "").length;
  const toReconcileCount = transactions.filter((t) => t.status === "new").length;

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
    <div className="flex flex-col gap-8">
      {/* CollapsibleCard is closed unless defaultOpen is set, so this starts collapsed. */}
      <CollapsibleCard title="Instruction">
        <ExpenseInstructions />
      </CollapsibleCard>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-line p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Total</p>
          <p className="font-display text-xl text-ink">{formatCents(totalCents)}</p>
        </div>
        <div className="rounded-xl border border-line p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Uncategorised</p>
          <p className="font-display text-xl text-ink">{uncategorisedCount}</p>
        </div>
        <div className="rounded-xl border border-line p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">To reconcile</p>
          <p className="font-display text-xl text-ink">{toReconcileCount}</p>
        </div>
      </section>

      <CollapsibleCard
        title={editing ? `Edit transaction #${editing.id}` : "Add a transaction"}
        defaultOpen={transactions.length === 0}
      >
        <TransactionForm
          key={editing?.id ?? "new"}
          accounts={accounts}
          categories={categories}
          editing={editing}
          onDone={() => setEditing(undefined)}
        />
      </CollapsibleCard>

      <section>
        <h2 className="font-display text-xl text-ink">Transactions</h2>
        <p className="mt-1 text-sm text-muted">
          {transactions.length} transaction(s). Use the search and filters to narrow the list.
        </p>
        <div className="mt-3">
          <DataGrid
            columns={columns}
            rows={transactions}
            getRowKey={(row) => row.id}
            emptyMessage="No transactions yet. Add one above, or import a statement below."
            enableExport
            exportFileName="expense-transactions"
            storageKey="expense-transactions"
          />
        </div>
      </section>

      {totals.length > 0 && (
        <section>
          <h2 className="font-display text-xl text-ink">Spend by category</h2>
          <ul className="mt-3 flex flex-col gap-1">
            {totals.map((total) => (
              <li
                key={total.categoryName || "uncategorised"}
                className="flex items-center justify-between rounded-md border border-line bg-paper px-3 py-1.5 text-sm"
              >
                <span className="text-ink">
                  {total.categoryName === "" ? (
                    <span className="text-muted">uncategorised</span>
                  ) : (
                    total.categoryName
                  )}
                  <span className="ml-2 text-xs text-muted">
                    {total.transactionCount} transaction(s)
                  </span>
                </span>
                <span className="font-mono text-ink">{formatCents(total.totalCents)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <CollapsibleCard title="Auto-categorise rules">
        <ExpenseRulesView rules={rules} categories={categories} />
      </CollapsibleCard>

      <CollapsibleCard title="Import a statement (CSV)">
        <ExpenseImportView accounts={accounts} namedMappings={namedMappings} />
      </CollapsibleCard>

      <CollapsibleCard title="Cards & categories">
        <ExpenseAccountsView accounts={accounts} categories={categories} />
      </CollapsibleCard>
    </div>
  );
}
