# Migration 0034: add an icon image to expense categories

**Date:** 2026-08-03
**Type:** additive columns
**Table(s) affected:** `exp_categories`

## What this does

Adds a small uploaded image to each expense category, so categories can be told
apart at a glance in the category picker, the transactions grid, the category list
under Meta Data and the spend rollups.

| Column | Type | Notes |
|---|---|---|
| `icon_image` | `BLOB` (nullable) | the icon bytes; NULL when no icon is set |
| `icon_image_mime_type` | `TEXT` (nullable) | e.g. `image/png`; NULL alongside a NULL image |

Both are nullable rather than defaulted: "no icon" is a real state, and an empty
blob would be a lie.

## Why a BLOB and not a base64 data URL

This mirrors `exp_creditcard_accounts.card_image` (migration 0031), which in turn
mirrors `sys_users.avatar` (migration 0011) — the app's established answer for a
per-row image:

- The bytes are served by a dedicated route
  (`/api/expense/categories/[name]/icon`), so they never ride along in a page's
  JSON payload — a base64 data URL would inflate every category list by ~33% of
  the image size and defeat browser caching.
- Reads of the category list therefore **select columns explicitly** instead of
  `SELECT *`. `listCategories` / `getCategoryByName` in
  `src/lib/expense/repository.ts` were changed from `SELECT *` to a named column
  list in the same change, so the blob stays out of every normal query. Only the
  icon-serving path touches these two columns.

Plain `ALTER TABLE ADD COLUMN` is used because these are simple additive nullable
columns — no rebuild needed, and existing rows are valid as they stand. No new
index: the table is keyed by `name` and is small.

## Constraints enforced in code, not the database

The use-case rejects anything that isn't `image/png`, `image/jpeg`, `image/webp`
or `image/gif`, and caps the size at 128 KB (a quarter of the card-image cap —
these are icons, not card art). SVG is deliberately excluded: it can carry script,
and it would be served from the app's own origin.

## Data handling

Existing categories get NULL for both columns, i.e. no icon, and render exactly as
they did before. Nothing is backfilled.

## Rollback

```sql
ALTER TABLE exp_categories DROP COLUMN icon_image_mime_type;
ALTER TABLE exp_categories DROP COLUMN icon_image;
```
