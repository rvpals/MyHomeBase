# Migration 0161: a recycle bin for Clips

**Date:** 2026-10-28
**Type:** six new tables (`clp_recycled_clips` + five child mirrors)

## What this does

Deleting a clip now **moves it to a bin** instead of destroying it. A new
Clips → Recycled Clips section lists what is in the bin and offers restore,
delete-forever, and empty-bin.

Before this, `clips-main-view.tsx` asked *"Delete this clip? This cannot be
undone."* and meant it — a clip is the only copy of whatever was pasted into it,
and one stray click took it. That confirmation is now a recycle, and the
irreversible step moved behind the bin.

| Table | Mirrors |
|---|---|
| `clp_recycled_clips` | `clp_clips` |
| `clp_recycled_clip_categories` | `clp_clip_categories` |
| `clp_recycled_clip_tags` | `clp_clip_tags` |
| `clp_recycled_clip_images` | `clp_clip_images` (bytes included) |
| `clp_recycled_clip_items` | `clp_clip_items` |
| `clp_recycled_clip_links` | `clp_clip_links` |

## Why mirror tables and not a `deleted_at` flag on `clp_clips`

A flag is the smaller migration and the worse design. Every existing read in this
module — the list, the board, the filter chips, the journal's link count, the
taxonomy usage counts, `idx_clp_clips_pinned_updated` — would have to learn to
exclude binned rows, and **one missed `WHERE` silently serves a deleted clip** as
though nothing happened.

A separate table cannot be read by accident: code that does not name it cannot see
a binned clip. That is the same reasoning migration 0079 recorded for
`jrn_recycled_entries`, and this bin is deliberately built to the same pattern so
a reader who knows one knows both.

## Why all six tables

A clip is not one row. Its categories, tags, images, checklist items and links
live in five child tables. A bin that copied only `clp_clips` would restore a clip
stripped of its taxonomy, its pasted screenshots and its checklist — silent data
loss wearing a safety feature's clothes, which is what 0079 says about the
journal.

## The images are copied, bytes and all

The one expensive decision here. Copying the BLOBs doubles a clip's stored bytes
for as long as it sits in the bin.

The cheaper alternative — leaving the rows in `clp_clip_images`, orphaned,
pointing at a clip that no longer exists — was rejected because
`/api/clips/images/[id]` serves **by image id alone**. A deleted clip's
screenshots would stay live at a guessable URL, and "delete" would not have
deleted the thing most worth deleting. Bytes are cheap; a delete that does not
delete is not. Purging reclaims the space.

## Sealed clips stay sealed

The encryption columns travel with the clip. Leaving them out would bin the
blanked `title`/`content_html` and drop the ciphertext, so a restored clip would
be unreadable forever with nothing to say why — the gap 0131 had to close for the
journal's bin after the fact.

A sealed clip is binned sealed and comes back sealed, still needing its password.
**The bin is not a way around the password**, and the bin's list shows
"(encrypted)" exactly as every other clips screen does.

## Restore aims at the original id

`clp_recycled_clips.clip_id` remembers the id the clip had. Restore reinserts at
that id when it is still free, which is what keeps an existing `clp_clip_links`
row — and the journal badge it draws — working across a delete and a restore. When
the id has been taken since, the restore takes a fresh one and the link is left
pointing at nothing, which this module already renders as *"the linked record is
gone"* rather than treating as an error.

Links are binned with the clip and restored as they were, rather than dropped. A
clip coming back detached from the entry it was filed against is a worse answer
than a stale link the reader can see.

## `is_pinned`, `card_color` and `done_at` are carried

All three are things a person deliberately set. `done_at` matters mechanically as
well: `src/lib/clips/board.ts` orders the completed half of a checklist by it, so
dropping it would reshuffle a restored clip's list for no reason the reader can
see.

## Not in this migration

- **No auto-purge.** The bin is emptied by hand, matching the journal's. No
  scheduled job, no age limit.
- **No `DEFAULT_MODULES` change.** Clips is already registered; this adds a
  section, not a module.
- **No new settings row.** Nothing here is configurable.

## Rollback

```sql
DROP TABLE clp_recycled_clip_links;
DROP TABLE clp_recycled_clip_items;
DROP TABLE clp_recycled_clip_images;
DROP TABLE clp_recycled_clip_tags;
DROP TABLE clp_recycled_clip_categories;
DROP TABLE clp_recycled_clips;
```

Anything sitting in the bin is lost with it — that is what rolling back a bin
means. Restore what matters before dropping.
