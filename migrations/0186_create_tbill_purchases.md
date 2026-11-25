# 0186 — T-Bill purchases

One table, `inv_tbill_purchases`, behind the Investments module's new **T-Bill**
section. No new prefix, no new module row, no change to `DEFAULT_MODULES`: a T-Bill
is an investment, so it lives under `inv_` with everything else the module owns.

## Why its own table, and not `inv_tax_lots` or `inv_stock_positions`

A Treasury Bill is a different shape of thing from both.

- **Not a position.** A position is marked to market: it has a current price that is
  refreshed, an unrealised gain that moves daily, and a quantity you might add to.
  A bill has none of that. It is bought once at a discount and redeemed at par on a
  date fixed at purchase; quoting a "current price" for it would invite a refresh
  that means nothing.
- **Not a tax lot.** `inv_tax_lots` exists to apply the split table and sort lots
  across the one-year long-term line. A bill never splits, and a 4- or 26-week bill
  is never long-term. Both of that table's reasons to exist are absent.

Folding it into either would have meant columns that are always NULL on one side and
meaningless on the other — and, worse, a split normalisation silently running over
instruments that cannot split.

## Everything is known on the day you buy

This is the fact the schema is built on, and it is why `date_payout` and
`payout_amount_cents` are `NOT NULL` rather than filled in at maturity. A bill's
redemption date and face value are both printed on the confirmation. There is no
"pending" state to model, so every row can compute its gain and its yield from the
moment it is entered, and the stats card never has to explain a partial total.

Confirmed with the requester before building, precisely because the other reading —
record the purchase now, fill in the payout later — would have made both columns
nullable and put a "—" in four derived figures.

## Four figures that are NOT columns

Gain Amount, Gain %, # Days to Maturity and Yield are **computed on read** in
`src/lib/treasury-bills`, never stored:

```
gainAmountCents  = payoutAmountCents - amountSpentCents
gainPct          = gainAmountCents / amountSpentCents * 100
daysToMaturity   = datePayout - datePurchased
yieldPct         = (100 - purchasePrice) / purchasePrice * 100 * 365 / daysToMaturity
```

A stored copy disagrees with its inputs the moment a row is edited, and nothing
queries or sorts on them in the database. The same call `inv_stock_positions` did
*not* make for `unrealized_gain_loss_pct` — that one is stored because it arrives
from the broker as a given; these four are arithmetic over columns in the same row.

**`gainPct` and `yieldPct` read "—", never 0%**, when there is nothing to divide by
(a zero amount spent, a zero price, a same-day maturity). A zero there would be
indistinguishable from a real zero return. Same rule the Tax Lots XIRR follows.

## `purchase_price` is REAL, and that is deliberate

Money in this schema is integer cents. This column is not money — it is the price
per **$100 of face value** that the confirmation quotes, and Treasury prices carry
six decimals (`98.637500`). Rounded to cents, a 4-week bill's computed yield moves
in the fourth significant figure.

So: `REAL` for the quoted rate, `INTEGER` cents for `amount_spent_cents` and
`payout_amount_cents`, which *are* money. Migration 0111 made the same split for
watch conditions and states the rule; `inv_tax_lots.shares` is REAL for the
neighbouring reason.

The yield formula only holds if the price is quoted per $100 face — so the field is
labelled that way on the form and validated to `0 < price <= 100`, rather than
accepting any number and computing nonsense from it.

## `amount_spent_cents` is stored, not computed

It could be `shares_purchased * purchase_price`. It is stored anyway, because the
broker's **settled** amount includes rounding that formula does not reproduce, and
Gain Amount is defined against what actually left the account. The form auto-fills it
from shares × price as you type and lets you overwrite it, so the common case costs
no typing and the statement can still be recorded faithfully.

## No unique index — and the importer does the work instead

`(symbol, date_purchased)` is **not** unique. Per `coding-guide.md`, a DATE column
may never sit in a unique index: buying two bills of the same symbol on one day is
ordinary, and at date granularity the rows genuinely are identical, so the constraint
would silently drop the second — exactly the bug migration 0038 documents for
`inv_stock_transactions`.

Duplicate detection belongs in the CSV importer, which can see the whole file at
once: it reads the stored `(symbol, date_purchased)` keys **once before the run**,
counts how many matching rows the file holds against how many are already stored, and
inserts the shortfall. The database cannot tell a real second purchase from an
accidental re-import; the importer can.

Two indexes, both plain: `(date_purchased DESC, id DESC)` for the section's only
query shape, and `(symbol, date_purchased)` for that match-key lookup.

## Where it is edited

Investments → T-Bill, which carries the T-Bill Stats card above the purchases grid
and the Add / Edit / Delete controls. CSV files load through Investments → CSV
Import, as a fourth import type beside Positions, Transactions and Account
Performance — saved mappings go in the shared `csv_named_mappings` table under
`import_type = 'TBill'`, so this migration adds no mapping table of its own.
