# Migration 0116: one background picture for every screen

**Date:** 2026-09-27
**Type:** one new column on an existing table

## What this does

Adds `app_wide` to `sys_dashboard_texture` — the pinned settings row that says
which library picture is selected (0063, extended by 0113).

| Object | Shape | Notes |
|---|---|---|
| `sys_dashboard_texture.app_wide` | `INTEGER NOT NULL DEFAULT 0 CHECK (app_wide IN (0,1))` | `0` = home dashboard only, as today. `1` = behind every authenticated screen |

With the flag on, the selected picture is drawn by the protected layout instead
of by the home page, so it covers the home dashboard, all nine modules,
Administration and the account screen.

**Nothing changes on screen until an admin ticks it.** Existing rows land on `0`,
which is exactly the behaviour they had. No backfill.

## Why a flag on the singleton, not a new table

The question is "where does the selected picture apply?", and the selection
already lives on this row. Scope is a property of that one selection, so one read
answers both *which picture* and *where* — and there is no second table whose
absence a reader has to interpret.

## Why it is not per-picture, unlike opacity / mode / blur

0113 moved those three onto each library row, and gave the reason: they describe
the **image**. A dark photograph needs a lower opacity than a pale pattern, so
carrying them per row is what makes switching textures restore the tuning.

Scope is not like that. It describes the **installation's** intent — "I want one
background everywhere" — which doesn't change when you audition a different
picture. Per-picture, ticking it would be a step you had to remember on every
switch, and forgetting it would blank eight modules.

## What this does *not* change: the per-module override

A module with its own picture in `sys_module_texture` (0064) still wins on its
own screens. The Music Library keeps its own background; this flag only decides
what the screens with **no picture of their own** draw.

That resolution is two domain reads combined in `src/lib/app-texture/`, not
anything SQL knows about. Neither texture table learned about the other, and
0064 is untouched.

## Why the table names still say 'dashboard'

`sys_dashboard_texture` and `sys_dashboard_textures` now back an app-wide
feature, so the names undersell them.

They are kept anyway. A migration is immutable once it has run anywhere (the
lesson 0115 records), so renaming means a **new** table, a copy of up to 20
BLOBs, and every reader repointed — real risk and real backup weight to buy a
better noun. The home dashboard is also still the honest subject whenever the
flag is off, which is the default and the shipped state.

If the names are ever worth fixing, that is a table rename of its own, not a
rider on this.

## Why the default is off

A new behaviour that switches itself on during a migration is one nobody chose.
This one would appear on **every screen at once**, which is the worst possible
place to surprise somebody — and on an install whose texture was tuned to sit
behind the home screen's cards, not behind Administration's dense tables.

So the upgrade is inert, and going app-wide is a deliberate tick in
*Administration → Configuration → App Texture*.

## Storage shape

`INTEGER` 0/1 with a `CHECK`, because SQLite has no boolean. The `CHECK` is what
stops storage representing a third value every reader would then have to handle
— the same reasoning the `mode` columns use in 0063, 0064 and 0113.

No BLOB obligation here: this column is a flag, and the reads that resolve it
already omit the picture bytes (`image IS NOT NULL AS has_image`). The serving
route at `GET /api/dashboard/texture` remains the only reader of the blob.

## Reversing it

SQLite supports `ALTER TABLE ... DROP COLUMN` from 3.35:

```sql
ALTER TABLE sys_dashboard_texture DROP COLUMN app_wide;
```

Dropping it returns the picture to the home dashboard alone. No picture is lost —
the column carries no image, only scope — and `sys_module_texture` is unaffected,
so a module's own background survives the rollback untouched.
