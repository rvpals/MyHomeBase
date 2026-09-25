"use client";

// The Indexes card: where the wider market stands today, above your own
// portfolio. S&P, NASDAQ, Dow, Russell, VIX, the metals, oil, the 10-year yield,
// the dollar index and bitcoin.
//
// A client component because the numbers are fetched on demand rather than on
// page load — thirty-three calls to an unauthenticated provider is not something
// to do on every dashboard render. Expanding the card fetches the lot, and the
// refresh button refetches it. Every figure arrives already computed by
// `@/lib/market-indexes`; this file formats and lays out, nothing else.
//
// Each row opens to a detail panel: the day and 52-week ranges, the trailing
// one-year change, the 50- and 200-day averages, the all-time high, and an
// intraday sparkline. Those ride on the board's second pass, so they are
// fetched with the board rather than per row — see `includeDetail`. Coverage
// varies by symbol (the commodity futures report no one-year change), so every
// figure renders an em-dash when it's missing.

import { useState } from "react";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { SlotIcon } from "@/components/slot-icon";
import { Sparkline } from "@/components/sparkline";
import { IndexLogo } from "@/components/ticker-logo";
import { TreeIcon } from "@/components/tree-icons";
import { getIconSlot } from "@/lib/icons";
import { rangePosition, type IndexBoard, type IndexQuote, type IndexUnit } from "@/lib/market-indexes";
import { centsToDollars, formatCents } from "@/lib/shared/money";
import { loadIndexBoardAction } from "./stock-indexes-actions";

// Module scope: the registry is a static table, so this is a lookup, not I/O. The
// non-null assertion is safe for an id that ships in the repo — an unregistered one
// is a build-time mistake, not a runtime condition.
const INDEXES_SLOT = getIconSlot("stock_card_indexes")!;

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

/** A signed percentage, or an em-dash when the provider didn't report one. */
function formatPct(value: number | undefined): string {
  if (value === undefined) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

/**
 * Where today's level sits in its 52-week range, as a track with a marker.
 *
 * One-off markup rather than a component: it's a positioned dot on a line, used
 * on exactly this screen. Worth promoting if a second caller ever wants it.
 */
function RangeTrack({ position }: { position: number }) {
  return (
    <span className="relative inline-block h-1 w-full rounded-full bg-line" aria-hidden="true">
      <span
        className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brass"
        style={{ left: `${position}%` }}
      />
    </span>
  );
}

/** One label/value pair in the expanded panel. */
function DetailFigure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium uppercase tracking-wide text-muted">{label}</span>
      <span className="font-mono text-sm text-ink">{value}</span>
    </div>
  );
}

/**
 * The second-pass figures, revealed when a row is expanded.
 *
 * Every figure is optional and independently absent — the three commodity
 * futures return no one-year change while everything around it is present — so
 * each renders an em-dash rather than the panel branching on which ones arrived.
 */
function IndexDetailPanel({ quote }: { quote: IndexQuote }) {
  const detail = quote.detail;
  const level = (cents: number | undefined) =>
    cents === undefined ? "—" : formatLevel(cents, quote.unit);

  const position =
    detail &&
    rangePosition(quote.valueCents, detail.fiftyTwoWeekLowCents, detail.fiftyTwoWeekHighCents);

  const hasDayRange = quote.dayHighCents > 0 && quote.dayLowCents > 0;

  return (
    <div className="border-b border-line/60 bg-paper-raised/40 px-3 py-3">
      {!detail ? (
        <p className="text-xs text-muted">
          No extra detail for this index — the provider didn&apos;t return it.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {detail.intradayCents.length > 1 && (
            <div className="flex items-center gap-3">
              <Sparkline
                values={detail.intradayCents}
                baseline={
                  quote.previousCloseCents > 0 ? { value: quote.previousCloseCents } : undefined
                }
                width={200}
                height={36}
                className="max-lg:w-full"
                ariaLabel={`${quote.label} intraday, ${detail.intradayCents.length} points, ${formatMovePct(quote)} on the day`}
              />
              <span className="text-xs text-muted">Today, vs. the previous close</span>
            </div>
          )}

          <div className="grid grid-cols-4 gap-3 max-lg:grid-cols-2">
            <DetailFigure
              label="Day range"
              value={
                hasDayRange ? `${level(quote.dayLowCents)} – ${level(quote.dayHighCents)}` : "—"
              }
            />
            <DetailFigure
              label="52-week"
              value={
                detail.fiftyTwoWeekLowCents === undefined
                  ? "—"
                  : `${level(detail.fiftyTwoWeekLowCents)} – ${level(detail.fiftyTwoWeekHighCents)}`
              }
            />
            <DetailFigure label="1-year" value={formatPct(detail.oneYearChangePct)} />
            <DetailFigure label="All-time high" value={level(detail.allTimeHighCents)} />
            <DetailFigure label="50-day avg" value={level(detail.fiftyDayAverageCents)} />
            <DetailFigure label="200-day avg" value={level(detail.twoHundredDayAverageCents)} />
          </div>

          {position !== undefined && (
            <div className="flex flex-col gap-1">
              <RangeTrack position={position} />
              <span className="text-xs text-muted">
                {position.toFixed(0)}% of the 52-week range
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One index, as a row on a wide screen and a stacked block on a narrow one.
 *
 * A four-column table of eleven rows doesn't fit a phone, so below 1024px the
 * same cells restack with `max-lg:` variants — the grid drops to two columns
 * with the label spanning the top. Desktop classes are untouched, so the wide
 * layout can't regress.
 *
 * The row is a `<button>` because tapping it expands the detail panel. Six more
 * figures per row is more than either screen width can carry inline — the wide
 * grid would need ten columns and the phone would stack to a screenful per
 * index — so the extras live behind a disclosure on both.
 */
function IndexRow({
  quote,
  expanded,
  onToggle,
}: {
  quote: IndexQuote;
  expanded: boolean;
  onToggle: () => void;
}) {
  // A missing previous close means the level is known but the move isn't — say
  // so with a dash rather than printing a confident "+0.00".
  const moveUnknown = quote.previousCloseCents === 0;

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className="grid w-full grid-cols-[minmax(0,1fr)_7rem_6rem_5.5rem] items-baseline gap-2 border-b border-line/60 py-2 text-left last:border-b-0 hover:bg-paper-raised/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass max-lg:grid-cols-[minmax(0,1fr)_auto] max-lg:gap-x-3 max-lg:gap-y-0.5"
    >
      {/* Icon and label travel together in one flex cell, so the narrow layout
          (where the label spans both columns) needs no second arrangement —
          the pair just spans instead of the text alone. */}
      <span className="flex min-w-0 items-center gap-2 self-center text-sm text-ink max-lg:col-span-2 max-lg:font-medium">
        {/* The same `&rsaquo;` disclosure `CollapsibleCard` uses for its own
            header, so a row's chevron and the card's read as one vocabulary.
            There is no chevron in `TreeIcon` — this is the house convention. */}
        <span
          className={`shrink-0 text-muted transition-transform motion-reduce:transition-none ${
            expanded ? "rotate-90" : ""
          }`}
          aria-hidden
        >
          &rsaquo;
        </span>
        <IndexLogo symbol={quote.symbol} label={quote.label} />
        <span className="truncate">{quote.label}</span>
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
    </button>
  );
}

function GroupSection({
  label,
  quotes,
  expanded,
  onToggle,
}: {
  label: string;
  quotes: IndexQuote[];
  expanded: Set<string>;
  onToggle: (symbol: string) => void;
}) {
  return (
    <div>
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted">{label}</h3>
      {/* No column headings: three numbers per row (level, move, move %) are
          self-describing next to the label, and a header band per group would be
          four headings repeated four times down one card. */}
      <div className="mt-1">
        {quotes.map((quote) => (
          <div key={quote.symbol}>
            <IndexRow
              quote={quote}
              expanded={expanded.has(quote.symbol)}
              onToggle={() => onToggle(quote.symbol)}
            />
            {expanded.has(quote.symbol) && <IndexDetailPanel quote={quote} />}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * How old a board may be and still count as current when the card is reopened.
 *
 * Expanding fetches, but a collapse-and-expand a few seconds later shouldn't
 * cost another eleven provider calls — the levels won't have moved. The Refresh
 * button ignores this and always refetches.
 */
const FRESH_FOR_MS = 60_000;

export function StockIndexesCard() {
  const [open, setOpen] = useState(false);
  const [board, setBoard] = useState<IndexBoard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Which rows are showing their detail panel. Client view state, nothing more. */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggleRow(symbol: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });
  }

  async function refreshAll() {
    setLoading(true);
    setError(null);
    // `includeDetail` triples the provider calls, which is why the board asks
    // for it once here rather than per row: fetching on expand would mean a
    // visible wait every time a row is opened, and the whole board's detail
    // costs one round of parallel calls whether one row wants it or eleven do.
    const result = await loadIndexBoardAction({ includeDetail: true });
    setLoading(false);

    if (!result.ok || !result.board) {
      setError(result.error ?? "Failed to load the index board.");
      return;
    }
    setBoard(result.board);
  }

  /**
   * Opening the card is a request for today's numbers, so fetch them — nobody
   * expands Indexes to read a stale board. Collapsing fetches nothing, and a
   * fetch already in flight is left alone.
   */
  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next || loading) return;

    const fetchedAt = board ? Date.parse(board.fetchedAt) : Number.NaN;
    const isFresh = !Number.isNaN(fetchedAt) && Date.now() - fetchedAt < FRESH_FOR_MS;
    if (!isFresh) void refreshAll();
  }

  // Icon-only, matching the dashboard's other refresh control, so `title` and
  // `ariaLabel` carry the whole meaning. It spins while the fetch is in flight —
  // that's the only progress signal an eleven-call round trip gets.
  const refreshButton = (
    <Button
      size="sm"
      variant="secondary"
      onClick={refreshAll}
      disabled={loading}
      title="Refresh the major indexes"
      ariaLabel="Refresh the major indexes"
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
      title="Indexes"
      titleIcon={<SlotIcon slot={INDEXES_SLOT} className="h-4 w-4" />}
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
        <div className="flex flex-col gap-5">
          {board.groups.map((group) => (
            <GroupSection
              key={group.group}
              label={group.label}
              quotes={group.quotes}
              expanded={expanded}
              onToggle={toggleRow}
            />
          ))}

          <p className="text-xs text-muted">
            Fetched {fetchedLabel(board.fetchedAt)}. Levels are quoted in their own units —
            points for an index, dollars for a commodity, percent for a yield. Open a row for
            its ranges and averages; each sparkline is scaled to its own day, so two of them
            can&apos;t be compared to each other.
          </p>

          {/* A provider that lost a symbol is worth saying out loud, so a missing
              row doesn't read as a missing index. */}
          {board.failures.length > 0 && (
            <p className="text-xs text-brass-dark">
              Couldn&apos;t fetch: {board.failures.map((failure) => failure.label).join(", ")}. Press
              Refresh to try again.
            </p>
          )}
        </div>
      ) : (
        !error && (
          <p className="rounded-md border border-dashed border-line p-4 text-center text-sm text-muted">
            {loading
              ? "Fetching the major indexes…"
              : "No index levels yet — press Refresh to fetch them."}
          </p>
        )
      )}
    </CollapsibleCard>
  );
}
