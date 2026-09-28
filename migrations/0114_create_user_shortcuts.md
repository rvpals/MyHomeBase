# Migration 0114: per-user home-screen shortcuts

**Date:** 2026-09-27
**Type:** one new table

## What this does

Adds `sys_user_shortcuts` — the storage behind the **My Shortcuts** home-screen
widget. A shortcut is an icon, a name and a destination, and each person keeps
their own list.

| Object | Shape | Notes |
|---|---|---|
| `sys_user_shortcuts` | `id` PK, `user_id`, `kind`, `name`, `icon`, `url`, `module_slug`, `section_id`, `sort_order`, timestamps | One row per shortcut per person |
| `idx_sys_user_shortcuts_owner` | index on `(user_id, sort_order, id)` | The card's only read |
| `sys_user_shortcuts_set_updated_at` | trigger | The usual `updated_at` stamp |

## Why `sys_`

A home-screen widget is platform furniture: owned by no feature module, able to
point *at* any module, sitting beside the other home cards. That is the same
call migrations 0095 (`sys_calculator_history`) and 0096 (`sys_scratchpad_notes`)
made for the floating components, which are furniture in the same sense. See
`coding-guide.md`, *Database table naming*.

A `sho_` prefix was rejected on the registry's own rule that a prefix is a
**namespace** and must still fit the second table. There is no second table
coming — a shortcut has no sub-entity.

## Per-user, and the line that draws

`user_id` is mandatory and part of every query's identity. The repository
exposes **no method that reads a shortcut across users**, so an id arriving from
a client is safe to act on: the use-case passes the session's user id and
someone else's row simply isn't found. This mirrors `sys_scratchpad_notes`.

Note the deliberate asymmetry with the widget itself:

| Question | Where it's answered | Who decides |
|---|---|---|
| Does the My Shortcuts card exist at all? | `home_widgets` app setting (migration 0067) | An admin, household-wide |
| What's *in* it? | This table | Each person, for themselves |

That is the same split 0096 drew between scratchpad categories (shared
structure) and notes (private content).

## Two kinds, one table

`kind` is `CHECK`-constrained to `'url'` or `'section'` — a closed set of two
the code switches on exhaustively, not a list extended at runtime.

There is deliberately **no third `'module'` kind**. A shortcut to a module root
is a `'section'` row with `module_slug` set and `section_id` empty; the two
differ only in depth and resolve through the same navigation tree.

## The target is stored as coordinates, not as a path

`module_slug` + `section_id` rather than a resolved `href`. This is the decision
worth defending, and there are three reasons:

1. **A stored path rots silently.** The day a route moves, every saved href
   404s, and there is nothing left in the row to repair it from. Coordinates are
   re-resolved against the live tree on each render, so a moved route follows
   automatically.
2. **A deleted target becomes detectable.** A slug that no longer resolves can
   be reported to the reader; a dead path can only be clicked.
3. **It makes the access re-check possible** — the important one. A reader who
   loses access to a module must stop seeing their shortcut into it. That
   question can be asked of a slug and never of a path, so the check is done at
   render time against `getNavTreeData`, not trusted from the stored row.

## The `icon` column is a glyph name, not a slot id

`icon` holds a `TREE_ICONS` concept (`'rocket'`, `'map'`, …) chosen by the
reader from a picker.

It is explicitly **not** an icon slot id. A slot is a stable id for a *fixed*
position registered at build time in `ICON_SLOTS`, and the ids are persisted in
`ico_slot_overrides.slot_id` — so there is no way to register one per
user-created row, and no way to keep such an id static. A shortcut's glyph is
user *data*, the same kind of thing as the name beside it.

An unrecognised concept (one retired from `TREE_ICONS` in a later release) falls
back to a default glyph at render time rather than throwing — the same tolerance
`resolveHomeWidgets` shows an unknown widget id.

## No seed data

The table starts empty and the card draws its empty state until someone adds a
shortcut. Nothing to backfill: there is no prior feature whose data this
replaces.

## Reversing it

`DROP TRIGGER sys_user_shortcuts_set_updated_at; DROP INDEX
idx_sys_user_shortcuts_owner; DROP TABLE sys_user_shortcuts;` — nothing
references this table and it references nothing. Removing `myShortcuts` from
`HOME_WIDGET_IDS` needs no migration of its own: a stored `home_widgets` value
still naming it is dropped by `resolveHomeWidgets`, which is the same reason the
retired `clock` card shipped without one.
