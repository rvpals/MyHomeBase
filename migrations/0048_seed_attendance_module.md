# Migration 0048: seed the Attendance module

**Date:** 2026-08-16
**Type:** data-only (no schema change — `sys_modules` already exists)

## What this does

Adds the `attendance` row to `sys_modules` so the Attendance module appears on
the home grid and in the app bar for users granted access.

| Field | Value |
|---|---|
| `slug` | `attendance` |
| `short_name` | Attendance |
| `long_name` | Class Attendance |
| `description` | Take daily attendance for a class. |
| `sequence` | 6 (after Expense, which is 5) |
| `is_visible` | 1 |
| `icon` | `book` (from `MODULE_ICON_NAMES`) |

`MODULE_ICON_NAMES` is a fixed enum of ten names and has no `users` glyph, so
`book` is the closest fit for a class register. Changing it later is an admin
edit, not a migration.

Mirrored in `src/lib/modules/defaults.ts` (`DEFAULT_MODULES`) — both must stay in
sync, because "Reset to Default" on the Module Configuration screen restores the
table from that list, and a module missing there would be silently dropped.

Access is not granted automatically: admins see every module, and other users
need the module assigned in User Management.

## Rollback

```sql
DELETE FROM sys_modules WHERE slug = 'attendance';
```
