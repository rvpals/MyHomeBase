# Migration 0041: seed the STARTUP_MESSAGE setting

**Date:** 2026-08-08
**Type:** seed data (no schema change)

## What this does

Adds one row to `sys_app_settings`:

| key | value | description |
|---|---|---|
| `STARTUP_MESSAGE` | `''` | If the value is not blank, display this message when the application home screen is reached. |

The home screen reads it, shows it in a modal if it is non-blank, and clears it back
to blank when the user clicks OK. A deployment sets it to
`A new deployment is published on <timestamp>` so the next person to reach the home
screen learns a new build is running.

No schema change — `sys_app_settings` is a key/value store and already fits.

## Why blank rather than NULL

The request was for a NULL value, but `sys_app_settings.value` is `TEXT NOT NULL`
(migration 0002). Making it nullable means a full create-copy-drop-rename rebuild of
the table for no behavioural gain, so **empty string is the "nothing to show"
sentinel** instead. `getStartupMessage()` in `src/lib/settings/settings.ts` maps a
blank (or whitespace-only) value to `undefined`, so callers never test for `''`
themselves.

`INSERT OR IGNORE` so re-running against a database that already has the key is a
no-op, matching migration 0023.

## Seed data

Mirrored in `src/lib/settings/defaults.ts` — "Reset to Default" restores the table to
exactly that list, so the key has to be present there or a reset would delete it.

## Rollback

```sql
DELETE FROM sys_app_settings WHERE key = 'STARTUP_MESSAGE';
```

Also remove the entry from `src/lib/settings/defaults.ts`.
