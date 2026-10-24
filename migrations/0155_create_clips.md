# Migration 0155: the Clips module's tables

**Date:** 2026-10-23
**Type:** seven tables created, with their indexes and triggers

## What this does

Creates the `clp_` namespace and the seven tables behind the Clips module: rich-text
notes that stand on their own, carry categories and tags, hold pasted images, and can
be referenced from a journal entry.

| Table | Holds |
|---|---|
| `clp_clips` | The clip itself — title, sanitized HTML body, encryption columns |
| `clp_categories` | Managed category list, each with an optional icon |
| `clp_tags` | Managed tag list, same shape |
| `clp_clip_categories` | Clip ↔ category pairings |
| `clp_clip_tags` | Clip ↔ tag pairings |
| `clp_clip_images` | Pasted images, as BLOBs |
| `clp_clip_links` | A clip attached to a record in another module |

## Why a new prefix

Clips are not a Journal feature. The Journal is one of several things a clip can be
attached to, and the module is reachable, searchable and taggable on its own — a clip
with no link at all is a normal clip. `coding-guide.md`'s rule decides it: a prefix is
a module namespace, so Clips takes `clp_`. It is also chosen to still fit the second
and third tables, which is the lesson `pho_` and `tol_` both record.

## The four decisions worth knowing

### 1. Images are BLOBs with a serving route, never inline base64

`content_html` references `/api/clips/images/<id>`. The bytes live in
`clp_clip_images`.

This is the one thing migration 0079 explicitly recorded when it dropped
`jrn_entry_images`, which stored attachments as inline base64 data URLs: base64
inflates the stored bytes by about a third, and it lands every image in every read of
the row. The BLOB-plus-route split is the app's established pattern — `exp_categories`
(0034), `inv_investment_accounts` (0037), `jrn_categories` (0042) — and migration 0042
spells out the payoff: the bytes never bloat a JSON payload and the browser can cache
them.

### 2. The body is stored sanitized, not raw

`sanitizeClipHtml` reduces pasted markup to an allowlist of elements and attributes
before the repository sees it. It is an **allowlist**, like
`src/lib/icons/sanitize-svg.ts` and unlike `src/lib/journal-reports/sanitize.ts` — and
the difference is deliberate. The report sanitizer says plainly that it is defence in
depth over a template the author wrote. A clip is **pasted from an email**, which is
the single most likely way for hostile markup to reach this app: the sender chose that
content, not the reader. So this is a real hostile-input boundary and it fails closed.

`style` attributes are dropped, which is the largest visible consequence — a pasted
email loses the sender's fonts, colours and widths and renders in this app's theme.
That is the intended trade, and it is also a security one: arbitrary inline CSS inside
this app's own pages can position things over the navigation or fetch a background
image from somewhere else.

### 3. Encryption mirrors the Journal, with one difference that matters

The four columns (`is_encrypted`, `title_encrypted`, `content_encrypted`,
`password_hint`) and their blob format are exactly migration 0131's, and the
implementation is now literally shared — `encryption.ts` was promoted from
`src/lib/journal/` to `src/lib/shared/` in this same change.

The taxonomy stays plaintext, for the same reason an entry's does: a sealed clip still
has to appear under its categories and tags.

**A journal entry belongs to one person; a clip is shared.** So the password is the
only gate — anyone who has it can open the clip, and anyone who forgets it loses the
clip *for everyone granted the module*. There is no recovery, no admin override, no
reset. The UI states this before sealing anything.

### 4. The link is a table, one-directional, and never cascades

`clp_clip_links` rather than a `clip_id` column on `jrn_entries`, because touching
`jrn_entries` would drag in the recycle-bin mirror, the encryption columns and the ~16
action files naming the journal slug. A separate table also lets one clip support
several entries, which is the real case: one email thread can bear on two days.

The direction is one-way: a clip knows its targets, the Journal does not know clips
exist. That keeps `src/lib/journal` free of any dependency on `src/lib/clips`, which
would be the import cycle `ARCHITECTURE.md` forbids. The badge on a journal screen is
composed in the presentation layer, which may read both.

**Deleting a journal entry never deletes a clip.** That is the module's central
promise — the whole point of pasting an email here rather than into the entry is that
it survives independently. Two sub-cases:

- **Deleted and restored.** `restoreRecycledEntries`
  (`src/lib/journal/repository.ts`) reinserts at the **original** id precisely so
  existing references keep working, falling back to a fresh id only when that id has
  been taken. So a link normally reconnects by itself.
- **Deleted for good, or restored under a fresh id.** The link is left pointing at
  nothing. The viewer renders that as "the linked record is gone" — a normal state
  here, not an error, and explicitly not a reason to remove the clip.

## `target_module` is an enum in code, plain TEXT here

The same choice migration 0142 made for `sys_messages.module`: the set of linkable
modules is a fixed zod enum validated at the boundary, not a lookup against
`sys_modules`. An unknown value fails loudly at the edge instead of being stored and
discovered later by a join that quietly returns nothing. `journal` is the only member
today; adding another means adding it to `CLIP_LINK_MODULES`, not to a table.

## Indexes

- `idx_clp_clips_updated` — the list's only ordering, newest-touched first. The `id`
  tiebreaker is not optional: two clips saved in the same second are ordinary, and
  without it tied rows come back in an order that appears to shuffle between renders.
- `idx_clp_clip_links_unique` — makes "attach" idempotent, so pressing it twice is a
  no-op rather than a second row.
- `idx_clp_clip_links_target` — the journal's read, counting clips across a whole page
  of entries in one query rather than one per row.
- The `COLLATE NOCASE` unique indexes on both taxonomy tables keep the reader's own
  capitalisation while still refusing a near-duplicate, exactly as
  `sys_scratchpad_categories` does (0096).

## No date column is in a unique index

Per `coding-guide.md`. The unique indexes here are over ids and names only.

## What is NOT changed

Nothing existing. Every table is new, and no column is added to or removed from any
other module's tables — the Journal in particular is untouched by this migration.
