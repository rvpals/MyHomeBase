"use client";

// The Indexes card: where the wider market stands today, above your own
// portfolio. S&P, NASDAQ, Dow, Russell, VIX, the metals, oil, the 10-year yield,
// the dollar index and bitcoin.
//
// A client component because the numbers are fetched on demand rather than on
// page load — eleven calls to an unauthenticated provider is not something to do
// on every dashboard render. Press Refresh all and it fetches the lot. Every
// figure arrives already computed by `@/lib/market-indexes`; this file formats
// and lays out, nothing else.

import { useState } from "react";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import type { IndexBoard, IndexQuote, IndexUnit } from "@/lib/market-indexes";
import { centsToDollars, formatCents } from "@/lib/shared/money";
import { loadIndexBoardAction } from "./stock-indexes-actions";

/** Red down, green up, neutral flat — the dashboard's convention. */
function moveClass(cents: number): string {
  if (cents < 0) return "text-red-400";
  if (cents > 0) return "text-emerald-400";
  return "text-muted";
}

/**
 * A level in the unit it's actually quoted in.
 *
 * The reason `IndexUnit` exists: the S&P is a point level (no dollar sign — it
 * isn't a price), gold really is dollars per ounce, and `^TNX` is a percentage.
 * Two decimals throughout, which is how all three are conventionally printed.
 */
function formatLevel(cents: number, unit: IndexUnit): string {
  const value = centsToDollars(cents);
  if (unit === "currency") return formatCents(cents);
  if (unit === "percent") return `${value.toFixed(2)}%`;
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** The day move, signed, in the same unit as the level. */
function formatMove(quote: IndexQuote): string {
  const sign = quote.changeCents >= 0 ? "+" : "-";
  const magnitude = formatLevel(Math.abs(quote.changeCents), quote.unit);
  return `${sign}${magnitude}`;
}

function formatMovePct(quote: IndexQuote): string {
  return `${quote.changePct >= 0 ? "+" : ""}${quote.changePct.toFixed(2)}%`;
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
 * One index, as a row on a wide screen and a stacked block on a narrow one.
 *
 * A four-column table of eleven rows doesn't fit a phone, so below 1024px the
 * same cells restack with `max-lg:` variants — the grid drops to two columns
 * with the label spanning the top. Desktop classes are untouched, so the wide
 * layout can't regress.
 */
function IndexRow({ quote }: { quote: IndexQuote }) {
  // A missing previous close means the level is known but the move isn't — say
  // so with a dash rather than printing a confident "+0.00".
  const moveUnknown = quote.previousCloseCents === 0;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_7rem_6rem_5.5rem] items-baseline gap-2 border-b border-line/60 py-2 last:border-b-0 max-lg:grid-cols-[minmax(0,1fr)_auto] max-lg:gap-x-3 max-lg:gap-y-0.5">
      <span className="truncate text-sm text-ink max-lg:col-span-2 max-lg:font-medium">
        {quote.label}
      </span>
      <span className="text-right font-mono text-sm text-ink max-lg:text-left max-lg:text-base">
        {formatLevel(quote.valueCents, quote.unit)}
      </span>
      {moveUnknown ? (
        <span className="col-span-2 text-right font-mono text-sm text-muted max-lg:col-span-1">
          — no prior close
        </span>
      ) : (
        <>
          <span className={`text-right font-mono text-sm ${moveClass(quote.changeCents)} max-lg:hidden`}>
            {formatMove(quote)}
          </span>
          <span className={`text-right font-mono text-sm ${moveClass(quote.changeCents)}`}>
            {/* Narrow screens get both figures in one cell — two columns of
                numbers beside a wrapping label was unreadable at 390px. */}
            <span className="hidden max-lg:inline">{formatMove(quote)} </span>
            {formatMovePct(quote)}
          </span>
        </>
      )}
    </div>
  );
}

function GroupSection({ label, quotes }: { label: string; quotes: IndexQuote[] }) {
  return (
    <div>
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted">{label}</h3>
      {/* No column headings: three numbers per row (level, move, move %) are
          self-describing next to the label, and a header band per group would be
          four headings repeated four times down one card. */}
      <div className="mt-1">
        {quotes.map((quote) => (
          <IndexRow key={quote.symbol} quote={quote} />
        ))}
      </div>
    </div>
  );
}

export function StockIndexesCard() {
  const [board, setBoard] = useState<IndexBoard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refreshAll() {
    setLoading(true);
    setError(null);
    const result = await loadIndexBoardAction();
    setLoading(false);

    if (!result.ok || !result.board) {
      setError(result.error ?? "Failed to load the index board.");
      return;
    }
    setBoard(result.board);
  }

  const refreshButton = (
    <Button size="sm" variant="secondary" onClick={refreshAll} disabled={loading}>
      {loading ? "Refreshing…" : "Refresh all"}
    </Button>
  );

  return (
    <CollapsibleCard title="Indexes" headerAction={refreshButton}>
      {error && (
        <p className="mb-4 rounded-md border border-red-400/40 bg-red-400/5 p-3 text-sm text-red-400">
          {error}
        </p>
      )}

      {board ? (
        <div className="flex flex-col gap-5">
          {board.groups.map((group) => (
            <GroupSection key={group.group} label={group.label} quotes={group.quotes} />
          ))}

          <p className="text-xs text-muted">
            Fetched {fetchedLabel(board.fetchedAt)}. Levels are quoted in their own units —
            points for an index, dollars for a commodity, percent for a yield.
          </p>

          {/* A provider that lost a symbol is worth saying out loud, so a missing
              row doesn't read as a missing index. */}
          {board.failures.length > 0 && (
            <p className="text-xs text-brass-dark">
              Couldn&apos;t fetch: {board.failures.map((failure) => failure.label).join(", ")}. Press
              Refresh all to try again.
            </p>
          )}
        </div>
      ) : (
        !error && (
          <p className="rounded-md border border-dashed border-line p-4 text-center text-sm text-muted">
            Press <span className="text-ink">Refresh all</span> to fetch the major indexes. They
            aren&apos;t loaded automatically, so opening the dashboard stays fast.
          </p>
        )
      )}
    </CollapsibleCard>
  );
}
