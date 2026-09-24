"use client";

// The Ticker Monitor screen: set, edit and remove the conditions watched for
// one symbol.
//
// Route-local rather than a registered component, the same call
// `TickerConsultDialog` makes — it knows this module's server actions, which a
// shared component must not. The generic pieces it is built from (`Modal`,
// `Button`, the form input class) all come from the registry.

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/button";
import { Modal } from "@/components/modal";
import { TreeIcon } from "@/components/tree-icons";
import { centsToDollars, dollarsToCents, formatCents } from "@/lib/shared/money";
import { DEFAULT_BAND_PCT, type MonitorType } from "@/lib/ticker-monitors";
import {
  createMonitorAction,
  deleteMonitorAction,
  loadTickerMonitorsAction,
  setMonitorEnabledAction,
  updateMonitorAction,
  type TickerMonitorScreen,
} from "./ticker-monitors-actions";

/** Copied from design.md's form-input rule rather than invented. */
const INPUT_CLASS =
  "rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

/** The three monitors, in the order the request listed them. */
const MONITOR_CHOICES: { value: MonitorType; label: string; hint: string }[] = [
  {
    value: "gain_near_amount",
    label: "Unrealized gain near an amount",
    hint: "Tell me when the gain on this holding approaches a dollar figure.",
  },
  {
    value: "loss_near_amount",
    label: "Unrealized loss near an amount",
    hint: "Leave the amount at 0 for break-even — the bad one has nearly recovered.",
  },
  {
    value: "gain_near_pct_of_cost",
    label: "Unrealized gain near a % of cost basis",
    hint: "Tell me when the gain approaches a share of what I paid.",
  },
];

export interface TickerMonitorDialogProps {
  ticker: string;
  onClose: () => void;
  /** Lets the viewer refresh its warning marker after a change. */
  onChanged?: () => void;
}

export function TickerMonitorDialog({
  ticker,
  onClose,
  onChanged,
}: TickerMonitorDialogProps) {
  const [screen, setScreen] = useState<TickerMonitorScreen | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [isSaving, setIsSaving] = useState(false);

  // The form. One piece of state per field, since the shape is small and the
  // type governs which of the two target inputs is shown.
  const [editingId, setEditingId] = useState<number | undefined>();
  const [monitorType, setMonitorType] = useState<MonitorType>("gain_near_amount");
  const [amountDollars, setAmountDollars] = useState("");
  const [percent, setPercent] = useState("");
  const [bandPct, setBandPct] = useState(String(DEFAULT_BAND_PCT));

  const load = useCallback(async () => {
    try {
      setScreen(await loadTickerMonitorsAction(ticker));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load monitors.");
    }
  }, [ticker]);

  useEffect(() => {
    void load();
  }, [load]);

  function resetForm() {
    setEditingId(undefined);
    setMonitorType("gain_near_amount");
    setAmountDollars("");
    setPercent("");
    setBandPct(String(DEFAULT_BAND_PCT));
  }

  function startEditing(row: TickerMonitorScreen["rows"][number]) {
    setEditingId(row.monitor.id);
    setMonitorType(row.monitor.monitorType);
    setAmountDollars(
      row.monitor.monitorType === "gain_near_pct_of_cost"
        ? ""
        : String(centsToDollars(row.monitor.targetCents)),
    );
    setPercent(
      row.monitor.monitorType === "gain_near_pct_of_cost" ? String(row.monitor.targetPct) : "",
    );
    setBandPct(String(row.monitor.bandPct));
  }

  async function save() {
    setError(undefined);
    setIsSaving(true);
    try {
      const isPercentType = monitorType === "gain_near_pct_of_cost";
      // A blank amount is 0, which is meaningful for the loss type (break-even)
      // and refused by the schema for the gain type — so the message the reader
      // gets comes from `lib`, not from a second copy of the rule here.
      const targetCents = isPercentType ? 0 : dollarsToCents(amountDollars.trim() || "0");
      const targetPct = isPercentType ? Number(percent.trim() || "0") : 0;
      const band = Number(bandPct.trim() || String(DEFAULT_BAND_PCT));

      const input = {
        ticker,
        monitorType,
        targetCents,
        targetPct,
        bandPct: band,
        isEnabled: true,
      };

      if (editingId === undefined) {
        await createMonitorAction(input);
      } else {
        await updateMonitorAction({ ...input, id: editingId });
      }

      resetForm();
      await load();
      onChanged?.();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save the monitor.");
    } finally {
      setIsSaving(false);
    }
  }

  async function remove(id: number) {
    setIsSaving(true);
    try {
      await deleteMonitorAction(id);
      if (editingId === id) resetForm();
      await load();
      onChanged?.();
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleEnabled(id: number, isEnabled: boolean) {
    setIsSaving(true);
    try {
      await setMonitorEnabledAction(id, isEnabled);
      await load();
      onChanged?.();
    } finally {
      setIsSaving(false);
    }
  }

  const isPercentType = monitorType === "gain_near_pct_of_cost";
  const activeChoice = MONITOR_CHOICES.find((choice) => choice.value === monitorType);

  return (
    <Modal
      title={`${ticker} — Ticker Monitor`}
      size="lg"
      onClose={onClose}
      description="Monitors are checked whenever prices refresh. A match files a message and marks the ticker."
      footer={
        <Button variant="primary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="flex flex-col gap-5">
        {error && (
          <p className="rounded-md border border-line bg-paper p-3 text-sm text-ink">{error}</p>
        )}

        {/* What the monitors are judged against. Shown because every one of the
            three is relative to these two numbers, and a reader setting a
            target needs to see where they are starting from. */}
        {screen && (
          <div className="flex flex-wrap gap-3">
            <div className="rounded-xl border border-line p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">
                Unrealized gain/loss
              </p>
              <p className="font-display text-xl text-ink">
                {formatCents(screen.unrealizedGainLossCents)}
              </p>
            </div>
            <div className="rounded-xl border border-line p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">
                Cost basis
              </p>
              <p className="font-display text-xl text-ink">{formatCents(screen.costCents)}</p>
            </div>
          </div>
        )}

        {screen && screen.costCents <= 0 && (
          <p className="rounded-md border border-line bg-paper p-3 text-sm text-muted">
            This ticker has no recorded cost basis, so no monitor can be judged against it.
            Import or enter your transactions first.
          </p>
        )}

        {/* The existing monitors. */}
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-ink">Monitors</h3>
          {!screen && <p className="text-sm text-muted">Loading…</p>}
          {screen && screen.rows.length === 0 && (
            <p className="text-sm text-muted">No monitors set for {ticker} yet.</p>
          )}
          {screen?.rows.map((row) => (
            <div
              key={row.monitor.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-line bg-paper p-3"
            >
              {row.isWarning && (
                <TreeIcon name="warning" className="h-4 w-4 shrink-0 text-brass-dark" />
              )}
              <span className={`text-sm ${row.monitor.isEnabled ? "text-ink" : "text-muted"}`}>
                {row.summary}
              </span>
              <span className="text-xs text-muted">within {row.monitor.bandPct}%</span>
              {!row.monitor.isEnabled && (
                <span className="rounded bg-line/60 px-1.5 py-0.5 text-xs text-muted">Off</span>
              )}
              <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => toggleEnabled(row.monitor.id, !row.monitor.isEnabled)}
                  disabled={isSaving}
                  className="rounded-md px-2 py-0.5 text-xs font-medium text-muted transition-colors hover:bg-line/60 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass disabled:opacity-50"
                >
                  {row.monitor.isEnabled ? "Turn off" : "Turn on"}
                </button>
                <button
                  type="button"
                  onClick={() => startEditing(row)}
                  disabled={isSaving}
                  title="Edit this monitor"
                  aria-label="Edit this monitor"
                  className="rounded-md p-1 text-muted transition-colors hover:bg-line/60 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass disabled:opacity-50"
                >
                  <TreeIcon name="pencil" className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => remove(row.monitor.id)}
                  disabled={isSaving}
                  title="Delete this monitor"
                  aria-label="Delete this monitor"
                  className="rounded-md p-1 text-muted transition-colors hover:bg-line/60 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass disabled:opacity-50"
                >
                  <TreeIcon name="trash" className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </section>

        {/* The form. */}
        <section className="flex flex-col gap-3 border-t border-line pt-4">
          <h3 className="text-sm font-medium text-ink">
            {editingId === undefined ? "Add a monitor" : "Edit monitor"}
          </h3>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-muted">
              Watch for
            </span>
            <select
              value={monitorType}
              onChange={(event) => setMonitorType(event.target.value as MonitorType)}
              className={INPUT_CLASS}
            >
              {MONITOR_CHOICES.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
            {activeChoice && <span className="text-xs text-muted">{activeChoice.hint}</span>}
          </label>

          <div className="flex flex-wrap gap-3">
            {isPercentType ? (
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium uppercase tracking-wide text-muted">
                  Percent of cost basis
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.1"
                  value={percent}
                  onChange={(event) => setPercent(event.target.value)}
                  placeholder="20"
                  className={`${INPUT_CLASS} w-40`}
                />
              </label>
            ) : (
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium uppercase tracking-wide text-muted">
                  Amount ($)
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={amountDollars}
                  onChange={(event) => setAmountDollars(event.target.value)}
                  placeholder={monitorType === "loss_near_amount" ? "0" : "10000"}
                  className={`${INPUT_CLASS} w-40`}
                />
              </label>
            )}

            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-muted">
                &ldquo;Near&rdquo; band (%)
              </span>
              <input
                type="number"
                inputMode="decimal"
                min="0.1"
                max="100"
                step="0.5"
                value={bandPct}
                onChange={(event) => setBandPct(event.target.value)}
                className={`${INPUT_CLASS} w-40`}
              />
              <span className="text-xs text-muted">
                How close counts as near. 5% of $10,000 fires from $9,500.
              </span>
            </label>
          </div>

          <div className="flex gap-2">
            <Button variant="primary" onClick={save} disabled={isSaving}>
              {editingId === undefined ? "Add monitor" : "Save changes"}
            </Button>
            {editingId !== undefined && (
              <Button variant="secondary" onClick={resetForm} disabled={isSaving}>
                Cancel
              </Button>
            )}
          </div>
        </section>
      </div>
    </Modal>
  );
}
