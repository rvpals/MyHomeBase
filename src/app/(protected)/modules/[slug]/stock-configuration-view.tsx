"use client";

// The Configuration section: the three thresholds the next-day scan judges each
// position against. These are module settings, the same rows Administration →
// Module Configuration writes — surfaced here because they're the knobs you reach
// for while looking at the scan, not while doing admin.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import type { NextDayActionThresholds } from "@/lib/next-day-actions";
import {
  DASHBOARD_WIDGET_INFO,
  defaultDashboardWidgets,
  moveDashboardWidget,
  toggleDashboardWidget,
  type DashboardWidgetPreference,
} from "@/lib/stock-dashboard";
import { saveDashboardWidgetsAction } from "./stock-dashboard-actions";
import { saveNextDayThresholdsAction } from "./next-day-actions-actions";

const INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

function PercentField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-ink">{label}</span>
      <input
        value={value}
        inputMode="decimal"
        onChange={(event) => onChange(event.target.value)}
        className={INPUT_CLASS}
      />
      <span className="mt-1 block text-xs text-muted">{hint}</span>
    </label>
  );
}

/**
 * Which dashboard widgets are drawn, and in what order.
 *
 * Reorder is up/down buttons rather than drag-and-drop: six rows don't need a drag
 * library, and buttons are keyboard-operable and screen-reader-legible for free.
 */
function DashboardWidgetsCard({ widgets }: { widgets: DashboardWidgetPreference[] }) {
  const router = useRouter();
  // Local until saved, so reordering half a dozen rows is one write, not six.
  const [draft, setDraft] = useState(widgets);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  const isDirty = JSON.stringify(draft) !== JSON.stringify(widgets);
  const hiddenCount = draft.filter((widget) => !widget.visible).length;

  function update(next: DashboardWidgetPreference[]) {
    setDraft(next);
    setMessage(undefined);
    setError(undefined);
  }

  async function handleSave() {
    setIsSaving(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const result = await saveDashboardWidgetsAction(draft);
      if (!result.ok) {
        setError(result.error ?? "Failed to save the layout.");
        return;
      }
      setMessage("Dashboard layout saved.");
      router.refresh();
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <CollapsibleCard title="Dashboard widgets">
      <p className="text-sm text-muted">
        Untick a widget to keep it off the dashboard, and use the arrows to set the order they
        appear in. Hiding a widget doesn&apos;t stop anything being recorded — it only changes what
        the Dashboard section draws.
      </p>

      <ul className="mt-4 flex flex-col gap-2">
        {draft.map((widget, index) => {
          const info = DASHBOARD_WIDGET_INFO[widget.id];
          return (
            <li
              key={widget.id}
              className={`flex items-start gap-3 rounded-md border border-line p-3 ${
                widget.visible ? "" : "opacity-60"
              }`}
            >
              <span className="mt-0.5 flex shrink-0 flex-col gap-0.5">
                <button
                  type="button"
                  onClick={() => update(moveDashboardWidget(draft, widget.id, "up"))}
                  disabled={index === 0}
                  aria-label={`Move ${info.label} up`}
                  className="rounded border border-line px-1.5 text-xs leading-4 text-brass-dark hover:bg-paper-raised disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => update(moveDashboardWidget(draft, widget.id, "down"))}
                  disabled={index === draft.length - 1}
                  aria-label={`Move ${info.label} down`}
                  className="rounded border border-line px-1.5 text-xs leading-4 text-brass-dark hover:bg-paper-raised disabled:opacity-30"
                >
                  ↓
                </button>
              </span>

              <span className="mt-0.5 shrink-0 font-mono text-xs text-muted">{index + 1}</span>

              <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  checked={widget.visible}
                  onChange={() => update(toggleDashboardWidget(draft, widget.id))}
                  className="mt-1"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink">{info.label}</span>
                  <span className="block text-xs text-muted">{info.description}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      {hiddenCount === draft.length && (
        <p className="mt-3 text-sm text-brass-dark">
          Every widget is hidden — the Dashboard section will be empty.
        </p>
      )}
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      {message && <p className="mt-3 text-sm text-emerald-400">{message}</p>}

      <div className="mt-4 flex gap-2">
        <Button onClick={handleSave} disabled={isSaving || !isDirty}>
          {isSaving ? "Saving…" : "Save layout"}
        </Button>
        <Button variant="secondary" onClick={() => update(defaultDashboardWidgets())} disabled={isSaving}>
          Reset to default
        </Button>
      </div>
    </CollapsibleCard>
  );
}

export function StockConfigurationView({
  thresholds,
  widgets,
}: {
  thresholds: NextDayActionThresholds;
  widgets: DashboardWidgetPreference[];
}) {
  const router = useRouter();
  const [profitTarget, setProfitTarget] = useState(String(thresholds.profitTargetPct));
  const [stockCap, setStockCap] = useState(String(thresholds.stockConcentrationCapPct));
  const [etfCap, setEtfCap] = useState(String(thresholds.etfConcentrationCapPct));
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  async function handleSave() {
    setIsSaving(true);
    setError(undefined);
    setMessage(undefined);
    try {
      // Send the parsed numbers and let the lib schema reject them — a blank box
      // becomes NaN, which `.positive()` refuses, so the message comes from one place.
      const result = await saveNextDayThresholdsAction({
        profitTargetPct: Number(profitTarget),
        stockConcentrationCapPct: Number(stockCap),
        etfConcentrationCapPct: Number(etfCap),
      });
      if (!result.ok) {
        setError(result.error ?? "Failed to save the thresholds.");
        return;
      }
      setMessage("Thresholds saved.");
      router.refresh();
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <DashboardWidgetsCard widgets={widgets} />

      <div className="rounded-xl border border-line p-4">
        <h3 className="font-display text-lg text-ink">Next-day scan thresholds</h3>
        <p className="mt-1 text-sm text-muted">
          Each is a percentage between 0 and 100. They decide when the scan under
          Actionables raises a Trim Profit or Rebalance flag; Stop Loss (a 20-day SMA
          breach) and Strong Buy (a 1.5&times; volume spike) aren&apos;t configurable.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <PercentField
            label="Profit target (%)"
            hint="A position above this total return is flagged Trim Profit."
            value={profitTarget}
            onChange={setProfitTarget}
          />
          <PercentField
            label="Stock concentration cap (%)"
            hint="A single stock worth more than this share of the portfolio is flagged Rebalance."
            value={stockCap}
            onChange={setStockCap}
          />
          <PercentField
            label="ETF concentration cap (%)"
            hint="The same cap for ETFs, normally set higher — an ETF is already diversified."
            value={etfCap}
            onChange={setEtfCap}
          />
        </div>

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        {message && <p className="mt-3 text-sm text-emerald-400">{message}</p>}

        <div className="mt-4">
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? "Saving…" : "Save thresholds"}
          </Button>
        </div>
      </div>
    </div>
  );
}
