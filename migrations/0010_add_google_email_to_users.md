# Migration 0010: add google_email to users

**Date:** 2026-07-13
**Type:** add nullable column

## What this does

Adds `google_email` to `users`, letting an admin link an existing account
to a Google account for "Sign in with Google". A plain `ALTER TABLE ADD
COLUMN` is sufficient here — this project's SQLite migration guide only
requires the copy-rename-drop dance for changes beyond a simple nullable
column addition.

## Columns

| Column | Type | Notes |
|---|---|---|
| `google_email` | `TEXT` (nullable) | Set/cleared from User Management (`setUserGoogleEmail` in `src/lib/user/user.ts`). `NULL` means the account can only log in with a password. |

`CREATE UNIQUE INDEX users_google_email_idx ON users(google_email) WHERE
google_email IS NOT NULL` — a **partial** unique index, so any number of
accounts can have `NULL` (unlinked), but no two accounts can be linked to
the same Google email. Google account holders are never auto-registered on
sign-in — `src/lib/auth/auth.ts`'s `completeGoogleLogin` only succeeds if
this column already matches an existing, enabled user.

## No backfill

Existing users start unlinked (`NULL`); each admin links their own Google
email later from User Management.

## Rollback

`DROP INDEX users_google_email_idx;` — SQLite can't drop a single column
without a table rebuild; if the column itself needs to go, use the
copy-rename-drop pattern to recreate `users` without it.
