"use client";

// The Configuration section: the three thresholds the next-day scan judges each
// position against. These are module settings, the same rows Administration →
// Module Configuration writes — surfaced here because they're the knobs you reach
// for while looking at the scan, not while doing admin.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import type { NextDayActionThresholds } from "@/lib/next-day-actions";
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

export function StockConfigurationView({ thresholds }: { thresholds: NextDayActionThresholds }) {
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
