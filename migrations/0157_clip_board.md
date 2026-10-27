# Migration 0157: the Clips board — pinning, card colour, checklist items

**Date:** 2026-10-25
**Type:** two columns added to `clp_clips`, one index swapped, one new table

## What this does

Turns Clips from a list into a board. Three additions that ship as one screen:

| Change | Where |
|---|---|
| `is_pinned` | `clp_clips`, new column |
| `card_color` | `clp_clips`, new column |
| checklist items | `clp_clip_items`, new table |
| board ordering | `idx_clp_clips_pinned_updated` replaces `idx_clp_clips_updated` |

They are one migration because they are one feature. A board that could not pin,
colour or hold a checklist is the list it already is, drawn in columns — shipping any
one of them alone would leave the other two as columns nothing reads.

## The excerpt length is **not** here

The board's per-card excerpt length is a preference, and preferences live in
`sys_module_settings` as key/value rows under the owning module — the same storage the
Journal's `photo_root` and Household's `hsa_receipt_root` use. Adding one needs no
migration at all, which is the point of that table.

Key `clips_excerpt_chars`, default 300, clamped 80–2000 at the boundary. It is read and
written by `src/lib/clips/settings.ts` and edited on Clips → Configuration, which until
now was a deliberate placeholder with nothing in it.

## Why checklist items are a table and not checkboxes in `content_html`

This is the load-bearing decision, so it is recorded here as well as in the `.sql`.

`sanitizeClipHtml` removes `<input>` **with its contents** and refuses `style`
outright. Both are deliberate — a clip body is pasted email, and a working form inside
this app's own origin is worse than one in a mail client. Storing checklists as
checkbox markup would mean reopening that allowlist, and failing closed is the only
reason it is defensible.

It is also wrong mechanically. Ticking a box would rewrite the whole `content_html`
column — a pasted email, potentially hundreds of kilobytes — on every click, re-running
the sanitizer each time, with the tick surviving only if that round trip happened to
preserve it.

So an item is a row and a tick is one `UPDATE`. A clip has both a body and items; the
card draws the body, then the items.

## Why `card_color` stores a key and never a hex

`design.md` forbids a literal colour anywhere structural. All nine theme tokens are
swappable at runtime and eight themes ship, two of them light — so a stored `#fecaca`
is a pink card in every theme, unreadable on Daybreak and wrong against every accent.

A stored `'rose'` is resolved to a tint built from the *current* theme's tokens, so a
coloured card recolours with the app. The seven keys (`default`, `rose`, `amber`,
`sage`, `ocean`, `indigo`, `slate`) are fixed in `src/lib/clips/schema.ts` and
validated by zod at the boundary — the same choice 0142 made for `sys_messages.module`
and 0155 for `clp_clip_links.target_module`.

**The keys are permanent, like an icon slot id.** They are written into this column on
every coloured clip, so renaming one silently blanks those cards back to default.

## Why `ALTER TABLE` and not copy-rename-drop

Both additions are simple additive columns with defaults, which need no rebuild — the
same call migration 0154 made adding `is_enabled` to `daily_quotes`. The rebuild
pattern in `coding-guide.md` is for changing an existing column or a CHECK constraint,
and neither happens here.

A rebuild would also be actively worse: it would drop the `clp_clips_set_updated_at`
trigger migration 0155 attached to this table and oblige this file to recreate it
correctly. `ALTER TABLE` leaves it in place.

## No backfill

Both columns default to the right answer for every existing row — `0` is unpinned and
`''` is uncoloured. A household upgrading sees exactly the clips it had yesterday, in
the same order.

## Pinning bumps `updated_at`

`clp_clips_set_updated_at` fires on any `UPDATE` to this table, so pinning a clip
touches its timestamp exactly as editing its body does. Intended, and consistent with
how 0154 left quote toggling — a pinned clip sorting to the front of its own half is
the behaviour the board wants anyway.

Ticking a checklist item does **not** bump it: the items are their own table with no
such trigger, so working through a checklist doesn't reshuffle the board under the
reader's hands.

## The index swap

`idx_clp_clips_pinned_updated` replaces `idx_clp_clips_updated` rather than joining it.
A leading `is_pinned DESC` still serves an unpinned-first read, so keeping both would
mean two indexes maintained on every write to serve one query.

## Both views get pinning

Pinning is in the repository's `ORDER BY`, not in a view, so the list and the board
inherit it from the same read — they cannot disagree about what is pinned or in what
order it comes back.
