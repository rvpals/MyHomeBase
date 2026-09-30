# Migration 0119: register the Household module

**Date:** 2026-09-28
**Type:** seed (1 row)

## What this does

Inserts **Household** into `sys_modules`, so it appears on the home grid and the
navigation tree and becomes grantable per user.

| Field | Value |
|---|---|
| `slug` | `household` |
| `short_name` | Household |
| `long_name` | Household |
| `description` | Recipes, receipts and the HSA — the household's paperwork. |
| `sequence` | 11 |
| `is_visible` | 1 |
| `icon` | `household` |

Mirrored in [`DEFAULT_MODULES`](../src/lib/modules/defaults.ts). Both must stay in
sync: this migration builds a fresh database, and that list is what admin *Reset to
Default* restores the table from. A module missing from it vanishes the first time
anyone resets.

Its tables arrived in 0118, which is the separately-numbered create-then-seed pair
`modules.md` asks for.

## Why sequence 11

Next unused integer. Tools took 10 in migration 0098; sequence 1 stays vacant, having
belonged to the Real Estate module retired in 0026.

## Short name and long name are the same word

Every other module has a longer formal title ("Journal" / "My Journal"). There is no
honest expansion of "Household" that adds information — "Household Management" is
longer without being clearer — so both fields carry the same string rather than
inventing a title for the admin screens. Both are admin-editable at runtime, so this
is a text field away from being changed by anyone who disagrees.

## Why a new `household` glyph, and what that cost

Unlike Tools (0098), which found an exact-fit unused `tool` already in
`MODULE_ICON_NAMES`, nothing in the existing fifteen fits a household. `home` is the
closest and is *taken by the home screen's own concept*; using it would put the same
artwork on "the dashboard" and "this module", which is the collision the icon-slot
registry exists to prevent.

So this adds a sixteenth module concept, which is the expensive path `modules.md`
warns about: a **missing module concept is fatal** in
`scripts/gen-icon-glyphs.mjs` (every set must cover all of them, since the toolbar has
no other artwork to fall back on). All eleven sets were checked against the installed
packages before the name was chosen:

| Set | Glyph |
|---|---|
| lucide | `house-plus`, then `house` |
| tabler | `home-cog`, then `home` |
| material-symbols | `household-supplies` |
| mingcute | `home-4-fill`, then `home-3-fill` |
| ph | `house-line-duotone` |
| solar (line + bold) | `home-smile-angle-*-duotone` |
| hugeicons | `home-07`, then `home-01` |
| streamline-color | `house-chimney-2`, then `home-4` |
| flat-color-icons | `home` |
| fluent-emoji-flat / fluent-emoji | `house-with-garden`, then `house` |

Two sets resolve to a plain house (`flat-color-icons` has no household glyph at all —
its whole set is 300 business icons). That is accepted rather than worked around: the
module *is* the house, the home screen's own icon is a different concept in a
different registry, and the two never render adjacent.

This is the case Music Library (0053 → 0055) and Picture Gallery (0084 → 0085) each
got wrong by shipping on a borrowed `heart` and needing a follow-up migration. Naming
every set's glyph up front is what avoids a 0120 to fix this one.

## Access

A freshly seeded module is granted to **nobody**. Admins bypass
`sys_user_module_access` by role, so an admin account sees it immediately; every other
account gets a 404 until the module is granted in admin *User Management*. That is the
normal state for a new module and not a bug to chase.

## Rollback

```sql
DELETE FROM sys_modules WHERE slug = 'household';
```

Also remove the entry from `DEFAULT_MODULES`, or the next *Reset to Default* puts it
back. Grants in `sys_user_module_access` referencing it should go too, as should the
module's texture row in `sys_module_texture` if one was ever set.
