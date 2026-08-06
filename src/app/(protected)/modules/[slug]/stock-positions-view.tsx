"use client";

// The Positions section: the holdings grid, the add/edit form, and Refresh All.
// Transactions moved to their own section (stock-transactions-view.tsx) when the
// module gained a tree nav — they were tabs in one view before that.

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import { Tabs, type TabItem } from "@/components/tabs";
// Route-local, not a registered shared component: it's an <img> with a monogram
// fallback used by exactly these two sibling views.
import { AccountIconImage } from "./stock-accounts-view";
import { TickerCell, TickerViewerHost } from "./ticker-viewer-host";
import {
  POSITION_TYPES,
  UNASSIGNED_ACCOUNT_ID,
  type PositionType,
  type StockPosition,
} from "@/lib/stock-positions";
import { snapshotBucketFor, type SnapshotBucket } from "@/lib/stock-daily-snapshot";
import { centsToDollars, formatCents } from "@/lib/shared/money";
import {
  deletePositionAction,
  fetchQuoteAction,
  refreshAllPositionsAction,
  upsertPositionAction,
  type PositionFormInput,
} from "./stock-positions-actions";

const INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

/** An account a position can belong to. `id` 0 is the Unassigned pseudo-account. */
export interface PositionAccountOption {
  id: number;
  name: string;
  /** Set when the account has an icon; drives the Account column's thumbnail. */
  iconMimeType?: string;
  /** Cache-buster for the icon route, so a replaced icon isn't served stale. */
  updatedAt?: string;
}

const EMPTY_POSITION_FORM: PositionFormInput = {
  accountId: UNASSIGNED_ACCOUNT_ID,
  ticker: "",
  name: "",
  type: "Stock",
  currentPrice: "",
  quantity: "",
  dayGainLoss: "0",
  dayHigh: "0",
  dayLow: "0",
  dividendRate: "0",
  cost: "0",
  unitCost: "0",
  unrealizedGainLoss: "0",
  unrealizedGainLossPct: "0",
  estAnnualIncome: "0",
  incomeEarned: "0",
  cusip: "",
  isin: "",
  assetClass: "",
  assetStrategy: "",
};

function toPositionFormInput(position: StockPosition): PositionFormInput {
  return {
    accountId: position.accountId,
    ticker: position.ticker,
    name: position.name,
    type: position.type,
    currentPrice: centsToDollars(position.currentPriceCents).toFixed(2),
    quantity: String(position.quantity),
    dayGainLoss: centsToDollars(position.dayGainLossCents).toFixed(2),
    dayHigh: centsToDollars(position.dayHighCents).toFixed(2),
    dayLow: centsToDollars(position.dayLowCents).toFixed(2),
    dividendRate: centsToDollars(position.dividendRateCents).toFixed(2),
    cost: centsToDollars(position.costCents).toFixed(2),
    unitCost: centsToDollars(position.unitCostCents).toFixed(2),
    unrealizedGainLoss: centsToDollars(position.unrealizedGainLossCents).toFixed(2),
    unrealizedGainLossPct: String(position.unrealizedGainLossPct),
    estAnnualIncome: centsToDollars(position.estAnnualIncomeCents).toFixed(2),
    incomeEarned: centsToDollars(position.incomeEarnedCents).toFixed(2),
    cusip: position.cusip,
    isin: position.isin,
    assetClass: position.assetClass,
    assetStrategy: position.assetStrategy,
  };
}

/** A position's identity in a React key or a grid row. */
function positionRowKey(position: StockPosition): string {
  return `${position.accountId}:${position.ticker}`;
}

function TextField({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-ink">{label}</span>
      <input
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className={`${INPUT_CLASS} disabled:opacity-60`}
      />
    </label>
  );
}

function PositionForm({
  title,
  initialValue,
  accounts,
  onSave,
  onCancel,
  lockIdentity = false,
}: {
  title: string;
  initialValue: PositionFormInput;
  accounts: PositionAccountOption[];
  onSave: (input: PositionFormInput) => Promise<string | undefined>;
  onCancel?: () => void;
  /** On edit, the account + ticker are the primary key — changing them would move the row, not edit it. */
  lockIdentity?: boolean;
}) {
  const [form, setForm] = useState(initialValue);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);
  const [isFetchingQuote, setIsFetchingQuote] = useState(false);
  // Which symbol we've already looked up, so leaving and re-entering the field
  // doesn't fire the same request again.
  const [autoFetchedTicker, setAutoFetchedTicker] = useState<string | undefined>(undefined);

  function update<Key extends keyof PositionFormInput>(key: Key, value: PositionFormInput[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

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
      // Keep the chosen account so adding several holdings to one account doesn't
      // reset the picker between each.
      setForm({ ...EMPTY_POSITION_FORM, accountId: form.accountId });
    } finally {
      setIsSaving(false);
    }
  }

  /**
   * Looks the ticker up as soon as you leave the field, so the usual case needs no
   * extra click. Deliberately only when the name is still blank — it must never
   * overwrite something typed by hand — and once per symbol. The Fetch button
   * remains for a deliberate re-fetch.
   */
  async function handleTickerBlur() {
    const ticker = form.ticker.trim();
    if (lockIdentity || ticker === "" || form.name.trim() !== "") return;
    if (isFetchingQuote || autoFetchedTicker === ticker) return;
    setAutoFetchedTicker(ticker);
    await handleFetchQuote();
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
      setForm((current) => ({
        ...current,
        name: result.name || current.name,
        currentPrice: result.currentPrice ?? current.currentPrice,
        dayHigh: result.dayHigh ?? current.dayHigh,
        dayLow: result.dayLow ?? current.dayLow,
        dividendRate: result.dividendRate ?? current.dividendRate,
      }));
    } finally {
      setIsFetchingQuote(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Account</span>
          <select
            value={form.accountId}
            disabled={lockIdentity}
            onChange={(event) => update("accountId", Number(event.target.value))}
            className={`${INPUT_CLASS} disabled:opacity-60`}
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Ticker</span>
          <div className="flex gap-2">
            <input
              value={form.ticker}
              disabled={lockIdentity}
              onChange={(event) => update("ticker", event.target.value.toUpperCase())}
              onBlur={handleTickerBlur}
              className={`${INPUT_CLASS} disabled:opacity-60`}
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
        <TextField label="Name" value={form.name} onChange={(value) => update("name", value)} />

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Type</span>
          <select
            value={form.type}
            onChange={(event) => update("type", event.target.value as PositionType)}
            className={INPUT_CLASS}
          >
            {POSITION_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <TextField
          label="Current price ($)"
          value={form.currentPrice}
          onChange={(value) => update("currentPrice", value)}
        />
        <TextField label="Quantity" value={form.quantity} onChange={(value) => update("quantity", value)} />

        <TextField label="Day high ($)" value={form.dayHigh} onChange={(value) => update("dayHigh", value)} />
        <TextField label="Day low ($)" value={form.dayLow} onChange={(value) => update("dayLow", value)} />
        <TextField
          label="Day gain/loss ($)"
          value={form.dayGainLoss}
          onChange={(value) => update("dayGainLoss", value)}
        />
      </div>

      {/* Collapsed by default: a hand-entered position rarely knows its CUSIP.
          These are the fields a broker CSV fills in. */}
      <CollapsibleCard title="Cost basis, income and identifiers">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <TextField label="Cost basis ($ total)" value={form.cost} onChange={(value) => update("cost", value)} />
          <TextField label="Unit cost ($/share)" value={form.unitCost} onChange={(value) => update("unitCost", value)} />
          <TextField
            label="Unrealized gain/loss ($)"
            value={form.unrealizedGainLoss}
            onChange={(value) => update("unrealizedGainLoss", value)}
          />
          <TextField
            label="Unrealized gain/loss (%)"
            value={form.unrealizedGainLossPct}
            onChange={(value) => update("unrealizedGainLossPct", value)}
          />
          <TextField
            label="Annual dividend/share ($)"
            value={form.dividendRate}
            onChange={(value) => update("dividendRate", value)}
          />
          <TextField
            label="Est. annual income ($)"
            value={form.estAnnualIncome}
            onChange={(value) => update("estAnnualIncome", value)}
          />
          <TextField
            label="Income earned to date ($)"
            value={form.incomeEarned}
            onChange={(value) => update("incomeEarned", value)}
          />
          <TextField label="CUSIP" value={form.cusip} onChange={(value) => update("cusip", value)} />
          <TextField label="ISIN" value={form.isin} onChange={(value) => update("isin", value)} />
          <TextField label="Asset class" value={form.assetClass} onChange={(value) => update("assetClass", value)} />
          <TextField
            label="Asset strategy"
            value={form.assetStrategy}
            onChange={(value) => update("assetStrategy", value)}
          />
        </div>
      </CollapsibleCard>

      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex gap-2">
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

export function StockPositionsView({
  positions,
  accounts,
}: {
  positions: StockPosition[];
  /** Real brokerage accounts; the Unassigned option is added here, not by the caller. */
  accounts: PositionAccountOption[];
}) {
  const router = useRouter();
  const [editingKey, setEditingKey] = useState<string | undefined>(undefined);
  const [isRefreshing, setIsRefreshing] = useState(false);
  /** The symbol whose full viewer is open, if any. */
  const [openTicker, setOpenTicker] = useState<string | undefined>(undefined);

  const accountOptions: PositionAccountOption[] = [
    { id: UNASSIGNED_ACCOUNT_ID, name: "Unassigned" },
    ...accounts,
  ];
  const accountFor = (accountId: number) =>
    accountOptions.find((account) => account.id === accountId) ?? {
      id: accountId,
      name: `Account ${accountId}`,
    };
  const accountName = (accountId: number) => accountFor(accountId).name;

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
    setEditingKey(undefined);
    router.refresh();
    return undefined;
  }

  async function handleDelete(position: StockPosition) {
    if (
      !window.confirm(
        `Delete "${position.ticker}" from ${accountName(position.accountId)}? This cannot be undone.`,
      )
    )
      return;
    const result = await deletePositionAction(position.accountId, position.ticker);
    if (result.ok) router.refresh();
    else window.alert(result.error);
  }

  const columns: DataGridColumn<StockPosition>[] = [
    {
      key: "ticker",
      header: "Ticker",
      value: (position) => position.ticker,
      render: (position) => <TickerCell ticker={position.ticker} onOpen={setOpenTicker} />,
    },
    { key: "name", header: "Name", value: (position) => position.name, render: (position) => position.name || "—" },
    {
      key: "account",
      header: "Account",
      value: (position) => accountName(position.accountId),
      render: (position) => (
        <span className="flex items-center gap-2">
          <AccountIconImage account={accountFor(position.accountId)} size={18} />
          {accountName(position.accountId)}
        </span>
      ),
    },
    { key: "type", header: "Type", value: (position) => position.type, render: (position) => position.type },
    {
      key: "strategy",
      header: "Strategy",
      value: (position) => position.assetStrategy,
      render: (position) => position.assetStrategy || "—",
    },
    {
      key: "price",
      header: "Price",
      value: (position) => position.currentPriceCents,
      render: (position) => formatCents(position.currentPriceCents),
    },
    { key: "quantity", header: "Qty", value: (position) => position.quantity, render: (position) => position.quantity },
    {
      key: "value",
      header: "Value",
      // `value` earns this column sorting, search and CSV export as well as the
      // footer total — the total is what needed it.
      value: (position) => position.valueCents,
      render: (position) => formatCents(position.valueCents),
      aggregate: "sum",
      formatAggregate: (cents) => formatCents(cents),
    },
    {
      key: "unitCost",
      header: "Unit Cost",
      value: (position) => position.unitCostCents,
      render: (position) => (position.unitCostCents > 0 ? formatCents(position.unitCostCents) : "—"),
    },
    {
      key: "cost",
      header: "Cost Basis",
      value: (position) => position.costCents,
      render: (position) => (position.costCents > 0 ? formatCents(position.costCents) : "—"),
      aggregate: "sum",
      formatAggregate: (cents) => formatCents(cents),
    },
    {
      key: "unrealized",
      header: "Total G/L",
      value: (position) => position.unrealizedGainLossCents,
      render: (position) =>
        position.costCents > 0 ? (
          <span className={position.unrealizedGainLossCents < 0 ? "text-red-400" : "text-emerald-400"}>
            {formatCents(position.unrealizedGainLossCents)}
          </span>
        ) : (
          "—"
        ),
      aggregate: "sum",
      formatAggregate: (cents) => formatCents(cents),
    },
    {
      key: "unrealizedPct",
      header: "Total G/L %",
      value: (position) => position.unrealizedGainLossPct,
      render: (position) =>
        position.costCents > 0 ? (
          <span className={position.unrealizedGainLossPct < 0 ? "text-red-400" : "text-emerald-400"}>
            {position.unrealizedGainLossPct >= 0 ? "+" : ""}
            {position.unrealizedGainLossPct.toFixed(2)}%
          </span>
        ) : (
          "—"
        ),
    },
    {
      key: "dayGainLoss",
      header: "Day G/L",
      value: (position) => position.dayGainLossCents,
      render: (position) => (
        <span className={position.dayGainLossCents < 0 ? "text-red-400" : "text-emerald-400"}>
          {formatCents(position.dayGainLossCents)}
        </span>
      ),
      aggregate: "sum",
      formatAggregate: (cents) => formatCents(cents),
    },
    {
      key: "estAnnualIncome",
      header: "Annual Income",
      value: (position) => position.estAnnualIncomeCents,
      render: (position) =>
        position.estAnnualIncomeCents > 0 ? formatCents(position.estAnnualIncomeCents) : "—",
      aggregate: "sum",
      formatAggregate: (cents) => formatCents(cents),
    },
    { key: "cusip", header: "CUSIP", value: (position) => position.cusip, render: (position) => position.cusip || "—" },
    { key: "isin", header: "ISIN", value: (position) => position.isin, render: (position) => position.isin || "—" },
    {
      key: "actions",
      header: "Actions",
      excludeFromRecordView: true,
      render: (position) => (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setEditingKey(positionRowKey(position))}
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

  const editingPosition = positions.find((position) => positionRowKey(position) === editingKey);

  // Split by the same three buckets the Dashboard's Daily Glance table uses —
  // `snapshotBucketFor` is the one place that decides what counts as "other",
  // so the tabs and the dashboard can't drift apart.
  const byBucket: Record<SnapshotBucket, StockPosition[]> = { stock: [], etf: [], other: [] };
  for (const position of positions) byBucket[snapshotBucketFor(position)].push(position);

  const positionTabs: TabItem[] = (
    [
      { bucket: "stock", label: "Stocks", empty: "No stock positions yet." },
      { bucket: "etf", label: "ETF", empty: "No ETF positions yet." },
      {
        bucket: "other",
        label: "Others",
        empty: "No bond, fund, crypto or other positions yet.",
      },
    ] as const
  ).map(({ bucket, label, empty }) => ({
    key: bucket,
    label: `${label} (${byBucket[bucket].length})`,
    content: (
      <DataGrid
        // Type is dropped where the tab already says it. Not on Others, which
        // collapses Bond, MutualFund, Crypto and Other into one list — there
        // it's the only thing telling them apart.
        columns={bucket === "other" ? columns : columns.filter((column) => column.key !== "type")}
        rows={byBucket[bucket]}
        getRowKey={positionRowKey}
        emptyMessage={empty}
        exportFileName={`stock-positions-${bucket}`}
        // Stocks and ETF share a layout because their columns are identical;
        // Others keeps its own, since a stored layout spanning a different set
        // of columns is how you get a column resurrected in the wrong tab.
        storageKey={
          bucket === "other"
            ? "myhomebase:stock-positions-grid-other"
            : "myhomebase:stock-positions-grid"
        }
        recordViewTitle={(position) => `${position.ticker} — ${position.name}`}
      />
    ),
  }));

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
        <PositionForm
          title="Add position"
          initialValue={EMPTY_POSITION_FORM}
          accounts={accountOptions}
          onSave={handleSave}
        />
      </CollapsibleCard>

      {editingPosition && (
        <div className="mt-4">
          <CollapsibleCard
            title={`Edit: ${editingPosition.ticker} — ${accountName(editingPosition.accountId)}`}
            defaultOpen
          >
            <PositionForm
              title="Save changes"
              initialValue={toPositionFormInput(editingPosition)}
              accounts={accountOptions}
              onSave={handleSave}
              onCancel={() => setEditingKey(undefined)}
              lockIdentity
            />
          </CollapsibleCard>
        </div>
      )}

      <div className="mt-4">
        <Tabs items={positionTabs} />
      </div>

      {openTicker && (
        <TickerViewerHost ticker={openTicker} onClose={() => setOpenTicker(undefined)} />
      )}
    </div>
  );
}
