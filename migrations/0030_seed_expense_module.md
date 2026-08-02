# Migration 0030: seed the Expense module

**Date:** 2026-08-01
**Type:** data-only (no schema change — `sys_modules` already exists)

## What this does

Adds the `expense` row to `sys_modules` so the Expense tracker appears on the
home grid and in the sidebar for users granted access.

| Field | Value |
|---|---|
| `slug` | `expense` |
| `short_name` | Expense |
| `long_name` | Expense Tracker |
| `description` | Track credit-card spending by category. |
| `sequence` | 5 (after CSV Analysis, which is 4) |
| `is_visible` | 1 |
| `icon` | `wallet` (from `MODULE_ICON_NAMES`) |

Mirrored in `src/lib/modules/defaults.ts` (`DEFAULT_MODULES`) — both must stay in
sync, because "Reset to Default" on the Module Configuration screen restores the
table from that list, and a module missing there would be silently dropped.

Access is not granted automatically: admins see every module, and other users
need the module assigned in User Management.

## Rollback

```sql
DELETE FROM sys_modules WHERE slug = 'expense';
```
