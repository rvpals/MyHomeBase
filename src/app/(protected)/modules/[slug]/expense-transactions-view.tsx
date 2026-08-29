"use client";

import { useState, type ChangeEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import { IconSelect } from "@/components/icon-select";
import { Modal } from "@/components/modal";
import {
  TRANSACTION_STATUSES,
  parseMoneyToCents,
  type BulkTransactionEditInput,
  type CreditCardAccount,
  type ExpenseCategory,
  type ExpenseTransaction,
  type ExpenseVendor,
  type TransactionStatus,
} from "@/lib/expense";
import {
  bulkEditTransactionsAction,
  deleteTransactionAction,
  deleteTransactionsAction,
  saveTransactionAction,
} from "./expense-actions";
import { expenseSectionHref } from "./expense-sections";
import {
  CardThumbnail,
  CategoryIconThumbnail,
  VendorIconThumbnail,
  categoryIconSelectOptions,
  categoryIconUrlsByName,
  formatCents,
  todayIso,
  vendorIconFor,
  vendorIconUrlsByName,
} from "./expense-shared";

/** What the picker calls an empty category — blank means "not categorised yet". */
const UNCATEGORISED_LABEL = "uncategorised";

/**
 * How much of a description seeds a new rule's name. Short on purpose: it's a
 * starting point the user edits, and a card description's leading characters are
 * the brand ("SQ *TGI FRID") while the tail is store and order noise.
 */
const RULE_NAME_SEED_LENGTH = 10;

const INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

/** Row-action glyphs. Local one-offs: only this grid uses them. */
function PencilIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M4 20h4l10-10a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5z" />
      <path d="M13.5 6.5l4 4" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M4 7h16" />
      <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" />
      <path d="M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

/**
 * A magician's wand with sparks — "conjure a rule from this description". Local and
 * hand-drawn like the two above: `TreeIcon name="magic"` exists, but a themed icon set
 * draws it as full-colour artwork, which is right for the Music nav entry and wrong for
 * a 16px control sitting inline beside the description text.
 */
function MagicIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M5 19l9-9" />
      <path d="M12.5 5.5l1.2 2.3 2.3 1.2-2.3 1.2-1.2 2.3-1.2-2.3L9 9l2.3-1.2z" />
      <path d="M18 4.5v2M17 5.5h2" />
      <path d="M19 14v2M18 15h2" />
    </svg>
  );
}

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
          <IconSelect
            options={categoryIconSelectOptions(categories)}
            value={form.categoryName}
            onChange={(categoryName) => update("categoryName", categoryName)}
            clearLabel={`— ${UNCATEGORISED_LABEL} —`}
            placeholder="Leave blank to categorise later"
            ariaLabel="Category"
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

/**
 * The bulk-editable fields, in the order the dialog lists them. Transaction date
 * and amount are absent here *and* in `bulkTransactionEditSchema` — the schema is
 * what actually enforces it, this list only decides what's on screen.
 */
const BULK_FIELDS = [
  { field: "categoryName", label: "Category" },
  { field: "vendor", label: "Vendor" },
  { field: "status", label: "Status" },
  { field: "processed", label: "Processed" },
  { field: "transactionAccountId", label: "Account" },
  { field: "note", label: "Note" },
  { field: "transactionDescription", label: "Description" },
] as const;

type BulkField = (typeof BULK_FIELDS)[number]["field"];

/**
 * Bulk edit for the selected rows: tick a field to include it, type the value
 * that every selected transaction should get. A ticked field with an empty value
 * clears it — that's what "apply this value to all" has to mean.
 *
 * Local to this view rather than a shared component: the field list is
 * expense-specific. Promote it if a second grid needs the same thing.
 */
function BulkEditDialog({
  selected,
  accounts,
  categories,
  onCancel,
  onApplied,
}: {
  selected: ExpenseTransaction[];
  accounts: CreditCardAccount[];
  categories: ExpenseCategory[];
  onCancel: () => void;
  onApplied: (count: number) => void;
}) {
  const [enabled, setEnabled] = useState<Set<BulkField>>(new Set());
  const [values, setValues] = useState<Record<BulkField, string>>({
    categoryName: "",
    vendor: "",
    status: "new",
    processed: "yes",
    transactionAccountId: String(accounts[0]?.id ?? ""),
    note: "",
    transactionDescription: "",
  });
  const [error, setError] = useState<string | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);

  function toggleField(field: BulkField) {
    setEnabled((current) => {
      const next = new Set(current);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  }

  function updateValue(field: BulkField, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  async function handleApply() {
    // Only the ticked fields go into the change set; the rest stay untouched.
    const changes: BulkTransactionEditInput = {};
    if (enabled.has("categoryName")) changes.categoryName = values.categoryName;
    if (enabled.has("vendor")) changes.vendor = values.vendor;
    if (enabled.has("status")) changes.status = values.status as TransactionStatus;
    if (enabled.has("processed")) changes.processed = values.processed === "yes";
    if (enabled.has("transactionAccountId")) {
      changes.transactionAccountId = Number(values.transactionAccountId);
    }
    if (enabled.has("note")) changes.note = values.note;
    if (enabled.has("transactionDescription")) {
      changes.transactionDescription = values.transactionDescription;
    }

    setIsSaving(true);
    setError(undefined);
    try {
      const result = await bulkEditTransactionsAction(
        selected.map((row) => row.id),
        changes,
      );
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onApplied(result.count ?? 0);
    } finally {
      setIsSaving(false);
    }
  }

  function renderControl(field: BulkField) {
    const isEnabled = enabled.has(field);
    const shared = {
      disabled: !isEnabled,
      className: `${INPUT_CLASS} disabled:opacity-40`,
      value: values[field],
      onChange: (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
        updateValue(field, event.target.value),
      "aria-label": BULK_FIELDS.find((entry) => entry.field === field)?.label,
    };

    if (field === "status") {
      return (
        <select {...shared}>
          {TRANSACTION_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      );
    }
    if (field === "processed") {
      return (
        <select {...shared}>
          <option value="yes">yes</option>
          <option value="no">no — re-queue for clean-up</option>
        </select>
      );
    }
    if (field === "transactionAccountId") {
      return (
        <select {...shared}>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      );
    }
    if (field === "categoryName") {
      // Not the `shared` spread: IconSelect raises the value itself rather than a
      // change event, so it can't take a plain input's handler.
      return (
        <IconSelect
          options={categoryIconSelectOptions(categories)}
          value={values.categoryName}
          onChange={(categoryName) => updateValue("categoryName", categoryName)}
          clearLabel="— clear the category —"
          disabled={!isEnabled}
          placeholder={isEnabled ? "Leave blank to clear this field" : ""}
          ariaLabel="Category"
          className="disabled:opacity-40"
        />
      );
    }
    return <input {...shared} placeholder={isEnabled ? "Leave blank to clear this field" : ""} />;
  }

  return (
    <Modal
      title={`Bulk edit ${selected.length} transaction(s)`}
      description="Tick a field to apply its value to every selected transaction. Unticked fields are left as they are, and a ticked field left blank clears it. Transaction date and amount can't be bulk edited."
      onClose={onCancel}
      isBusy={isSaving}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleApply} disabled={isSaving || enabled.size === 0}>
            {isSaving ? "Applying…" : `Apply to ${selected.length}`}
          </Button>
        </>
      }
    >
      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

      <div className="flex flex-col gap-3">
        {BULK_FIELDS.map(({ field, label }) => (
          <div key={field} className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[11rem_1fr]">
            <label className="flex items-center gap-2 text-sm font-medium text-ink">
              <input
                type="checkbox"
                checked={enabled.has(field)}
                onChange={() => toggleField(field)}
              />
              {label}
            </label>
            {renderControl(field)}
          </div>
        ))}
      </div>

    </Modal>
  );
}

export function ExpenseTransactionsView({
  transactions,
  accounts,
  categories,
  vendors,
}: {
  transactions: ExpenseTransaction[];
  accounts: CreditCardAccount[];
  categories: ExpenseCategory[];
  vendors: ExpenseVendor[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<ExpenseTransaction | undefined>(undefined);
  // Holds the rows the dialog is editing plus the grid's own clear-selection
  // callback, so the selection is dropped once the change lands.
  const [bulkEdit, setBulkEdit] = useState<
    { rows: ExpenseTransaction[]; clearSelection: () => void } | undefined
  >(undefined);
  const [isBulkBusy, setIsBulkBusy] = useState(false);
  // What the last bulk operation did — a selection can be cleared and the rows
  // re-sorted by the refresh, so "12 updated" is the only visible confirmation.
  const [bulkResult, setBulkResult] = useState<string | undefined>(undefined);

  const accountName = (id: number) => accounts.find((account) => account.id === id)?.name ?? "—";
  // A row carries only the category *name*, so the grid looks its icon up here
  // rather than scanning the category list per cell.
  const categoryIconUrls = categoryIconUrlsByName(categories);
  // Same for the vendor, which is a bare string on the row. Keyed case-insensitively
  // (see vendorIconUrlsByName) since a row's spelling need not match the saved one.
  const vendorIconUrls = vendorIconUrlsByName(vendors);

  async function handleBulkDelete(rows: ExpenseTransaction[], clearSelection: () => void) {
    if (!window.confirm(`Delete ${rows.length} transaction(s)? This can't be undone.`)) return;
    setIsBulkBusy(true);
    try {
      const result = await deleteTransactionsAction(rows.map((row) => row.id));
      if (!result.ok) {
        window.alert(result.error);
        return;
      }
      setBulkResult(`Deleted ${result.count} transaction(s).`);
      clearSelection();
      router.refresh();
    } finally {
      setIsBulkBusy(false);
    }
  }

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
      // Blank is normal — plenty of statements omit it — so say so rather than
      // leaving a cell that looks like a rendering fault.
      render: (row) => row.postingDate || "—",
    },
    {
      key: "description",
      header: "Description",
      // `value` stays the raw text so sorting and search ignore the button.
      value: (row) => row.transactionDescription,
      render: (row) => (
        <span className="group/rule flex items-center gap-1.5">
          <span>{row.transactionDescription}</span>
          {/*
            A Link, not a button: this navigates, so middle-click and
            open-in-new-tab should work. The rules screen reads ?name=,
            ?description= and ?vendorDescription= and seeds an editable form —
            every field stays editable, and nothing is written until the user
            saves there. The full description goes over twice on purpose: once as
            the rule's own description, and once as the line to match on.
          */}
          <Link
            href={`${expenseSectionHref("transaction-rules")}?name=${encodeURIComponent(
              row.transactionDescription.slice(0, RULE_NAME_SEED_LENGTH),
            )}&description=${encodeURIComponent(
              row.transactionDescription,
            )}&vendorDescription=${encodeURIComponent(row.transactionDescription)}`}
            aria-label={`Add a rule for ${row.transactionDescription}`}
            title="Add rule"
            // Hidden until the row is hovered on a pointer device, so a long
            // table isn't a wall of glyphs — but always visible on touch, which
            // has no hover, and whenever it has keyboard focus.
            className="shrink-0 rounded-md p-0.5 text-brass-dark opacity-0 transition-opacity hover:bg-brass-soft focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass group-hover/rule:opacity-100 max-lg:opacity-100 motion-reduce:transition-none"
          >
            <MagicIcon />
          </Link>
        </span>
      ),
    },
    {
      key: "vendor",
      header: "Vendor",
      value: (row) => row.vendor,
      render: (row) =>
        row.vendor === "" ? (
          ""
        ) : (
          <span className="flex items-center gap-2">
            <VendorIconThumbnail iconUrl={vendorIconFor(vendorIconUrls, row.vendor)} />
            <span>{row.vendor}</span>
          </span>
        ),
    },
    {
      key: "category",
      header: "Category",
      value: (row) => row.categoryName,
      render: (row) =>
        row.categoryName === "" ? (
          <span className="text-muted">{UNCATEGORISED_LABEL}</span>
        ) : (
          <span className="flex items-center gap-2">
            <CategoryIconThumbnail iconUrl={categoryIconUrls.get(row.categoryName)} />
            <span className="rounded-full bg-brass-soft px-2 py-0.5 text-xs font-semibold text-brass-dark">
              {row.categoryName}
            </span>
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
      // Net spend for whatever the filters currently show — refunds are negative,
      // so this is a true net, not a gross of charges.
      aggregate: "sum",
      formatAggregate: (cents) => formatCents(cents),
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
      className: "w-20",
      excludeFromRecordView: true,
      // Icon-only, so each button carries an accessible name and a tooltip —
      // without them the control is unlabelled for a screen reader.
      render: (row) => (
        <div className="flex items-center justify-center gap-1">
          <button
            type="button"
            onClick={() => setEditing(row)}
            aria-label={`Edit transaction ${row.id}`}
            title="Edit"
            className="rounded-md p-1 text-brass-dark transition-colors hover:bg-brass-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
          >
            <PencilIcon />
          </button>
          <button
            type="button"
            onClick={async () => {
              if (!window.confirm("Delete this transaction?")) return;
              const result = await deleteTransactionAction(row.id);
              if (result.ok) router.refresh();
              else window.alert(result.error);
            }}
            aria-label={`Delete transaction ${row.id}`}
            title="Delete"
            className="rounded-md p-1 text-red-400 transition-colors hover:bg-red-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
          >
            <TrashIcon />
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
          {transactions.length} transaction(s). Use the search and filters to narrow the list, then
          tick rows to bulk edit or delete them.
          {bulkResult && <span className="ml-2 font-medium text-brass-dark">{bulkResult}</span>}
        </p>
        <DataGrid
          columns={columns}
          rows={transactions}
          getRowKey={(row) => row.id}
          emptyMessage="No transactions yet. Add one above, or import a statement."
          enableExport
          exportFileName="expense-transactions"
          storageKey="expense-transactions"
          recordViewTitle={(row) => `Transaction #${row.id}`}
          enableSelection
          renderSelectionActions={(selectedRows, clearSelection) => (
            <>
              <Button
                size="sm"
                variant="secondary"
                disabled={isBulkBusy}
                onClick={() => setBulkEdit({ rows: selectedRows, clearSelection })}
              >
                Bulk edit
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={isBulkBusy}
                onClick={() => handleBulkDelete(selectedRows, clearSelection)}
              >
                {isBulkBusy ? "Deleting…" : "Delete"}
              </Button>
            </>
          )}
        />
      </div>

      {bulkEdit && (
        <BulkEditDialog
          selected={bulkEdit.rows}
          accounts={accounts}
          categories={categories}
          onCancel={() => setBulkEdit(undefined)}
          onApplied={(count) => {
            setBulkResult(`Updated ${count} transaction(s).`);
            bulkEdit.clearSelection();
            setBulkEdit(undefined);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
