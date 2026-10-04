# Migration 0129: HSA receipts are stored as files on the NAS

**Date:** 2026-10-03
**Type:** column add + column drop on `hsh_hsa_expenses`

## What this does

| Object | Change |
|---|---|
| `hsh_hsa_expenses.receipt_path` | **added**, `TEXT`, NULL = no receipt |
| `hsh_hsa_expenses.receipt_file` | **dropped** (the BLOB from 0128) |

`receipt_mime_type` and `receipt_file_name` stay. The file name now records what the
upload was originally called; the stored name is the last segment of `receipt_path`.

## Where the files go

`<receipt folder>/<YYYY>/<YYYY-MM-DD>_<Payee>_<Amount>_<id>.<ext>`, for example
`2026/2026-10-03_CVS_$42.50_17.jpg`.

- **The receipt folder** is the Household module's `hsa_receipt_root` setting, a
  `sys_module_settings` row, so it needs no table. It's set on Household → Configuration,
  which only admins can change.
- **The year** comes from the expense's Date. The year folder is created on first use.
- **The column is relative to the folder**, so moving the archive means changing one
  setting instead of rewriting every row.
- **The name follows the record.** Editing the Date, Payee or Amount renames the file,
  and a new year moves it into that year's folder.
- **Deleting an expense or removing its receipt deletes the file**, after the screen has
  warned that it will.
- **With no folder set, attaching a receipt is refused.** There is no fallback to the
  database, so receipts live in exactly one place.

## Why the BLOB can be dropped

0128 only ever existed in the working tree. Min confirmed no receipt was attached under
it, so there is nothing to move out. `receipt_file` has no index, constraint or trigger
reference, which `DROP COLUMN` (SQLite 3.35+) requires.

## Rollback

```sql
ALTER TABLE hsh_hsa_expenses ADD COLUMN receipt_file BLOB;
ALTER TABLE hsh_hsa_expenses DROP COLUMN receipt_path;
```

The files on the NAS are untouched by a rollback. They just stop being linked.
