# Migration 0031: add a card image to expense accounts

**Date:** 2026-08-02
**Type:** additive columns

## What this does

Adds a small image to each credit-card account, so cards can be told apart at a
glance in the accounts list, the card picker and the transactions grid.

| Column | Type | Notes |
|---|---|---|
| `card_image` | `BLOB` (nullable) | the image bytes; NULL when no image is set |
| `card_image_mime_type` | `TEXT` (nullable) | e.g. `image/png`; NULL alongside a NULL image |

Both are nullable rather than defaulted: "no image" is a real state, and an empty
blob would be a lie.

## Why a BLOB and not a base64 data URL

This mirrors `sys_users.avatar` (migration 0011), which is the app's existing
answer for a per-row image:

- The bytes are served by a dedicated route, so they never ride along in a page's
  JSON payload — a base64 data URL would inflate every account list by ~33% of
  the image size and defeat browser caching.
- Reads of the account list therefore **select columns explicitly** instead of
  `SELECT *`, keeping the blob out of every normal query. Only the
  image-serving path touches these two columns.

Plain `ALTER TABLE ADD COLUMN` is used because these are simple additive nullable
columns — no rebuild needed, and existing rows are valid as they stand.

## Constraints enforced in code, not the database

The use-case rejects anything that isn't `image/png`, `image/jpeg`, `image/webp`
or `image/gif`, and caps the size at 512 KB. SVG is deliberately excluded: it can
carry script, and it would be served from the app's own origin.

## Rollback

```sql
ALTER TABLE exp_creditcard_accounts DROP COLUMN card_image_mime_type;
ALTER TABLE exp_creditcard_accounts DROP COLUMN card_image;
```
