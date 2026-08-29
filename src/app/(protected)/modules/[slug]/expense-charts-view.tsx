"use client";

import { useState } from "react";
import { ChartBar } from "@/components/chart-bar";
import { CHART_CATEGORICAL_COLORS } from "@/components/chart-colors";
import { ChartPie } from "@/components/chart-pie";
import { CollapsibleCard } from "@/components/collapsible-card";
import type {
  CategoryTotal,
  ExpenseCategory,
  ExpenseVendor,
  VendorTotal,
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

export function ExpenseChartsView({
  totals,
  vendorTotals,
  categories,
  vendors,
}: {
  totals: CategoryTotal[];
  vendorTotals: VendorTotal[];
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

  return (
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
}
