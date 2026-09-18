# Migration 0098: register the Tools module

**Date:** 2026-09-17
**Type:** seed (1 row)

## What this does

Inserts the **Tools** module into `sys_modules`, so it appears on the home grid and
the module rail and becomes grantable per user.

| Field | Value |
|---|---|
| `slug` | `tools` |
| `short_name` | Tools |
| `long_name` | Tools & Utilities |
| `description` | This module list all the utilities and tools |
| `sequence` | 10 |
| `is_visible` | 1 |
| `icon` | `tool` |

Mirrored in [`DEFAULT_MODULES`](../src/lib/modules/defaults.ts). Both must stay in
sync: this migration builds a fresh database, and that list is what admin *Reset to
Default* restores the table from. A module missing from it vanishes the first time
anyone resets.

## Why sequence 10

Next unused integer. Picture Gallery took 9 in migration 0084; sequence 1 stays vacant,
having belonged to the Real Estate module retired in 0026.

## Why the `tool` icon, and why no new glyph

`tool` is already in `MODULE_ICON_NAMES` and no module uses it — so Tools gets an
exact-fit icon at zero cost.

This is worth recording because it is the case `modules.md` says to aim for. Adding a
*new* concept means hand-drawing it for the classic set and naming it in the candidate
maps for all twelve sets in `scripts/gen-icon-glyphs.mjs`, or the generator fails. Music
Library and Picture Gallery both shipped on a borrowed `heart` and needed a follow-up
migration to fix. Nothing like that is needed here.

## Why the description reads as it does

`This module list all the utilities and tools` is the requester's own wording, kept
verbatim rather than corrected to "lists". It is **admin-editable at runtime** from
Admin → Configuration, so changing it is a text field rather than a migration — and
`DEFAULT_MODULES` carries the identical string so a reset does not silently reword it.

## Access

A freshly seeded module is granted to **nobody**. Admins bypass `sys_user_module_access`
by role, so an admin account sees it immediately; every other account gets a 404 until
the module is granted in admin *User Management*. That is the normal state for a new
module and not a bug to chase.

## Rollback

```sql
DELETE FROM sys_modules WHERE slug = 'tools';
```

Also remove the entry from `DEFAULT_MODULES`, or the next *Reset to Default* puts it
back. Grants in `sys_user_module_access` referencing it should go too.
