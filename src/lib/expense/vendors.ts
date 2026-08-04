// Vendor spend rollups.
//
// A statement line carries two names for the same shop: the tidied `vendor` that
// post-import processing sets, and the raw `transaction_description` the card
// printed. Only some rows have the first, so grouping on `vendor` alone hides
// most of the spend. When it's empty we fall back to a *brand key* derived from
// the description — the leading word, once processor prefixes, order references
// and store numbers are stripped — so "COSTCO WHSE #1017 SEATTLE WA" and
// "COSTCO GAS #1017" land in one COSTCO group, matching the COSTCO* / AMAZON*
// shape you'd write by hand.

import type { ExpenseRepository, TransactionFilter } from "./ports";
import type { ExpenseTransaction, VendorTotal } from "./types";

/**
 * Payment aggregators that print their own name ahead of the merchant's, e.g.
 * "SQ *BLUE BOTTLE", "TST* THE DINER". Stripped so the brand rather than the
 * processor becomes the key. The trailing `*` is required, which is what keeps
 * this from eating a merchant whose name happens to start with these letters.
 */
const PROCESSOR_PREFIX = /^(SQ|TST|PP|PAYPAL|SP|EB|WPY|IC|POS|PY)\s*\*+\s*/;

/** Leading words with no brand identity of their own ("THE HOME DEPOT"). */
const LEADING_FILLER = new Set(["THE", "A"]);

/**
 * The brand key for one raw statement description — upper-case, no punctuation,
 * no store or reference numbers. Returns "" when there's nothing usable left.
 */
export function vendorKeyFromDescription(description: string): string {
  // Text after a "*" is a per-order reference ("AMAZON.COM*2A34B5C6"), so cut
  // it — but only once any processor prefix has gone, since that uses "*" too.
  const head = description.toUpperCase().replace(PROCESSOR_PREFIX, "").split("*")[0];

  // Punctuation is separator noise: "AMAZON.COM", "WHSE #1017", "TRADER JOE'S".
  const words = head.split(/[^A-Z0-9]+/).filter((word) => word !== "");

  const key: string[] = [];
  for (const word of words) {
    // Leading filler never starts a key, but is fine once we've taken a word.
    if (key.length === 0 && LEADING_FILLER.has(word)) continue;
    key.push(word);
    // Stop at the first word carrying a letter. A digits-only opener is kept and
    // joined to it, so "7 ELEVEN #221" reads "7 ELEVEN" rather than "ELEVEN".
    if (/[A-Z]/.test(word)) break;
  }

  // All digits and no letter anywhere means there was no brand to find.
  return key.some((word) => /[A-Z]/.test(word)) ? key.join(" ") : "";
}

/**
 * What a transaction groups under: the tidied vendor when it has one (upper-cased
 * so "Costco" and "COSTCO" are one group), else the description's brand key.
 */
export function vendorGroupKey(transaction: ExpenseTransaction): string {
  const vendor = transaction.vendor.trim();
  return vendor === "" ? vendorKeyFromDescription(transaction.transactionDescription) : vendor.toUpperCase();
}

/**
 * Spend per vendor over the rows given, biggest total first. Pure — the caller
 * supplies the transactions, so a screen that already holds them doesn't re-read
 * the table.
 */
export function vendorTotals(transactions: ExpenseTransaction[]): VendorTotal[] {
  const groups = new Map<string, VendorTotal>();

  for (const transaction of transactions) {
    const key = vendorGroupKey(transaction);
    const vendor = transaction.vendor.trim();
    const existing = groups.get(key);

    if (!existing) {
      groups.set(key, {
        vendor: vendor === "" ? key : vendor,
        totalCents: transaction.amountCents,
        transactionCount: 1,
        isDerived: vendor === "",
      });
      continue;
    }

    existing.totalCents += transaction.amountCents;
    existing.transactionCount += 1;
    // A tidied name beats a derived one as the group's label, whichever row
    // happened to come first.
    if (vendor !== "" && existing.isDerived) {
      existing.vendor = vendor;
      existing.isDerived = false;
    }
  }

  // Biggest spend first; the name breaks ties so the order is stable.
  return [...groups.values()].sort(
    (left, right) => right.totalCents - left.totalCents || left.vendor.localeCompare(right.vendor),
  );
}

/** Spend per vendor straight from the repository, biggest total first. */
export function totalsByVendor(repo: ExpenseRepository, filter?: TransactionFilter): VendorTotal[] {
  return vendorTotals(repo.listTransactions(filter));
}
