# Migration 0068: create exp_vendors

**Date:** 2026-08-29
**Type:** schema (one new table, one index, one trigger — no data written)

## What this does

Adds `exp_vendors`, giving a vendor the same editable identity a category has: a
description, an uploadable icon, and the ability to be renamed away or deleted.

```sql
CREATE TABLE exp_vendors (
  name        TEXT PRIMARY KEY,
  description TEXT NOT NULL DEFAULT '',
  icon_image  BLOB,
  icon_image_mime_type TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

## Why a table at all

Before this, a vendor was **derived at read time and nowhere else**. `vendorTotals`
in `src/lib/expense/vendors.ts` groups transactions on `exp_transactions.vendor`
(added by 0032), falling back to a brand key stripped out of the raw
`transaction_description` when that column is blank — which it is on most rows.
That is a rollup, not an entity: there was no row to hang a description or an icon
off, and nothing to edit.

**The rollup is unchanged by this migration.** `vendorTotals`, `vendorGroupKey` and
`vendorKeyFromDescription` still work exactly as before, still drive the charts and
the dashboard, and still need no vendor row to exist. `exp_vendors` is a side table
that *decorates* those groups. A vendor with no row renders with no icon; that is
the normal state, not a defect.

Consequence worth stating: the Meta Data screen shows a **merge** of the two — every
vendor found in the transactions, plus every saved row. A derived-only vendor is
displayed but not yet stored, and gets written on first edit or first icon upload.
The merge lives in `mergeVendorsWithTotals` (`src/lib/expense/vendors.ts`), so the
reader and the writer can't drift.

## Why the NOCASE index

`vendorGroupKey` already upper-cases before grouping, so "Costco" and "COSTCO" are
one group in every rollup. If the table let both exist as separate rows, one group
could match two icons and the screen would have to pick arbitrarily.

SQLite's `TEXT PRIMARY KEY` is case-*sensitive*, so the PK alone does not prevent
that. `exp_vendors_name_nocase` does, and it is also the index the repository's
`WHERE name = ? COLLATE NOCASE` lookups use. Keeping the PK as-is preserves the
stored spelling — you see the vendor cased the way you typed it, while matching
ignores case.

This is the one deliberate difference from `exp_categories`, where category names
*are* case-sensitive and "Groceries" / "groceries" can both exist.

## Notes

- Icon bytes: mime allowlist and the 128 KB cap are enforced in code
  (`MAX_VENDOR_ICON_BYTES`, `decodeImageUpload` in `src/lib/shared/image-upload.ts`),
  not by the DB — same as every other image in this app. SVG is excluded on purpose
  as a stored-XSS vector.
- No foreign key to `exp_transactions.vendor`. The relationship is by name and is
  deliberately loose: transactions must keep their vendor text whether or not a
  vendor row exists, and imports must never fail for want of one.
- `deleteVendor` clears nothing on the transactions. It drops the row and its icon
  only, so the vendor immediately reappears in the list as derived-only. This
  differs from `deleteCategory`, which blanks `exp_transactions.category_name` —
  because a blank category is a meaningful state ("uncategorised") whereas blanking
  `vendor` would destroy the tidied name that post-import rules worked out.
- No `DEFAULT_MODULES` change: this is a new card inside an existing section of the
  existing Expense module.
- No icon-slot registry entry: vendor icons are user-uploaded blobs served from the
  DB, like category icons, not `SlotIcon` slots.

## Rollback

```sql
DROP TRIGGER IF EXISTS exp_vendors_set_updated_at;
DROP INDEX IF EXISTS exp_vendors_name_nocase;
DROP TABLE IF EXISTS exp_vendors;
```

Safe: no other table references `exp_vendors`, and dropping it only removes the
descriptions and icons. Every vendor still appears everywhere it did before, from
the derived rollups, exactly as it did pre-migration.
