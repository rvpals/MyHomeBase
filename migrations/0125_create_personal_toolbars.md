# Migration 0125: Personal toolbars

**Date:** 2026-10-01
**Type:** two new tables, no seed

## What this does

Adds the storage behind **personal toolbars** — a configurable bar of shortcuts
docked to one of the four screen edges, pointing at the menu items migration 0124
made addressable.

| Object | Shape | Notes |
|---|---|---|
| `sys_toolbars` | `id` PK, `name`, `background_color`, `border_color`, `text_color`, `edge`, `full_mode_only`, `is_visible`, `sort_order`, `created_at` | One row per toolbar |
| `sys_toolbar_items` | `id` PK, `toolbar_id`, `kind`, `menu_item_id`, `label`, `sort_order`, `created_at` | One row per shortcut, heading or separator |
| `idx_sys_toolbars_order` | index | `(sort_order, id)` — the shell's read |
| `idx_sys_toolbar_items_order` | index | `(toolbar_id, sort_order, id)` — one bar's rows |

**No module row is registered** and **no `DEFAULT_MODULES` change** — this is
platform chrome, administered from Display Settings, not a feature module.

## This does not replace the main navigation

Worth stating in the log because it constrains every future change here: the
navigation tree (full layout) and the two-tier bottom bar (compact) are **untouched**.
A toolbar is an additional surface *alongside* them. Nothing about where-you-are may
live on one — that belongs to a navigation tier per `design.md`. A reader who hides
every toolbar still has complete navigation.

## Why two tables and not a settings row

`coding-guide.md`'s test is whether rows accumulate and are queried individually.
`floating_enabled` is correctly one settings row: bounded by the registered
components, always read whole. Toolbars are bounded by nothing — an admin can add a
fifth or a tenth — they are ordered, individually edited, and each owns a growing
ordered list of items. That is two tables.

## Why `menu_item_id` is a string and cannot be a foreign key

Menu items are **derived from code**, not stored in a table (see 0124). There is
nothing to point at, so no FK can exist and nothing at the database level stops a row
from naming a section a later release removes.

Handled at both ends instead:

| When | What happens |
|---|---|
| Adding a row | `addToolbarItem` validates against the live registry — the one moment the mistake is fixable |
| Rendering | `resolveToolbar` **drops** a row whose id no longer resolves |

So a removed section leaves a shorter bar, never a dead button. A toolbar left with
no actionable rows is not rendered at all, rather than appearing as an empty coloured
stripe.

## Why colours are literals, not theme tokens

A deliberate exception to `design.md`'s "colours are tokens, not literals", and worth
being honest about: the entire feature is that an admin picks the colours. A token
picker would be stricter and would keep a bar in step with a theme change; it would
also make "I want my red bar" impossible.

`NULL` is the default and the common case, so an unconfigured toolbar stays themed.
The **format** is constrained in `schema.ts` to hex and `rgb()`/`hsl()` — these values
are interpolated into an inline `style`, so `url(...)` must never reach the DOM.

## Why `full_mode_only` exists

The compact bottom edge is already claimed by the section trigger and the music
player, and the side edges are ~390px apart on a phone. A bar that earns its space on
a desktop is often in the way on a phone. This flag is the honest way to say so,
rather than a `max-lg:` restyle pretending a ten-item bar fits.

## Why ownership is split

`is_visible` here is the **administrator's** switch — hidden means hidden for
everyone. Each reader's own show/hide is a `toolbars_hidden` list in
`sys_user_preferences`, not a column here, because it is per-person and a row per
(toolbar, reader) would need cleaning up on both deletions to store a set of small
integers. Same split the scratchpad (0096) and the floating layer already make.

## Nothing is seeded

Unlike 0123's starter TODO lists, an empty state is correct here: a toolbar nobody
asked for, docked to an edge and covering content, is worse than no toolbar.

## Rollback

```sql
DROP TABLE sys_toolbar_items;
DROP TABLE sys_toolbars;
```

Safe. Toolbars are additive chrome — dropping them removes the bars and leaves the
navigation tree, the compact bar and every menu item untouched. Readers' stored
`toolbars_hidden` preference becomes inert rather than broken (unknown ids are
ignored on read), so it needs no separate cleanup.
