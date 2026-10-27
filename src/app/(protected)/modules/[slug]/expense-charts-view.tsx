"use client";

import { useMemo, useState } from "react";
import { ChartBar } from "@/components/chart-bar";
import { CHART_CATEGORICAL_COLORS } from "@/components/chart-colors";
import { ChartLine } from "@/components/chart-line";
import { ChartPie } from "@/components/chart-pie";
import { CollapsibleCard } from "@/components/collapsible-card";
import { Tabs, type TabItem } from "@/components/tabs";
import {
  compareMonths,
  currentMonth,
  latestMonth,
  monthCategoryBreakdown,
  monthLabel,
  monthlyTotals,
  monthsPresent,
  nextMonthOf,
  previousMonthOf,
  type CategoryComparison,
  type CategoryTotal,
  type ExpenseCategory,
  type ExpenseTransaction,
  type ExpenseVendor,
  type VendorTotal,
} from "@/lib/expense";
import { OTHER_SLICE_KEY, foldToOther, type PartToWholeSlice } from "@/lib/shared/chart-options";
import {
  CategoryIconThumbnail,
  VendorIconThumbnail,
  categoryIconUrlsByName,
  formatCents,
  vendorIconFor,
  vendorIconUrlsByName,
} from "./expense-shared";

const UNCATEGORISED_LABEL = "uncategorised";
const UNKNOWN_VENDOR_LABEL = "unknown";

/**
 * How many vendors the pie names before the rest fold into one "others" slice.
 * The cap is the palette's, not a layout choice — see `MAX_PART_TO_WHOLE_SLICES`.
 */
const CHARTED_VENDOR_COUNT = 5;

/**
 * The Vendor card: a donut of each **saved** vendor's share, with the pooled slice
 * drillable.
 *
 * Restricted to saved vendors on purpose. The derived rollups pick up every brand
 * key a statement description yields, which is a long tail of one-off spellings
 * that swamps the chart; saving a vendor is the signal that you care about it, so
 * the saved list is the curated one worth charting. The shares are therefore of
 * *saved* spend, not of all spend — the header says so.
 *
 * Clicking "N other vendors" doesn't open a different kind of view — it folds the
 * *remainder* the same way and draws the same donut one level down. So the drill is
 * one operation applied repeatedly, and "Back" is just a smaller depth.
 */
function VendorSpendCard({
  vendorTotals,
  vendors,
}: {
  vendorTotals: VendorTotal[];
  /** The saved vendors: both what the chart is limited to and where its icons come from. */
  vendors: ExpenseVendor[];
}) {
  const vendorIconUrls = vendorIconUrlsByName(vendors);
  // How many whole pages of vendors have been drilled past. 0 is the top level.
  const [depth, setDepth] = useState(0);

  // Upper-cased, matching vendorGroupKey and the NOCASE index: a transaction's
  // spelling needn't match the saved row's, and comparing exactly would drop a
  // vendor from its own chart.
  const savedNames = new Set(vendors.map((vendor) => vendor.name.toUpperCase()));

  // A pie shows a share of a whole, so a credit — a negative share — has no slice
  // to sit in. Same exclusion as the category chart, for a stricter reason.
  // `vendorTotals` already arrives biggest-first, so slicing keeps the top spenders.
  const vendorSpend = vendorTotals.filter(
    (total) => total.totalCents > 0 && savedNames.has(total.vendor.trim().toUpperCase()),
  );
  const allSlices: PartToWholeSlice[] = vendorSpend.map((total) => ({
    key: total.vendor || UNKNOWN_VENDOR_LABEL,
    label: total.vendor || UNKNOWN_VENDOR_LABEL,
    value: total.totalCents / 100,
  }));

  // Guard a stale depth: the row count can shrink under a re-render (a deletion, a
  // re-import) and leave a depth pointing past the end.
  const maxDepth = Math.max(0, Math.ceil(allSlices.length / CHARTED_VENDOR_COUNT) - 1);
  const safeDepth = Math.min(depth, maxDepth);

  const pageSlices = allSlices.slice(safeDepth * CHARTED_VENDOR_COUNT);
  const items = foldToOther(pageSlices, CHARTED_VENDOR_COUNT, (count) => `${count} other vendors`);

  const pageTotalCents = Math.round(pageSlices.reduce((sum, slice) => sum + slice.value, 0) * 100);
  const isDrilled = safeDepth > 0;
  const canDrill = pageSlices.length > CHARTED_VENDOR_COUNT;

  return (
    <CollapsibleCard title="Vendor">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-lg text-ink">
          Spend by vendor
          {isDrilled && <span className="text-muted"> — the smaller {pageSlices.length}</span>}
        </h3>
        {isDrilled && (
          <button
            type="button"
            onClick={() => setDepth(safeDepth - 1)}
            className="rounded-md text-sm font-medium text-brass-dark hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
          >
            &larr; Back
          </button>
        )}
      </div>
      <p className="mt-1 text-sm text-muted">
        {isDrilled ? (
          <>
            The vendors pooled one level up, as a share of their own{" "}
            {formatCents(pageTotalCents)}.
          </>
        ) : (
          <>
            Each saved vendor&apos;s share of {formatCents(pageTotalCents)} — the spend
            belonging to vendors you&apos;ve saved, not your whole total. Grouped on the
            vendor that post-import processing set, falling back to the leading brand word
            of the statement description, so COSTCO* and AMAZON* lines roll up together.
            Save a vendor under Meta Data to add it here.
          </>
        )}
        {canDrill && " Click the pooled slice to break it down further."}
      </p>
      {items.length > 0 ? (
        <>
          <div className="mt-3">
            <ChartPie
              items={items}
              formatValue={(value) => `$${value.toFixed(2)}`}
              // Only the pooled slice drills — a single vendor has nothing inside it.
              isSliceEnabled={(slice) => slice.key === OTHER_SLICE_KEY}
              onSliceClick={() => setDepth(safeDepth + 1)}
            />
          </div>
          {/*
            This list is load-bearing, not decoration. It does two jobs the pie
            can't: it names each slice (the chart prints only a percentage, so this
            is where identity lives now that there's no legend box), and it gives
            the exact amount a slice can only approximate. It's also the "table
            view" that discharges the dataviz contrast warning — three of the
            palette's hues sit below 3:1 against paper — and the only way a
            keyboard reaches the drill-down, since an SVG wedge can't take focus.
            The swatch index must track the chart's, which is why both read
            CHART_CATEGORICAL_COLORS in the same order.
          */}
          <ul className="mt-3 flex flex-col gap-1">
            {items.map((item, index) => {
              const swatch = (
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{
                    backgroundColor:
                      CHART_CATEGORICAL_COLORS[index % CHART_CATEGORICAL_COLORS.length],
                  }}
                />
              );
              const amount = (
                <span className="ml-2 shrink-0 font-mono text-ink">${item.value.toFixed(2)}</span>
              );

              if (item.key === OTHER_SLICE_KEY) {
                return (
                  <li key={item.key}>
                    <button
                      type="button"
                      onClick={() => setDepth(safeDepth + 1)}
                      className="flex w-full items-center justify-between rounded-md border border-line bg-paper px-3 py-1.5 text-left text-sm transition-colors hover:bg-brass-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass motion-reduce:transition-none"
                    >
                      <span className="flex min-w-0 items-center gap-2 text-ink">
                        {swatch}
                        <span className="truncate">{item.label}</span>
                        <span className="shrink-0 text-xs text-brass-dark">Break down &rsaquo;</span>
                      </span>
                      {amount}
                    </button>
                  </li>
                );
              }

              return (
                <li
                  key={item.key}
                  className="flex items-center justify-between rounded-md border border-line bg-paper px-3 py-1.5 text-sm"
                >
                  <span className="flex min-w-0 items-center gap-2 text-ink">
                    {swatch}
                    {/* The slice key is the vendor name, so it can carry the icon.
                        The pooled slice above is many vendors and keeps the
                        swatch alone. */}
                    <VendorIconThumbnail iconUrl={vendorIconFor(vendorIconUrls, item.key)} />
                    <span className="truncate">{item.label}</span>
                  </span>
                  {amount}
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        // Two different reasons for an empty chart, and "no spend" would be a lie
        // for the first one: you may well have plenty of spend, just none of it
        // against a vendor you've saved.
        <p className="mt-3 text-sm text-muted">
          {vendors.length === 0
            ? "No saved vendors yet — save one under Meta Data to chart it."
            : "No positive spend against your saved vendors to chart."}
        </p>
      )}
    </CollapsibleCard>
  );
}

/** What an empty category is called in the trend table. Matches the rest of the module. */
const UNCATEGORISED_TREND_LABEL = "uncategorised";

/** How many movers the comparison table lists before it stops. */
const MAX_COMPARISON_ROWS = 12;

/**
 * Net spend per calendar month — the module's only view with a time axis.
 *
 * Calendar months rather than billing cycles: a cycle belongs to one card, so
 * two cards closing on different days have different "Augusts" and there is no
 * shared axis to compare. See the header of `trends.ts`.
 */
function SpendOverTimeCard({ transactions }: { transactions: ExpenseTransaction[] }) {
  // Walks every transaction, so it recomputes only when the rows change rather
  // than on each render of the surrounding screen.
  const totals = useMemo(() => monthlyTotals(transactions), [transactions]);

  if (totals.length < 2) {
    return (
      <section>
        <h2 className="font-display text-xl text-ink">Spend over time</h2>
        <p className="mt-1 text-sm text-muted">
          {totals.length === 0
            ? "Nothing dated to chart yet."
            : "Only one month so far — a trend needs at least two."}
        </p>
      </section>
    );
  }

  // Dollars, not cents: the axis and the tooltip both read in the unit the rest
  // of the screen prints.
  const data = totals.map((total) => ({ month: total.label, spend: total.totalCents / 100 }));

  const latest = totals[totals.length - 1];
  const previous = totals[totals.length - 2];
  const change = latest.totalCents - previous.totalCents;

  return (
    <section>
      <h2 className="font-display text-xl text-ink">Spend over time</h2>
      <p className="mt-1 text-sm text-muted">
        Net spend per calendar month, refunds included. {latest.label} is{" "}
        {change === 0 ? (
          "level with"
        ) : (
          <>
            <span className={change > 0 ? "text-brass-dark" : "text-emerald-400"}>
              {formatCents(Math.abs(change))} {change > 0 ? "more" : "less"}
            </span>{" "}
            than
          </>
        )}{" "}
        {previous.label}.
        {/* The newest month is almost always still running, so it will read as a
            drop no matter what. Said plainly rather than letting the chart imply
            a fall that is really an incomplete month. */}{" "}
        The most recent month may be partial.
      </p>
      <div className="mt-3">
        <ChartLine
          data={data}
          series={[{ key: "spend", label: "Net spend" }]}
          xKey="month"
          formatValue={(value) => `$${value.toFixed(2)}`}
          // Every month prints its own dollar amount. Twelve months is exactly
          // DEFAULT_MAX_POINT_LABELS, so a desktop labels all of them; a narrow
          // viewport halves the cap and `resolvePointLabelMode` downgrades this
          // to the high/low pair rather than collide twelve labels across 390px.
          // The gear toolbar still lets a reader override it, and that choice
          // persists under the storage key below.
          pointLabels="all"
          displayStorageKey="myhomebase:chart:expense-spend-over-time"
        />
      </div>
    </section>
  );
}

/** One category's row in the comparison table: the two months and the delta. */
function ComparisonRow({
  row,
  iconUrl,
}: {
  row: CategoryComparison;
  iconUrl: string | undefined;
}) {
  const isUp = row.changeCents > 0;
  const isFlat = row.changeCents === 0;

  return (
    // Stacks below 1024px: five columns don't fit a phone, and a horizontal
    // scroll hides the delta — which is the column the table exists for.
    <li className="flex items-center justify-between gap-3 rounded-md border border-line bg-paper px-3 py-1.5 text-sm max-lg:flex-col max-lg:items-start max-lg:gap-1">
      <span className="flex min-w-0 items-center gap-2 text-ink">
        {row.categoryName === "" ? (
          <span className="text-muted">{UNCATEGORISED_TREND_LABEL}</span>
        ) : (
          <>
            <CategoryIconThumbnail iconUrl={iconUrl} />
            <span className="truncate">{row.categoryName}</span>
          </>
        )}
      </span>

      <span className="flex shrink-0 items-center gap-3 font-mono text-xs max-lg:w-full max-lg:justify-between">
        <span className="text-muted">{formatCents(row.previousCents)}</span>
        <span aria-hidden="true" className="text-muted">
          →
        </span>
        <span className="text-ink">{formatCents(row.currentCents)}</span>
        <span
          className={`w-28 text-right ${
            isFlat ? "text-muted" : isUp ? "text-brass-dark" : "text-emerald-400"
          }`}
        >
          {isFlat ? "no change" : `${isUp ? "+" : "−"}${formatCents(Math.abs(row.changeCents))}`}
          {/* A percentage needs a non-zero base to mean anything — a category
              that started from nothing has no meaningful ratio. */}
          {row.changeRatio !== undefined && !isFlat && (
            <span className="ml-1 text-muted">
              ({isUp ? "+" : "−"}
              {Math.abs(Math.round(row.changeRatio * 100))}%)
            </span>
          )}
        </span>
      </span>
    </li>
  );
}

/**
 * This month against last, per category, biggest movement first — the card that
 * answers "what changed?", which the all-time totals below cannot.
 *
 * Both months are taken from the data rather than from today's clock, so a
 * module that hasn't been imported into for a while compares the two months you
 * actually have instead of two empty ones.
 */
function MonthComparisonCard({
  transactions,
  categoryIconUrls,
}: {
  transactions: ExpenseTransaction[];
  categoryIconUrls: Map<string, string>;
}) {
  const current = useMemo(() => latestMonth(transactions), [transactions]);
  const previous = current === undefined ? undefined : previousMonthOf(current);

  const rows = useMemo(
    () =>
      current === undefined || previous === undefined
        ? []
        : compareMonths(transactions, current, previous),
    [transactions, current, previous],
  );

  if (current === undefined || previous === undefined) {
    return (
      <section>
        <h2 className="font-display text-xl text-ink">Month on month</h2>
        <p className="mt-1 text-sm text-muted">Nothing dated to compare yet.</p>
      </section>
    );
  }

  const movers = rows.filter((row) => row.changeCents !== 0).slice(0, MAX_COMPARISON_ROWS);

  return (
    <section>
      <h2 className="font-display text-xl text-ink">Month on month</h2>
      <p className="mt-1 text-sm text-muted">
        {monthLabel(current)} against {monthLabel(previous)}, biggest movement first.
        {rows.length > movers.length &&
          ` ${rows.length - movers.length} unchanged or smaller mover(s) not shown.`}
      </p>
      {movers.length === 0 ? (
        <p className="mt-3 text-sm text-muted">
          Nothing moved between these two months.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-1">
          {movers.map((row) => (
            <ComparisonRow
              key={row.categoryName || UNCATEGORISED_TREND_LABEL}
              row={row}
              iconUrl={categoryIconUrls.get(row.categoryName)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/** How many categories the month pie names before the rest pool into one slice. */
const CHARTED_CATEGORY_COUNT = 4;

/**
 * One month's spend split by category — the "Expense type By Month" tab.
 *
 * Opens on the **real current month**, not on the newest month in the data. That
 * is a deliberate difference from `MonthComparisonCard` above, which compares the
 * two months you actually have: this tab answers "where is this month's money
 * going", and "nothing yet" is a true answer to that, where showing August in
 * October would be a misleading one. The steppers walk the calendar, so an empty
 * month is reachable and says so.
 *
 * The pooled slice drills exactly as the Vendor card's does — same operation
 * applied one level down, with "Back" being a smaller depth.
 */
function MonthCategoryPieCard({
  transactions,
  categoryIconUrls,
}: {
  transactions: ExpenseTransaction[];
  categoryIconUrls: Map<string, string>;
}) {
  // The opening month is read once, at mount, rather than on every render: a
  // render that happened to cross midnight on the 1st would otherwise move the
  // reader to a different month under them.
  const [month, setMonth] = useState(() => currentMonth());
  // How many whole pages of categories have been drilled past. 0 is the top level.
  const [depth, setDepth] = useState(0);

  // Walks every transaction, so it recomputes only when the rows or the month
  // change rather than on each render of the surrounding screen.
  const breakdown = useMemo(
    () => monthCategoryBreakdown(transactions, month),
    [transactions, month],
  );
  const months = useMemo(() => monthsPresent(transactions), [transactions]);

  function goToMonth(next: string | undefined) {
    if (next === undefined) return;
    setMonth(next);
    // A new month is a new set of categories, so a depth carried over from the
    // old one would point into a page that no longer means anything.
    setDepth(0);
  }

  // Only positive spend reaches the chart — a credit has no share of a whole.
  // The table below still lists every category, credits included.
  const allSlices: PartToWholeSlice[] = breakdown.slices
    .filter((slice) => slice.isSpend)
    .map((slice) => ({
      key: slice.categoryName || UNCATEGORISED_LABEL,
      label: slice.categoryName || UNCATEGORISED_LABEL,
      value: slice.totalCents / 100,
    }));

  // Guard a stale depth: the row count can shrink under a re-render and leave a
  // depth pointing past the end.
  const maxDepth = Math.max(0, Math.ceil(allSlices.length / CHARTED_CATEGORY_COUNT) - 1);
  const safeDepth = Math.min(depth, maxDepth);

  const pageSlices = allSlices.slice(safeDepth * CHARTED_CATEGORY_COUNT);
  const items = foldToOther(
    pageSlices,
    CHARTED_CATEGORY_COUNT,
    (count) => `${count} other categories`,
  );

  const pageTotalCents = Math.round(pageSlices.reduce((sum, slice) => sum + slice.value, 0) * 100);
  const isDrilled = safeDepth > 0;
  const canDrill = pageSlices.length > CHARTED_CATEGORY_COUNT;

  return (
    <section>
      {/* The month bar. Wraps rather than scrolls: at 390px the picker drops to
          its own line instead of pushing the steppers off the edge. */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => goToMonth(previousMonthOf(month))}
          aria-label="Previous month"
          className="rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink transition-colors hover:bg-brass-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass motion-reduce:transition-none"
        >
          &lsaquo;
        </button>

        {/*
          The month title is itself the picker. A native <select> rather than a
          custom menu: it is one short list, and the platform's own control is
          the one that already works with a phone's wheel and a keyboard.

          `months` holds only months that have rows, but the steppers walk the
          calendar freely — so the current month is added when it isn't in that
          list, or the <select> would show a value matching no <option> and
          silently render the first one instead.
        */}
        <label className="relative">
          <span className="sr-only">Month</span>
          <select
            value={month}
            onChange={(event) => goToMonth(event.target.value)}
            className="cursor-pointer rounded-md border border-line bg-paper px-3 py-1.5 font-display text-lg text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
          >
            {(months.includes(month) ? months : [...months, month].sort())
              .slice()
              .reverse()
              .map((option) => (
                <option key={option} value={option}>
                  {monthLabel(option)}
                </option>
              ))}
          </select>
        </label>

        <button
          type="button"
          onClick={() => goToMonth(nextMonthOf(month))}
          aria-label="Next month"
          className="rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink transition-colors hover:bg-brass-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass motion-reduce:transition-none"
        >
          &rsaquo;
        </button>

        {isDrilled && (
          <button
            type="button"
            onClick={() => setDepth(safeDepth - 1)}
            className="rounded-md text-sm font-medium text-brass-dark hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
          >
            &larr; Back
          </button>
        )}
      </div>

      {/* The biggest category, called out rather than exploded out of the ring:
          ChartPie draws one fixed donut shape by design, so the emphasis lives
          here and on the table row instead of in the wedge geometry. */}
      {breakdown.biggest !== undefined && !isDrilled && (
        <p className="mt-3 text-sm text-muted">
          Biggest:{" "}
          <span className="font-medium text-ink">
            {breakdown.biggest.categoryName || UNCATEGORISED_LABEL}
          </span>{" "}
          <span className="font-mono text-ink">{formatCents(breakdown.biggest.totalCents)}</span> —{" "}
          {Math.round(breakdown.biggest.share * 100)}% of {formatCents(breakdown.spendCents)} spent
          across {breakdown.slices.filter((slice) => slice.isSpend).length} categor
          {breakdown.slices.filter((slice) => slice.isSpend).length === 1 ? "y" : "ies"}.
        </p>
      )}

      <p className="mt-1 text-sm text-muted">
        {isDrilled ? (
          <>
            The categories pooled one level up, as a share of their own{" "}
            {formatCents(pageTotalCents)}.
          </>
        ) : (
          <>
            {breakdown.transactionCount} transaction(s), {formatCents(breakdown.netCents)} net.
            {breakdown.netCents !== breakdown.spendCents &&
              " Categories in credit are listed below but not charted."}
          </>
        )}
        {canDrill && " Click the pooled slice to break it down further."}
      </p>

      {items.length > 0 ? (
        <div className="mt-3">
          <ChartPie
            items={items}
            formatValue={(value) => `$${value.toFixed(2)}`}
            // Only the pooled slice drills — a single category has nothing inside it.
            isSliceEnabled={(slice) => slice.key === OTHER_SLICE_KEY}
            onSliceClick={() => setDepth(safeDepth + 1)}
          />
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted">
          {breakdown.transactionCount === 0
            ? `Nothing recorded in ${breakdown.label}.`
            : `No positive spend to chart in ${breakdown.label}.`}
        </p>
      )}

      {/*
        The companion table, and it is required rather than decorative: ChartPie
        prints only a percentage inside each wedge, so this is where a slice's
        identity and its exact amount live, and it is the only way a keyboard
        reaches the drill-down. It lists *every* category for the month —
        including the ones folded into the pooled slice and the ones in credit —
        so the rows reconcile with the month's own total even though the chart
        shows a subset. The swatch index tracks the chart's, which is why both
        read CHART_CATEGORICAL_COLORS in the same order.
      */}
      {breakdown.slices.length > 0 && (
        <ul className="mt-4 flex flex-col gap-1">
          {breakdown.slices.map((slice) => {
            const label = slice.categoryName || UNCATEGORISED_LABEL;
            // Only the charted page carries a swatch: a row folded into "others"
            // or sitting in credit has no colour in the ring to match.
            const chartedIndex = isDrilled
              ? -1
              : items.findIndex((item) => item.key === label && item.key !== OTHER_SLICE_KEY);
            const isBiggest = breakdown.biggest?.categoryName === slice.categoryName;

            return (
              <li
                key={label}
                className={`flex items-center justify-between gap-3 rounded-md border px-3 py-1.5 text-sm max-lg:flex-col max-lg:items-start max-lg:gap-1 ${
                  isBiggest ? "border-brass bg-brass-soft" : "border-line bg-paper"
                }`}
              >
                <span className="flex min-w-0 items-center gap-2 text-ink">
                  <span
                    aria-hidden
                    className="h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{
                      backgroundColor:
                        chartedIndex >= 0
                          ? CHART_CATEGORICAL_COLORS[
                              chartedIndex % CHART_CATEGORICAL_COLORS.length
                            ]
                          : "transparent",
                    }}
                  />
                  {slice.categoryName === "" ? (
                    <span className="text-muted">{UNCATEGORISED_LABEL}</span>
                  ) : (
                    <>
                      <CategoryIconThumbnail
                        iconUrl={categoryIconUrls.get(slice.categoryName)}
                        name={slice.categoryName}
                      />
                      <span className={`truncate ${isBiggest ? "font-medium" : ""}`}>
                        {slice.categoryName}
                      </span>
                    </>
                  )}
                  <span className="shrink-0 text-xs text-muted">
                    {slice.transactionCount} transaction(s)
                  </span>
                </span>

                <span className="flex shrink-0 items-center gap-3 font-mono text-xs max-lg:w-full max-lg:justify-between">
                  <span className={slice.isSpend ? "text-ink" : "text-emerald-400"}>
                    {formatCents(slice.totalCents)}
                  </span>
                  {/* A credit has no share of the spend, so it prints a dash
                      rather than a 0% that would read as "nothing spent here". */}
                  <span className="w-12 text-right text-muted">
                    {slice.isSpend ? `${Math.round(slice.share * 100)}%` : "—"}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function ExpenseChartsView({
  totals,
  vendorTotals,
  transactions,
  categories,
  vendors,
}: {
  totals: CategoryTotal[];
  vendorTotals: VendorTotal[];
  /** The rows themselves — the monthly rollups are computed from them client-side. */
  transactions: ExpenseTransaction[];
  /** Only for their icons — a rollup carries a category name, not its icon. */
  categories: ExpenseCategory[];
  /** Likewise: a vendor rollup carries only the name. */
  vendors: ExpenseVendor[];
}) {
  const categoryIconUrls = categoryIconUrlsByName(categories);

  if (totals.length === 0) {
    return (
      <p className="text-sm text-muted">
        Nothing to chart yet — add or import some transactions, then categorise them.
      </p>
    );
  }

  // Refunds make a category's total negative, which a bar chart can't express
  // meaningfully alongside spend, so only positive totals are charted. The table
  // below still shows everything.
  const spendItems = totals
    .filter((total) => total.totalCents > 0)
    .map((total) => ({
      key: total.categoryName || UNCATEGORISED_LABEL,
      label: total.categoryName || UNCATEGORISED_LABEL,
      value: total.totalCents / 100,
    }));

  const netCents = totals.reduce((sum, total) => sum + total.totalCents, 0);
  const transactionCount = totals.reduce((sum, total) => sum + total.transactionCount, 0);

  // Two tabs rather than one long scroll: the all-time breakdown and the
  // month-on-month view answer different questions, and Tabs is for unrelated
  // panels sharing a space (ViewModeSwitch would claim they were one dataset
  // re-cut, which they are not).
  const mainTab = (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="font-display text-xl text-ink">Spend by category</h2>
        <p className="mt-1 text-sm text-muted">
          {transactionCount} transaction(s), {formatCents(netCents)} net.
          {spendItems.length < totals.length && " Categories in credit are listed below but not charted."}
        </p>
        {spendItems.length > 0 ? (
          <div className="mt-3">
            <ChartBar
              items={spendItems}
              formatValue={(value) => `$${value.toFixed(2)}`}
              displayStorageKey="myhomebase:chart:expense-spend-by-category"
            />
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted">No positive spend to chart.</p>
        )}
      </section>

      <VendorSpendCard vendorTotals={vendorTotals} vendors={vendors} />

      <section>
        <h2 className="font-display text-xl text-ink">Totals</h2>
        <ul className="mt-3 flex flex-col gap-1">
          {totals.map((total) => (
            <li
              key={total.categoryName || UNCATEGORISED_LABEL}
              className="flex items-center justify-between rounded-md border border-line bg-paper px-3 py-1.5 text-sm"
            >
              <span className="flex items-center gap-2 text-ink">
                {total.categoryName === "" ? (
                  <span className="text-muted">{UNCATEGORISED_LABEL}</span>
                ) : (
                  <>
                    <CategoryIconThumbnail iconUrl={categoryIconUrls.get(total.categoryName)} />
                    {total.categoryName}
                  </>
                )}
                <span className="text-xs text-muted">
                  {total.transactionCount} transaction(s)
                </span>
              </span>
              <span
                className={`font-mono ${total.totalCents < 0 ? "text-emerald-400" : "text-ink"}`}
              >
                {formatCents(total.totalCents)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );

  const monthlyTab = (
    <div className="flex flex-col gap-8">
      <SpendOverTimeCard transactions={transactions} />
      <MonthComparisonCard transactions={transactions} categoryIconUrls={categoryIconUrls} />
    </div>
  );

  const byMonthTab = (
    <MonthCategoryPieCard transactions={transactions} categoryIconUrls={categoryIconUrls} />
  );

  const tabs: TabItem[] = [
    { key: "main", label: "Main", content: mainTab },
    { key: "monthly", label: "Monthly comparison", content: monthlyTab },
    { key: "by-month", label: "Expense type By Month", content: byMonthTab },
  ];

  return <Tabs items={tabs} defaultActiveKey="main" />;
}
