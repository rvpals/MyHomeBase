"use client";

// The "Add by tickers" dialog: pick several symbols, and the screen analyzes every
// recorded buy for each of them.
//
// Route-local rather than a registered component. It is a checkbox list in a
// `Modal` with a filter box — the reusable parts (`Modal`, `Button`) are already
// registered, and what is left is this screen's own arrangement of them. If a second
// screen ever wants a multi-select-from-a-long-list dialog, that is the moment to
// promote it and give it a name.
//
// It holds no analysis logic: pressing Analyze encodes the selection into the URL,
// and the server component does the seeding and the maths. That keeps the result
// bookmarkable and means this file never learns what a tax lot is.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { Modal } from "@/components/modal";
import { TickerLogo } from "@/components/ticker-logo";

/** One selectable ticker, as the section loaded it from the ledger. */
export interface TaxLotTickerOption {
  ticker: string;
  /** How many buy transactions are on record — what the analysis will be built from. */
  buyCount: number;
  /** True when it is still a held position, so the picker can mark it. */
  isHeld: boolean;
}

export function StockTaxLotsTickerPicker({
  options,
  onClose,
}: {
  options: TaxLotTickerOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState("");

  const visible = useMemo(() => {
    const needle = filter.trim().toUpperCase();
    return needle ? options.filter((option) => option.ticker.includes(needle)) : options;
  }, [options, filter]);

  function toggle(ticker: string) {
    setSelected((current) =>
      current.includes(ticker)
        ? current.filter((item) => item !== ticker)
        : [...current, ticker],
    );
  }

  /**
   * Hands the selection to the URL and lets the server do the rest.
   *
   * Only the symbols travel, not their lots: the section reads each ticker's buys
   * itself, so a link stays short no matter how many transactions are behind it and
   * always reflects the current ledger rather than a snapshot of it.
   */
  function analyze() {
    if (selected.length === 0) return;
    const query = new URLSearchParams({ seedTickers: selected.join(",") });
    router.push(`/modules/stock-etfs/tax-lots?${query.toString()}`);
    onClose();
  }

  // Selecting what the filter is currently showing, not the whole list — "all" with
  // a filter applied meaning "all 60 tickers" would be a nasty surprise.
  const allVisibleSelected =
    visible.length > 0 && visible.every((option) => selected.includes(option.ticker));

  function toggleAllVisible() {
    setSelected((current) =>
      allVisibleSelected
        ? current.filter((ticker) => !visible.some((option) => option.ticker === ticker))
        : [...new Set([...current, ...visible.map((option) => option.ticker)])],
    );
  }

  return (
    <Modal
      title="Add by tickers"
      description="Pick the symbols to analyze. Every recorded buy for each one becomes a lot; sells are excluded."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={analyze} disabled={selected.length === 0}>
            {selected.length === 0
              ? "Analyze"
              : `Analyze ${selected.length} ticker${selected.length === 1 ? "" : "s"}`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {options.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">
            No buy transactions on record. Import or add trades first — this screen
            builds its lots from them.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Filter tickers…"
                aria-label="Filter tickers"
                className="min-w-0 flex-1 rounded-md border border-line bg-transparent px-3 py-2 text-sm text-ink"
              />
              <Button size="sm" variant="secondary" onClick={toggleAllVisible}>
                {allVisibleSelected ? "Clear shown" : "Select shown"}
              </Button>
            </div>

            {/* Capped height with its own scroll, so a long ledger doesn't push the
                footer's Analyze button off the dialog. Two columns from `sm` up —
                the rows are short, so one column would waste a desktop's width. */}
            <div className="grid max-h-80 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
              {visible.map((option) => (
                <label
                  key={option.ticker}
                  className="flex cursor-pointer items-center gap-2 rounded-md border border-line px-3 py-2 text-sm hover:border-brass"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(option.ticker)}
                    onChange={() => toggle(option.ticker)}
                  />
                  <TickerLogo ticker={option.ticker} size={18} />
                  <span className="font-medium text-ink">{option.ticker}</span>
                  <span className="ml-auto flex items-center gap-2 text-xs text-muted">
                    {/* Held is worth marking: an unheld symbol has no live price, so
                        its section will say the price was assumed. */}
                    {option.isHeld && (
                      <span className="rounded bg-brass-soft px-1.5 py-0.5 text-brass-dark">
                        held
                      </span>
                    )}
                    <span className="tabular-nums">
                      {option.buyCount} buy{option.buyCount === 1 ? "" : "s"}
                    </span>
                  </span>
                </label>
              ))}
              {visible.length === 0 && (
                <p className="col-span-full p-4 text-center text-sm text-muted">
                  No ticker matches “{filter}”.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
