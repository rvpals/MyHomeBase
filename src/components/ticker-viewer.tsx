// The full-record dialog for one ticker: everything the app knows about a
// symbol, on two tabs.
//
// The two tabs are the point — "Our data" is what MyHomeBase recorded (holdings,
// trades, watchlists), "Market" is what the provider said (quote, chart, risk,
// news). A reader should never have to guess whether a number came from their
// broker export or from Yahoo.
//
// Within a tab, each section is a `CollapsibleCard` rather than a nested tab.
// Sub-tabs hid things a reader wanted side by side — holdings against the trade
// history, the price chart against the quote — and made you click through four
// panels to find out whether anything was there at all. Cards open by default,
// so entering a tab shows everything it has and collapsing is the reader's
// choice rather than the default state.
//
// Pure presentation. It fetches nothing: every panel arrives as a
// `TickerPanelState` and the host decides when to load it.

"use client";

import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Modal } from "@/components/modal";
import { Button } from "@/components/button";
import { ChartCandle } from "@/components/chart-candle";
import { ChartLine } from "@/components/chart-line";
import { CollapsibleCard } from "@/components/collapsible-card";
import { TickerLogo } from "@/components/ticker-logo";
import type { MarketEvent } from "@/lib/market-data";
import { hasFullBars } from "@/lib/shared/chart-candle";
import { centsToDollars, formatCents } from "@/lib/shared/money";
// The event phrasing is shared with the Events card rather than written twice —
// the same dividend must not read two ways in one dialog.
import { describeMarketEvent } from "@/lib/ticker-overview";
import type { TickerYahooDetail } from "@/lib/ticker-detail";
import type {
  TickerEvent,
  TickerEventFeed,
  TickerHistoryRange,
  TickerNewsFeed,
  TickerOwnData,
  TickerPriceSeries,
  TickerQuote,
  TickerRisk,
  TickerTimelinePoint,
  TickerTradeTimeline,
} from "@/lib/ticker-overview";

/** Which tab is showing. Each holds a stack of cards, not further tabs. */
export type TickerPanelGroup = "own" | "market" | "yahoo";

/** One panel's load state. The host owns it; the viewer just renders it. */
export interface TickerPanelState<T> {
  data?: T;
  error?: string;
  isLoading?: boolean;
}

export interface TickerViewerProps {
  ticker: string;
  /** Controlled — the host switches tabs so it can load a tab's data on entry. */
  activeGroup: TickerPanelGroup;
  onSelectGroup: (group: TickerPanelGroup) => void;
  onClose: () => void;

  ownData: TickerPanelState<TickerOwnData>;
  /**
   * Powers the "My past performance" chart in the Transactions panel. Market
   * data, so it loads on demand like the Market panels do — the trade table
   * above it is already on screen from `ownData` while this arrives.
   */
  tradeTimeline: TickerPanelState<TickerTradeTimeline>;
  quote: TickerPanelState<TickerQuote>;
  priceSeries: TickerPanelState<TickerPriceSeries>;
  events: TickerPanelState<TickerEventFeed>;
  risk: TickerPanelState<TickerRisk>;
  news: TickerPanelState<TickerNewsFeed>;
  /** Powers all six cards on the Yahoo Finance Detail tab, from one fetch. */
  detail: TickerPanelState<TickerYahooDetail>;

  /** The chart window currently selected. */
  range: TickerHistoryRange;
  onSelectRange: (range: TickerHistoryRange) => void;
  /** Windows to offer. Defaults to the full set. */
  ranges?: readonly TickerHistoryRange[];

  /**
   * Recompute the risk figures from the provider and overwrite the stored row.
   * Risk is cached indefinitely, so this button is the *only* thing that
   * refreshes it — see `migrations/0039_create_ticker_risk_cache.md`.
   */
  onRecalculateRisk: () => void;

  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

const DEFAULT_RANGES: readonly TickerHistoryRange[] = ["1mo", "3mo", "6mo", "1y", "5y"];

const GROUPS: { key: TickerPanelGroup; label: string; hint: string }[] = [
  { key: "own", label: "Our data", hint: "Recorded in MyHomeBase" },
  // Not "live": the Risks card is served from a stored calculation, and says
  // when it was made. Overclaiming freshness here would undercut that.
  { key: "market", label: "Market", hint: "From the market-data provider" },
  {
    key: "yahoo",
    label: "Yahoo Finance Detail",
    hint: "The provider's full reference record — one fetch, six sections",
  },
];

const RANGE_LABELS: Record<TickerHistoryRange, string> = {
  "1mo": "1M",
  "3mo": "3M",
  "6mo": "6M",
  "1y": "1Y",
  "5y": "5Y",
};

// ---------------------------------------------------------------------------
// Formatting — view-local, and deliberately not in `lib`: these are display
// conventions for this dialog, not domain rules.
// ---------------------------------------------------------------------------

function formatPct(value: number, digits = 2): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function formatPlainPct(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

function formatShares(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

/** "2026-08-05" or an ISO instant, shown as a short local date. */
function formatDate(value?: string): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function formatDateTime(value?: string): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * How old a stored risk calculation gets before the card says so in amber.
 *
 * Nothing expires the cache — a row is served at any age — so the date is the
 * only thing standing between a reader and a figure from last year. A week is
 * roughly when "volatility over the trailing year" stops being this week's
 * answer.
 */
const RISK_STALE_AFTER_DAYS = 7;

function isOlderThanDays(value: string, days: number): boolean {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  return Date.now() - parsed.getTime() > days * 24 * 60 * 60 * 1000;
}

/**
 * Red/green for gain/loss is a semantic color, not a theme accent — see
 * design.md. Zero stays neutral so a flat day doesn't read as a win.
 */
function moveClass(value: number): string {
  if (value > 0) return "text-emerald-400";
  if (value < 0) return "text-red-400";
  return "text-muted";
}

// ---------------------------------------------------------------------------
// Small presentational pieces, local to this dialog.
// ---------------------------------------------------------------------------

function StatTile({
  label,
  value,
  hint,
  moveValue,
}: {
  label: string;
  value: string;
  hint?: string;
  /**
   * Supply the signed number the value represents to color it red/green.
   * Passed separately from `value` on purpose — the sign can't be recovered
   * reliably from a formatted string (a typographic minus isn't a hyphen).
   */
  moveValue?: number;
}) {
  return (
    <div className="rounded-xl border border-line p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div
        className={`font-display text-xl ${moveValue != null ? moveClass(moveValue) : "text-ink"}`}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

/** A signed amount rendered with a typographic minus, e.g. "−$1,234.56". */
function signedCents(cents: number): string {
  return `${cents >= 0 ? "+" : "−"}${formatCents(Math.abs(cents))}`;
}

/** A signed figure whose color carries the sign. */
function Move({ cents, pct }: { cents: number; pct?: number }) {
  return (
    <span className={moveClass(cents)}>
      {cents >= 0 ? "+" : "−"}
      {formatCents(Math.abs(cents))}
      {pct != null && <span className="ml-1 text-xs">({formatPct(pct)})</span>}
    </span>
  );
}

function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{children}</div>;
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="mb-2 mt-6 font-display text-sm uppercase tracking-wide text-muted first:mt-0">
      {children}
    </h3>
  );
}

function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {head.map((label, index) => (
              <th
                key={label}
                className={`border-b border-line px-2 py-1.5 text-xs font-medium uppercase tracking-wide text-muted ${
                  index === 0 ? "text-left" : "text-right"
                }`}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Cell({
  children,
  align = "right",
  className = "",
}: {
  children: ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <td
      className={`border-b border-line px-2 py-1.5 text-ink ${
        align === "left" ? "text-left" : "text-right"
      } ${className}`}
    >
      {children}
    </td>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-muted">{children}</p>;
}

/** One key/value line for the metadata list under a panel. */
function MetaItem({ label, value }: { label: string; value: string }) {
  if (!value || value === "—") return null;
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className="font-mono text-sm text-ink">{value}</dd>
    </div>
  );
}

/**
 * Renders whichever of loading / error / empty / content applies.
 *
 * Every panel goes through this so the four states look identical wherever you
 * are in the dialog — a market panel that hasn't been opened yet is a normal
 * state, not a blank.
 */
function Panel<T>({
  state,
  loadingLabel,
  children,
}: {
  state: TickerPanelState<T>;
  loadingLabel: string;
  children: (data: T) => ReactNode;
}) {
  if (state.error) {
    return (
      <p className="rounded-lg border border-line bg-brass-soft p-4 text-sm text-brass-dark">
        {state.error}
      </p>
    );
  }
  // Only a *first* load blanks the panel. A refetch (switching the chart range)
  // keeps the previous content on screen and lets the panel show its own inline
  // spinner, so the chart doesn't flash away and back.
  if (!state.data) return <Empty>{state.isLoading ? loadingLabel : "Nothing loaded yet."}</Empty>;
  return <>{children(state.data)}</>;
}

// ---------------------------------------------------------------------------
// Panels — our data
// ---------------------------------------------------------------------------

function HoldingsPanel({ data }: { data: TickerOwnData }) {
  const { totals, holdings } = data;

  if (!data.isHeld) {
    return (
      <Empty>
        No position in {data.ticker} is recorded
        {data.isWatched ? " — it is only on a watchlist." : "."}
      </Empty>
    );
  }

  return (
    <div>
      <StatGrid>
        <StatTile label="Shares" value={formatShares(totals.quantity)} hint={`${totals.accountCount} account(s)`} />
        <StatTile
          label="Cost basis"
          value={totals.costCents > 0 ? formatCents(totals.costCents) : "—"}
          hint={totals.averageUnitCostCents > 0 ? `${formatCents(totals.averageUnitCostCents)} / share` : "Not recorded"}
        />
        <StatTile label="Market value" value={formatCents(totals.valueCents)} />
        <StatTile
          label="Unrealized"
          value={signedCents(totals.unrealizedGainLossCents)}
          moveValue={totals.unrealizedGainLossCents}
          hint={totals.costCents > 0 ? formatPct(totals.totalReturnPct) : undefined}
        />
      </StatGrid>

      <div className="mt-3 rounded-xl border border-line p-4">
        <span className="text-xs font-medium uppercase tracking-wide text-muted">Today</span>{" "}
        <Move cents={totals.dayGainLossCents} pct={totals.dayChangePct} />
      </div>

      <SectionTitle>By account</SectionTitle>
      <Table head={["Account", "Shares", "Unit cost", "Cost", "Value", "Today", "Unrealized"]}>
        {holdings.map((row) => (
          <tr key={row.accountId}>
            <Cell align="left">{row.accountName}</Cell>
            <Cell>{formatShares(row.quantity)}</Cell>
            <Cell>{row.unitCostCents > 0 ? formatCents(row.unitCostCents) : "—"}</Cell>
            <Cell>{row.costCents > 0 ? formatCents(row.costCents) : "—"}</Cell>
            <Cell>{formatCents(row.valueCents)}</Cell>
            <Cell>
              <Move cents={row.dayGainLossCents} />
            </Cell>
            <Cell>
              <Move cents={row.unrealizedGainLossCents} pct={row.unrealizedGainLossPct} />
            </Cell>
          </tr>
        ))}
      </Table>

      <SectionTitle>Security details</SectionTitle>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <MetaItem label="Type" value={data.type ?? "—"} />
        <MetaItem label="Asset class" value={data.assetClass} />
        <MetaItem label="Strategy" value={data.assetStrategy} />
        <MetaItem label="CUSIP" value={data.cusip} />
        <MetaItem label="ISIN" value={data.isin} />
        <MetaItem label="Rows updated" value={formatDate(data.lastUpdatedAt)} />
      </dl>
    </div>
  );
}

/** What each timeline point is, for the table's "Point" column. */
const TIMELINE_LABELS: Record<TickerTimelinePoint["kind"], string> = {
  prevClose: "Close, day before",
  trade: "Trade",
  nextClose: "Close, day after",
  current: "Current price",
  event: "Close",
};

/** Colours an event chip by whether the quarter beat, missed, or is neutral news. */
function eventToneClass(event: MarketEvent): string {
  if (event.kind !== "earnings") return "bg-brass-soft text-brass-dark";
  if (event.epsActualCents == null || event.epsEstimateCents == null) {
    return "bg-brass-soft text-brass-dark";
  }
  if (event.epsActualCents > event.epsEstimateCents) return "bg-brass-soft text-emerald-400";
  if (event.epsActualCents < event.epsEstimateCents) return "bg-brass-soft text-red-400";
  return "bg-brass-soft text-brass-dark";
}

/**
 * The row's Note cell — the same column the transactions table has, carrying
 * both kinds of annotation a point can have: whatever you typed against the
 * trade, and whatever the provider says happened that day.
 */
function NoteCell({ point }: { point: TickerTimelinePoint }) {
  const note = point.note?.trim();
  if (point.events.length === 0 && !note) return <span className="text-muted">—</span>;

  return (
    <div className="flex flex-col gap-1">
      {point.events.length > 0 && (
        <span className="flex flex-wrap gap-1">
          {point.events.map((event, index) => (
            <span
              key={`${event.kind}:${event.timestamp}:${index}`}
              className={`rounded px-1.5 py-0.5 text-xs font-medium ${eventToneClass(event)}`}
            >
              {describeMarketEvent(event)}
            </span>
          ))}
        </span>
      )}
      {note && <span className="text-muted">{note}</span>}
    </div>
  );
}

/**
 * Avg / highest / lowest of what we actually paid per share.
 *
 * Its own card rather than a tile in the row above because these three are one
 * thought — the spread of your entry prices — and they read together.
 */
function TradePriceCard({ stats }: { stats: TickerOwnData["trades"]["stats"] }) {
  if (stats.count === 0) return null;

  return (
    <div className="rounded-xl border border-line p-4">
      <div className="flex items-baseline justify-between">
        <h4 className="font-display text-sm uppercase tracking-wide text-muted">
          Trade price per share
        </h4>
        <span className="text-xs text-muted">
          across {formatCount(stats.count)} trade(s)
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-3">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted">Average</dt>
          <dd className="font-display text-xl text-ink">
            {formatCents(stats.avgPricePerShareCents)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted">Highest</dt>
          <dd className="font-display text-xl text-ink">
            {formatCents(stats.maxPricePerShareCents)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted">Lowest</dt>
          <dd className="font-display text-xl text-ink">
            {formatCents(stats.minPricePerShareCents)}
          </dd>
        </div>
      </dl>
    </div>
  );
}

/**
 * "My past performance" — every trade plotted against the market's close on the
 * trading day either side of it, ending at the current price.
 *
 * The bracket closes are what make the chart worth reading: a trade price on its
 * own says nothing about whether it was a good fill.
 */
function PastPerformance({ state }: { state: TickerPanelState<TickerTradeTimeline> }) {
  return (
    <>
      <SectionTitle>My past performance</SectionTitle>
      <p className="-mt-1 mb-3 text-xs text-muted">
        Your trades against the provider&apos;s closing price on the trading day either side of
        each one, ending at the latest close. Weekends and holidays are skipped, so
        &ldquo;day before&rdquo; means the previous <em>trading</em> day.
      </p>

      <Panel state={state} loadingLabel="Fetching the market around your trades…">
        {(timeline) => <PastPerformanceBody timeline={timeline} />}
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------------------
// Chart marks. A generic circle wastes the one channel a scatter of points has
// going spare: its shape. Each point on the performance chart says what kind of
// thing it was without needing the tooltip.
// ---------------------------------------------------------------------------

/**
 * Which mark a point gets. One per point, so the shapes stay readable — a point
 * can be several of these at once (a buy on an earnings day that made the news),
 * and the row in the table below carries the full picture.
 *
 * Order is by how much the point is *about you*: your own trade first, then what
 * the company did, then what was written about it, then a plain close.
 */
type ChartMark = "buy" | "sell" | "event" | "news" | "close";

function markFor(point: TickerTimelinePoint): ChartMark {
  if (point.kind === "trade") return point.action === "Sell" ? "sell" : "buy";
  if (point.events.length > 0) return "event";
  if (point.stories.length > 0) return "news";
  return "close";
}

/** Tailwind text colour per mark; the shapes fill from `currentColor`. */
const MARK_CLASS: Record<ChartMark, string> = {
  // Semantic red/green, per design.md — a buy and a sell are not two brand hues.
  buy: "text-emerald-400",
  sell: "text-red-400",
  event: "text-brass",
  news: "text-brass-dark",
  close: "text-muted",
};

/**
 * The mark's geometry, centred on the origin. Drawn as a path so every shape is
 * one element and the caller only has to position a `<g>`.
 */
function MarkShape({ mark }: { mark: ChartMark }) {
  if (mark === "buy") {
    // Pointing up: you added to the position.
    return <path d="M0,-5.5 L5,3.5 L-5,3.5 Z" fill="currentColor" />;
  }
  if (mark === "sell") {
    return <path d="M0,5.5 L5,-3.5 L-5,-3.5 Z" fill="currentColor" />;
  }
  if (mark === "event") {
    return <path d="M0,-5.5 L5.5,0 L0,5.5 L-5.5,0 Z" fill="currentColor" />;
  }
  if (mark === "news") {
    // Hollow, so it reads as commentary on the price rather than an action.
    return <circle r={4} fill="none" stroke="currentColor" strokeWidth={2} />;
  }
  return <circle r={2.5} fill="currentColor" />;
}

/** The shape key, since the marks carry meaning the chart legend can't express. */
function MarkLegend() {
  const items: { mark: ChartMark; label: string }[] = [
    { mark: "buy", label: "Buy" },
    { mark: "sell", label: "Sell" },
    { mark: "event", label: "Dividend / split / earnings" },
    { mark: "news", label: "News that day" },
    { mark: "close", label: "Close" },
  ];

  return (
    <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
      {items.map((item) => (
        <li key={item.mark} className="flex items-center gap-1.5">
          <svg viewBox="-8 -8 16 16" className={`h-3.5 w-3.5 ${MARK_CLASS[item.mark]}`} aria-hidden="true">
            <MarkShape mark={item.mark} />
          </svg>
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * The per-row news control.
 *
 * A button rather than the stories inline: most rows have none, and a column of
 * expanded headlines made every row three lines tall. When the provider indexed
 * nothing for that date it still opens, and says why — an empty cell on its own
 * reads as "quiet day", which is usually wrong.
 */
function NewsCell({
  point,
  ticker,
  isOpen,
  onToggle,
}: {
  point: TickerTimelinePoint;
  ticker: string;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        title={`News for ${ticker} on ${formatDate(point.date)}`}
        className="rounded-md border border-line px-2 py-0.5 text-xs font-medium text-brass-dark hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
      >
        {point.stories.length > 0 ? `News (${point.stories.length})` : "News"}
      </button>

      {isOpen && (
        <div className="mt-2">
          {point.stories.length > 0 ? (
            <ul className="space-y-1">
              {point.stories.map((story) => (
                <li key={story.url}>
                  <a
                    href={story.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brass-dark hover:underline"
                  >
                    {story.title}
                  </a>
                  <span className="ml-1 text-xs text-muted">— {story.publisher}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted">
              Nothing indexed for this date. The provider&apos;s search only covers recent
              coverage —{" "}
              <a
                href={`https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}/news`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brass-dark hover:underline"
              >
                browse {ticker} news
              </a>
              .
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function PastPerformanceBody({ timeline }: { timeline: TickerTradeTimeline }) {
  const [openNewsKey, setOpenNewsKey] = useState<string | undefined>(undefined);

  if (timeline.points.length === 0) {
    return <Empty>Nothing to plot — no trades are recorded for {timeline.ticker}.</Empty>;
  }

  // Two series over the same points: the price line, and a second that only
  // carries a value where something happened, so Recharts draws it as isolated
  // markers on the line rather than a second trend.
  // One series, with the kind carried on each row so the dot renderer can shape
  // it. This replaced a second "event" series of duplicated y-values: that drew
  // markers, but it also put a meaningless second entry in the legend and told
  // you nothing about buys, sells or news.
  const chartData = timeline.points.map((point) => ({
    date: point.date,
    price: centsToDollars(point.pricePerShareCents),
    mark: markFor(point),
  }));

  return (
    <div>
      <ChartLine
        data={chartData}
        series={[
          {
            key: "price",
            label: "Price per share",
            renderDot: ({ cx, cy, index, payload }) => {
              const mark = (payload.mark as ChartMark) ?? "close";
              return (
                <g
                  key={`${payload.date}:${index}`}
                  transform={`translate(${cx}, ${cy})`}
                  className={MARK_CLASS[mark]}
                >
                  <MarkShape mark={mark} />
                </g>
              );
            },
          },
        ]}
        xKey="date"
        formatValue={(value) => `$${value.toFixed(2)}`}
        formatX={(value) => String(value).slice(5)}
        // The best and worst price in the window. The buy/sell shapes already
        // carry the story of the individual trades.
        pointLabels="extremes"
        displayStorageKey="myhomebase:chart:ticker-my-performance"
      />
      <MarkLegend />

      {timeline.datesWithoutCloses.length > 0 && (
        <p className="mt-3 text-xs text-muted">
          No provider history around{" "}
          <span className="text-ink">{timeline.datesWithoutCloses.join(", ")}</span> — those trades
          are plotted without their bracket closes.
        </p>
      )}

      <SectionTitle>Plotted points</SectionTitle>
      <p className="-mt-1 mb-3 text-xs text-muted">
        The <span className="text-ink">Note</span> column carries whatever you recorded against
        a trade, plus any dated event the provider reports for that day:{" "}
        <span className="rounded bg-brass-soft px-1.5 py-0.5 font-medium text-brass-dark">
          Dividend
        </span>{" "}
        is the amount per share on its ex-dividend date,{" "}
        <span className="rounded bg-brass-soft px-1.5 py-0.5 font-medium text-brass-dark">
          Split
        </span>{" "}
        gives the ratio, and{" "}
        <span className="rounded bg-brass-soft px-1.5 py-0.5 font-medium text-brass-dark">
          Earnings
        </span>{" "}
        shows reported EPS against the estimate —{" "}
        <span className="text-emerald-400">green</span> for a beat,{" "}
        <span className="text-red-400">red</span> for a miss. An event dated to a day the market
        was shut is shown against the last close on or before it, so every row&apos;s price is a
        real one. The same points are marked as a second series on the chart above.
      </p>
      <Table head={["Date", "Point", "Price / share", "Note", "News"]}>
        {timeline.points.map((point, index) => {
          const key = `${point.date}:${point.kind}:${point.transactionId ?? index}`;
          return (
            <tr key={key}>
              <Cell align="left">{formatDate(point.date)}</Cell>
              <Cell align="left">
                {point.kind === "trade" ? (
                  <span className={point.action === "Buy" ? "text-emerald-400" : "text-red-400"}>
                    {point.action} {formatShares(point.numberOfShares ?? 0)} sh
                  </span>
                ) : (
                  <span className="text-muted">{TIMELINE_LABELS[point.kind]}</span>
                )}
              </Cell>
              <Cell>{formatCents(point.pricePerShareCents)}</Cell>
              <Cell align="left">
                <NoteCell point={point} />
              </Cell>
              <Cell align="left">
                <NewsCell
                  point={point}
                  ticker={timeline.ticker}
                  isOpen={openNewsKey === key}
                  onToggle={() => setOpenNewsKey(openNewsKey === key ? undefined : key)}
                />
              </Cell>
            </tr>
          );
        })}
      </Table>

      {/* Said plainly rather than left as a column of dashes: the provider's news
          search only returns recent coverage, so an old row being empty means
          "not indexed", not "nothing happened". Events do not have that limit. */}
      <p className="mt-3 text-xs text-muted">
        {timeline.newsUnavailable
          ? "The news provider could not be reached, so no stories are attached."
          : timeline.newsFromDate
            ? `The news lookup only reaches back to ${formatDate(timeline.newsFromDate)} — an empty News panel before that means the provider does not index that far, not that the day was quiet.`
            : "The news provider returned no stories for this ticker."}{" "}
        {timeline.eventsUnavailable
          ? "Dividends, splits and earnings could not be fetched."
          : "Dividends, splits and reported quarters go back as far as the price history does."}
        {timeline.unplottedEventCount > 0 &&
          ` ${formatCount(timeline.unplottedEventCount)} event(s) fell outside the price history and are not plotted.`}
      </p>
    </div>
  );
}

function TradesPanel({
  data,
  timeline,
}: {
  data: TickerOwnData;
  timeline: TickerPanelState<TickerTradeTimeline>;
}) {
  const { trades } = data;

  if (trades.transactions.length === 0) {
    return <Empty>No transactions are recorded for {data.ticker}.</Empty>;
  }

  return (
    <div>
      <StatGrid>
        <StatTile
          label="Avg cost basis"
          value={trades.averageCostBasisCents != null ? formatCents(Math.round(trades.averageCostBasisCents)) : "—"}
          hint="Weighted, buys only"
        />
        <StatTile
          label="Bought"
          value={formatShares(trades.sharesBought)}
          hint={`${formatCount(trades.buyCount)} trade(s) · ${formatCents(trades.totalBoughtCents)}`}
        />
        <StatTile
          label="Sold"
          value={formatShares(trades.sharesSold)}
          hint={`${formatCount(trades.sellCount)} trade(s) · ${formatCents(trades.totalSoldCents)}`}
        />
        <StatTile
          label="Net shares"
          value={formatShares(trades.sharesBought - trades.sharesSold)}
          hint="Bought less sold"
        />
      </StatGrid>

      <div className="mt-3">
        <TradePriceCard stats={trades.stats} />
      </div>

      <SectionTitle>
        {formatCount(trades.transactions.length)} trade(s), {formatDate(trades.firstTradeAt)} to{" "}
        {formatDate(trades.lastTradeAt)}
      </SectionTitle>
      <Table
        head={[
          "Date",
          "Action",
          "Shares",
          "Price",
          "G/L % $ since this trans",
          "Total",
          "Brokerage",
        ]}
      >
        {trades.transactions.map((row) => (
          <tr key={row.id}>
            <Cell align="left">{formatDate(row.transactionAt)}</Cell>
            <Cell>
              <span className={row.action === "Buy" ? "text-emerald-400" : "text-red-400"}>
                {row.action}
              </span>
            </Cell>
            <Cell>{formatShares(row.numberOfShares)}</Cell>
            <Cell>{formatCents(row.pricePerShareCents)}</Cell>
            <Cell>
              {row.hasMoveSince ? (
                <span
                  title={`${formatCents(row.pricePerShareCents)} at the trade → ${formatCents(
                    trades.currentPriceCents,
                  )} now · ${signedCents(row.moveSinceCentsPerShare)} per share`}
                >
                  <Move cents={row.moveSinceCents} pct={row.moveSincePct} />
                </span>
              ) : (
                <span className="text-muted" title="No current price is recorded for this ticker.">
                  —
                </span>
              )}
            </Cell>
            <Cell>{formatCents(row.totalAmountCents)}</Cell>
            <Cell>{row.brokerageFirm || "—"}</Cell>
          </tr>
        ))}
      </Table>

      <PastPerformance state={timeline} />
    </div>
  );
}

function WatchAndIncomePanel({ data }: { data: TickerOwnData }) {
  const { income, watchEntries } = data;

  return (
    <div>
      <SectionTitle>Dividends</SectionTitle>
      {income.estAnnualIncomeCents === 0 && income.dividendRateCents === 0 ? (
        <Empty>No dividend is recorded for {data.ticker}.</Empty>
      ) : (
        <StatGrid>
          <StatTile label="Rate / share" value={formatCents(income.dividendRateCents)} hint="Annual" />
          <StatTile label="Est. annual income" value={formatCents(income.estAnnualIncomeCents)} />
          <StatTile
            label="Yield on value"
            value={income.yieldOnValuePct > 0 ? formatPlainPct(income.yieldOnValuePct, 2) : "—"}
          />
          <StatTile
            label="Yield on cost"
            value={income.yieldOnCostPct > 0 ? formatPlainPct(income.yieldOnCostPct, 2) : "—"}
            hint={income.incomeEarnedCents > 0 ? `${formatCents(income.incomeEarnedCents)} earned` : undefined}
          />
        </StatGrid>
      )}

      <SectionTitle>Watchlists</SectionTitle>
      {watchEntries.length === 0 ? (
        <Empty>{data.ticker} is not on a watchlist.</Empty>
      ) : (
        <Table head={["List", "Added", "Price then", "Since added", "Reminder"]}>
          {watchEntries.map((entry) => (
            <tr key={entry.itemId}>
              <Cell align="left">{entry.watchListName}</Cell>
              <Cell>{formatDate(entry.addedDate)}</Cell>
              <Cell>
                {entry.priceWhenAddedCents > 0 ? formatCents(entry.priceWhenAddedCents) : "—"}
              </Cell>
              <Cell>
                {entry.changeSinceAddedCents === 0 && entry.changeSinceAddedPct === 0 ? (
                  <span className="text-muted">—</span>
                ) : (
                  <Move cents={entry.changeSinceAddedCents} pct={entry.changeSinceAddedPct} />
                )}
              </Cell>
              <Cell>
                {entry.reminderAt ? (
                  <span title={entry.reminderMessage}>{formatDate(entry.reminderAt)}</span>
                ) : (
                  "—"
                )}
              </Cell>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panels — market data
// ---------------------------------------------------------------------------

function QuotePanel({ data }: { data: TickerQuote }) {
  return (
    <div>
      <StatGrid>
        <StatTile label="Price" value={formatCents(data.priceCents)} hint={data.shortName} />
        <StatTile label="Previous close" value={formatCents(data.previousCloseCents)} />
        <StatTile
          label="Change"
          value={signedCents(data.changeCents)}
          moveValue={data.changeCents}
          hint={formatPct(data.changePct)}
        />
        <StatTile
          label="Dividend / share"
          value={data.dividendRateCents > 0 ? formatCents(data.dividendRateCents) : "—"}
          hint={data.dividendRateCents > 0 ? "Annual rate" : undefined}
        />
      </StatGrid>

      <SectionTitle>Day range</SectionTitle>
      <div className="rounded-xl border border-line p-4">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-mono text-ink">{formatCents(data.dayLowCents)}</span>
          <span className="text-xs uppercase tracking-wide text-muted">Low → High</span>
          <span className="font-mono text-ink">{formatCents(data.dayHighCents)}</span>
        </div>
        <RangeBar
          low={data.dayLowCents}
          high={data.dayHighCents}
          current={data.priceCents}
          className="mt-3"
        />
      </div>

      <p className="mt-4 text-xs text-muted">Fetched {formatDateTime(data.fetchedAt)}.</p>
    </div>
  );
}

/** Where a price sits between a low and a high. */
function RangeBar({
  low,
  high,
  current,
  className = "",
}: {
  low: number;
  high: number;
  current: number;
  className?: string;
}) {
  const position = high > low ? Math.max(0, Math.min(100, ((current - low) / (high - low)) * 100)) : 50;
  return (
    <div className={`relative h-2 rounded-full bg-line ${className}`}>
      <span
        aria-hidden="true"
        style={{ left: `${position}%` }}
        className="absolute top-1/2 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brass"
      />
    </div>
  );
}

/** How the price window is drawn. */
type PriceMark = "line" | "candles";

const MARK_OPTIONS: readonly { value: PriceMark; label: string }[] = [
  { value: "line", label: "Line" },
  { value: "candles", label: "Candles" },
];

const MARK_STORAGE_KEY = "myhomebase:chart:ticker-market-mark";

function ChartPanel({
  data,
  range,
  ranges,
  onSelectRange,
  isLoading,
}: {
  data: TickerPriceSeries;
  range: TickerHistoryRange;
  ranges: readonly TickerHistoryRange[];
  onSelectRange: (range: TickerHistoryRange) => void;
  isLoading?: boolean;
}) {
  // Local, not hoisted to the host: switching mark redraws the data already
  // fetched, where switching range refetches. Remembered across mounts the same
  // way each chart's display options are — a reader who prefers candles opens the
  // next ticker on candles.
  const [mark, setMark] = useState<PriceMark>("line");

  useEffect(() => {
    // Read in an effect, not the initializer: `localStorage` doesn't exist on the
    // server, and reading it during render would disagree with the served HTML.
    try {
      const stored = window.localStorage.getItem(MARK_STORAGE_KEY);
      /* eslint-disable-next-line react-hooks/set-state-in-effect --
         Syncing from an external system (localStorage) on mount, the same pattern
         as `useChartDisplay`. */
      if (stored === "line" || stored === "candles") setMark(stored);
    } catch {
      // Storage can be unavailable (private browsing); the line default stands.
    }
  }, []);

  function onSelectMark(next: PriceMark) {
    setMark(next);
    try {
      window.localStorage.setItem(MARK_STORAGE_KEY, next);
    } catch {
      // Not worth surfacing — the choice still holds for this session.
    }
  }

  // Recharts wants plain numbers, and dollars read better on an axis than cents.
  const chartData = data.points.map((point) => ({
    date: point.date,
    close: centsToDollars(point.closeCents),
  }));

  // Candles are offered only when the provider gave a full bar for every point —
  // a candlestick with holes in it reads as halted trading, not missing data.
  const canShowCandles = hasFullBars(data.points);
  const candleData = canShowCandles
    ? data.points.map((point) => ({
        x: point.date,
        open: centsToDollars(point.openCents ?? 0),
        high: centsToDollars(point.highCents ?? 0),
        low: centsToDollars(point.lowCents ?? 0),
        close: centsToDollars(point.closeCents),
      }))
    : [];

  // Falls back to the line whenever candles aren't available, so a ticker whose
  // provider shorted the bars doesn't land on an empty panel.
  const showCandles = mark === "candles" && canShowCandles;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-1">
        {ranges.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onSelectRange(option)}
            aria-pressed={option === range}
            className={`rounded-md px-3 py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${
              option === range
                ? "bg-brass-soft text-brass-dark"
                : "text-muted hover:text-ink"
            }`}
          >
            {RANGE_LABELS[option]}
          </button>
        ))}
        {canShowCandles && (
          // Same button vocabulary as the ranges, pushed to the far end: it picks
          // how the window is drawn, not which window. `ml-auto` collapses to a
          // plain wrap on a narrow card, so the row still reads at 390px.
          <span className="ml-auto flex gap-1 max-lg:ml-0 max-lg:w-full max-lg:pt-1">
            {MARK_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => onSelectMark(option.value)}
                aria-pressed={option.value === mark}
                className={`rounded-md px-3 py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${
                  option.value === mark
                    ? "bg-brass-soft text-brass-dark"
                    : "text-muted hover:text-ink"
                }`}
              >
                {option.label}
              </button>
            ))}
          </span>
        )}
        {isLoading && <span className="self-center pl-2 text-xs text-muted">Loading…</span>}
      </div>

      {chartData.length === 0 ? (
        <Empty>The provider returned no closes for this window.</Empty>
      ) : (
        <>
          {showCandles ? (
            <ChartCandle
              data={candleData}
              label="Daily range"
              formatValue={(value) => `$${value.toFixed(2)}`}
              formatX={(value) => String(value).slice(5)}
              pointLabels="none"
              displayStorageKey="myhomebase:chart:ticker-market-candles"
            />
          ) : (
            <ChartLine
              data={chartData}
              series={[{ key: "close", label: "Close" }]}
              xKey="date"
              formatValue={(value) => `$${value.toFixed(2)}`}
              formatX={(value) => String(value).slice(5)}
              // A price window reads by its high and low; the period change is
              // spelled out in the stat tiles below.
              pointLabels="extremes"
              displayStorageKey="myhomebase:chart:ticker-market-history"
            />
          )}
          <div className="mt-4">
            <StatGrid>
              <StatTile
                label="Period change"
                value={signedCents(data.changeCents)}
                moveValue={data.changeCents}
                hint={formatPct(data.changePct)}
              />
              <StatTile label="High" value={formatCents(data.highCents)} />
              <StatTile label="Low" value={formatCents(data.lowCents)} />
              <StatTile
                label="Avg volume"
                value={data.averageVolume != null ? formatCount(data.averageVolume) : "—"}
                hint={`${formatCount(data.points.length)} closes`}
              />
            </StatGrid>
          </div>
        </>
      )}
    </div>
  );
}

function RiskPanel({ data }: { data: TickerRisk }) {
  return (
    <div>
      <StatGrid>
        <StatTile
          label="Annualized vol."
          value={formatPlainPct(data.annualizedVolPct)}
          hint={data.volatilityLabel}
        />
        <StatTile
          label="Daily std. dev."
          value={formatPlainPct(data.dailyStdDevPct, 2)}
        />
        <StatTile
          label={`Correlation to ${data.marketBenchmarkTicker}`}
          value={data.marketCorrelation != null ? data.marketCorrelation.toFixed(2) : "—"}
          hint={data.marketCorrelation == null ? "Benchmark unavailable" : undefined}
        />
        <StatTile
          label="Annualized return"
          value={formatPct(data.annualizedReturnPct, 1)}
          moveValue={data.annualizedReturnPct}
          hint="From the last year of closes"
        />
      </StatGrid>

      <SectionTitle>52-week range</SectionTitle>
      <div className="rounded-xl border border-line p-4">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-mono text-ink">{formatCents(data.low52wCents)}</span>
          <span className="font-display text-ink">{formatCents(data.currentPriceCents)}</span>
          <span className="font-mono text-ink">{formatCents(data.high52wCents)}</span>
        </div>
        <RangeBar
          low={data.low52wCents}
          high={data.high52wCents}
          current={data.currentPriceCents}
          className="mt-3"
        />
        <p className="mt-3 text-xs text-muted">
          {formatPlainPct(data.rangePositionPct, 0)} of the way up the range, from{" "}
          {formatCount(data.sampleCount)} daily closes.
        </p>
      </div>

      {/* These figures are stored and reused indefinitely, so the date is not a
          footnote — it's the only signal that a number might be months old.
          Amber past a week; Recalculate lives in the card header. */}
      <p
        className={`mt-4 text-xs ${
          isOlderThanDays(data.calculatedAt, RISK_STALE_AFTER_DAYS) ? "text-brass-dark" : "text-muted"
        }`}
      >
        Calculated {formatDateTime(data.calculatedAt)}
        {isOlderThanDays(data.calculatedAt, RISK_STALE_AFTER_DAYS) &&
          " — over a week old. Recalculate to refresh."}
      </p>
    </div>
  );
}

/** Colour and wording for a quarter's outcome. Semantic, not a theme accent. */
const OUTCOME_STYLE: Record<
  NonNullable<TickerEvent["outcome"]>,
  { label: string; className: string }
> = {
  beat: { label: "Beat", className: "text-emerald-400" },
  miss: { label: "Miss", className: "text-red-400" },
  inline: { label: "In line", className: "text-muted" },
};

/** The kind chip on each row, so the list scans by type without reading it. */
function EventKindChip({ kind }: { kind: TickerEvent["kind"] }) {
  const labels: Record<TickerEvent["kind"], string> = {
    earnings: "Earnings",
    dividend: "Dividend",
    split: "Split",
  };
  return (
    <span className="rounded bg-brass-soft px-1.5 py-0.5 text-xs font-medium text-brass-dark">
      {labels[kind]}
    </span>
  );
}

/** One key/value line inside an expanded event. */
function EventDetail({
  label,
  value,
  className = "text-ink",
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className={`font-mono text-sm ${className}`}>{value}</dd>
    </div>
  );
}

/**
 * What one event unfolds to.
 *
 * Everything we hold, spelled out — the row above is a summary and this is the
 * whole record. The Yahoo link is per-*ticker*, not per-event, because the
 * provider gives no per-event page; the wording says so rather than implying a
 * deep link.
 */
function EventDetails({ event, ticker }: { event: TickerEvent; ticker: string }) {
  const outcome = event.outcome ? OUTCOME_STYLE[event.outcome] : undefined;

  return (
    <div className="rounded-lg border border-line bg-paper p-4">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <EventDetail label="Date" value={formatDate(event.date)} />

        {event.kind === "earnings" && (
          <>
            <EventDetail
              label="Reported EPS"
              value={event.epsActualCents != null ? formatCents(event.epsActualCents) : "Not yet reported"}
            />
            <EventDetail
              label="Estimate"
              value={event.epsEstimateCents != null ? formatCents(event.epsEstimateCents) : "—"}
            />
            {event.epsSurpriseCents != null && outcome && (
              <EventDetail
                label="Surprise"
                className={`font-mono text-sm ${outcome.className}`}
                value={
                  `${signedCents(event.epsSurpriseCents)}` +
                  (event.epsSurprisePct != null ? ` (${formatPct(event.epsSurprisePct, 1)})` : "") +
                  ` · ${outcome.label}`
                }
              />
            )}
          </>
        )}

        {event.kind === "dividend" && (
          <EventDetail
            label="Amount / share"
            value={event.amountCents != null ? formatCents(event.amountCents) : "—"}
          />
        )}

        {event.kind === "split" && <EventDetail label="Ratio" value={event.ratio ?? "—"} />}

        {event.closeCents != null && (
          <EventDetail
            label={event.closeDate ? `Close, ${formatDate(event.closeDate)}` : "Close that day"}
            value={formatCents(event.closeCents)}
          />
        )}
      </dl>

      {/* Stated when the price is borrowed from an earlier session, so nobody
          reads it as the print on the event's own date. */}
      {event.closeDate && (
        <p className="mt-3 text-xs text-muted">
          The market was shut on {formatDate(event.date)}, so this is the last close before it.
        </p>
      )}

      <p className="mt-3 text-xs">
        <a
          href={`https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-brass-dark hover:underline"
        >
          View {ticker} on Yahoo Finance
        </a>
        <span className="text-muted"> — the provider has no page for a single event.</span>
      </p>
    </div>
  );
}

function EventsPanel({ data }: { data: TickerEventFeed }) {
  // One open at a time, like the timeline's News column: a column of expanded
  // detail blocks is a wall, and these are read one at a time anyway.
  const [openKey, setOpenKey] = useState<string | undefined>(undefined);

  if (data.events.length === 0) {
    return (
      <Empty>
        No dividends, splits or reported quarters for {data.ticker} in the last year.
      </Empty>
    );
  }

  return (
    <div>
      <Table head={["Date", "Event", "What happened", "Close"]}>
        {data.events.map((event, index) => {
          const key = `${event.date}:${event.kind}:${index}`;
          const isOpen = openKey === key;
          const outcome = event.outcome ? OUTCOME_STYLE[event.outcome] : undefined;

          return (
            <Fragment key={key}>
              <tr>
                <Cell align="left">
                  <button
                    type="button"
                    onClick={() => setOpenKey(isOpen ? undefined : key)}
                    aria-expanded={isOpen}
                    className="flex items-center gap-1.5 text-brass-dark hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
                  >
                    <span
                      className={`text-muted transition-transform motion-reduce:transition-none ${
                        isOpen ? "rotate-90" : ""
                      }`}
                      aria-hidden
                    >
                      &rsaquo;
                    </span>
                    {formatDate(event.date)}
                  </button>
                </Cell>
                <Cell align="left">
                  <EventKindChip kind={event.kind} />
                </Cell>
                <Cell align="left">
                  {event.summary}
                  {outcome && (
                    <span className={`ml-2 text-xs font-medium ${outcome.className}`}>
                      {outcome.label}
                    </span>
                  )}
                </Cell>
                <Cell>{event.closeCents != null ? formatCents(event.closeCents) : "—"}</Cell>
              </tr>
              {isOpen && (
                <tr>
                  <td colSpan={4} className="border-b border-line px-2 pb-3 pt-1">
                    <EventDetails event={event} ticker={data.ticker} />
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </Table>

      {data.closesUnavailable && (
        <p className="mt-3 text-xs text-muted">
          The price history could not be fetched, so no event shows the close it happened
          against.
        </p>
      )}
    </div>
  );
}

function NewsPanel({ data }: { data: TickerNewsFeed }) {
  if (data.stories.length === 0) {
    return <Empty>The provider has no recent stories for {data.ticker}.</Empty>;
  }

  return (
    <ul className="space-y-2">
      {data.stories.map((story) => (
        <li key={story.url} className="rounded-lg border border-line p-3">
          <a
            href={story.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-ink hover:text-brass-dark hover:underline"
          >
            {story.title}
          </a>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>{story.publisher}</span>
            <span aria-hidden="true">·</span>
            <span>{formatDateTime(story.publishedAt)}</span>
            {story.isFromToday && (
              <span className="rounded bg-brass-soft px-1.5 py-0.5 font-medium text-brass-dark">
                Today
              </span>
            )}
            {story.isPrimarySubject ? (
              <span className="rounded bg-brass-soft px-1.5 py-0.5 font-medium text-brass-dark">
                Lead subject
              </span>
            ) : (
              <span title={`${data.ticker} is mentioned, not the subject`}>Mention</span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Panels — the Yahoo reference record.
//
// Every field on every section is optional (see `lib/ticker-detail/types.ts`),
// so each of these renders only what came back. `Facts` drops its own undefined
// rows, which is what keeps an ETF's Profile card from being a grid of dashes.
// ---------------------------------------------------------------------------

/** A large money figure as $4.56T / $391.0B / $12.3M. Cents in, compact out. */
function formatBigCents(cents?: number): string | undefined {
  if (cents == null) return undefined;
  const dollars = cents / 100;
  const magnitude = Math.abs(dollars);
  const sign = dollars < 0 ? "−" : "";

  if (magnitude >= 1e12) return `${sign}$${(magnitude / 1e12).toFixed(2)}T`;
  if (magnitude >= 1e9) return `${sign}$${(magnitude / 1e9).toFixed(2)}B`;
  if (magnitude >= 1e6) return `${sign}$${(magnitude / 1e6).toFixed(1)}M`;
  return formatCents(cents);
}

/** A large share/unit count as 48.2M / 15.1B. Not money, so no currency. */
function formatBigCount(value?: number): string | undefined {
  if (value == null) return undefined;
  const magnitude = Math.abs(value);
  if (magnitude >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (magnitude >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (magnitude >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return formatCount(value);
}

function ratio(value?: number, digits = 2): string | undefined {
  return value == null ? undefined : value.toFixed(digits);
}

function optionalPct(value?: number, digits = 2): string | undefined {
  return value == null ? undefined : formatPlainPct(value, digits);
}

/**
 * A definition grid that silently skips anything the provider didn't report.
 *
 * Passing `undefined` for a value removes the row entirely rather than printing
 * a dash — with coverage this patchy, a card of dashes says nothing, and a short
 * card of real figures says exactly what is known.
 */
function Facts({
  items,
  columns = 3,
}: {
  items: [label: string, value: string | undefined][];
  columns?: 2 | 3;
}) {
  const present = items.filter((item): item is [string, string] => Boolean(item[1]));
  if (present.length === 0) {
    return <p className="text-sm text-muted">The provider reported none of these.</p>;
  }

  return (
    <dl className={`grid grid-cols-2 gap-3 ${columns === 3 ? "sm:grid-cols-3" : ""}`}>
      {present.map(([label, value]) => (
        <div key={label}>
          <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
          <dd className="font-mono text-sm text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Shown in place of a card's body when the provider omitted that whole module. */
function NotReported({ what }: { what: string }) {
  return <Empty>The provider reports no {what} for this symbol.</Empty>;
}

function MarketDataSection({ data }: { data: TickerYahooDetail }) {
  const section = data.marketData;
  if (!section) return <NotReported what="market data" />;

  const range =
    section.dayLowCents != null && section.dayHighCents != null
      ? `${formatCents(section.dayLowCents)} – ${formatCents(section.dayHighCents)}`
      : undefined;
  const range52 =
    section.fiftyTwoWeekLowCents != null && section.fiftyTwoWeekHighCents != null
      ? `${formatCents(section.fiftyTwoWeekLowCents)} – ${formatCents(section.fiftyTwoWeekHighCents)}`
      : undefined;

  return (
    <Facts
      items={[
        ["Price", section.priceCents != null ? formatCents(section.priceCents) : undefined],
        ["Previous close", section.previousCloseCents != null ? formatCents(section.previousCloseCents) : undefined],
        ["Open", section.openCents != null ? formatCents(section.openCents) : undefined],
        ["Day range", range],
        ["52-week range", range52],
        ["Market cap", formatBigCents(section.marketCapCents)],
        ["Volume", formatBigCount(section.volume)],
        ["Average volume", formatBigCount(section.averageVolume)],
        ["Exchange", section.exchangeName],
        ["Currency", section.currency],
        ["Type", section.quoteType],
        // Only present outside regular hours, which is exactly when it matters.
        ["Pre-market", section.preMarketPriceCents != null ? formatCents(section.preMarketPriceCents) : undefined],
        ["Pre-market move", optionalPct(section.preMarketChangePct)],
        ["Post-market", section.postMarketPriceCents != null ? formatCents(section.postMarketPriceCents) : undefined],
        ["Post-market move", optionalPct(section.postMarketChangePct)],
      ]}
    />
  );
}

function CompanyProfileSection({ data }: { data: TickerYahooDetail }) {
  const section = data.profile;
  if (!section) return <NotReported what="company profile" />;

  const location = [section.city, section.state, section.country].filter(Boolean).join(", ");
  const identity: [string, string | undefined][] = [
    ["Sector", section.sector],
    ["Industry", section.industry],
    ["Employees", section.employees != null ? formatCount(section.employees) : undefined],
    ["Headquarters", location || undefined],
  ];

  return (
    <div>
      {/* Skipped entirely when none of the four are known, rather than printing
          "reported none of these" above a summary that plainly reports plenty.
          A fund has a description but no sector, industry or staff. */}
      {identity.some(([, value]) => value) && <Facts items={identity} />}

      {section.website && (
        <p className="mt-3 text-sm">
          <a
            href={section.website}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brass-dark hover:underline"
          >
            {section.website}
          </a>
        </p>
      )}

      {section.summary && (
        <>
          <SectionTitle>Business summary</SectionTitle>
          <p className="text-sm leading-relaxed text-ink">{section.summary}</p>
        </>
      )}

      {section.officers.length > 0 && (
        <>
          <SectionTitle>Officers</SectionTitle>
          <Table head={["Name", "Title", "Age", "Total pay"]}>
            {section.officers.map((officer) => (
              <tr key={`${officer.name}:${officer.title}`}>
                <Cell align="left">{officer.name}</Cell>
                <Cell align="left">{officer.title || "—"}</Cell>
                <Cell>{officer.age ?? "—"}</Cell>
                <Cell>{formatBigCents(officer.totalPayCents) ?? "—"}</Cell>
              </tr>
            ))}
          </Table>
        </>
      )}
    </div>
  );
}

/** Yahoo's period keys, said in words. "0m" is the current month. */
const TREND_PERIOD_LABELS: Record<string, string> = {
  "0m": "Now",
  "-1m": "1 month ago",
  "-2m": "2 months ago",
  "-3m": "3 months ago",
};

/** Colours a rating action: an upgrade is good news, a downgrade isn't. */
function actionClass(action?: string): string {
  if (action === "up") return "text-emerald-400";
  if (action === "down") return "text-red-400";
  return "text-muted";
}

function AnalysisSection({ data }: { data: TickerYahooDetail }) {
  const section = data.analysis;
  if (!section) return <NotReported what="analyst coverage" />;

  const targetRange =
    section.targetLowCents != null && section.targetHighCents != null
      ? `${formatCents(section.targetLowCents)} – ${formatCents(section.targetHighCents)}`
      : undefined;

  return (
    <div>
      <Facts
        items={[
          ["Consensus", section.recommendationKey?.replace(/_/g, " ")],
          // 1 = strong buy, 5 = strong sell. Said here so the number is readable.
          ["Rating (1 buy – 5 sell)", ratio(section.recommendationMean)],
          ["Analysts", section.analystCount != null ? formatCount(section.analystCount) : undefined],
          ["Mean target", section.targetMeanCents != null ? formatCents(section.targetMeanCents) : undefined],
          ["Median target", section.targetMedianCents != null ? formatCents(section.targetMedianCents) : undefined],
          ["Target range", targetRange],
        ]}
      />

      {section.trend.length > 0 && (
        <>
          <SectionTitle>Recommendation trend</SectionTitle>
          <Table head={["Period", "Strong buy", "Buy", "Hold", "Sell", "Strong sell", "Total"]}>
            {section.trend.map((period) => (
              <tr key={period.period}>
                <Cell align="left">{TREND_PERIOD_LABELS[period.period] ?? period.period}</Cell>
                <Cell className="text-emerald-400">{period.strongBuy}</Cell>
                <Cell className="text-emerald-400">{period.buy}</Cell>
                <Cell>{period.hold}</Cell>
                <Cell className="text-red-400">{period.sell}</Cell>
                <Cell className="text-red-400">{period.strongSell}</Cell>
                <Cell>{period.total}</Cell>
              </tr>
            ))}
          </Table>
        </>
      )}

      {section.ratingChanges.length > 0 && (
        <>
          <SectionTitle>Recent rating changes</SectionTitle>
          <Table head={["Date", "Firm", "Action", "From", "To"]}>
            {section.ratingChanges.map((change) => (
              <tr key={`${change.date}:${change.firm}:${change.toGrade}`}>
                <Cell align="left">{formatDate(change.date)}</Cell>
                <Cell align="left">{change.firm}</Cell>
                <Cell align="left" className={actionClass(change.action)}>
                  {change.action ?? "—"}
                </Cell>
                <Cell align="left">{change.fromGrade || "—"}</Cell>
                <Cell align="left">{change.toGrade}</Cell>
              </tr>
            ))}
          </Table>
          {/* The provider keeps the full archive; this is the recent slice. */}
          {section.totalRatingChanges > section.ratingChanges.length && (
            <p className="mt-3 text-xs text-muted">
              Showing the {section.ratingChanges.length} most recent of{" "}
              {formatCount(section.totalRatingChanges)} the provider holds.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function ValuationSection({ data }: { data: TickerYahooDetail }) {
  const section = data.valuation;
  if (!section) return <NotReported what="valuation figures" />;

  return (
    <Facts
      items={[
        ["Trailing P/E", ratio(section.trailingPE)],
        ["Forward P/E", ratio(section.forwardPE)],
        ["PEG ratio", ratio(section.pegRatio)],
        ["Price / book", ratio(section.priceToBook)],
        ["Price / sales", ratio(section.priceToSales)],
        ["Enterprise value", formatBigCents(section.enterpriseValueCents)],
        ["EV / revenue", ratio(section.enterpriseToRevenue)],
        ["EV / EBITDA", ratio(section.enterpriseToEbitda)],
        ["Beta", ratio(section.beta)],
        ["Dividend yield", optionalPct(section.dividendYieldPct)],
        ["Payout ratio", optionalPct(section.payoutRatioPct)],
      ]}
    />
  );
}

function FinancialsSection({ data }: { data: TickerYahooDetail }) {
  const section = data.financials;
  if (!section) return <NotReported what="financials" />;

  return (
    <div>
      <Facts
        items={[
          ["Revenue (TTM)", formatBigCents(section.totalRevenueCents)],
          ["Gross profit", formatBigCents(section.grossProfitsCents)],
          ["EBITDA", formatBigCents(section.ebitdaCents)],
          ["Free cash flow", formatBigCents(section.freeCashflowCents)],
          ["Total cash", formatBigCents(section.totalCashCents)],
          ["Total debt", formatBigCents(section.totalDebtCents)],
          ["Debt / equity", ratio(section.debtToEquity)],
          ["Current ratio", ratio(section.currentRatio)],
          ["Profit margin", optionalPct(section.profitMarginPct)],
          ["Operating margin", optionalPct(section.operatingMarginPct)],
          ["Return on equity", optionalPct(section.returnOnEquityPct)],
          ["Return on assets", optionalPct(section.returnOnAssetsPct)],
          ["Revenue growth", optionalPct(section.revenueGrowthPct)],
          ["Earnings growth", optionalPct(section.earningsGrowthPct)],
        ]}
      />

      {section.incomeStatements.length > 0 && (
        <>
          <SectionTitle>Income statement, by year</SectionTitle>
          <Table head={["Period end", "Revenue", "Gross profit", "Operating income", "Net income"]}>
            {section.incomeStatements.map((row) => (
              <tr key={row.endDate}>
                <Cell align="left">{formatDate(row.endDate)}</Cell>
                <Cell>{formatBigCents(row.totalRevenueCents) ?? "—"}</Cell>
                <Cell>{formatBigCents(row.grossProfitCents) ?? "—"}</Cell>
                <Cell>{formatBigCents(row.operatingIncomeCents) ?? "—"}</Cell>
                <Cell>{formatBigCents(row.netIncomeCents) ?? "—"}</Cell>
              </tr>
            ))}
          </Table>
        </>
      )}
    </div>
  );
}

function KeyStatisticsSection({ data }: { data: TickerYahooDetail }) {
  const section = data.keyStatistics;
  if (!section) return <NotReported what="key statistics" />;

  const split =
    section.lastSplitFactor && section.lastSplitDate
      ? `${section.lastSplitFactor} on ${formatDate(section.lastSplitDate)}`
      : section.lastSplitFactor;

  return (
    <Facts
      items={[
        ["Shares outstanding", formatBigCount(section.sharesOutstanding)],
        ["Float", formatBigCount(section.floatShares)],
        ["Held by insiders", optionalPct(section.heldPercentInsidersPct)],
        ["Held by institutions", optionalPct(section.heldPercentInstitutionsPct)],
        ["Shares short", formatBigCount(section.sharesShort)],
        ["Short ratio", ratio(section.shortRatio)],
        ["Short % of float", optionalPct(section.shortPercentOfFloatPct)],
        ["Book value / share", section.bookValuePerShareCents != null ? formatCents(section.bookValuePerShareCents) : undefined],
        ["52-week change", optionalPct(section.fiftyTwoWeekChangePct)],
        ["S&P 52-week change", optionalPct(section.benchmark52WeekChangePct)],
        ["Fiscal year end", section.lastFiscalYearEnd ? formatDate(section.lastFiscalYearEnd) : undefined],
        ["Most recent quarter", section.mostRecentQuarter ? formatDate(section.mostRecentQuarter) : undefined],
        ["Last split", split],
      ]}
    />
  );
}

// ---------------------------------------------------------------------------
// The dialog
// ---------------------------------------------------------------------------

/** A row of tab buttons. Styled to match `Tabs`, but controlled by the caller. */
function TabStrip<K extends string>({
  items,
  activeKey,
  onSelect,
  label,
}: {
  items: { key: K; label: string; hint?: string }[];
  activeKey: K;
  onSelect: (key: K) => void;
  label: string;
}) {
  return (
    <div className="flex gap-1 border-b border-line" role="tablist" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="tab"
          title={item.hint}
          aria-selected={item.key === activeKey}
          onClick={() => onSelect(item.key)}
          className={`px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${
            item.key === activeKey
              ? "border-b-2 border-brass text-ink"
              : "text-muted hover:text-ink"
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function TickerViewer({
  ticker,
  activeGroup,
  onSelectGroup,
  onClose,
  ownData,
  tradeTimeline,
  quote,
  priceSeries,
  events,
  risk,
  news,
  detail,
  range,
  onSelectRange,
  ranges = DEFAULT_RANGES,
  onRecalculateRisk,
  className = "",
}: TickerViewerProps) {
  // The header price prefers the live quote and falls back to our own recorded
  // price, so the dialog still says what a share is worth before the Market tab
  // has ever been opened.
  const headerPriceCents = quote.data?.priceCents ?? ownData.data?.holdings[0]?.currentPriceCents;
  const headerChangePct = quote.data?.changePct ?? ownData.data?.totals.dayChangePct;
  const name = quote.data?.shortName || ownData.data?.name || "";

  return (
    <Modal
      title={ticker}
      size="window"
      onClose={onClose}
      className={className}
      description={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <TickerLogo ticker={ticker} size={28} />
          {name && <span className="text-ink">{name}</span>}
          {headerPriceCents != null && (
            <span className="font-mono text-ink">{formatCents(headerPriceCents)}</span>
          )}
          {headerChangePct != null && (
            <span className={moveClass(headerChangePct)}>{formatPct(headerChangePct)}</span>
          )}
          {ownData.data?.isHeld === false && ownData.data.isWatched && (
            <span className="rounded bg-brass-soft px-1.5 py-0.5 text-xs font-medium text-brass-dark">
              Watch only
            </span>
          )}
        </span>
      }
    >
      <TabStrip
        label="Data source"
        items={GROUPS}
        activeKey={activeGroup}
        onSelect={onSelectGroup}
      />

      {/* One card per section, all open. The inactive tab's cards are unmounted
          rather than hidden, so switching tabs doesn't leave two charts
          measuring themselves against a container they can't see. */}
      <div className="space-y-3 pt-4">
        {activeGroup === "own" && (
          <>
            <CollapsibleCard title="Holdings" defaultOpen>
              <Panel state={ownData} loadingLabel="Reading your records…">
                {(data) => <HoldingsPanel data={data} />}
              </Panel>
            </CollapsibleCard>

            <CollapsibleCard title="Transactions" defaultOpen>
              <Panel state={ownData} loadingLabel="Reading your records…">
                {(data) => <TradesPanel data={data} timeline={tradeTimeline} />}
              </Panel>
            </CollapsibleCard>

            <CollapsibleCard title="Watchlist & income" defaultOpen>
              <Panel state={ownData} loadingLabel="Reading your records…">
                {(data) => <WatchAndIncomePanel data={data} />}
              </Panel>
            </CollapsibleCard>
          </>
        )}

        {activeGroup === "market" && (
          <>
            <CollapsibleCard title="Quote" defaultOpen>
              <Panel state={quote} loadingLabel="Fetching the quote…">
                {(data) => <QuotePanel data={data} />}
              </Panel>
            </CollapsibleCard>

            <CollapsibleCard title="Price History" defaultOpen>
              <Panel state={priceSeries} loadingLabel="Fetching the price history…">
                {(data) => (
                  <ChartPanel
                    data={data}
                    range={range}
                    ranges={ranges}
                    onSelectRange={onSelectRange}
                    isLoading={priceSeries.isLoading}
                  />
                )}
              </Panel>
            </CollapsibleCard>

            {/* Sits under the chart because it explains its shape: the step down
                in March was the ex-dividend date, the gap up was the beat. */}
            <CollapsibleCard title="Events" defaultOpen>
              <Panel state={events} loadingLabel="Fetching dividends, splits and earnings…">
                {(data) => <EventsPanel data={data} />}
              </Panel>
            </CollapsibleCard>

            {/* Recalculate goes in `headerAction` so it stays reachable with the
                card shut — this is the only way to refresh a stored row, and a
                reader shouldn't have to expand the card to reach it. */}
            <CollapsibleCard
              title="Risks"
              defaultOpen
              headerAction={
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={onRecalculateRisk}
                  disabled={risk.isLoading}
                >
                  {risk.isLoading ? "Recalculating…" : "Recalculate"}
                </Button>
              }
            >
              <Panel state={risk} loadingLabel="Computing the risk figures…">
                {(data) => <RiskPanel data={data} />}
              </Panel>
            </CollapsibleCard>

            <CollapsibleCard title="News" defaultOpen>
              <Panel state={news} loadingLabel="Fetching recent stories…">
                {(data) => <NewsPanel data={data} />}
              </Panel>
            </CollapsibleCard>
          </>
        )}

        {activeGroup === "yahoo" && (
          <Panel state={detail} loadingLabel="Fetching the Yahoo Finance record…">
            {(data) => (
              <>
                {/* Only Market Data starts open. Six expanded cards of reference
                    tables is a very long page, and this is the section a reader
                    lands here for; the rest are looked up deliberately. */}
                <CollapsibleCard title="Market Data" defaultOpen className="mb-3">
                  <MarketDataSection data={data} />
                </CollapsibleCard>

                <CollapsibleCard title="Company Profile" className="mb-3">
                  <CompanyProfileSection data={data} />
                </CollapsibleCard>

                <CollapsibleCard title="Analysis recommendations" className="mb-3">
                  <AnalysisSection data={data} />
                </CollapsibleCard>

                <CollapsibleCard title="Valuation & Trading" className="mb-3">
                  <ValuationSection data={data} />
                </CollapsibleCard>

                <CollapsibleCard title="Financials" className="mb-3">
                  <FinancialsSection data={data} />
                </CollapsibleCard>

                <CollapsibleCard title="Key statistics" className="mb-3">
                  <KeyStatisticsSection data={data} />
                </CollapsibleCard>

                <p className="text-xs text-muted">
                  All six sections come from one request to the provider, fetched{" "}
                  {formatDateTime(data.fetchedAt)}.
                </p>
              </>
            )}
          </Panel>
        )}
      </div>
    </Modal>
  );
}
