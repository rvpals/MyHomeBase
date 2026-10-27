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
import {
  DEFAULT_BAND_PCT,
  needsCostBasis,
  usesBand,
  type MonitorType,
  type MoveDirection,
} from "@/lib/ticker-monitors";
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

/**
 * The monitors, gain/loss ones first and the two security-level ones (0148)
 * after — the order groups them by what they are measured against, which is
 * also the order the cost-basis guard applies in.
 */
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
  {
    value: "price_near_amount",
    label: "Price per share reaches an amount",
    hint: "Fires while the price is within the band of your target — approaching from either side. Use a small band (0.5%) to catch it close to the target itself.",
  },
  {
    value: "day_move_pct",
    label: "Price moves up or down % in a day",
    hint: "Measured against the previous close, like the % change on a quote screen. Only as current as your last price refresh.",
  },
];

/** The two directions, for the day-move type. */
const DIRECTION_CHOICES: { value: MoveDirection; label: string }[] = [
  { value: "up", label: "Up" },
  { value: "down", label: "Down" },
];

/**
 * Which box holds this type's target: the percent one, or the dollar one.
 *
 * Two types read `targetPct` — the cost-basis share and the day move — so this
 * is a predicate rather than a comparison against a single value. Getting it
 * wrong shows the reader an empty field and silently saves a 0.
 */
function usesPercentTarget(monitorType: MonitorType): boolean {
  return monitorType === "gain_near_pct_of_cost" || monitorType === "day_move_pct";
}

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
  const [direction, setDirection] = useState<MoveDirection>("up");
  // Delivery, not condition — so it is not cleared or hidden by the type
  // switch below the way the target fields are (migrations/0149).
  const [isPopup, setIsPopup] = useState(false);

  const load = useCallback(async () => {
    try {
      setScreen(await loadTickerMonitorsAction(ticker));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load monitors.");
    }
  }, [ticker]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing state to a prop or to browser-only data that is unknowable during render; runs on mount or when that input changes, not in a loop.
    void load();
  }, [load]);

  function resetForm() {
    setEditingId(undefined);
    setMonitorType("gain_near_amount");
    setAmountDollars("");
    setPercent("");
    setBandPct(String(DEFAULT_BAND_PCT));
    setDirection("up");
    setIsPopup(false);
  }

  function startEditing(row: TickerMonitorScreen["rows"][number]) {
    setEditingId(row.monitor.id);
    setMonitorType(row.monitor.monitorType);
    // Which field holds this type's target decides which one is repopulated.
    // `usesPercentTarget` rather than a test against one type: `day_move_pct`
    // also carries its target in `targetPct`, and reading it back into the
    // amount box would blank the threshold on every edit.
    const isPercent = usesPercentTarget(row.monitor.monitorType);
    setAmountDollars(isPercent ? "" : String(centsToDollars(row.monitor.targetCents)));
    setPercent(isPercent ? String(row.monitor.targetPct) : "");
    setBandPct(String(row.monitor.bandPct));
    setDirection(row.monitor.direction === "down" ? "down" : "up");
    setIsPopup(row.monitor.isPopup);
  }

  async function save() {
    setError(undefined);
    setIsSaving(true);
    try {
      const isPercentType = usesPercentTarget(monitorType);
      // A blank amount is 0, which is meaningful for the loss type (break-even)
      // and refused by the schema for the gain type — so the message the reader
      // gets comes from `lib`, not from a second copy of the rule here.
      const targetCents = isPercentType ? 0 : dollarsToCents(amountDollars.trim() || "0");
      const targetPct = isPercentType ? Number(percent.trim() || "0") : 0;
      // The band is stored for every type that reads one. `day_move_pct` ignores
      // it, so it is sent as the default rather than as whatever the hidden box
      // last held — a stored band nothing reads should at least not look edited.
      const band = usesBand(monitorType)
        ? Number(bandPct.trim() || String(DEFAULT_BAND_PCT))
        : DEFAULT_BAND_PCT;

      const input = {
        ticker,
        monitorType,
        targetCents,
        targetPct,
        bandPct: band,
        // Only the day-move type may carry one; the schema refuses it on the
        // rest rather than blanking it silently.
        direction: monitorType === "day_move_pct" ? direction : ("" as const),
        isEnabled: true,
        isPopup,
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

  const isPercentType = usesPercentTarget(monitorType);
  const isDayMove = monitorType === "day_move_pct";
  const showBand = usesBand(monitorType);
  const activeChoice = MONITOR_CHOICES.find((choice) => choice.value === monitorType);
  // The basis warning only applies to the types actually measured against it.
  const basisBlocks = screen !== undefined && screen.costCents <= 0 && needsCostBasis(monitorType);

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
            {/* The two figures the new types are set against, shown for the
                same reason as the first pair: a reader typing a price target
                needs to see where the price is now. */}
            <div className="rounded-xl border border-line p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">
                Price per share
              </p>
              <p className="font-display text-xl text-ink">
                {screen.pricePerShareCents > 0 ? formatCents(screen.pricePerShareCents) : "—"}
              </p>
            </div>
            <div className="rounded-xl border border-line p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">
                Today&rsquo;s move
              </p>
              <p className="font-display text-xl text-ink">
                {screen.dayChangePct === undefined
                  ? "—"
                  : `${screen.dayChangePct >= 0 ? "+" : ""}${screen.dayChangePct.toFixed(2)}%`}
              </p>
            </div>
          </div>
        )}

        {/* Shown only while a basis-dependent type is selected: a price target
            on a holding with no transactions is perfectly valid (0148), and
            warning about it unconditionally would say the opposite. */}
        {basisBlocks && (
          <p className="rounded-md border border-line bg-paper p-3 text-sm text-muted">
            This ticker has no recorded cost basis, so a gain or loss monitor cannot be judged
            against it. Import or enter your transactions first — or watch the share price
            instead, which needs no basis.
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
              {/* The threshold type stores a band nothing reads, so printing
                  "within 5%" beside it would describe behaviour it does not
                  have. */}
              {usesBand(row.monitor.monitorType) && (
                <span className="text-xs text-muted">within {row.monitor.bandPct}%</span>
              )}
              {/* Shown on the row so the option is legible without opening
                  Edit — it changes how this monitor behaves, which the summary
                  sentence beside it does not say. */}
              {row.monitor.isPopup && (
                <span className="rounded bg-line/60 px-1.5 py-0.5 text-xs text-muted">Popup</span>
              )}
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
            {/* Only the day-move type has a direction, and it is meaningless
                without one — so it leads, before the size of the move. */}
            {isDayMove && (
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium uppercase tracking-wide text-muted">
                  Direction
                </span>
                <select
                  value={direction}
                  onChange={(event) => setDirection(event.target.value as MoveDirection)}
                  className={`${INPUT_CLASS} w-40`}
                >
                  {DIRECTION_CHOICES.map((choice) => (
                    <option key={choice.value} value={choice.value}>
                      {choice.label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {isPercentType ? (
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium uppercase tracking-wide text-muted">
                  {isDayMove ? "Move size (%)" : "Percent of cost basis"}
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.1"
                  value={percent}
                  onChange={(event) => setPercent(event.target.value)}
                  placeholder={isDayMove ? "3" : "20"}
                  className={`${INPUT_CLASS} w-40`}
                />
                {isDayMove && (
                  <span className="text-xs text-muted">
                    Fires at this move or beyond, not near it.
                  </span>
                )}
              </label>
            ) : (
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium uppercase tracking-wide text-muted">
                  {monitorType === "price_near_amount" ? "Target price ($)" : "Amount ($)"}
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

            {/* Hidden for the threshold type, which ignores it: a band either
                side of a 3% move would be true from -2% to +8%, i.e. always. */}
            {showBand && (
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
                  {monitorType === "price_near_amount"
                    ? "How close counts as near, either side. 5% of $150 fires from $142.50."
                    : "How close counts as near. 5% of $10,000 fires from $9,500."}
                </span>
              </label>
            )}
          </div>

          {/* Outside the fields row above: that row holds the parameters of the
              *condition*, which change with the type. This is how the monitor
              reports, which every type carries the same way. */}
          <label className="flex max-w-md items-start gap-3">
            <input
              type="checkbox"
              checked={isPopup}
              onChange={(event) => setIsPopup(event.target.checked)}
              className="mt-1"
            />
            <span>
              <span className="block text-sm text-ink">Popup</span>
              <span className="block text-sm text-muted">
                Also interrupt the home screen when this fires, with a notice to dismiss.
                It still files a message either way.
              </span>
            </span>
          </label>

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
