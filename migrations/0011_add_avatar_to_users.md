# Migration 0011: add avatar to users

**Date:** 2026-07-14
**Type:** add nullable columns

## What this does

Adds `avatar` and `avatar_mime_type` to `users`, storing a user's profile
picture directly as a BLOB — no filesystem or external storage. Two plain
`ALTER TABLE ADD COLUMN`s are sufficient (this project's SQLite guide only
requires copy-rename-drop for changes beyond a simple nullable column).

## Columns

| Column | Type | Notes |
|---|---|---|
| `avatar` | `BLOB` (nullable) | Raw image bytes. Deliberately excluded from `SqliteUserRepository`'s normal row-mapping queries (`listUsers`, `getUserById`, etc.) — only `getAvatar`/`setAvatar` in `src/lib/user/repository.ts` touch this column, so listing users or rendering the sidebar never pulls blob bytes. |
| `avatar_mime_type` | `TEXT` (nullable) | e.g. `image/png`. Part of the normal `User` row mapping (as `avatarMimeType`) — its presence alone tells the UI whether to render an image or fall back to initials, without transferring bytes. |

Both columns are always set/cleared together (`setAvatar` in
`src/lib/user/user.ts`) — never one without the other.

## No backfill

Existing users start with no avatar; each uploads their own from the new
`/account` page.

## Rollback

SQLite can't drop a single column without a table rebuild; use the
copy-rename-drop pattern to recreate `users` without these two columns if
they need to go.
