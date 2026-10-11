# Migration 0137: the two script font settings

**Date:** 2026-10-10
**Type:** two seed rows in `sys_app_settings`, no new tables, no changes to existing objects

## What this does

Seeds the two settings behind the new **Script Fonts** screen at
**Administration → Display Settings → Script Fonts**: which decorative handwriting face
each of the app's two script surfaces is written in.

| Key | Seeded value | Meaning |
|---|---|---|
| `daily_quote_font` | `great-vibes` | The face the home screen's Daily Quote card is written in |
| `journal_handwriting_font` | `great-vibes` | The face the Journal entry form uses with **Handwriting** switched on |

## Why two settings and not one

Until this shipped, both surfaces read the same `--font-script` CSS variable, which
pointed at a single `localFont` loader for Great Vibes. They were not *configured* to
match — they had no choice but to match.

They are different kinds of writing. The Daily Quote is a proclamation you glance at
once; formal copperplate suits it and its legibility barely matters at `text-3xl`. The
Journal's handwriting sheet is your own hand over a paragraph you actually read back —
`design.md` calls this out as the "at-length" case and allows it only as a deliberate
exception. Splitting the token lets a reader keep the flourish on the quote and write
the journal in something steadier, which is the whole point of the screen.

## Why both default to Great Vibes

It is what both surfaces wore before either was configurable. An install that upgrades
into this picker therefore looks **exactly as it did before** until somebody opens the
screen and changes something — no install is restyled by taking the upgrade.

## The ids are permanent

Each value is one of the ids in `src/lib/settings/script-fonts.ts`, resolved to a CSS
variable in `src/app/layout.tsx`. Renaming an id silently drops the choice on every
install that had picked it and falls the surface back to Great Vibes — the same trap as
an icon slot id. Removing a face from the catalogue has the same effect, by design:
`resolveScriptFont` falls back rather than leaving a surface with no `font-family`.

## Why app settings, not module settings

The Journal's handwriting **size** lives in that module's own settings, so putting the
**face** in app settings is a deliberate asymmetry. The size is a reading-comfort choice
about one field in one module. The face is an appearance choice for the application,
which is why it sits beside the color theme, the icon set and the chrome style on
Display Settings — all of which are one choice for the whole app rather than per person.

## Reversing it

```sql
DELETE FROM sys_app_settings WHERE key IN ('daily_quote_font', 'journal_handwriting_font');
```

Safe at any time: with the rows gone, `resolveScriptFont` returns Great Vibes for both
surfaces and the app looks as it did before this migration.

## Safety

`INSERT … ON CONFLICT(key) DO NOTHING`, so re-running it is a no-op and it will not
overwrite a face somebody has already chosen. It creates no tables, alters no existing
rows, and touches no data outside these two keys.
