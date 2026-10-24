# Migration 0156: register the Clips module

**Date:** 2026-10-23
**Type:** one row inserted into `sys_modules`

## What this does

Registers Clips so it appears on the home grid and in the navigation, and becomes
grantable per user.

| Field | Value |
|---|---|
| Slug | `clips` |
| Short name | Clips |
| Long name | Clips |
| Description | Rich-text notes with tags and pasted images, linkable to a journal entry. |
| Sequence | 12 |
| Icon | `folder` |

Separate from 0155 and later-numbered, per the recipe in `modules.md`: the tables are
created first, then the module that uses them is registered.

## Sequence 12

The next unused integer — 11 is Household. Sequence 1 stays vacant: it belonged to the
Real Estate module, retired in `0026_drop_real_estate_module`.

## Why the icon is `folder` and not a new `clip` glyph

`MODULE_ICON_NAMES` is not a free-text field. Adding a name to it means drawing that
concept in **all twelve** generated icon sets, because a missing module concept is
fatal in `scripts/gen-icon-glyphs.mjs`. That is its own piece of work with its own
migration, and the registry records two precedents for doing it afterwards rather than
inline: Music Library borrowed `heart` from 0053 until 0055 gave it `music`, and
Picture Gallery did the same until 0085 gave it `photo`.

So this seeds `folder`, which is a real glyph in every set today, rather than a name
that would crash icon generation. A later migration can swap it exactly as 0055 and
0085 did — the module row's `icon` column is admin-editable besides.

## Access

A freshly seeded module is granted to **nobody** except admins, who bypass the table
by role. It must be granted in Administration → User Management before any non-admin
can reach it; until then `/modules/clips` renders as `notFound()` for them, which is
deliberate — an ungranted module is indistinguishable from one that does not exist.

## Keep `DEFAULT_MODULES` in sync

`src/lib/modules/defaults.ts` carries the same values. This is **not** a duplicate to
be tidied away: this migration builds a fresh database, and `DEFAULT_MODULES` is what
admin "Reset to Default" restores `sys_modules` from. A module missing there vanishes
the first time anyone resets. That file's comment names this migration.

## Not added to `MESSAGE_MODULES`

`src/lib/messages/schema.ts` lists the modules that may file into the message queue,
as a fixed enum (migration 0142 says why it is not a lookup). Clips files no messages,
so it is deliberately absent. If it ever gains a background job or a notification, the
slug has to be added there first or `createMessage` throws at the boundary.
