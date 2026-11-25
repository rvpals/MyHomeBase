"use client";

// The T-Bill section: the T-Bill Stats card over the purchases grid.
//
// Presentation only. Every figure on screen — gain, gain %, days to maturity, yield,
// the five totals and the chart series — arrives already computed from
// src/lib/treasury-bills. Nothing here calculates anything except the form's
// convenience auto-fill, which is a typing aid over a field the user can overwrite.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { ChartLine } from "@/components/chart-line";
import { CollapsibleCard } from "@/components/collapsible-card";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import { Modal } from "@/components/modal";
import { SlotIcon } from "@/components/slot-icon";
import { getIconSlot } from "@/lib/icons";
import { centsToDollars, formatCents } from "@/lib/shared/money";
// A leaf module, not the `@/lib/treasury-bills` barrel: the barrel re-exports the
// SQLite repository, which would drag better-sqlite3 into this client bundle.
import type { TBillPurchaseView, TBillStats } from "@/lib/treasury-bills/types";
import {
  createTBillPurchaseAction,
  deleteTBillPurchaseAction,
  deleteTBillPurchasesAction,
  updateTBillPurchaseAction,
  type TBillFormInput,
} from "./stock-tbill-actions";

// Module scope: the registry is static, so this is a lookup and not I/O.
const TBILL_STATS_SLOT = getIconSlot("stock_card_tbill_stats")!;

const INPUT_CLASS =
  "rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

/** The one place a percentage becomes text. `undefined` is "—", never "0.00%". */
function formatPct(value: number | undefined, fractionDigits = 2): string {
  return value === undefined ? "—" : `${value.toFixed(fractionDigits)}%`;
}

/** Cents as money, or "—" when there is no figure at all. */
function formatOptionalCents(cents: number | undefined): string {
  return cents === undefined ? "—" : formatCents(Math.round(cents));
}

function emptyForm(): TBillFormInput {
  return {
    symbol: "",
    description: "",
    datePurchased: "",
    datePayout: "",
    sharesPurchased: "",
    purchasePrice: "",
    amountSpent: "",
    payoutAmount: "",
  };
}

function toForm(purchase: TBillPurchaseView): TBillFormInput {
  return {
    symbol: purchase.symbol,
    description: purchase.description,
    datePurchased: purchase.datePurchased,
    datePayout: purchase.datePayout,
    sharesPurchased: String(purchase.sharesPurchased),
    purchasePrice: String(purchase.purchasePrice),
    amountSpent: (purchase.amountSpentCents / 100).toFixed(2),
    payoutAmount: (purchase.payoutAmountCents / 100).toFixed(2),
  };
}

type Dialog =
  | { kind: "closed" }
  | { kind: "edit"; id?: number; form: TBillFormInput; error?: string }
  | { kind: "delete"; purchase: TBillPurchaseView }
  | { kind: "bulk-delete"; rows: TBillPurchaseView[]; clear: () => void };

/** One stat tile. The container/label/value structure design.md specifies. */
function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-line p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 font-display text-xl text-ink">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function StockTBillView({
  purchases,
  stats,
}: {
  purchases: TBillPurchaseView[];
  stats: TBillStats;
}) {
  const router = useRouter();
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [dialog, setDialog] = useState<Dialog>({ kind: "closed" });

  async function run(work: () => Promise<{ ok: boolean; error?: string }>) {
    setIsBusy(true);
    setError(undefined);
    const result = await work();
    setIsBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Something went wrong.");
      return;
    }
    setDialog({ kind: "closed" });
    router.refresh();
  }

  async function save(current: Extract<Dialog, { kind: "edit" }>) {
    setIsBusy(true);
    const result =
      current.id === undefined
        ? await createTBillPurchaseAction(current.form)
        : await updateTBillPurchaseAction(current.id, current.form);
    setIsBusy(false);

    if (!result.ok) {
      // Shown inside the dialog: a banner in the page body sits behind the overlay.
      setDialog({ ...current, error: result.error ?? "Could not save that purchase." });
      return;
    }
    setDialog({ kind: "closed" });
    router.refresh();
  }

  const columns: DataGridColumn<TBillPurchaseView>[] = [
    {
      key: "datePurchased",
      header: "Date Purchased",
      render: (row) => <span className="whitespace-nowrap">{row.datePurchased}</span>,
      value: (row) => row.datePurchased,
    },
    {
      key: "sharesPurchased",
      header: "Share Purchased",
      render: (row) => row.sharesPurchased.toLocaleString(),
      value: (row) => row.sharesPurchased,
      aggregate: "sum",
      formatAggregate: (total) => total.toLocaleString(),
    },
    {
      key: "purchasePrice",
      header: "Purchase Price",
      hint: "The price per $100 of face value, as the confirmation quotes it. The yield is computed against this unit.",
      render: (row) => row.purchasePrice.toFixed(4),
      value: (row) => row.purchasePrice,
    },
    {
      key: "symbol",
      header: "Symbol",
      render: (row) => <span className="whitespace-nowrap text-ink">{row.symbol}</span>,
      value: (row) => row.symbol,
      // So searching finds a bill by its description without the column sorting
      // or exporting as "symbol description".
      searchValue: (row) => row.description,
    },
    {
      key: "amountSpent",
      header: "Amount Spent",
      render: (row) => (
        <span className="whitespace-nowrap">{formatCents(row.amountSpentCents)}</span>
      ),
      value: (row) => centsToDollars(row.amountSpentCents),
      aggregate: "sum",
      formatAggregate: (total) => formatCents(Math.round(total * 100)),
    },
    {
      key: "description",
      header: "Description",
      render: (row) => row.description || <span className="text-muted">—</span>,
      value: (row) => row.description,
    },
    {
      key: "datePayout",
      header: "Date Payout",
      hint: "The maturity date — when the bill is redeemed at face value.",
      render: (row) => <span className="whitespace-nowrap">{row.datePayout}</span>,
      value: (row) => row.datePayout,
    },
    {
      key: "payoutAmount",
      header: "Payout Amount",
      render: (row) => (
        <span className="whitespace-nowrap">{formatCents(row.payoutAmountCents)}</span>
      ),
      value: (row) => centsToDollars(row.payoutAmountCents),
      aggregate: "sum",
      formatAggregate: (total) => formatCents(Math.round(total * 100)),
    },
    {
      key: "gainAmount",
      header: "Gain Amount",
      hint: "Payout amount minus amount spent. A loss shows as a negative figure.",
      // Semantic red/green, per design.md: these stay literal Tailwind shades rather
      // than theme tokens, so "down" reads the same in every theme.
      render: (row) => (
        <span
          className={`whitespace-nowrap ${
            row.gainAmountCents < 0 ? "text-red-400" : "text-emerald-400"
          }`}
        >
          {formatCents(row.gainAmountCents)}
        </span>
      ),
      value: (row) => centsToDollars(row.gainAmountCents),
      aggregate: "sum",
      formatAggregate: (total) => formatCents(Math.round(total * 100)),
    },
    {
      key: "gainPct",
      header: "Gain %",
      hint: "Gain amount over amount spent. Reads — when nothing was spent, which is not the same as 0%.",
      render: (row) => (
        <span
          className={`whitespace-nowrap ${
            row.gainPct === undefined
              ? "text-muted"
              : row.gainPct < 0
                ? "text-red-400"
                : "text-emerald-400"
          }`}
        >
          {formatPct(row.gainPct)}
        </span>
      ),
      value: (row) => row.gainPct ?? 0,
    },
    {
      key: "daysToMaturity",
      header: "# of Days to Maturity",
      hint: "Calendar days from the purchase date to the payout date.",
      render: (row) => row.daysToMaturity.toLocaleString(),
      value: (row) => row.daysToMaturity,
    },
    {
      key: "yieldPct",
      header: "Yield",
      hint: "(100 − purchase price) ÷ purchase price × 100 × 365 ÷ days to maturity. Reads — when there is no term to annualise over.",
      render: (row) => <span className="whitespace-nowrap">{formatPct(row.yieldPct, 3)}</span>,
      value: (row) => row.yieldPct ?? 0,
    },
    {
      key: "actions",
      header: "",
      excludeFromRecordView: true,
      render: (row) => (
        <div className="flex gap-1" onClick={(event) => event.stopPropagation()}>
          <Button
            size="sm"
            variant="secondary"
            disabled={isBusy}
            onClick={() => setDialog({ kind: "edit", id: row.id, form: toForm(row) })}
          >
            Edit
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={isBusy}
            onClick={() => setDialog({ kind: "delete", purchase: row })}
          >
            Delete
          </Button>
        </div>
      ),
    },
  ];

  // Dollars, not cents, so the axis and the tooltip read in the unit a person thinks
  // in. The series is already cumulative and already ordered — see buildGainOverTime.
  const chartData = stats.gainOverTime.map((point) => ({
    date: point.date,
    totalGain: centsToDollars(point.cumulativeGainCents),
  }));

  // No PAGE_CONTAINER here: [section]/page.tsx already wraps every section body in
  // it, and every sibling stock-* view leaves it to that one place.
  return (
    <div>
      {error && (
        <p className="mb-3 rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink">
          {error}
        </p>
      )}

      <div className="mb-6">
        <CollapsibleCard
          title="T-Bill Stats"
          titleIcon={<SlotIcon slot={TBILL_STATS_SLOT} className="h-4 w-4" />}
          defaultOpen
        >
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-5">
            <StatTile
              label="Total Cash Invested"
              value={formatCents(stats.totalInvestedCents)}
              hint={`${stats.purchaseCount} ${stats.purchaseCount === 1 ? "purchase" : "purchases"}`}
            />
            <StatTile label="Total Cash Gained" value={formatCents(stats.totalGainedCents)} />
            <StatTile label="Total Return" value={formatPct(stats.totalReturnPct)} />
            <StatTile label="Total Average Yield" value={formatPct(stats.averageYieldPct, 3)} />
            <StatTile
              label="Total Average Gain"
              value={formatOptionalCents(stats.averageGainCents)}
            />
          </div>

          {/* The movement of total gain over time. Deliberately inside the stats card
              rather than beside it: it is the same five numbers' story, told along an
              axis, and a card of its own would imply a second subject. */}
          <div className="mt-6">
            <h3 className="font-display text-sm font-semibold text-ink">Total gain over time</h3>
            <p className="mt-1 text-xs text-muted">
              Cumulative gain by payout date — a bill counts from the day it matures, not
              the day it was bought.
            </p>
            {chartData.length === 0 ? (
              <p className="mt-3 rounded-md border border-line bg-paper px-3 py-6 text-center text-sm text-muted">
                Nothing to plot yet — add a purchase.
              </p>
            ) : (
              <div className="mt-3">
                <ChartLine
                  data={chartData}
                  series={[{ key: "totalGain", label: "Total gain" }]}
                  xKey="date"
                  height={200}
                  // Straight segments: gain is realised in steps on maturity dates, and
                  // a smoothed curve would imply the total drifted between them.
                  curve="linear"
                  formatValue={(value) => formatCents(Math.round(value * 100))}
                />
              </div>
            )}
          </div>
        </CollapsibleCard>
      </div>

      <div className="mb-4 flex gap-2 max-lg:flex-col">
        <Button variant="primary" onClick={() => setDialog({ kind: "edit", form: emptyForm() })}>
          Add T-Bill purchase
        </Button>
      </div>

      <DataGrid
        columns={columns}
        rows={purchases}
        getRowKey={(row) => row.id}
        enableSelection
        renderSelectionActions={(selectedRows, clearSelection) => (
          <Button
            size="sm"
            variant="danger"
            disabled={isBusy}
            onClick={() =>
              setDialog({ kind: "bulk-delete", rows: selectedRows, clear: clearSelection })
            }
          >
            Delete {selectedRows.length}
          </Button>
        )}
        emptyMessage="No T-Bill purchases yet — add the first one."
        exportFileName="tbill-purchases"
        storageKey="investments-tbill"
      />

      {dialog.kind === "edit" && (
        <TBillEditor
          dialog={dialog}
          isBusy={isBusy}
          onChange={(form) => setDialog({ ...dialog, form })}
          onCancel={() => setDialog({ kind: "closed" })}
          onSave={() => save(dialog)}
        />
      )}

      {dialog.kind === "delete" && (
        <Modal
          title="Delete this T-Bill purchase?"
          onClose={() => setDialog({ kind: "closed" })}
          isBusy={isBusy}
          size="sm"
          footer={
            <>
              <Button
                variant="secondary"
                disabled={isBusy}
                onClick={() => setDialog({ kind: "closed" })}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={isBusy}
                onClick={() => run(() => deleteTBillPurchaseAction(dialog.purchase.id))}
              >
                Delete
              </Button>
            </>
          }
        >
          <p className="text-sm text-ink">
            {dialog.purchase.symbol} bought on {dialog.purchase.datePurchased} for{" "}
            {formatCents(dialog.purchase.amountSpentCents)}. This cannot be undone.
          </p>
        </Modal>
      )}

      {dialog.kind === "bulk-delete" && (
        <Modal
          title={`Delete ${dialog.rows.length} T-Bill ${dialog.rows.length === 1 ? "purchase" : "purchases"}?`}
          onClose={() => setDialog({ kind: "closed" })}
          isBusy={isBusy}
          size="sm"
          footer={
            <>
              <Button
                variant="secondary"
                disabled={isBusy}
                onClick={() => setDialog({ kind: "closed" })}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={isBusy}
                onClick={() =>
                  run(async () => {
                    const result = await deleteTBillPurchasesAction(
                      dialog.rows.map((row) => row.id),
                    );
                    if (result.ok) dialog.clear();
                    return result;
                  })
                }
              >
                Delete {dialog.rows.length}
              </Button>
            </>
          }
        >
          <p className="text-sm text-ink">
            {formatCents(dialog.rows.reduce((sum, row) => sum + row.amountSpentCents, 0))} of
            purchases will be removed. This cannot be undone.
          </p>
        </Modal>
      )}
    </div>
  );
}

/** One labelled field. Local to this form — nothing else needs it. */
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-muted">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

function TBillEditor({
  dialog,
  isBusy,
  onChange,
  onCancel,
  onSave,
}: {
  dialog: Extract<Dialog, { kind: "edit" }>;
  isBusy: boolean;
  onChange: (form: TBillFormInput) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const { form } = dialog;

  /**
   * Updates one field, and keeps Amount Spent in step with shares × price.
   *
   * A typing aid, not a rule: it only fires while Amount Spent still equals what the
   * previous shares × price produced, so a figure typed or edited by hand is never
   * overwritten. The authoritative value is whatever ends up in the box — the broker's
   * settled amount can differ from the product, which is why the column is stored.
   */
  function set(field: keyof TBillFormInput, value: string) {
    const next = { ...form, [field]: value };

    if (field === "sharesPurchased" || field === "purchasePrice") {
      const previousAuto = (Number(form.sharesPurchased) || 0) * (Number(form.purchasePrice) || 0);
      const current = Number(form.amountSpent) || 0;
      const isUntouched = form.amountSpent === "" || Math.abs(current - previousAuto) < 0.005;
      if (isUntouched) {
        const auto = (Number(next.sharesPurchased) || 0) * (Number(next.purchasePrice) || 0);
        next.amountSpent = auto > 0 ? auto.toFixed(2) : "";
      }
    }

    onChange(next);
  }

  return (
    <Modal
      title={dialog.id === undefined ? "Add a T-Bill purchase" : "Edit this T-Bill purchase"}
      onClose={onCancel}
      isBusy={isBusy}
      size="lg"
      footer={
        <>
          <Button variant="secondary" disabled={isBusy} onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" disabled={isBusy} onClick={onSave}>
            {isBusy ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      {dialog.error && (
        <p className="mb-3 rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink">
          {dialog.error}
        </p>
      )}

      {/* One column on a phone, two from 1024px. The fields are short, so two is
          plenty — a five-across form would be unreadable at any width. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Field label="Symbol">
          <input
            className={INPUT_CLASS}
            value={form.symbol}
            onChange={(event) => set("symbol", event.target.value)}
            placeholder="912797LS4"
          />
        </Field>

        <Field label="Date Purchased">
          <input
            type="date"
            className={INPUT_CLASS}
            value={form.datePurchased}
            onChange={(event) => set("datePurchased", event.target.value)}
          />
        </Field>

        <Field label="Share Purchased">
          <input
            type="number"
            step="any"
            min="0"
            className={INPUT_CLASS}
            value={form.sharesPurchased}
            onChange={(event) => set("sharesPurchased", event.target.value)}
          />
        </Field>

        <Field
          label="Purchase Price"
          hint="Per $100 of face value, e.g. 98.6375. The yield is computed against this unit."
        >
          <input
            type="number"
            step="any"
            min="0"
            max="100"
            className={INPUT_CLASS}
            value={form.purchasePrice}
            onChange={(event) => set("purchasePrice", event.target.value)}
          />
        </Field>

        <Field
          label="Amount Spent ($)"
          hint="Filled in from shares × price as you type. Overwrite it with the broker's settled amount if they differ."
        >
          <input
            type="number"
            step="0.01"
            min="0"
            className={INPUT_CLASS}
            value={form.amountSpent}
            onChange={(event) => set("amountSpent", event.target.value)}
          />
        </Field>

        <Field label="Date Payout" hint="The maturity date.">
          <input
            type="date"
            className={INPUT_CLASS}
            value={form.datePayout}
            onChange={(event) => set("datePayout", event.target.value)}
          />
        </Field>

        <Field label="Payout Amount ($)">
          <input
            type="number"
            step="0.01"
            min="0"
            className={INPUT_CLASS}
            value={form.payoutAmount}
            onChange={(event) => set("payoutAmount", event.target.value)}
          />
        </Field>

        <div className="lg:col-span-2">
          <Field label="Description" hint="The broker's own description of the instrument.">
            <textarea
              className={`${INPUT_CLASS} min-h-24`}
              value={form.description}
              onChange={(event) => set("description", event.target.value)}
            />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
