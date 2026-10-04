# Migration 0128: HSA Tracker tables

**Date:** 2026-10-03
**Type:** two new tables under an existing prefix

## What this does

Adds the storage behind the **HSA Tracker** half of the Household module, replacing its
placeholder screen. **No module row is registered** — Household exists (0119), so there is
no `seed_*_module` migration and no `DEFAULT_MODULES` change.

| Object | Shape | Notes |
|---|---|---|
| `hsh_hsa_expenses` | one row per receipt | date, time, amount, product, type, payee, service date, paid with, note, reimbursed, receipt file |
| `hsh_hsa_cards` | `id`, `name`, `is_active`, `created_at` | the "Paid with" pick list |
| `idx_hsh_hsa_expenses_entry` | index | `(entry_date, entry_time)` — the list's ordering |
| `idx_hsh_hsa_expenses_reimbursed` | index | "what is still to reimburse" |
| `idx_hsh_hsa_expenses_product` | index | `product_service COLLATE NOCASE` — the autocomplete's `SELECT DISTINCT` |
| `idx_hsh_hsa_cards_name` | unique index | `name COLLATE NOCASE` |

## Why `hsh_`

The prefix is the module's namespace, not an abbreviation of "recipe"; 0118 said the HSA
tables would join it without a rename.

## Decisions worth knowing

- **Amount is integer cents, and always positive.** A refund is a different fact and isn't
  modelled.
- **Date and time are two columns**, like `jrn_entries`, seeded from the browser clock and
  editable so a past receipt is entered under its real date.
- **`paid_with` is the card's name as text, not an id.** Renaming or deleting a card in
  Configuration never rewrites or orphans an old receipt. The cost: a rename doesn't flow
  back into history.
- **"Receipt attached?" is derived**, `receipt_file IS NOT NULL`, not a stored Y/N. A stored
  flag can disagree with the file it describes.
- **The receipt is a BLOB in the database for now**, as recipe pictures are. The NAS storage
  and naming scheme is meant to replace it; the three receipt columns live on the expense row
  so that's an additive migration.
- **`type` is validated in zod, not a `CHECK`**, so adding a type later needs no table
  rebuild. Same call as the recipe rating bound.
- **No `sort_order` on cards.** They list alphabetically; nothing asked for a custom order.

## Rollback

```sql
DROP TABLE hsh_hsa_expenses;
DROP TABLE hsh_hsa_cards;
```

Dropping `hsh_hsa_expenses` deletes every recorded expense and receipt. Its trigger and
indexes go with it.
