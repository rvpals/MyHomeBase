# Migration 0008: create user_module_access table

**Date:** 2026-07-12
**Type:** new table

## What this does

Creates `user_module_access`, the grant list of which modules a `user`-role
account can see. One row per (user, module) pair. **Only consulted for
`role = 'user'`** — admins bypass this table entirely in code
(`isAdmin(user)` short-circuits `getAccessibleModules` in
`src/lib/user/user.ts`), so an admin automatically gets every module,
including ones added after the admin account was created.

## Columns

| Column | Type | Notes |
|---|---|---|
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | internal PK |
| `user_id` | `INTEGER NOT NULL` | no FK (project convention); references `users.id` |
| `module_id` | `INTEGER NOT NULL` | no FK; references `modules.id` |
| `created_at` | `TEXT NOT NULL DEFAULT (datetime('now'))` | grant timestamp |

`UNIQUE (user_id, module_id)` prevents duplicate grants. `INDEX
user_module_access_user_id_idx` supports the "all modules for this user"
lookup used on every request that renders the sidebar.

## No seed data

Starts empty — grants are made from the User Management screen.

## Rollback

`DROP INDEX user_module_access_user_id_idx; DROP TABLE user_module_access;`
