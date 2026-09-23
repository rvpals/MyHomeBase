# Migration 0105: add an icon image to location categories and tags

**Date:** 2026-09-22
**Type:** four added columns
**Table(s) affected:** `jrn_location_categories`, `jrn_location_tags`

## What this does

Gives each **location** category and tag an uploadable icon, so a saved place's
categories are recognisable at a glance in the Location Manager's chips and on the
map, not just readable as text.

| Column | Table(s) | Type | Meaning |
| --- | --- | --- | --- |
| `icon_image` | `jrn_location_categories`, `jrn_location_tags` | `BLOB` (nullable) | the icon bytes; NULL when no icon is set |
| `icon_image_mime_type` | `jrn_location_categories`, `jrn_location_tags` | `TEXT` (nullable) | e.g. `image/png`; NULL alongside a NULL image |

Both are nullable rather than defaulted: "no icon" is a real state, and an empty
blob is not a sensible stand-in for it.

## Why this mirrors 0042 exactly

Migration 0042 added these same two columns to `jrn_categories`/`jrn_tags`, which
in turn followed `exp_categories.icon_image` (0034) and
`stk_investment_accounts.icon_image` (0037). Location categories are the same
shape as entry categories — a name-keyed managed list with a description — so
this is the established per-row-icon pattern applied once more, not a new idea.

Consequences that come with the pattern:

- The bytes are served by dedicated routes
  (`/api/journal/locations/categories/[name]/icon`,
  `/api/journal/locations/tags/[name]/icon`), so they never ride along in a
  page's JSON payload and the browser can cache them.
- Every list query **must name its columns** rather than `SELECT *`, so the blob
  stays out of normal reads. Only the icon-serving path loads it.
- The name is the primary key, so it arrives URL-encoded in the route path.

## Reversing the earlier "no icon here" decision

`journal-location-taxonomy-view.tsx` carried a note that location categories
deliberately had *no* icon, on the grounds that "a place's mark on the map is its
pin, so a second per-category glyph would compete with it". That call has been
reversed by request: the icon now *becomes* the pin's face for a categorised
place, so the two no longer compete — they're the same mark. The stale comment is
rewritten in the same change rather than left contradicting the code.

## Migration safety

Existing categories/tags get NULL for both new columns, i.e. no icon, and render
exactly as they did before. Nothing is backfilled and no data is dropped. Four
`ALTER TABLE ... ADD COLUMN` statements on SQLite are metadata-only and do not
rewrite the tables.
