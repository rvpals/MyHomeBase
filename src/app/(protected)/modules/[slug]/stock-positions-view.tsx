"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { ChartBar } from "@/components/chart-bar";
import { CollapsibleCard } from "@/components/collapsible-card";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import { Tabs, type TabItem } from "@/components/tabs";
import {
  computePortfolioSummary,
  type PositionType,
  type StockPosition,
  type StockTransaction,
  type TransactionAction,
} from "@/lib/stock-positions";
import { centsToDollars, formatCents } from "@/lib/shared/money";
import {
  createTransactionAction,
  deletePositionAction,
  deleteTransactionAction,
  fetchQuoteAction,
  refreshAllPositionsAction,
  updateTransactionAction,
  upsertPositionAction,
  type PositionFormInput,
  type TransactionFormInput,
} from "./stock-positions-actions";

const POSITION_TYPES: PositionType[] = ["Stock", "ETF", "Bond", "MutualFund", "Crypto", "Other"];
const TRANSACTION_ACTIONS: TransactionAction[] = ["Buy", "Sell"];

const EMPTY_POSITION_FORM: PositionFormInput = {
  ticker: "",
  name: "",
  type: "Stock",
  currentPrice: "",
  quantity: "",
  dayGainLoss: "0",
  dayHigh: "0",
  dayLow: "0",
  dividendRate: "0",
};

const EMPTY_TRANSACTION_FORM: TransactionFormInput = {
  transactionAt: "",
  action: "Buy",
  ticker: "",
  numberOfShares: "",
  pricePerShare: "",
  note: "",
};

function toPositionFormInput(position: StockPosition): PositionFormInput {
  return {
    ticker: position.ticker,
    name: position.name,
    type: position.type,
    currentPrice: centsToDollars(position.currentPriceCents).toFixed(2),
    quantity: String(position.quantity),
    dayGainLoss: centsToDollars(position.dayGainLossCents).toFixed(2),
    dayHigh: centsToDollars(position.dayHighCents).toFixed(2),
    dayLow: centsToDollars(position.dayLowCents).toFixed(2),
    dividendRate: centsToDollars(position.dividendRateCents).toFixed(2),
  };
}

function toTransactionFormInput(transaction: StockTransaction): TransactionFormInput {
  return {
    transactionAt: transaction.transactionAt,
    action: transaction.action,
    ticker: transaction.ticker,
    numberOfShares: String(transaction.numberOfShares),
    pricePerShare: centsToDollars(transaction.pricePerShareCents).toFixed(2),
    note: transaction.note,
  };
}

function PositionForm({
  title,
  initialValue,
  onSave,
  onCancel,
  lockTicker = false,
}: {
  title: string;
  initialValue: PositionFormInput;
  onSave: (input: PositionFormInput) => Promise<string | undefined>;
  onCancel?: () => void;
  lockTicker?: boolean;
}) {
  const [form, setForm] = useState(initialValue);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);
  const [isFetchingQuote, setIsFetchingQuote] = useState(false);

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
      setForm(EMPTY_POSITION_FORM);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleFetchQuote() {
    if (form.ticker.trim() === "") return;
    setIsFetchingQuote(true);
    setError(undefined);
    try {
      const result = await fetchQuoteAction(form.ticker);
      if (!result.ok) {
        setError(result.error ?? "Failed to fetch a live quote.");
        return;
      }
      setForm({
        ...form,
        name: result.name || form.name,
        currentPrice: result.currentPrice ?? form.currentPrice,
        dayHigh: result.dayHigh ?? form.dayHigh,
        dayLow: result.dayLow ?? form.dayLow,
        dividendRate: result.dividendRate ?? form.dividendRate,
      });
    } finally {
      setIsFetchingQuote(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Ticker</span>
        <div className="flex gap-2">
          <input
            value={form.ticker}
            disabled={lockTicker}
            onChange={(event) => setForm({ ...form, ticker: event.target.value.toUpperCase() })}
            className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass disabled:opacity-60"
          />
          <button
            type="button"
            onClick={handleFetchQuote}
            disabled={isFetchingQuote || form.ticker.trim() === ""}
            className="shrink-0 rounded-md border border-line px-2 py-1.5 text-xs font-medium text-brass-dark hover:bg-paper-raised disabled:opacity-50"
          >
            {isFetchingQuote ? "Fetching…" : "Fetch"}
          </button>
        </div>
      </label>
      <label className="block text-sm sm:col-span-2">
        <span className="mb-1 block font-medium text-ink">Name</span>
        <input
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
          className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Type</span>
        <select
          value={form.type}
          onChange={(event) => setForm({ ...form, type: event.target.value as PositionType })}
          className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        >
          {POSITION_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Current price ($)</span>
        <input
          value={form.currentPrice}
          onChange={(event) => setForm({ ...form, currentPrice: event.target.value })}
          className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Quantity</span>
        <input
          value={form.quantity}
          onChange={(event) => setForm({ ...form, quantity: event.target.value })}
          className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Day high ($)</span>
        <input
          value={form.dayHigh}
          onChange={(event) => setForm({ ...form, dayHigh: event.target.value })}
          className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Day low ($)</span>
        <input
          value={form.dayLow}
          onChange={(event) => setForm({ ...form, dayLow: event.target.value })}
          className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Day gain/loss ($)</span>
        <input
          value={form.dayGainLoss}
          onChange={(event) => setForm({ ...form, dayGainLoss: event.target.value })}
          className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Annual dividend/share ($)</span>
        <input
          value={form.dividendRate}
          onChange={(event) => setForm({ ...form, dividendRate: event.target.value })}
          className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        />
      </label>
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

function TransactionForm({
  title,
  initialValue,
  onSave,
  onCancel,
}: {
  title: string;
  initialValue: TransactionFormInput;
  onSave: (input: TransactionFormInput) => Promise<string | undefined>;
  onCancel?: () => void;
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
      setForm(EMPTY_TRANSACTION_FORM);
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
          className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Action</span>
        <select
          value={form.action}
          onChange={(event) => setForm({ ...form, action: event.target.value as TransactionAction })}
          className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
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
          className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Shares</span>
        <input
          value={form.numberOfShares}
          onChange={(event) => setForm({ ...form, numberOfShares: event.target.value })}
          className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Price/share ($)</span>
        <input
          value={form.pricePerShare}
          onChange={(event) => setForm({ ...form, pricePerShare: event.target.value })}
          className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
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
      <label className="block text-sm sm:col-span-3">
        <span className="mb-1 block font-medium text-ink">Note</span>
        <input
          value={form.note}
          onChange={(event) => setForm({ ...form, note: event.target.value })}
          className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        />
      </label>
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

function PositionsPanel({ positions }: { positions: StockPosition[] }) {
  const router = useRouter();
  const [editingTicker, setEditingTicker] = useState<string | undefined>(undefined);
  const [isRefreshing, setIsRefreshing] = useState(false);

  async function handleRefreshAll() {
    setIsRefreshing(true);
    try {
      const result = await refreshAllPositionsAction();
      if (!result.ok) {
        window.alert(result.error ?? "Failed to refresh positions.");
        return;
      }
      if (result.failed && result.failed.length > 0) {
        window.alert(
          `Refreshed ${result.refreshedCount} position(s). Failed: ${result.failed
            .map((failure) => `${failure.ticker} (${failure.error})`)
            .join(", ")}`,
        );
      }
      router.refresh();
    } finally {
      setIsRefreshing(false);
    }
  }

  async function handleSave(input: PositionFormInput) {
    const result = await upsertPositionAction(input);
    if (!result.ok) return result.error ?? "Failed to save position.";
    setEditingTicker(undefined);
    router.refresh();
    return undefined;
  }

  async function handleDelete(position: StockPosition) {
    if (!window.confirm(`Delete "${position.ticker}"? This cannot be undone.`)) return;
    const result = await deletePositionAction(position.ticker);
    if (result.ok) router.refresh();
    else window.alert(result.error);
  }

  const columns: DataGridColumn<StockPosition>[] = [
    { key: "ticker", header: "Ticker", render: (position) => position.ticker },
    { key: "name", header: "Name", render: (position) => position.name || "—" },
    { key: "type", header: "Type", render: (position) => position.type },
    { key: "price", header: "Price", render: (position) => formatCents(position.currentPriceCents) },
    { key: "quantity", header: "Qty", render: (position) => position.quantity },
    { key: "value", header: "Value", render: (position) => formatCents(position.valueCents) },
    {
      key: "dayGainLoss",
      header: "Day G/L",
      render: (position) => (
        <span className={position.dayGainLossCents < 0 ? "text-[#d03b3b]" : "text-[#0ca30c]"}>
          {formatCents(position.dayGainLossCents)}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (position) => (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setEditingTicker(position.ticker)}
            className="text-xs font-medium text-brass-dark hover:underline"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => handleDelete(position)}
            className="text-xs font-medium text-red-400 hover:underline"
          >
            Delete
          </button>
        </div>
      ),
    },
  ];

  const editingPosition = positions.find((position) => position.ticker === editingTicker);

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <Button
          type="button"
          variant="secondary"
          onClick={handleRefreshAll}
          disabled={isRefreshing || positions.length === 0}
        >
          {isRefreshing ? "Refreshing…" : "Refresh All"}
        </Button>
      </div>

      <CollapsibleCard title="Add Position">
        <PositionForm title="Add position" initialValue={EMPTY_POSITION_FORM} onSave={handleSave} />
      </CollapsibleCard>

      {editingPosition && (
        <div className="mt-4">
          <CollapsibleCard title={`Edit: ${editingPosition.ticker}`} defaultOpen>
            <PositionForm
              title="Save changes"
              initialValue={toPositionFormInput(editingPosition)}
              onSave={handleSave}
              onCancel={() => setEditingTicker(undefined)}
              lockTicker
            />
          </CollapsibleCard>
        </div>
      )}

      <div className="mt-4">
        <DataGrid columns={columns} rows={positions} getRowKey={(position) => position.ticker} emptyMessage="No positions yet." />
      </div>
    </div>
  );
}

function TransactionsPanel({ transactions }: { transactions: StockTransaction[] }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<number | undefined>(undefined);

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
    { key: "transactionAt", header: "Date", render: (transaction) => transaction.transactionAt },
    { key: "action", header: "Action", render: (transaction) => transaction.action },
    { key: "ticker", header: "Ticker", render: (transaction) => transaction.ticker },
    { key: "shares", header: "Shares", render: (transaction) => transaction.numberOfShares },
    { key: "price", header: "Price/Share", render: (transaction) => formatCents(transaction.pricePerShareCents) },
    { key: "total", header: "Total", render: (transaction) => formatCents(transaction.totalAmountCents) },
    {
      key: "note",
      header: "Note",
      render: (transaction) => <span className="text-muted">{transaction.note || "—"}</span>,
    },
    {
      key: "actions",
      header: "Actions",
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
        <TransactionForm title="Record transaction" initialValue={EMPTY_TRANSACTION_FORM} onSave={handleCreate} />
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
        <DataGrid columns={columns} rows={transactions} getRowKey={(transaction) => transaction.id} emptyMessage="No transactions yet." />
      </div>
    </div>
  );
}

export function StockPositionsView({
  positions,
  transactions,
}: {
  positions: StockPosition[];
  transactions: StockTransaction[];
}) {
  const summary = computePortfolioSummary(positions);

  const allocationItems = [
    { key: "stock", label: "Stock", value: centsToDollars(summary.stockValueCents) },
    { key: "etf", label: "ETF", value: centsToDollars(summary.etfValueCents) },
    { key: "other", label: "Other", value: centsToDollars(summary.otherValueCents) },
  ].filter((item) => item.value > 0);

  const tabs: TabItem[] = [
    { key: "positions", label: "Positions", content: <PositionsPanel positions={positions} /> },
    { key: "transactions", label: "Transactions", content: <TransactionsPanel transactions={transactions} /> },
  ];

  return (
    <div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-line p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Positions</p>
          <p className="mt-1 font-display text-xl text-ink">{summary.positionCount}</p>
        </div>
        <div className="rounded-xl border border-line p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Total Value</p>
          <p className="mt-1 font-display text-xl text-ink">{formatCents(summary.totalValueCents)}</p>
        </div>
        <div className="rounded-xl border border-line p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Day Change</p>
          <p
            className={`mt-1 font-display text-xl ${
              summary.totalDayGainLossCents < 0 ? "text-[#d03b3b]" : "text-[#0ca30c]"
            }`}
          >
            {formatCents(summary.totalDayGainLossCents)} ({summary.dayChangePct.toFixed(2)}%)
          </p>
        </div>
        <div className="rounded-xl border border-line p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Annual Dividend Income</p>
          <p className="mt-1 font-display text-xl text-ink">{formatCents(summary.annualDividendIncomeCents)}</p>
        </div>
      </div>

      {allocationItems.length > 0 && (
        <div className="mt-6">
          <h2 className="font-display text-lg text-ink">Allocation</h2>
          <ChartBar items={allocationItems} formatValue={(value) => formatCents(Math.round(value * 100))} className="mt-2" />
        </div>
      )}

      <div className="mt-6">
        <Tabs items={tabs} />
      </div>
    </div>
  );
}
