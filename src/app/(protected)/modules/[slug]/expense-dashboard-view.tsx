import Link from "next/link";
import type { ReactNode } from "react";
import { CollapsibleCard } from "@/components/collapsible-card";
import {
  categoryGroupKey,
  vendorGroupKeyForName,
  type CategoryTotal,
  type ExpenseCategory,
  type ExpenseVendor,
  type VendorTotal,
} from "@/lib/expense";
import { expenseGroupHref, expenseSectionHref } from "./expense-sections";
import {
  CategoryIconThumbnail,
  categoryIconUrlsByName,
  formatCents,
  vendorIconFor,
  vendorIconUrlsByName,
} from "./expense-shared";

/** One headline number. Highlighted when it represents outstanding work. */
function Tile({
  label,
  value,
  needsAttention = false,
  href,
}: {
  label: string;
  value: string;
  needsAttention?: boolean;
  href?: string;
}) {
  const body = (
    <>
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={`font-display text-xl ${needsAttention ? "text-brass" : "text-ink"}`}>{value}</p>
    </>
  );

  // Counters that represent work link to the screen where you'd deal with it.
  return href ? (
    <Link
      href={href}
      className="rounded-xl border border-line p-4 transition-colors hover:border-brass/50"
    >
      {body}
    </Link>
  ) : (
    <div className="rounded-xl border border-line p-4">{body}</div>
  );
}

/**
 * One "name — n transaction(s) — $total" row. Shared by both rollup lists.
 *
 * The whole row is the link, rather than just the name: every part of it —
 * icon, count, total — is describing the same group, so there's no sub-target
 * that would mean anything different.
 *
 * Deliberately not the `RowLink` from `expense-accounts-view.tsx`. That one is
 * `flex-1` because it sits beside per-row edit and delete controls; these rows
 * have no siblings to share width with, so reusing it would mean widening its
 * contract for two callers that want different layouts.
 */
function SpendRow({
  label,
  isPlaceholder = false,
  iconUrl,
  transactionCount,
  totalCents,
  href,
  title,
}: {
  label: string;
  /** Renders the name greyed out — it stands in for a missing value. */
  isPlaceholder?: boolean;
  iconUrl?: string;
  transactionCount: number;
  totalCents: number;
  /** Where the row's group lives on the Transactions screen. */
  href: string;
  title: string;
}) {
  return (
    <li>
      <Link
        href={href}
        title={title}
        // `py-2` rather than the old `py-1.5`: this is a touch target now, and
        // the extra few pixels are what make it comfortable on a phone. The
        // focus ring matches the Meta Data rows, so keyboard users get the same
        // affordance on both screens.
        className="flex items-center justify-between gap-3 rounded-md border border-line bg-paper px-3 py-2 text-sm transition-colors hover:border-brass/50 hover:bg-brass-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
      >
        <span className="flex min-w-0 items-center gap-2 text-ink">
          <CategoryIconThumbnail iconUrl={iconUrl} />
          <span className={`truncate ${isPlaceholder ? "text-muted" : ""}`}>{label}</span>
          <span className="shrink-0 text-xs text-muted">{transactionCount} transaction(s)</span>
        </span>
        <span className="shrink-0 font-mono text-ink">{formatCents(totalCents)}</span>
      </Link>
    </li>
  );
}

/** A titled rollup list, or the reason there's nothing in it yet. */
function SpendList({
  title,
  hint,
  isEmpty,
  emptyMessage,
  children,
}: {
  title: string;
  hint: ReactNode;
  isEmpty: boolean;
  emptyMessage: string;
  children: ReactNode;
}) {
  return (
    <div>
      <h3 className="font-display text-base text-ink">{title}</h3>
      <p className="mt-1 text-xs text-muted">{hint}</p>
      {isEmpty ? (
        <p className="mt-3 text-sm text-muted">{emptyMessage}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-1">{children}</ul>
      )}
    </div>
  );
}

export function ExpenseDashboardView({
  totalCents,
  transactionCount,
  unprocessedCount,
  uncategorisedCount,
  toReconcileCount,
  topVendors,
  topCategories,
  categories,
  vendors,
}: {
  totalCents: number;
  transactionCount: number;
  unprocessedCount: number;
  uncategorisedCount: number;
  toReconcileCount: number;
  topVendors: VendorTotal[];
  topCategories: CategoryTotal[];
  /** Only for their icons — a rollup carries a category name, not its icon. */
  categories: ExpenseCategory[];
  /** Likewise: a vendor rollup carries only the name. */
  vendors: ExpenseVendor[];
}) {
  const categoryIconUrls = categoryIconUrlsByName(categories);
  const vendorIconUrls = vendorIconUrlsByName(vendors);
  const noTransactions = transactionCount === 0;

  return (
    <div className="flex flex-col gap-8">
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Total" value={formatCents(totalCents)} />
        <Tile
          label="To processed"
          value={String(unprocessedCount)}
          needsAttention={unprocessedCount > 0}
          // The clean-up runner this count belongs to moved out of Import with the
          // rest of the rules UI.
          href={expenseSectionHref("transaction-rules")}
        />
        <Tile
          label="Uncategorised"
          value={String(uncategorisedCount)}
          needsAttention={uncategorisedCount > 0}
          href={expenseSectionHref("transactions")}
        />
        <Tile label="To reconcile" value={String(toReconcileCount)} />
      </section>

      <CollapsibleCard title="Interesting stats" defaultOpen>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <SpendList
            title="Top 5 biggest spenders by vendor"
            hint={
              <>
                Grouped on the vendor that post-import processing set, falling back to the leading
                brand word of the statement description — so COSTCO* and AMAZON* lines roll up
                together.
              </>
            }
            isEmpty={topVendors.length === 0}
            emptyMessage="Nothing to show yet — add or import some transactions to see a breakdown."
          >
            {topVendors.map((total) => {
              const name = total.vendor === "" ? "unknown" : total.vendor;
              return (
                <SpendRow
                  key={total.vendor || "unknown"}
                  label={name}
                  isPlaceholder={total.vendor === ""}
                  iconUrl={vendorIconFor(vendorIconUrls, total.vendor)}
                  transactionCount={total.transactionCount}
                  totalCents={total.totalCents}
                  // Every row here is derived *from* transactions, so its group
                  // always exists — unlike the Meta Data vendor list, where a
                  // saved vendor with no rows renders unlinked.
                  //
                  // `total.vendor` is a display name, not a group key, so it goes
                  // through the helper: that upper-cases to match `vendorGroupKey`,
                  // which is what makes a vendor saved as "Costco" reach the group
                  // derived as "COSTCO". An empty name yields `vendor-`, exactly
                  // the key the unknown group is built with.
                  href={expenseGroupHref("vendor", vendorGroupKeyForName(total.vendor))}
                  title={`Show ${name} transactions`}
                />
              );
            })}
          </SpendList>

          <SpendList
            title="Top 5 biggest spenders by category"
            hint={
              <>
                Out of {transactionCount} transaction(s).{" "}
                <Link href={expenseSectionHref("charts")} className="text-brass-dark hover:underline">
                  See all
                </Link>
                .
              </>
            }
            isEmpty={topCategories.length === 0}
            emptyMessage={
              noTransactions
                ? "Nothing to show yet — add or import some transactions to see a breakdown."
                : "Nothing to show yet — categorise a few transactions to see a breakdown."
            }
          >
            {topCategories.map((total) => {
              const name = total.categoryName === "" ? "uncategorised" : total.categoryName;
              return (
                <SpendRow
                  key={total.categoryName || "uncategorised"}
                  label={name}
                  isPlaceholder={total.categoryName === ""}
                  iconUrl={categoryIconUrls.get(total.categoryName)}
                  transactionCount={total.transactionCount}
                  totalCents={total.totalCents}
                  // Not upper-cased, matching `groupByCategory`: categories group
                  // on the stored name verbatim, so "Gas" and "gas" are genuinely
                  // different groups. An empty name yields `category-`, which is
                  // the uncategorised group's own key.
                  href={expenseGroupHref("category", categoryGroupKey(total.categoryName))}
                  title={`Show ${name} transactions`}
                />
              );
            })}
          </SpendList>
        </div>
      </CollapsibleCard>
    </div>
  );
}
