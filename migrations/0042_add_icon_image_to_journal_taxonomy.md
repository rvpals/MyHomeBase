# Migration 0042: add an icon image to journal categories and tags, drop jrn_icons

**Date:** 2026-08-14
**Type:** additive columns; one table dropped
**Table(s) affected:** `jrn_categories`, `jrn_tags` (columns added); `jrn_icons` (dropped)

## What this does

Gives each journal category and tag an uploadable icon, so they're recognisable at
a glance in the new Categories & Tags editor (My Journal → Configuration) and
anywhere else a category/tag is listed.

| Column | Table | Type | Notes |
|---|---|---|---|
| `icon_image` | `jrn_categories`, `jrn_tags` | `BLOB` (nullable) | the icon bytes; NULL when no icon is set |
| `icon_image_mime_type` | `jrn_categories`, `jrn_tags` | `TEXT` (nullable) | e.g. `image/png`; NULL alongside a NULL image |

Both are nullable rather than defaulted: "no icon" is a real state, and an empty
blob would be a lie.

## Why a BLOB and not a base64 data URL

This is the app's established answer for a per-row image — `sys_users.avatar`
(0011), `exp_creditcard_accounts.card_image` (0031), `exp_categories.icon_image`
(0034), `stk_investment_accounts.icon_image` (0037) — and it's here for the same
reasons:

- The bytes are served by dedicated routes (`/api/journal/categories/[name]/icon`,
  `/api/journal/tags/[name]/icon`), so they never ride along in a page's JSON
  payload.
- Reads of the category/tag lists therefore **select columns explicitly** instead
  of `SELECT *`. `listCategories`/`getCategoryByName`/`listTags`/`getTagByName` in
  `src/lib/journal/repository.ts` were changed to a named column list in the same
  change, so the blob stays out of every normal query. Only the icon-serving path
  touches these two columns per table.

Plain `ALTER TABLE ADD COLUMN` is used because these are simple additive nullable
columns — no rebuild needed, and existing rows are valid as they stand. No new
index: both tables are keyed by `name` and are small.

## Constraints enforced in code, not the database

The use-case rejects anything that isn't `image/png`, `image/jpeg`, `image/webp`
or `image/gif`, and caps the size at 128 KB (`MAX_JOURNAL_ICON_BYTES`) — the same
cap as an expense category icon, since both render small. SVG is deliberately
excluded: it can carry script, and it would be served from the app's own origin.
Decoding and validation reuse the shared `src/lib/shared/image-upload.ts` helper,
so the allowlist can't drift apart per module.

## jrn_icons dropped

`jrn_icons` (`icon_type`, `name`, `data` as a base64 data URL, keyed by
`(icon_type, name)`) was ported from the source app's own icon scheme in migration
0027, but was never read or written by any repository, use-case, or route — dead
schema from day one. The columns above are the app's now-established per-row-icon
pattern, so `jrn_icons` is redundant rather than superseded functionality; there is
no data to migrate out of it because nothing ever wrote to it in this app.

## Data handling

Existing categories/tags get NULL for both new columns, i.e. no icon, and render
exactly as they did before. Nothing is backfilled. `jrn_icons` is dropped outright;
since it held no application data, this is a no-op in practice, not a data loss.

## Rollback

```sql
CREATE TABLE jrn_icons (
  icon_type  TEXT NOT NULL,
  name       TEXT NOT NULL,
  data       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (icon_type, name)
);

ALTER TABLE jrn_tags DROP COLUMN icon_image_mime_type;
ALTER TABLE jrn_tags DROP COLUMN icon_image;
ALTER TABLE jrn_categories DROP COLUMN icon_image_mime_type;
ALTER TABLE jrn_categories DROP COLUMN icon_image;
```
