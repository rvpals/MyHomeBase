"use client";

// The Daily Glance card: how Stock and ETF moved today, then the five biggest
// risers and fallers with a per-ticker news button.
//
// A client component because the mover lists are re-rankable and each news button
// fetches on demand. The ranking itself is lib work (`topGainers`/`topLosers`) —
// this file only decides what's on screen.

import { useState } from "react";
import { formatCents } from "@/lib/shared/money";
import {
  topGainers,
  topLosers,
  type DayMove,
  type DayMovesByType,
  type MoverMeasure,
  type TickerDayMove,
} from "@/lib/stock-positions";
import type { TopNewsStory } from "@/lib/ticker-news";
import { fetchTopStoryAction } from "./stock-news-actions";
import { TickerCell, TickerViewerHost } from "./ticker-viewer-host";

const MOVER_COUNT = 5;

/**
 * Red down, green up — and **neutral at zero**. A flat day is not a win, and a
 * bucket you hold nothing in shouldn't render "+$0.00" in gain-green.
 */
function gainClass(cents: number): string {
  if (cents < 0) return "text-red-400";
  if (cents > 0) return "text-emerald-400";
  return "text-muted";
}

function signed(cents: number): string {
  return `${cents >= 0 ? "+" : ""}${formatCents(cents)}`;
}

function signedPct(pct: number): string {
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

/** How long ago, in the roughest terms that are still true. */
function relativeTime(isoInstant: string): string {
  const then = Date.parse(isoInstant);
  if (Number.isNaN(then)) return "";
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / (60 * 24))}d ago`;
}

function BucketTableRow({
  label,
  move,
  isTotal = false,
}: {
  label: string;
  move: DayMove;
  isTotal?: boolean;
}) {
  return (
    <tr className={isTotal ? "border-t-2 border-line" : ""}>
      <td className={`py-1.5 pr-2 text-left ${isTotal ? "font-medium text-ink" : "text-muted"}`}>
        {label}
      </td>
      <td className="py-1.5 pl-2 text-right font-mono text-ink">{formatCents(move.valueCents)}</td>
      <td className={`py-1.5 pl-2 text-right font-mono ${gainClass(move.gainLossCents)}`}>
        {signed(move.gainLossCents)}
      </td>
      <td className={`py-1.5 pl-2 text-right font-mono ${gainClass(move.gainLossCents)}`}>
        {signedPct(move.changePct)}
      </td>
    </tr>
  );
}

/**
 * The three buckets and their total, as one table.
 *
 * A table rather than a row of tiles because these four numbers are the same
 * measurement of different slices — reading them down a column is the whole
 * point, and tiles made you scan sideways to compare. The total was already
 * computed and simply wasn't shown before.
 */
function BucketTable({ moves }: { moves: DayMovesByType }) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr>
          {["Type", "Value", "Today", "%"].map((heading, index) => (
            <th
              key={heading}
              className={`border-b border-line py-1.5 text-xs font-medium uppercase tracking-wide text-muted ${
                index === 0 ? "pr-2 text-left" : "pl-2 text-right"
              }`}
            >
              {heading}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        <BucketTableRow label="Stock" move={moves.stock} />
        <BucketTableRow label="ETF" move={moves.etf} />
        {/* Only when it exists — most portfolios have no third bucket, and an
            empty "Other $0.00" row is noise. */}
        {moves.other.valueCents > 0 && <BucketTableRow label="Other" move={moves.other} />}
        <BucketTableRow label="Total" move={moves.total} isTotal />
      </tbody>
    </table>
  );
}

/** State of one ticker's news lookup. Kept per row so several can be open at once. */
type NewsState =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "error"; message: string }
  | { status: "story"; story: TopNewsStory };

function NewsPanel({ state }: { state: NewsState }) {
  if (state.status === "loading") {
    return <p className="mt-1 text-xs text-muted">Looking for today&apos;s top story…</p>;
  }
  if (state.status === "error") {
    return <p className="mt-1 text-xs text-red-400">{state.message}</p>;
  }
  if (state.status === "empty") {
    return <p className="mt-1 text-xs text-muted">No recent stories found for this ticker.</p>;
  }

  const { story } = state;
  return (
    <div className="mt-2 rounded-md border border-line bg-paper p-3">
      <a
        href={story.url}
        target="_blank"
        // noreferrer alongside noopener: this is an untrusted third-party link.
        rel="noopener noreferrer"
        className="text-sm font-medium text-brass-dark hover:underline"
      >
        {story.title}
      </a>
      <p className="mt-1 text-xs text-muted">
        {story.publisher} · {relativeTime(story.publishedAt)}
        {!story.isFromToday && (
          // Say so rather than letting a three-day-old headline imply it explains
          // this morning's move.
          <span className="text-brass-dark"> · nothing published today; this is the latest</span>
        )}
        {story.isFromToday && !story.isPrimarySubject && (
          <span className="text-brass-dark"> · mentions {story.ticker} rather than being about it</span>
        )}
      </p>
    </div>
  );
}

function MoverRow({
  move,
  measure,
  news,
  onLoadNews,
  onOpenTicker,
}: {
  move: TickerDayMove;
  measure: MoverMeasure;
  news?: NewsState;
  onLoadNews: () => void;
  onOpenTicker: (ticker: string) => void;
}) {
  const leadCents = measure === "total" ? move.gainLossCents : move.perShareGainLossCents;
  // The measure that isn't leading, shown quietly underneath — the two answer
  // different questions and it's cheap to keep both in view.
  const secondary =
    measure === "total"
      ? `${signed(move.perShareGainLossCents)}/share`
      : `${signed(move.gainLossCents)} total`;

  return (
    <li className="border-b border-line py-2 last:border-b-0">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 truncate text-sm font-medium text-ink">
            <TickerCell ticker={move.ticker} onOpen={onOpenTicker} size={20} />
            <span className="text-xs font-normal text-muted">{move.type}</span>
            {move.accountCount > 1 && (
              <span className="text-xs font-normal text-muted">
                across {move.accountCount} accounts
              </span>
            )}
          </p>
          <p className="truncate text-xs text-muted">{move.name || "—"}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className={`text-sm font-medium ${gainClass(leadCents)}`}>
            {signed(leadCents)}
            {measure === "perShare" && <span className="text-xs font-normal">/share</span>}
          </p>
          <p className={`text-xs ${gainClass(move.gainLossCents)}`}>{signedPct(move.changePct)}</p>
          <p className="text-xs text-muted">{secondary}</p>
        </div>
        <button
          type="button"
          onClick={onLoadNews}
          disabled={news?.status === "loading"}
          aria-label={`Top story for ${move.ticker}`}
          title={`Why did ${move.ticker} move? Get today's top story`}
          className="shrink-0 rounded-md border border-line px-2 py-1 text-xs font-medium text-brass-dark hover:bg-paper-raised disabled:opacity-50"
        >
          {news?.status === "loading" ? "…" : "News"}
        </button>
      </div>
      {news && <NewsPanel state={news} />}
    </li>
  );
}

function MoverList({
  title,
  moves,
  measure,
  emptyMessage,
  news,
  onLoadNews,
  onOpenTicker,
}: {
  title: string;
  moves: TickerDayMove[];
  measure: MoverMeasure;
  emptyMessage: string;
  news: Record<string, NewsState>;
  onLoadNews: (ticker: string) => void;
  onOpenTicker: (ticker: string) => void;
}) {
  return (
    <div>
      <h4 className="text-xs font-medium uppercase tracking-wide text-muted">{title}</h4>
      {moves.length === 0 ? (
        <p className="mt-2 rounded-md border border-dashed border-line p-4 text-center text-sm text-muted">
          {emptyMessage}
        </p>
      ) : (
        <ul className="mt-1">
          {moves.map((move) => (
            <MoverRow
              key={move.ticker}
              move={move}
              measure={measure}
              news={news[move.ticker]}
              onLoadNews={() => onLoadNews(move.ticker)}
              onOpenTicker={onOpenTicker}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

export function StockDailyGlance({
  moves,
  tickerMoves,
}: {
  moves: DayMovesByType;
  /** Today's move per ticker, already summed across accounts by the lib. */
  tickerMoves: TickerDayMove[];
}) {
  const [measure, setMeasure] = useState<MoverMeasure>("total");
  const [news, setNews] = useState<Record<string, NewsState>>({});
  /** The symbol whose full viewer is open, if any. */
  const [openTicker, setOpenTicker] = useState<string | undefined>(undefined);

  async function handleLoadNews(ticker: string) {
    setNews((current) => ({ ...current, [ticker]: { status: "loading" } }));
    const result = await fetchTopStoryAction(ticker);
    setNews((current) => ({
      ...current,
      [ticker]: !result.ok
        ? { status: "error", message: result.error ?? "Could not load the story." }
        : result.story
          ? { status: "story", story: result.story }
          : { status: "empty" },
    }));
  }

  const gainers = topGainers(tickerMoves, MOVER_COUNT, measure);
  const losers = topLosers(tickerMoves, MOVER_COUNT, measure);

  return (
    <div className="rounded-xl border border-line p-4">
      <h3 className="font-display text-lg text-ink">Daily Glance</h3>

      <div className="mt-4 rounded-xl border border-line p-4">
        <BucketTable moves={moves} />
      </div>

      {/* The selector governs the mover lists only. Per-share is meaningless for
          the buckets above, which mix securities at different prices. */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <h4 className="text-xs font-medium uppercase tracking-wide text-muted">
          Top movers today
        </h4>
        <div className="flex items-center gap-1 text-xs">
          <span className="mr-1 text-muted">Measure by</span>
          {(["total", "perShare"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setMeasure(option)}
              aria-pressed={measure === option}
              title={
                option === "total"
                  ? "Shares × price move — the effect on your portfolio"
                  : "The move on one share — the security's own move, whatever you hold"
              }
              className={`rounded-md border px-2 py-1 font-medium transition-colors ${
                measure === option
                  ? "border-brass bg-brass-soft text-brass-dark"
                  : "border-line text-muted hover:bg-paper-raised"
              }`}
            >
              {option === "total" ? "Total value" : "Per share"}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <MoverList
          title={`Top ${MOVER_COUNT} gainers`}
          moves={gainers}
          measure={measure}
          emptyMessage="Nothing is up today."
          news={news}
          onLoadNews={handleLoadNews}
          onOpenTicker={setOpenTicker}
        />
        <MoverList
          title={`Top ${MOVER_COUNT} losers`}
          moves={losers}
          measure={measure}
          emptyMessage="Nothing is down today."
          news={news}
          onLoadNews={handleLoadNews}
          onOpenTicker={setOpenTicker}
        />
      </div>

      <p className="mt-4 text-xs text-muted">
        <span className="text-ink">Total value</span> is shares × the price move — how much the
        holding made or lost you. <span className="text-ink">Per share</span> is the move on one
        share, so a big position and a small one in the same stock rank the same. The percentage is
        identical either way. Stocks and ETFs rank together, and a ticker held in more than one
        account is counted once. Press <span className="text-ink">News</span> on a row for the story
        most likely to explain its move, or the ticker itself for its full viewer.
      </p>

      {openTicker && (
        <TickerViewerHost ticker={openTicker} onClose={() => setOpenTicker(undefined)} />
      )}
    </div>
  );
}
