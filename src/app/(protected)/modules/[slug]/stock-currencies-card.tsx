"use client";

// The Foreign Currencies card: what one US dollar buys, across eleven currencies.
//
// A client component for the same reason the Indexes card beside it is one — the
// numbers are fetched on demand rather than on page load, because eleven calls to
// an unauthenticated provider is not something to do on every dashboard render.
// Expanding the card fetches the board; the refresh button refetches it.
//
// Flat rows, deliberately: no per-row detail panel. A currency pair has no 52-week
// range or moving average worth a reader's attention on a household dashboard, so
// the row is the whole story — flag, name, rate, today's move.
//
// Every figure arrives already computed by `@/lib/exchange-rates`; this file lays
// out and formats, and the rounding rule it formats with lives in the library too.

import { useState } from "react";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { SlotIcon } from "@/components/slot-icon";
import { TreeIcon } from "@/components/tree-icons";
import { rateFractionDigits, type CurrencyBoard, type CurrencyRate } from "@/lib/exchange-rates";
import { getIconSlot } from "@/lib/icons";
import { CurrencyFlag } from "./currency-flags";
import { loadCurrencyBoardAction } from "./stock-currencies-actions";

// Module scope: the registry is a static table, so this is a lookup, not I/O. The
// non-null assertion is safe for an id that ships in the repo — an unregistered one
// is a build-time mistake, not a runtime condition.
const CURRENCIES_SLOT = getIconSlot("stock_card_currencies")!;

/**
 * A board younger than this is reused when the card is reopened.
 *
 * The same minute the Indexes card uses, for the same reason: reopening a card you
 * just closed should not cost another round of provider calls. The refresh button
 * ignores this and always refetches.
 */
const FRESH_FOR_MS = 60_000;

/** Red down, green up, neutral flat — the dashboard's convention. */
function moveClass(changePct: number | undefined): string {
  if (changePct === undefined) return "text-muted";
  if (changePct < 0) return "text-red-400";
  if (changePct > 0) return "text-emerald-400";
  return "text-muted";
}

/**
 * The rate itself, to the precision its magnitude deserves.
 *
 * `rateFractionDigits` decides how many places; this only prints. Grouped with
 * `toLocaleString` so KRW reads 1,327.45 rather than 1327.45.
 */
function formatRate(rate: number): string {
  const digits = rateFractionDigits(rate);
  return rate.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** The day move as a signed percentage, or an em-dash when there's no previous close. */
function formatMovePct(changePct: number | undefined): string {
  if (changePct === undefined) return "—";
  return `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%`;
}

/** When the board was fetched, in the roughest terms that are still true. */
function fetchedLabel(isoInstant: string): string {
  const then = Date.parse(isoInstant);
  if (Number.isNaN(then)) return "";
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

/**
 * One currency.
 *
 * The row reads left to right as a sentence — flag, "1 USD =", the amount, the
 * code — because that is the question the card answers. The move sits to the
 * right, where every other number on this dashboard puts it.
 *
 * Narrow screens keep the same single row: it is four short pieces, and stacking
 * them would make eleven rows twice as tall for no gain. The label is what
 * truncates, never the number.
 */
function CurrencyRow({ rate }: { rate: CurrencyRate }) {
  return (
    <div className="flex items-center gap-3 border-b border-line/50 py-2 last:border-b-0 max-lg:gap-2">
      <CurrencyFlag flag={rate.flag} label={rate.label} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-ink">{rate.label}</p>
        <p className="truncate text-xs text-muted">1 USD &rarr; {rate.code}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="font-mono text-sm tabular-nums text-ink">{formatRate(rate.rate)}</p>
        <p className={`font-mono text-xs tabular-nums ${moveClass(rate.changePct)}`}>
          {formatMovePct(rate.changePct)}
        </p>
      </div>
    </div>
  );
}

export function ForeignCurrenciesCard() {
  const [open, setOpen] = useState(false);
  const [board, setBoard] = useState<CurrencyBoard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    const result = await loadCurrencyBoardAction();
    setLoading(false);

    if (!result.ok || !result.board) {
      setError(result.error ?? "Failed to load the currency board.");
      return;
    }
    setBoard(result.board);
  }

  /**
   * Opening the card is a request for today's rates, so fetch them. Collapsing
   * fetches nothing, and a fetch already in flight is left alone.
   *
   * No after-hours shortcut, unlike Indexes: FX trades around the clock from
   * Sunday evening to Friday evening, so "the market is closed, reuse the board"
   * would be wrong for most of the hours anyone is actually looking at this.
   */
  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next || loading) return;

    const fetchedAt = board ? Date.parse(board.fetchedAt) : Number.NaN;
    const isFresh = !Number.isNaN(fetchedAt) && Date.now() - fetchedAt < FRESH_FOR_MS;
    if (!isFresh) void refresh();
  }

  // Icon-only, matching the dashboard's other refresh controls, so `title` and
  // `ariaLabel` carry the whole meaning. It spins while the fetch is in flight.
  const refreshButton = (
    <Button
      size="sm"
      variant="secondary"
      onClick={refresh}
      disabled={loading}
      title="Refresh the exchange rates"
      ariaLabel="Refresh the exchange rates"
      className="px-2"
    >
      <TreeIcon
        name="refresh"
        className={`h-4 w-4 ${loading ? "animate-spin motion-reduce:animate-none" : ""}`}
      />
    </Button>
  );

  return (
    <CollapsibleCard
      title="Foreign Currencies"
      titleIcon={<SlotIcon slot={CURRENCIES_SLOT} className="h-4 w-4" />}
      open={open}
      onOpenChange={handleOpenChange}
      headerAction={refreshButton}
    >
      {error && (
        <p className="mb-4 rounded-md border border-red-400/40 bg-red-400/5 p-3 text-sm text-red-400">
          {error}
        </p>
      )}

      {board ? (
        <>
          {/* Two columns on a wide screen so eleven rows don't run long; one on a
              phone, where side-by-side rates would each be too narrow to read. */}
          <div className="grid grid-cols-1 gap-x-8 lg:grid-cols-2">
            {board.rates.map((rate) => (
              <CurrencyRow key={rate.code} rate={rate} />
            ))}
          </div>

          {board.rates.length === 0 && !error && (
            <p className="py-6 text-center text-sm text-muted">
              No rates came back. Press refresh to try again.
            </p>
          )}

          <p className="mt-3 text-xs text-muted">
            Mid-market rates, {fetchedLabel(board.fetchedAt)}. Indicative only — not the
            rate a bank will give you.
          </p>

          {board.failures.length > 0 && (
            <p className="mt-2 text-xs text-muted">
              Couldn&apos;t fetch: {board.failures.map((failure) => failure.code).join(", ")}.
              Press refresh to try again.
            </p>
          )}
        </>
      ) : (
        !error && (
          <p className="py-6 text-center text-sm text-muted">
            {loading ? "Fetching rates…" : "Press refresh to load today's rates."}
          </p>
        )
      )}
    </CollapsibleCard>
  );
}
