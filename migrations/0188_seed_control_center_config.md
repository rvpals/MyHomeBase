# Migration 0188: seed control_center_config setting

**Date:** 2026-11-27
**Type:** data-only (no schema change — `sys_app_settings` already exists)

## What this does

Adds the `control_center_config` row to `sys_app_settings`, holding the per-system
settings of the home screen's **MyHomeBase Control Center** card, edited at
**Administration → Display Settings → Dashboard Widgets → Dashboard Widget
Configuration**. One row holds all six, encoded as:

```
money_movers=5,journal_entries=5,household_recipes=4,classroom_classes=3,media_top_tracks=3,media_random_photo=1
```

| Key | Panel | Meaning | Range | Default |
|---|---|---|---|---|
| `money_movers` | Money | Gainers and losers listed (each) | 1–10 | 5 |
| `journal_entries` | Journal & Notes | Recent entries listed | 1–10 | 5 |
| `household_recipes` | Household | Random recipes drawn, on load and on re-roll | 1–12 | 4 |
| `classroom_classes` | Classroom | Classes listed | 1–10 | 3 |
| `media_top_tracks` | Media | Most-played songs listed | 1–10 | 3 |
| `media_random_photo` | Media | Draw the "From the archive" photo (`1`/`0`) | — | 1 |

The journal default is 5, up from the 3 the card drew before this setting existed — a
deliberate change. Every other default is the value previously hard-coded.

Recipes stop at 12 because `drawRandomRecipesAction` already caps a re-roll there.

**The keys are permanent.** They *are* the stored encoding, so renaming one makes
`resolveControlCenterConfig` miss it and fall back to the default. The encoding is owned
by `resolveControlCenterConfig` / `controlCenterConfigToValue` in
`src/lib/home-dashboard/control-center.ts`. Reading clamps and falls back per field;
writing validates with zod and rejects a bad value.

`INSERT OR IGNORE` so re-running against a DB that already has the row is a no-op.
Mirrored in `src/lib/settings/defaults.ts` (`DEFAULT_APP_SETTINGS`) — keep both in sync.
Saving goes through the `ON CONFLICT` upsert, so the form works even before this runs;
the row is wanted for its `description` and for reset parity.
