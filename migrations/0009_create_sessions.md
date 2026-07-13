# Migration 0009: create sessions table

**Date:** 2026-07-12
**Type:** new table

## What this does

Creates `sessions`, the server-side store backing the login cookie. `id` is
a random token generated at login time (`src/lib/auth/auth.ts`); the same
value is set as the `httpOnly` session cookie, so `id` is a `TEXT PRIMARY
KEY` rather than an `INTEGER AUTOINCREMENT` — it's opaque and unguessable,
not sequential.

## Columns

| Column | Type | Notes |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | random session token / cookie value |
| `user_id` | `INTEGER NOT NULL` | no FK (project convention); references `users.id` |
| `created_at` | `TEXT NOT NULL DEFAULT (datetime('now'))` | login time |
| `expires_at` | `TEXT NOT NULL` | `created_at` + 7 days (`SESSION_DURATION_MS` in `src/lib/auth/auth.ts`); checked on every request, expired rows are deleted lazily by `getCurrentUser` |

`INDEX sessions_user_id_idx` supports "delete all sessions for this user",
used to force-logout a user after their password, role, or disabled status
changes.

## No seed data

Starts empty — rows are created by `login` and removed by `logout` or
expiry.

## Rollback

`DROP INDEX sessions_user_id_idx; DROP TABLE sessions;`
