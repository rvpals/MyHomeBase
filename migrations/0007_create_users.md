# Migration 0007: create users table

**Date:** 2026-07-12
**Type:** new table

## What this does

Creates `users`, backing the new user management / authentication feature.
Each row is one login-capable account: a username, display fields, a hashed
password, and a role that governs access (`admin` vs `user`).

## Columns

| Column | Type | Notes |
|---|---|---|
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | internal PK |
| `username` | `TEXT NOT NULL UNIQUE` | login identifier |
| `full_name` | `TEXT NOT NULL` | shown in the sidebar once logged in |
| `description` | `TEXT` (nullable) | free-text note about the user, shown in the User Management grid |
| `password_hash` | `TEXT NOT NULL` | `scrypt` salt+hash, see `src/lib/shared/password.ts`. Never read outside `src/lib/user` |
| `role` | `TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user'))` | `admin` implicitly gets every module (present and future) plus the Administration section; `user` only gets modules granted via `user_module_access` |
| `is_disabled` | `INTEGER NOT NULL DEFAULT 0` | disabled users can't log in and have their sessions invalidated |
| `created_at` / `updated_at` | `TEXT NOT NULL DEFAULT (datetime('now'))` | `updated_at` trigger-maintained |

No FK constraints, matching the existing `modules`/`module_settings`
convention — relationships (`user_module_access`, `sessions`) are managed in
application code.

## No seed data

A committed migration with a default admin password would be a permanent
security hole in the repo history. The first admin account is created after
migration via `npm run cli -- create-user --username <u> --full-name <n>
--password <p> --role admin`.

## Rollback

`DROP TRIGGER users_set_updated_at; DROP TABLE users;`
