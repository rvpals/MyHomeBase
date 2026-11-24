# Migration 0176: an icon for each journal prefill template

**Date:** 2026-11-23
**Type:** new columns

## What this does

Adds two columns to `jrn_prefill_templates`, the template table from migration 0062.

| Column | Type | Notes |
|---|---|---|
| `icon_image` | `BLOB` | the icon bytes; `NULL` = no icon |
| `icon_image_mime_type` | `TEXT` | e.g. `image/png`; `NULL` = no icon |

## Why

The New Entry screen picks a template from a dropdown of names. A journal with a
dozen templates — "Gym", "Gym (travel)", "Golf", "Work trip" — reads as a wall of
text, and the one reached for daily is no faster to find than the one used twice a
year. An icon makes it findable without reading.

The icon shows in two places: beside each row on Journal → Configuration → Prefill
Templates, and beside each option in the New Entry screen's template picker.

## Why this forced the dropdown to change

Neither a native `<select>` nor a `<datalist>` can render an image in its options.
The New Entry picker therefore moves from `<select>` to `IconSelect`, the shared
combobox that exists for precisely this (`components.md` → *IconSelect*), in strict
mode (`allowFreeText={false}`) so it still behaves as a picker and not a text field.

## Why a BLOB and a mime column, not a data URL

`coding-guide.md` → *Per-row images*. Eleven tables now do this. The bytes are served
by one route — `/api/journal/prefill-templates/<id>/icon` — which is the **only**
reader of `icon_image`; everything else reads `icon_image_mime_type` to learn whether
an icon exists at all. A base64 data URL on the domain type would ship the bytes into
every Templates render and into the New Entry form's props.

The route is keyed by `id` rather than by name, unlike the category/tag icon routes:
a template's name is editable, so a name-keyed URL would 404 after a rename until the
next hard load. Templates are household-wide rows, so the route asks only whether the
reader is signed in — the user-scoped shape `sys_user_shortcuts` needs (0115) does not
apply.

## The obligation this carries

Every normal read of this table must continue to omit `icon_image`.
`PREFILL_TEMPLATE_COLUMNS` in `src/lib/journal/repository.ts` was already spelled out
rather than `SELECT *` for exactly this case, and it gains `icon_image_mime_type`
only. Adding `icon_image` there would put the bytes in every list.

## Why NULL and not ''

This schema's usual rule is that a settings value is blank, never NULL (see the note
at `coding-guide.md` → *A settings value is blank, never NULL*). These two columns are
the documented exception shape for images: they are a pair that is either both set or
both absent, and every icon read in this module — `getCategoryIcon`, `getTagIcon`,
their serving routes — is already written against `NULL` meaning absent. Matching
migration 0042 mattered more here than matching the TEXT rule.

## Nothing is backfilled

Every existing template starts with no icon, and the picker indents those rows so the
labels stay aligned. No icon is generated from the name either — unlike categories and
tags, a template name like "Gym (travel)" has no glyph to map to, so there is no ⚡
equivalent on this screen.

## Rolling back

Neither column is named by an index or a trigger, so
`ALTER TABLE jrn_prefill_templates DROP COLUMN icon_image` and the same for
`icon_image_mime_type` remove them directly. Only the uploaded icons are lost; the
templates themselves are untouched.
