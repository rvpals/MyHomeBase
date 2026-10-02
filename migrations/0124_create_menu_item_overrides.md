# Migration 0124: Menu item overrides

**Date:** 2026-10-01
**Type:** one new table, no seed

## What this does

Adds the storage behind **menu items** — the registry that gives every navigable
destination in the app a single addressable id, and lets an administrator retitle
or re-describe one.

| Object | Shape | Notes |
|---|---|---|
| `sys_menu_item_overrides` | `menu_item_id` TEXT PK, `title`, `hint`, `updated_at` | Sparse: one row per *changed* item, not per item |

**No module row is registered** — this is platform navigation, not a feature
module, so there is no `seed_*_module` migration and **no `DEFAULT_MODULES`
change**. It is the first half of the Personal Toolbars feature; the toolbar
tables themselves are a later migration.

## Why `sys_` and not a new prefix

A menu item spans every module's sections plus Administration's screens plus Home.
It is owned by no feature module, so it sits with `sys_modules` and
`sys_app_settings`. A 3-letter prefix is a *module* namespace — `coding-guide.md`
records that lesson twice (`pho_`, `tol_`) — and there is no module here to
namespace.

## Why the key is a text slot id, not an autoincrement integer

This is the load-bearing decision of the feature.

Every section already has a permanent unique id. `sectionSlotId(namespace, slug)`
derives `journal_section_locations`; it is registered in `ICON_SLOTS` and stored in
`ico_slot_overrides.slot_id`. **A menu item reuses exactly that string**, so:

- An item's customizable icon is the one that already works — Administration →
  Display Settings → Icons has edited these all along. No second icon path.
- The id allocates itself from the slug. There is no counter, no "get the next free
  id" step, and nothing to forget when adding a section.
- The registry derives from the same `SECTION_BUILDERS` and `adminNav` the
  navigation tree is built from, so a new section becomes a menu item automatically
  and the two cannot drift.

A parallel integer id was considered and rejected: it would give every subnode two
identities and two places to set an icon, which is the exact trap `coding-guide.md`
names under *What must NOT become a slot* — "a second, competing way to set one
value".

**The cost is real and worth stating.** A menu item id is permanent once shipped.
Renaming a section slug now orphans the override row here *and* the uploaded icon in
`ico_slot_overrides`. That rule already applied to icon slots; this table widens its
blast radius rather than inventing a new rule. `coding-guide.md` → *Menu items: the
id is the slot id* carries the full version.

## Why the table is sparse

A row exists only where an administrator changed something. The registry is the
default; this table is the exception list. Consequences:

- **"Reset to default" is a `DELETE`**, not an update back to a remembered value.
- An install where nothing has been renamed carries **zero rows**.
- `isOverridden` on the domain type is honest — writing values that match the
  registry's defaults removes the row rather than storing a no-op.

## Why `title` and `hint` treat blank differently

| Column | `NULL` | `''` |
|---|---|---|
| `title` | Use the registry's | **Never written.** Rejected on write, ignored on read |
| `hint` | Use the registry's | Deliberately no description |

A title renders in the navigation tree, so a blank one would be an unnamed row an
admin could not identify in order to fix — the UI you would go to to repair it is
the one it breaks. A blank hint is ordinary: plenty of sections ship without a
description.

## No secondary indexes

Every read is the whole table (`listAll`, resolving the registry in one query) or a
primary-key lookup. The table is bounded by how many of the ~78 destinations an
admin has renamed. An index on `updated_at` would cost writes to serve a query
nothing makes.

## Rollback

```sql
DROP TABLE sys_menu_item_overrides;
```

Safe: the table holds only overrides. Dropping it reverts every menu item to the
title and description its section file declares — the app reads the registry when
there is no row, which is the same state as a fresh install. No navigation breaks
and no icon upload is affected (those live in `ico_slot_overrides`).
