# Migration 0066: create ico_slot_overrides

**Date:** 2026-08-28
**Type:** new table

## What this does

Lets an admin replace the icon shown in one specific *place* in the application by
uploading an SVG or image file, without changing the icon set anywhere else.

The first place wired up is the **Daily Quote card on the home screen**
(**Admin → Configuration → Icons → Icon positions**). With nothing uploaded the card
renders exactly as it did before — the active icon set's `quote` glyph — so this
migration changes nothing visible on its own.

| Column | Type | Notes |
|---|---|---|
| `slot_id` | `TEXT NOT NULL` | An id from `ICON_SLOTS`, e.g. `homescreen_card_daily_quote` |
| `set_id` | `TEXT NOT NULL` | Which icon set the override applies to |
| `svg_body` | `TEXT` (nullable) | Sanitized **inner** SVG markup; inlined, so it theme-tints |
| `svg_w` / `svg_h` | `REAL` (nullable) | The drawing's coordinate system, from its viewBox |
| `image_data` | `BLOB` (nullable) | Raster alternative; served by a route, never tints |
| `image_mime` | `TEXT` (nullable) | NULL alongside a NULL image |
| `updated_at` | `TEXT NOT NULL` | Cache-buster for the serving route |

Primary key `(slot_id, set_id)`. A `CHECK` enforces exactly one of the two payloads.
No seed rows, and no index beyond the primary key — see the comment at the foot of
the `.sql`.

## The concept this introduces: a slot

Before this, the binding between "a place in the app" and "an icon" was a string
literal at the call site — `<TreeIcon name="quote" />` in `daily-quote-widget.tsx`.
That worked, but it had two consequences:

1. **Nothing could enumerate it.** "Which icon does the Daily Quote card use?" was a
   grep, not a query, so no configuration screen could offer a list of icon positions.
2. **Overrides could only ever be per-concept.** `quote` is used by the home card *and*
   a Journal nav section, so changing "the quote icon" would necessarily change both.

A **slot** is a code-registered id for one position (`homescreen_card_daily_quote`)
that declares a **default concept** (`quote`). `ICON_SLOTS` in
[src/lib/icons/slots.ts](../src/lib/icons/slots.ts) is now the single queryable map of
where this app shows icons. Resolution runs:

```
override for (slot, active set)  →  the set's baked glyph for defaultConcept  →  hand-drawn fallback
```

The last two steps are what already happened, which is the point: **a slot nobody has
overridden is indistinguishable from the code that preceded it.** That is what allows
call sites to adopt slots one at a time rather than in one sweep, and it is why this
ships with a single slot wired up.

## Why `(slot_id, set_id)` and not `slot_id` alone

An override keyed only by slot would follow you across all thirteen icon sets — your
hand-drawn quote mark appearing amid Fluent 3D emoji as readily as amid Solar Bold
Duotone. Since a set is meant to be a coherent look, that would quietly undermine the
reason sets exist. Keying by both means switching sets shows that set's own art, and
re-skinning a slot in a second set is a second upload. That asymmetry is deliberate.

## Why SVG is stored as sanitized text, not as bytes

[src/lib/shared/image-upload.ts](../src/lib/shared/image-upload.ts) refuses SVG
outright, and documents why: the bytes are served from this app's own origin, so an SVG
carrying script is stored XSS. That reasoning holds for every existing image column,
where a route hands the file back verbatim.

This column is different because the markup is **inlined into the page**, and inlining
is exactly what a custom glyph needs — an inline SVG inherits `currentColor`, so it
tints to the theme accent like every built-in glyph does. A raster override on an
accent-coloured badge is a coloured blob.

So the file is never stored as uploaded. `sanitizeSvg`
([src/lib/icons/sanitize-svg.ts](../src/lib/icons/sanitize-svg.ts)) reduces it to an
**allowlist** of drawing elements and presentation attributes; `<script>`, `<style>`,
`<foreignObject>`, `<use>`, `<a>`, `<image>`, every `on*` handler and every
`href`/`xlink:href` are dropped, and only the surviving inner markup is written here.

An allowlist rather than a blocklist because a blocklist has to anticipate every
vector and ships broken if it misses one; an allowlist drops anything it was never
taught, including SVG features that don't exist yet. Worth noting that the `sandbox`
CSP headers in
[src/app/api/journal/icon-response.ts](../src/app/api/journal/icon-response.ts) do
**not** help here — those protect a file served as its own document, whereas inlined
markup runs in the page's context. Sanitizing on write is the only control that applies,
which is why it has 15 tests of its own, most of them hostile input.

Raster uploads still go through `decodeImageUpload` unchanged, capped at 256 KB.

## Rollback

```sql
DROP TABLE ico_slot_overrides;
```

Safe at any time. Every slot falls back to its default concept, which is the glyph it
showed before this feature existed.
