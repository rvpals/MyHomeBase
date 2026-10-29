# Migration 0160: register the Document Library module

**Date:** 2026-10-28
**Type:** one row inserted into `sys_modules`

## What this does

Registers the Document Library so it appears on the home grid and in the navigation,
and becomes grantable per user.

| Field | Value |
|---|---|
| Slug | `documents` |
| Short name | Documents |
| Long name | Document Library |
| Description | Filed documents with categories, tags and their attachment files. |
| Sequence | 13 |
| Icon | `folder` |

Separate from 0159 and later-numbered, per the recipe in `modules.md`: the tables are
created first, then the module that uses them is registered.

## Sequence 13

The next unused integer — 12 is Clips. Sequence 1 stays vacant: it belonged to the Real
Estate module, retired in `0026_drop_real_estate_module`.

## Why the icon is `folder` and not a new `document` glyph

`MODULE_ICON_NAMES` is not a free-text field. Adding a name to it means drawing that
concept in **all twelve** generated icon sets, because a missing module concept is fatal
in `scripts/gen-icon-glyphs.mjs`. That is its own piece of work with its own migration,
and the registry records three precedents for doing it afterwards rather than inline:
Music Library borrowed `heart` from 0053 until 0055 gave it `music`, Picture Gallery did
the same until 0085 gave it `photo`, and Clips still borrows `folder` from 0156.

So this seeds `folder`, which is a real glyph in every set today, rather than a name
that would crash icon generation. A later migration can swap it exactly as 0055 and 0085
did — the module row's `icon` column is admin-editable besides.

**Note this is the second module on `folder`** (Clips is the first, and CSV Analysis the
third). That is tolerable but not ideal, and it is the argument for a `document` glyph
migration sooner rather than later: three modules wearing one glyph makes the home grid
harder to scan, which is the one thing the grid is for.

## Why the slug is `documents` and not `document-library`

The slug is the URL segment and is permanent in practice — it is in bookmarks, in
`DEFAULT_MODULES`, and hardcoded as a constant in the route and action files. `documents`
is shorter, reads better in `/modules/documents/new`, and matches the one-word slugs the
rest of the registry uses (`journal`, `clips`, `household`). The *long name* carries the
fuller "Document Library" for admin screens.

## Access

A freshly seeded module is granted to **nobody** except admins, who bypass the table by
role. It must be granted in Administration → User Management before any non-admin can
reach it; until then `/modules/documents` renders as `notFound()` for them, which is
deliberate — an ungranted module is indistinguishable from one that does not exist.

## Configuration is required before anything can be attached

Unlike most modules, this one does nothing useful until an administrator sets its
document folder on Documents → Configuration. Until then a document can be filed but a
file cannot be attached, and the use-case refuses with "No document folder is set."
rather than failing obscurely at the filesystem.

## Keep `DEFAULT_MODULES` in sync

`src/lib/modules/defaults.ts` carries the same values. This is **not** a duplicate to be
tidied away: this migration builds a fresh database, and `DEFAULT_MODULES` is what admin
"Reset to Default" restores `sys_modules` from. A module missing there vanishes the first
time anyone resets. That file's comment names this migration.

## Not added to `MESSAGE_MODULES`

`src/lib/messages/schema.ts` lists the modules that may file into the message queue, as a
fixed enum (migration 0142 says why it is not a lookup). The Document Library files no
messages, so it is deliberately absent. If it ever gains a background job — a folder
watcher that files dropped scans, say — the slug has to be added there first or
`createMessage` throws at the boundary.
