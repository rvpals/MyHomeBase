// The full-record dialog for one ticker: everything the app knows about a
// symbol, in tabs.
//
// The tabs are in two groups, and the grouping is the point — "Our data" is what
// MyHomeBase recorded (holdings, trades, watchlists), "Market" is what the
// provider said (quote, chart, risk, news). A reader should never have to guess
// whether a number came from their broker export or from Yahoo.
//
// Pure presentation. It fetches nothing: every panel arrives as a
// `TickerPanelState` and the host decides when to load it, which is what lets
// the market panels stay lazy — a provider round-trip happens when a reader
// opens that tab, not when the dialog opens.

"use client";

import { useState, type ReactNode } from "react";
import { Modal } from "@/components/modal";
import { ChartLine } from "@/components/chart-line";
import { TickerLogo } from "@/components/ticker-logo";
import type { MarketEvent } from "@/lib/market-data";
import { centsToDollars, formatCents } from "@/lib/shared/money";
import type {
  TickerHistoryRange,
  TickerNewsFeed,
  TickerOwnData,
  TickerPriceSeries,
  TickerQuote,
  TickerRisk,
  TickerTimelinePoint,
  TickerTradeTimeline,
} from "@/lib/ticker-overview";

/** Which panel is showing. The prefix is the group it belongs to. */
export type TickerPanelKey =
  | "own:holdings"
  | "own:trades"
  | "own:watch"
  | "market:quote"
  | "market:chart"
  | "market:risk"
  | "market:news";

export type TickerPanelGroup = "own" | "market";

/** One panel's load state. The host owns it; the viewer just renders it. */
export interface TickerPanelState<T> {
  data?: T;
  error?: string;
  isLoading?: boolean;
}

export interface TickerViewerProps {
  ticker: string;
  /** Controlled — the host switches panels so it can load one on first open. */
  activePanel: TickerPanelKey;
  onSelectPanel: (panel: TickerPanelKey) => void;
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
  risk: TickerPanelState<TickerRisk>;
  news: TickerPanelState<TickerNewsFeed>;

  /** The chart window currently selected. */
  range: TickerHistoryRange;
  onSelectRange: (range: TickerHistoryRange) => void;
  /** Windows to offer. Defaults to the full set. */
  ranges?: readonly TickerHistoryRange[];

  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

const DEFAULT_RANGES: readonly TickerHistoryRange[] = ["1mo", "3mo", "6mo", "1y", "5y"];

const GROUPS: { key: TickerPanelGroup; label: string; hint: string }[] = [
  { key: "own", label: "Our data", hint: "Recorded in MyHomeBase" },
  { key: "market", label: "Market", hint: "Live from the market-data provider" },
];

const PANELS: { key: TickerPanelKey; group: TickerPanelGroup; label: string }[] = [
  { key: "own:holdings", group: "own", label: "Holdings" },
  { key: "own:trades", group: "own", label: "Transactions" },
  { key: "own:watch", group: "own", label: "Watchlist & income" },
  { key: "market:quote", group: "market", label: "Quote" },
  { key: "market:chart", group: "market", label: "Price history" },
  { key: "market:risk", group: "market", label: "Risk" },
  { key: "market:news", group: "market", label: "News" },
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

/** A corporate action or reported quarter, in one short phrase. */
function describeEvent(event: MarketEvent): string {
  if (event.kind === "dividend") {
    return event.amountCents != null
      ? `Dividend ${formatCents(event.amountCents)}`
      : "Dividend";
  }
  if (event.kind === "split") {
    return event.ratio ? `Split ${event.ratio}` : "Split";
  }
  if (event.epsActualCents == null) return "Earnings";
  const beat =
    event.epsEstimateCents != null
      ? ` vs ${formatCents(event.epsEstimateCents)} est.`
      : "";
  return `Earnings ${formatCents(event.epsActualCents)} EPS${beat}`;
}

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
              {describeEvent(event)}
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
      <Table head={["Date", "Action", "Shares", "Price", "Total", "Brokerage"]}>
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
  // Recharts wants plain numbers, and dollars read better on an axis than cents.
  const chartData = data.points.map((point) => ({
    date: point.date,
    close: centsToDollars(point.closeCents),
  }));

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1">
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
        {isLoading && <span className="self-center pl-2 text-xs text-muted">Loading…</span>}
      </div>

      {chartData.length === 0 ? (
        <Empty>The provider returned no closes for this window.</Empty>
      ) : (
        <>
          <ChartLine
            data={chartData}
            series={[{ key: "close", label: "Close" }]}
            xKey="date"
            formatValue={(value) => `$${value.toFixed(2)}`}
            formatX={(value) => String(value).slice(5)}
          />
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

      <p className="mt-4 text-xs text-muted">Calculated {formatDateTime(data.calculatedAt)}.</p>
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
  activePanel,
  onSelectPanel,
  onClose,
  ownData,
  tradeTimeline,
  quote,
  priceSeries,
  risk,
  news,
  range,
  onSelectRange,
  ranges = DEFAULT_RANGES,
  className = "",
}: TickerViewerProps) {
  const activeGroup: TickerPanelGroup = activePanel.startsWith("market") ? "market" : "own";
  const groupPanels = PANELS.filter((panel) => panel.group === activeGroup);

  // The header price prefers the live quote and falls back to our own recorded
  // price, so the dialog still says what a share is worth before the Market tab
  // has ever been opened.
  const headerPriceCents = quote.data?.priceCents ?? ownData.data?.holdings[0]?.currentPriceCents;
  const headerChangePct = quote.data?.changePct ?? ownData.data?.totals.dayChangePct;
  const name = quote.data?.shortName || ownData.data?.name || "";

  return (
    <Modal
      title={ticker}
      size="full"
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
        onSelect={(group) => {
          // Switching group lands on that group's first panel rather than
          // remembering where you were — the groups are read start-to-end.
          const first = PANELS.find((panel) => panel.group === group);
          if (first) onSelectPanel(first.key);
        }}
      />

      <div className="mt-1">
        <TabStrip
          label={activeGroup === "own" ? "Our data panels" : "Market panels"}
          items={groupPanels}
          activeKey={activePanel}
          onSelect={onSelectPanel}
        />
      </div>

      <div className="pt-4">
        {activePanel === "own:holdings" && (
          <Panel state={ownData} loadingLabel="Reading your records…">
            {(data) => <HoldingsPanel data={data} />}
          </Panel>
        )}
        {activePanel === "own:trades" && (
          <Panel state={ownData} loadingLabel="Reading your records…">
            {(data) => <TradesPanel data={data} timeline={tradeTimeline} />}
          </Panel>
        )}
        {activePanel === "own:watch" && (
          <Panel state={ownData} loadingLabel="Reading your records…">
            {(data) => <WatchAndIncomePanel data={data} />}
          </Panel>
        )}
        {activePanel === "market:quote" && (
          <Panel state={quote} loadingLabel="Fetching the quote…">
            {(data) => <QuotePanel data={data} />}
          </Panel>
        )}
        {activePanel === "market:chart" && (
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
        )}
        {activePanel === "market:risk" && (
          <Panel state={risk} loadingLabel="Computing the risk figures…">
            {(data) => <RiskPanel data={data} />}
          </Panel>
        )}
        {activePanel === "market:news" && (
          <Panel state={news} loadingLabel="Fetching recent stories…">
            {(data) => <NewsPanel data={data} />}
          </Panel>
        )}
      </div>
    </Modal>
  );
}
