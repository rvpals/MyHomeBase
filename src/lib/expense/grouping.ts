// Rolling the transaction list up into groups, for the Transactions screen's
// "view by …" switcher.
//
// One function does all four groupings because they differ only in the key a row
// yields: the shape of the answer — a labelled group with a net total, a count
// and its own rows — is the same whether you asked by account or by vendor. The
// rows travel with the group so the view can hand them straight to the grid
// without re-filtering the list per group.
//
// Amounts are summed as-is, so a group's total is a *net*: a refund reduces it.
// That matches the flat grid's footer, which is the number this replaces.

import { cycleForDate, normalizeCloseDay } from "./billing-cycle";
import { vendorGroupKey } from "./vendors";
import type { CreditCardAccount, ExpenseTransaction } from "./types";

/** The groupings the Transactions screen offers. `all` is the ungrouped list. */
export const TRANSACTION_GROUP_BYS = ["all", "account", "cycle", "vendor", "category"] as const;

export type TransactionGroupBy = (typeof TRANSACTION_GROUP_BYS)[number];

/**
 * Whether a raw string names a grouping. Used on values arriving from the URL,
 * so a stale or hand-edited `?groupBy=` narrows to the union rather than being
 * cast into it.
 */
export function isTransactionGroupBy(value: string | undefined): value is TransactionGroupBy {
  return value !== undefined && (TRANSACTION_GROUP_BYS as readonly string[]).includes(value);
}

/** Human labels for the view switcher. */
export const TRANSACTION_GROUP_BY_LABELS: Record<TransactionGroupBy, string> = {
  all: "All",
  account: "Account",
  cycle: "Billing cycle",
  vendor: "Vendor",
  category: "Category",
};

/** What an empty category groups under. Matches the flat grid's wording. */
export const UNCATEGORISED_GROUP_LABEL = "uncategorised";

/** What a row with no usable vendor name groups under. */
export const UNKNOWN_VENDOR_GROUP_LABEL = "unknown";

/** What a row whose date cannot be read groups under, in the cycle view. */
export const UNDATED_GROUP_LABEL = "no usable date";

export interface TransactionGroup {
  /** Stable identity, unique within one grouping. Also the React key. */
  key: string;
  /** What the group row shows. */
  label: string;
  /**
   * Secondary text for the group row — the card's name in the cycle view, a
   * card's description elsewhere. Empty when there's nothing to add.
   */
  sublabel: string;
  /** Net of `amountCents` over `rows`; negative when refunds outweigh charges. */
  totalCents: number;
  transactionCount: number;
  rows: ExpenseTransaction[];
  /**
   * The account this group belongs to, when the grouping implies exactly one —
   * `account` and `cycle`. Lets the view show the card art without a lookup.
   */
  accountId?: number;
}

/**
 * Which date a transaction is measured by, for cycle purposes. A statement is
 * assembled from posting dates, but plenty of card exports omit `postingDate`
 * entirely, so the purchase date stands in when it is blank rather than the row
 * dropping out of the view.
 */
export function cycleDateFor(transaction: ExpenseTransaction): string {
  const posting = transaction.postingDate.trim();
  return posting === "" ? transaction.transactionDate : posting;
}

/**
 * Groups transactions for one view mode.
 *
 * `by: "all"` returns a single group holding everything, so the caller has one
 * shape to render rather than a branch. Groups come back in the order the view
 * wants to show them: newest cycle first, biggest spender first, and accounts in
 * the order they were listed.
 */
export function groupTransactions(
  transactions: ExpenseTransaction[],
  by: TransactionGroupBy,
  accounts: CreditCardAccount[],
): TransactionGroup[] {
  switch (by) {
    case "all":
      return [buildGroup("all", "All transactions", "", transactions)];
    case "account":
      return groupByAccount(transactions, accounts);
    case "cycle":
      return groupByCycle(transactions, accounts);
    case "vendor":
      return groupByVendor(transactions);
    case "category":
      return groupByCategory(transactions);
  }
}

function buildGroup(
  key: string,
  label: string,
  sublabel: string,
  rows: ExpenseTransaction[],
  accountId?: number,
): TransactionGroup {
  return {
    key,
    label,
    sublabel,
    totalCents: rows.reduce((sum, row) => sum + row.amountCents, 0),
    transactionCount: rows.length,
    rows,
    accountId,
  };
}

/**
 * Collects rows by a key each yields, preserving first-seen order. A Map rather
 * than repeated filtering: the grouped view runs over the whole table, so this
 * stays one pass.
 */
function collect(
  transactions: ExpenseTransaction[],
  keyOf: (transaction: ExpenseTransaction) => string,
): Map<string, ExpenseTransaction[]> {
  const groups = new Map<string, ExpenseTransaction[]>();
  for (const transaction of transactions) {
    const key = keyOf(transaction);
    const existing = groups.get(key);
    if (existing) existing.push(transaction);
    else groups.set(key, [transaction]);
  }
  return groups;
}

/**
 * One group per card, in the account list's own order — which is the order the
 * card picker and Meta Data show, so the two screens agree.
 *
 * A card with no transactions still gets a group. An empty card is a fact worth
 * seeing on a screen that lists your cards, and it is also the state right after
 * you add one.
 */
function groupByAccount(
  transactions: ExpenseTransaction[],
  accounts: CreditCardAccount[],
): TransactionGroup[] {
  const byAccount = collect(transactions, (transaction) =>
    String(transaction.transactionAccountId),
  );

  const groups = accounts.map((account) =>
    buildGroup(
      `account-${account.id}`,
      account.name,
      account.description,
      byAccount.get(String(account.id)) ?? [],
      account.id,
    ),
  );

  // Rows pointing at a card that no longer exists should not vanish from the
  // screen — deleting a card in use is refused, but an older database may still
  // hold orphans, and silently hiding spend is the worse failure.
  const known = new Set(accounts.map((account) => String(account.id)));
  for (const [key, rows] of byAccount) {
    if (known.has(key)) continue;
    groups.push(buildGroup(`account-${key}`, `Unknown card #${key}`, "", rows, Number(key)));
  }

  return groups;
}

/**
 * One group per (card, cycle), newest cycle first, cards in list order.
 *
 * Nested this way because a cycle *is* a property of a card: two cards closing on
 * different days have different August periods, so pooling "August" across cards
 * would put one label on several date ranges.
 */
function groupByCycle(
  transactions: ExpenseTransaction[],
  accounts: CreditCardAccount[],
): TransactionGroup[] {
  const groups: TransactionGroup[] = [];

  for (const accountGroup of groupByAccount(transactions, accounts)) {
    const account = accounts.find((candidate) => candidate.id === accountGroup.accountId);
    const closeDay = normalizeCloseDay(account?.statementCloseDay ?? 0);

    // Keyed by close date, so sorting the keys descending as strings puts the
    // most recent statement at the top — which is the one you are reconciling.
    const byCycle = collect(accountGroup.rows, (transaction) => {
      const cycle = cycleForDate(cycleDateFor(transaction), closeDay);
      return cycle?.key ?? "";
    });

    const cycleKeys = [...byCycle.keys()].filter((key) => key !== "").sort().reverse();

    for (const cycleKey of cycleKeys) {
      const rows = byCycle.get(cycleKey)!;
      const cycle = cycleForDate(cycleDateFor(rows[0]), closeDay)!;
      groups.push(
        buildGroup(
          `cycle-${accountGroup.accountId}-${cycleKey}`,
          cycle.label,
          accountGroup.label,
          rows,
          accountGroup.accountId,
        ),
      );
    }

    // Undated rows go last, under their card, rather than being dropped.
    const undated = byCycle.get("");
    if (undated) {
      groups.push(
        buildGroup(
          `cycle-${accountGroup.accountId}-undated`,
          UNDATED_GROUP_LABEL,
          accountGroup.label,
          undated,
          accountGroup.accountId,
        ),
      );
    }
  }

  return groups;
}

/**
 * One group per vendor, biggest net spend first.
 *
 * Grouped on `vendorGroupKey`, the same key the vendor rollups and the charts
 * use, so "COSTCO WHSE #1017" and "COSTCO GAS" land together here exactly as
 * they do there. The label prefers a tidied `vendor` from any row in the group
 * over the derived key, since the derived one reads rough.
 */
function groupByVendor(transactions: ExpenseTransaction[]): TransactionGroup[] {
  const byVendor = collect(transactions, vendorGroupKey);

  const groups = [...byVendor].map(([key, rows]) => {
    const tidied = rows.find((row) => row.vendor.trim() !== "")?.vendor.trim();
    const label = tidied ?? (key === "" ? UNKNOWN_VENDOR_GROUP_LABEL : key);
    return buildGroup(`vendor-${key}`, label, "", rows);
  });

  return groups.sort((left, right) => right.totalCents - left.totalCents);
}

/** One group per category, biggest net spend first, uncategorised included. */
function groupByCategory(transactions: ExpenseTransaction[]): TransactionGroup[] {
  const byCategory = collect(transactions, (transaction) => transaction.categoryName);

  const groups = [...byCategory].map(([key, rows]) =>
    buildGroup(`category-${key}`, key === "" ? UNCATEGORISED_GROUP_LABEL : key, "", rows),
  );

  return groups.sort((left, right) => right.totalCents - left.totalCents);
}

/**
 * The group key for one account, vendor or category, so a link can name a group
 * the way `groupTransactions` will build it.
 *
 * These mirror the key strings the private group builders above produce. They
 * live here, beside those builders, because the two must agree exactly: the
 * Meta Data cards link to `?group=<key>` and the Transactions screen opens the
 * group whose key matches. A key format changed in one place and not the other
 * would leave every one of those links silently opening nothing.
 */
export function accountGroupKey(accountId: number): string {
  return `account-${accountId}`;
}

/**
 * Upper-cased to match `vendorGroupKey`, which upper-cases a tidied vendor so
 * "Costco" and "COSTCO" are one group. A Meta Data row stores whatever spelling
 * was saved, so without this a vendor saved in mixed case would link to a group
 * key that never occurs.
 */
export function vendorGroupKeyForName(vendorName: string): string {
  return `vendor-${vendorName.trim().toUpperCase()}`;
}

/**
 * Not upper-cased, unlike the vendor key: categories group on the stored name
 * verbatim, so "Gas" and "gas" are genuinely different groups here.
 */
export function categoryGroupKey(categoryName: string): string {
  return `category-${categoryName}`;
}
