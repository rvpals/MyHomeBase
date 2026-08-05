# Migration 0037: add an icon image to investment accounts

**Date:** 2026-08-04
**Type:** additive columns
**Table(s) affected:** `stk_investment_accounts`

## What this does

Gives each brokerage account an uploadable icon — a broker logo, usually — so
accounts are recognisable at a glance in the account list and in the Positions
grid's Account column.

(The CSV-import screen's account picker is a native `<select>`, which can't render
an image in an option. Showing the icon there would mean swapping it for the
`IconSelect` component; not done here.)

| Column | Type | Notes |
|---|---|---|
| `icon_image` | `BLOB` (nullable) | the icon bytes; NULL when no icon is set |
| `icon_image_mime_type` | `TEXT` (nullable) | e.g. `image/png`; NULL alongside a NULL image |

Both are nullable rather than defaulted: "no icon" is a real state, and an empty
blob would be a lie.

## Why a BLOB and not a base64 data URL

This is the app's established answer for a per-row image — `sys_users.avatar`
(0011), `exp_creditcard_accounts.card_image` (0031), `exp_categories.icon_image`
(0034) — and it's here for the same reasons:

- The bytes are served by a dedicated route (`/api/stocks/accounts/[id]/icon`), so
  they never ride along in a page's JSON payload. A base64 data URL would inflate
  every account list by ~33% of the image size and defeat browser caching.
- Reads of the account list therefore **select columns explicitly** instead of
  `SELECT *`. `listAccounts` / `getAccountById` in
  `src/lib/investment-accounts/repository.ts` were changed from `SELECT *` to a
  named column list in the same change, so the blob stays out of every normal
  query. Only the icon-serving path touches these two columns.

Plain `ALTER TABLE ADD COLUMN` is used because these are simple additive nullable
columns — no rebuild needed, and existing rows are valid as they stand. No new
index: the table is keyed by `id` and holds a handful of rows.

## Constraints enforced in code, not the database

The use-case rejects anything that isn't `image/png`, `image/jpeg`, `image/webp`
or `image/gif`, and caps the size at 128 KB — the same cap as a category icon,
since both render small. SVG is deliberately excluded: it can carry script, and it
would be served from the app's own origin.

That decoding and validation now lives in `src/lib/shared/image-upload.ts`, lifted
out of `lib/expense` when this became its second caller, so the allowlist can't
drift apart per module.

## Data handling

Existing accounts get NULL for both columns, i.e. no icon, and render with the
monogram fallback exactly as they did before. Nothing is backfilled.

## Rollback

```sql
ALTER TABLE stk_investment_accounts DROP COLUMN icon_image_mime_type;
ALTER TABLE stk_investment_accounts DROP COLUMN icon_image;
```
