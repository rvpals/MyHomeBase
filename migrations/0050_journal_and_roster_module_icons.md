# Migration 0050: distinct icons for Journal and Attendance

**Date:** 2026-08-17
**Type:** data update (two `UPDATE`s, no schema change)
**Table(s) affected:** `sys_modules`

## What this does

Journal and Attendance both seeded with the `book` icon, so they rendered as the
same glyph in the app bar, on the home grid and in the carousel. This points each
at its own new concept.

| Module | Before | After |
|---|---|---|
| `journal` | `book` | `journal` — a bound journal with a quill |
| `attendance` | `book` | `roster` — a class register: checklist rows with ticks |

`0048_seed_attendance_module.md` noted that `book` was a stand-in because the icon
list had no better fit, and that changing it later would be an admin edit rather
than a migration. There is no admin UI for the module icon, so it is this.

## Why two new names rather than reusing `book`

`icon` is validated against `MODULE_ICON_NAMES` (`src/lib/modules/icon-names.ts`)
by the module zod schema, so a new value has to be added to that list — it isn't a
free-text field. Redefining `book` itself to mean "journal" was the alternative,
and it was rejected: `book` is a generic concept any module can pick, so changing
what it draws would silently change every other use of it.

The list therefore goes from 10 concepts to 12, and both new ones are baked across
all 12 icon sets by `scripts/gen-icon-glyphs.mjs` plus drawn by hand for the
"classic" set. No set was missing a usable glyph for either concept.

## Idempotency and respecting a manual choice

Both statements are scoped by slug **and** by `icon = 'book'`. Re-running is a
no-op, because the second pass finds no row still holding the old value. More to
the point, if someone has already changed either module's icon by hand, this
migration doesn't overwrite that choice.

## Rollback

```sql
UPDATE sys_modules SET icon = 'book' WHERE slug = 'journal' AND icon = 'journal';
UPDATE sys_modules SET icon = 'book' WHERE slug = 'attendance' AND icon = 'roster';
```

Reverting the *code* as well means dropping `journal`/`roster` from
`MODULE_ICON_NAMES`; leaving them in place is harmless, since an unused concept
costs only the baked glyph bodies.
