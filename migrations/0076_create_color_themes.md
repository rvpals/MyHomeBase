# Migration 0076: create sys_color_themes

**Date:** 2026-08-30
**Type:** new table (+ one corrective UPDATE)

## What this does

Turns color themes from **code** into **data**, so an admin can build one at
**Admin → Configuration → Color Themes** instead of asking for a code change.

Before this, `COLOR_THEMES` in [src/lib/settings/themes.ts](../src/lib/settings/themes.ts)
was the only source of themes, and `sys_app_settings.color_theme` stored the id of
whichever one was selected. This table holds the themes themselves. The eight built-ins
are seeded into it, so **on the day it runs this migration changes nothing visible** —
the same eight themes are offered and the same one stays selected.

| Column | Type | Notes |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | Slug, e.g. `signal-deck`. The value that goes in `sys_app_settings.color_theme` |
| `name` | `TEXT NOT NULL` | Shown on the picker card |
| `description` | `TEXT NOT NULL DEFAULT ''` | One line under the name |
| `paper`, `paper_raised` | `TEXT NOT NULL` | Page and raised-card surfaces. CHECKed as `#RRGGBB` |
| `ink`, `muted`, `muted_inverse` | `TEXT NOT NULL` | Body text, secondary text, and text on an accent fill |
| `line` | `TEXT NOT NULL` | Borders and dividers |
| `brass`, `brass_dark`, `brass_soft` | `TEXT NOT NULL` | Accent, its darker text-safe shade, its tinted fill |
| `font_display`, `font_body`, `font_mono` | `TEXT NOT NULL` | One of the seven `FontKey` values |
| `is_builtin` | `INTEGER NOT NULL DEFAULT 0` | 1 for the eight seeded below |
| `sort_order` | `INTEGER NOT NULL DEFAULT 100` | Built-ins 10–80; user themes default to 100, so they sort after |
| `created_at`, `updated_at` | `TEXT NOT NULL` | `updated_at` maintained by a trigger, as in 0002 |

## Why nine columns and not one JSON blob

A single `tokens TEXT` column holding JSON would have been fewer lines and is how a lot
of "user settings" tables end up. It was rejected because **the shape is closed and
already known**: `ColorThemeTokens` has exactly nine colors and three font keys, and
every component in the app reads them through the same nine CSS custom properties. A
schema that is known should be enforced, not re-parsed.

Concretely, columns buy three things JSON could not:

- A `CHECK ... GLOB '#[0-9A-Fa-f]...'` per color. A malformed hex string never reaches
  the `:root` style block in [src/app/layout.tsx](../src/app/layout.tsx), where it would
  produce an invalid CSS declaration and silently fall back to the previous token value —
  the kind of bug that looks like "the theme didn't save".
- Readability in the SQL Explorer. `SELECT id, brass FROM sys_color_themes` answers
  "which theme is the purple one" without a JSON extension.
- A cheap future `ALTER TABLE ADD COLUMN` if a tenth token is ever introduced, with the
  default filling every existing row. Adding a key inside a JSON blob means rewriting
  every row and handling the absent case in code forever.

## Why the built-ins are seeded rather than merged at read time

The alternative was to leave this table empty and have theme resolution return
`table row ?? COLOR_THEMES entry`, inserting a row only when someone edits a built-in
(copy-on-write).

Seeding was chosen because copy-on-write leaves **two code paths alive permanently** —
every read merges two sources, and every screen has to reason about a theme that may or
may not have a row. Seeding collapses that on the migration: after it runs, the table is
the single source of truth for what themes exist, and editing a built-in is an ordinary
`UPDATE`. The picker lists rows; it does not list rows-plus-constants.

`COLOR_THEMES` stays in the codebase, but its job narrows to **the reset baseline**: it
is what "Reset to built-in" copies back over a row. That is why `is_builtin` exists —
it means "this id has a definition in code to fall back to", not "read-only".

`getColorTheme(id)` also stays, as the fallback for a selected id with no row at all
(a hand-edited setting, or a theme deleted out from under the setting).

## Why `id` is a slug and not an autoincrement integer

`sys_app_settings.color_theme` has held strings like `signal-deck` since migration 0004,
and that value is what every install already carries. A numeric primary key would mean
translating that setting on read, or rewriting it here and hoping nothing else stored it.
A slug key means the existing setting keeps pointing at the right row with no
translation, and `getColorTheme`'s code fallback keeps working against the same ids.

## Why `font_*` is not a foreign key

Same reasoning as `ico_slot_overrides.slot_id` in 0066: the font registry is **code, not
data**. Each face has to be loaded by a `next/font/google` call in
[src/app/layout.tsx](../src/app/layout.tsx), so a row naming a font nothing loads would
render as the browser fallback rather than the chosen face. There is no table to point
at. The use-case layer checks membership against `FONT_KEYS` on write, which is also
what keeps the admin screen's font list and the loaded faces in step.

## The corrective UPDATE

Migration 0004 seeded `color_theme = 'brass'`. No theme has had that id since the themes
were renamed, so `getColorTheme('brass')` has been quietly returning `COLOR_THEMES[0]`
ever since — the app looked right, and the stored value was wrong.

That was harmless while the fallback was the only consumer. It stops being harmless now:
the picker highlights the row matching the setting (nothing would be highlighted), and
"Reset to built-in" needs a real target. So the final statement repoints any
`color_theme` value that does not match a seeded id at `signal-deck`, which is the theme
such an install has actually been rendering all along.

Written as `WHERE value NOT IN (SELECT id FROM sys_color_themes)` rather than
`WHERE value = 'brass'` so it also catches an install whose setting was hand-edited to
something else that never existed.

## Rollback

```sql
DROP TRIGGER IF EXISTS color_themes_set_updated_at;
DROP TABLE IF EXISTS sys_color_themes;
```

Safe whenever no user-built theme is selected. Theme resolution falls back to
`getColorTheme`, so the eight built-ins keep working with no table — but **a user-created
theme is dropped with it**, and any install whose `color_theme` names one will fall back
to `signal-deck` on the next render. Check with
`SELECT id FROM sys_color_themes WHERE is_builtin = 0;` before rolling back.

The corrective UPDATE is not reversed. Restoring a value that never named a real theme
has no benefit.
