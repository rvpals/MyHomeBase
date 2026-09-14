"use client";

// The Transactions section: buy/sell history, plus the form to record or edit one.
// Lifted out of stock-positions-view.tsx (where it was a tab) when the module
// gained a tree nav and each section became its own route.

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import type { StockTransaction, TransactionAction } from "@/lib/stock-positions";
import { TickerCell, TickerViewerHost } from "./ticker-viewer-host";
import { centsToDollars, formatCents } from "@/lib/shared/money";
import {
  createTransactionAction,
  deleteTransactionAction,
  listTickerHoldingsAction,
  updateTransactionAction,
  type TickerHolding,
  type TransactionFormInput,
} from "./stock-positions-actions";

const TRANSACTION_ACTIONS: TransactionAction[] = ["Buy", "Sell"];

const INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

const EMPTY_TRANSACTION_FORM: TransactionFormInput = {
  transactionAt: "",
  action: "Buy",
  ticker: "",
  numberOfShares: "",
  pricePerShare: "",
  brokerageFirm: "",
  externalId: "",
  note: "",
  // Off by default: holdings come from the broker import unless you opt in, which
  // is how every transaction recorded before this option existed behaved.
  applyToPosition: false,
};

/**
 * The "also update positions data" control, shown only when recording a new trade.
 *
 * Editing is deliberately excluded: the original trade has already moved the
 * holding, so re-applying an edit would double-count it. Undoing the old figures and
 * applying the new ones is a different, larger feature.
 *
 * It looks up which accounts hold the ticker so it can say what the trade will
 * change *before* you submit, and so it can ask which holding when a symbol is held
 * more than once — a position is keyed by account, but a transaction isn't.
 */
function ApplyToPositionField({
  ticker,
  action,
  shares,
  checked,
  accountId,
  onCheckedChange,
  onAccountChange,
}: {
  ticker: string;
  action: TransactionAction;
  shares: string;
  checked: boolean;
  accountId: number | undefined;
  onCheckedChange: (checked: boolean) => void;
  onAccountChange: (accountId: number | undefined) => void;
}) {
  // Keyed by symbol so a result can never be shown against a different ticker —
  // the lookup is async, and the field it describes is still being typed into.
  const [loaded, setLoaded] = useState<{ symbol: string; holdings: TickerHolding[] }>();
  const symbol = ticker.trim().toUpperCase();

  // Only looked up once the box is ticked — an untouched form shouldn't fire a
  // request per keystroke for a feature nobody opted into.
  useEffect(() => {
    if (!checked || !symbol) return;
    let current = true;
    void listTickerHoldingsAction(symbol).then((result) => {
      if (current) setLoaded({ symbol, holdings: result });
    });
    return () => {
      current = false;
    };
  }, [checked, symbol]);

  // Derived, not stored: a result for a stale symbol simply doesn't count, so
  // there's no second state to reset when the ticker changes.
  const holdings = checked && loaded?.symbol === symbol ? loaded.holdings : undefined;
  const isAmbiguous = (holdings?.length ?? 0) > 1;
  const target = isAmbiguous
    ? holdings?.find((holding) => holding.accountId === accountId)
    : holdings?.[0];

  const parsedShares = Number(shares || "0");
  const delta = action === "Buy" ? parsedShares : -parsedShares;
  const projected = target ? target.quantity + delta : undefined;

  return (
    <div className="sm:col-span-3">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onCheckedChange(event.target.checked)}
          className="mt-1"
        />
        <span>
          <span className="block text-sm text-ink">Also update positions data</span>
          <span className="block text-sm text-muted">
            Adds or deducts these shares from the matching holding. Off by default —
            holdings normally come from a broker import, and a later import will
            overwrite this.
          </span>
        </span>
      </label>

      {/* Indented to the checkbox label on desktop; flush left on a phone. */}
      {checked && symbol && holdings && (
        <div className="mt-2 ml-7 text-sm max-lg:ml-0">
          {holdings.length === 0 ? (
            <p className="text-red-400">
              No {symbol} position to update. Clear this box to record the transaction on
              its own, or add the position first.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {isAmbiguous && (
                <label className="block">
                  <span className="mb-1 block font-medium text-ink">
                    {symbol} is held in {holdings.length} accounts — update which?
                  </span>
                  <select
                    value={accountId ?? ""}
                    onChange={(event) =>
                      onAccountChange(event.target.value === "" ? undefined : Number(event.target.value))
                    }
                    className={INPUT_CLASS}
                  >
                    <option value="">Select an account…</option>
                    {holdings.map((holding) => (
                      <option key={holding.accountId} value={holding.accountId}>
                        {holding.accountName} — {holding.quantity} shares
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {target && projected !== undefined && (
                <p className={projected < 0 ? "text-red-400" : "text-muted"}>
                  {projected < 0
                    ? `${target.accountName} holds only ${target.quantity} shares — this sale can't be applied.`
                    : `${target.accountName}: ${target.quantity} → ${projected} shares.`}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function toTransactionFormInput(transaction: StockTransaction): TransactionFormInput {
  return {
    transactionAt: transaction.transactionAt,
    action: transaction.action,
    ticker: transaction.ticker,
    numberOfShares: String(transaction.numberOfShares),
    pricePerShare: centsToDollars(transaction.pricePerShareCents).toFixed(2),
    brokerageFirm: transaction.brokerageFirm,
    externalId: transaction.externalId,
    note: transaction.note,
  };
}

function TransactionForm({
  title,
  initialValue,
  onSave,
  onCancel,
  canApplyToPosition = false,
}: {
  title: string;
  initialValue: TransactionFormInput;
  onSave: (input: TransactionFormInput) => Promise<string | undefined>;
  onCancel?: () => void;
  /** Recording offers the holding update; editing doesn't — see ApplyToPositionField. */
  canApplyToPosition?: boolean;
}) {
  const [form, setForm] = useState(initialValue);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);

  const totalAmount = (Number(form.numberOfShares || "0") * Number(form.pricePerShare || "0")).toFixed(2);

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
      // Clearing the form keeps the "also update positions" choice: entering a run
      // of trades shouldn't silently revert to leaving holdings untouched. The
      // account pick is dropped, since it belonged to the ticker just recorded.
      setForm({ ...EMPTY_TRANSACTION_FORM, applyToPosition: form.applyToPosition });
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
          value={form.transactionAt}
          onChange={(event) => setForm({ ...form, transactionAt: event.target.value })}
          className={INPUT_CLASS}
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Action</span>
        <select
          value={form.action}
          onChange={(event) => setForm({ ...form, action: event.target.value as TransactionAction })}
          className={INPUT_CLASS}
        >
          {TRANSACTION_ACTIONS.map((action) => (
            <option key={action} value={action}>
              {action}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Ticker</span>
        <input
          value={form.ticker}
          onChange={(event) => setForm({ ...form, ticker: event.target.value.toUpperCase() })}
          className={INPUT_CLASS}
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Shares</span>
        <input
          value={form.numberOfShares}
          onChange={(event) => setForm({ ...form, numberOfShares: event.target.value })}
          className={INPUT_CLASS}
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Price/share ($)</span>
        <input
          value={form.pricePerShare}
          onChange={(event) => setForm({ ...form, pricePerShare: event.target.value })}
          className={INPUT_CLASS}
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Total (computed)</span>
        <input
          value={`$${totalAmount}`}
          readOnly
          className="w-full rounded-md border border-line bg-paper-raised px-3 py-1.5 text-sm text-muted"
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Brokerage firm</span>
        <input
          value={form.brokerageFirm ?? ""}
          onChange={(event) => setForm({ ...form, brokerageFirm: event.target.value })}
          placeholder="e.g. Chase"
          className={INPUT_CLASS}
        />
      </label>
      <label className="block text-sm sm:col-span-2">
        <span className="mb-1 block font-medium text-ink">Broker reference (optional)</span>
        <input
          value={form.externalId ?? ""}
          onChange={(event) => setForm({ ...form, externalId: event.target.value })}
          placeholder="confirmation # — makes re-imports exact"
          className={INPUT_CLASS}
        />
      </label>
      <label className="block text-sm sm:col-span-3">
        <span className="mb-1 block font-medium text-ink">Note</span>
        <input
          value={form.note}
          onChange={(event) => setForm({ ...form, note: event.target.value })}
          className={INPUT_CLASS}
        />
      </label>
      {canApplyToPosition && (
        <ApplyToPositionField
          ticker={form.ticker}
          action={form.action}
          shares={form.numberOfShares}
          checked={form.applyToPosition ?? false}
          accountId={form.applyAccountId}
          onCheckedChange={(checked) =>
            setForm({
              ...form,
              applyToPosition: checked,
              // Drop a stale account pick when the option is switched off.
              applyAccountId: checked ? form.applyAccountId : undefined,
            })
          }
          onAccountChange={(applyAccountId) => setForm((current) => ({ ...current, applyAccountId }))}
        />
      )}
      {error && <p className="text-sm text-red-400 sm:col-span-3">{error}</p>}
      <div className="flex gap-2 sm:col-span-3">
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

export function StockTransactionsView({ transactions }: { transactions: StockTransaction[] }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<number | undefined>(undefined);
  /** The symbol whose full viewer is open, if any. */
  const [openTicker, setOpenTicker] = useState<string | undefined>(undefined);

  async function handleCreate(input: TransactionFormInput) {
    const result = await createTransactionAction(input);
    if (!result.ok) return result.error ?? "Failed to record transaction.";
    router.refresh();
    return undefined;
  }

  async function handleUpdate(transactionId: number, input: TransactionFormInput) {
    const result = await updateTransactionAction(transactionId, input);
    if (!result.ok) return result.error ?? "Failed to update transaction.";
    setEditingId(undefined);
    router.refresh();
    return undefined;
  }

  async function handleDelete(transaction: StockTransaction) {
    if (!window.confirm(`Delete this ${transaction.action} of ${transaction.ticker}?`)) return;
    const result = await deleteTransactionAction(transaction.id);
    if (result.ok) router.refresh();
    else window.alert(result.error);
  }

  const columns: DataGridColumn<StockTransaction>[] = [
    {
      key: "transactionAt",
      header: "Date",
      value: (transaction) => transaction.transactionAt,
      render: (transaction) => transaction.transactionAt,
    },
    {
      key: "action",
      header: "Action",
      value: (transaction) => transaction.action,
      render: (transaction) => transaction.action,
    },
    {
      key: "ticker",
      header: "Ticker",
      value: (transaction) => transaction.ticker,
      render: (transaction) => (
        <TickerCell ticker={transaction.ticker} onOpen={setOpenTicker} size={20} />
      ),
    },
    {
      key: "brokerageFirm",
      header: "Firm",
      value: (transaction) => transaction.brokerageFirm,
      render: (transaction) => transaction.brokerageFirm || "—",
    },
    {
      key: "shares",
      header: "Shares",
      value: (transaction) => transaction.numberOfShares,
      render: (transaction) => transaction.numberOfShares,
    },
    {
      key: "price",
      header: "Price/Share",
      value: (transaction) => transaction.pricePerShareCents,
      render: (transaction) => formatCents(transaction.pricePerShareCents),
    },
    {
      key: "total",
      header: "Total",
      value: (transaction) => transaction.totalAmountCents,
      render: (transaction) => formatCents(transaction.totalAmountCents),
      aggregate: "sum",
      formatAggregate: (cents) => formatCents(cents),
    },
    {
      key: "externalId",
      header: "Reference",
      value: (transaction) => transaction.externalId,
      render: (transaction) => (
        <span className="font-mono text-xs text-muted">{transaction.externalId || "—"}</span>
      ),
    },
    {
      key: "note",
      header: "Note",
      value: (transaction) => transaction.note,
      render: (transaction) => <span className="text-muted">{transaction.note || "—"}</span>,
    },
    {
      key: "actions",
      header: "Actions",
      excludeFromRecordView: true,
      render: (transaction) => (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setEditingId(transaction.id)}
            className="text-xs font-medium text-brass-dark hover:underline"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => handleDelete(transaction)}
            className="text-xs font-medium text-red-400 hover:underline"
          >
            Delete
          </button>
        </div>
      ),
    },
  ];

  const editingTransaction = transactions.find((transaction) => transaction.id === editingId);

  return (
    <div>
      <CollapsibleCard title="Record Transaction">
        <TransactionForm
          title="Record transaction"
          initialValue={EMPTY_TRANSACTION_FORM}
          onSave={handleCreate}
          canApplyToPosition
        />
      </CollapsibleCard>

      {editingTransaction && (
        <div className="mt-4">
          <CollapsibleCard title={`Edit: ${editingTransaction.action} ${editingTransaction.ticker}`} defaultOpen>
            <TransactionForm
              title="Save changes"
              initialValue={toTransactionFormInput(editingTransaction)}
              onSave={(input) => handleUpdate(editingTransaction.id, input)}
              onCancel={() => setEditingId(undefined)}
            />
          </CollapsibleCard>
        </div>
      )}

      <div className="mt-4">
        <DataGrid
          columns={columns}
          rows={transactions}
          getRowKey={(transaction) => transaction.id}
          emptyMessage="No transactions yet."
          exportFileName="stock-transactions"
          storageKey="myhomebase:stock-transactions-grid"
        />
      </div>

      {openTicker && (
        <TickerViewerHost ticker={openTicker} onClose={() => setOpenTicker(undefined)} />
      )}
    </div>
  );
}
