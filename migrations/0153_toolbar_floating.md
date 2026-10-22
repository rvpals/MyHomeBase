# Migration 0153: a floating personal toolbar

**Date:** 2026-10-20
**Type:** CHECK constraint change (copy-rename-drop on `sys_toolbars`)

## What this does

Adds a fifth value to `sys_toolbars.edge` — `floating` — for a toolbar that sits
**over** the page at a position each reader drags for themselves, instead of being
docked to a screen edge.

| Object | Change |
|---|---|
| `sys_toolbars.edge` | `CHECK` widened from `('top','bottom','left','right')` to `('top','bottom','left','right','floating')` |

No new table, no new 3-letter prefix, no new column, and nothing in `DEFAULT_MODULES`
changes — this is a display setting on chrome that already exists.

## Why this needs a table rebuild

SQLite cannot alter a `CHECK` in place. `coding-guide.md` reserves copy-rename-drop for
exactly this, and 0126 and 0127 both did it on the sibling `sys_toolbar_items` table for
the same reason. The additive `ALTER TABLE` form that 0130 used is only available for a
*new* column.

Unlike 0127, **no rows are deleted and none are converted**. This widens the set rather
than narrowing it, so every value already stored is still legal.

## Why `floating` is a fifth `edge` value and not an `is_floating` column

An additive boolean column would have avoided the rebuild, and it was the cheaper
migration. It was not taken, because a bar is in exactly one place and these are the
five places.

A boolean beside `edge` leaves `edge` meaningless-but-still-set on a floating bar: two
columns that can disagree, with no answer to "which wins" that is not a convention
someone has to remember and that every new call site can get wrong. The renderer already
switches exhaustively on `edge`, and `occupiedEdges` already derives the reserved page
space from it — one closed set keeps both correct by construction, where a second field
would need every one of those call sites to consult it too.

A rebuild once is cheaper than a second source of truth forever.

## Why `id` is carried across explicitly

Not cosmetic, and the one way this migration could lose data if written carelessly.

A reader's `toolbars_hidden` list and their new `toolbar_positions` entry both live in
`sys_user_preferences` — which this migration does not touch — and both address toolbars
**by id**. If the copy let SQLite reassign ids, every reader's hide list and every saved
position would silently re-point at a different bar. The `INSERT ... SELECT` names `id`
first for that reason.

## Why the reader's x/y is not a column here

It is a `toolbar_positions` preference in `sys_user_preferences`, keyed by reader, in the
same shape as the existing `toolbars_hidden` and `nav_expanded_modules` values:

```
<toolbarId>:<x>,<y>;<toolbarId>:<x>,<y>
```

This is the split 0125 already made for `is_visible` (the admin's switch) versus the
`toolbars_hidden` list (the reader's own). `sys_toolbars` is the **administrator's**
table: which bars exist, and how each one looks. *Where a bar sits on my screen* is mine,
exactly as *whether it is on my screen at all* is mine.

A column here would mean one person dragging a bar moves it for the entire household —
the precise behaviour the ownership split exists to prevent. It would also be wrong on
its face: two readers on different screen sizes cannot share one pixel position.

A malformed or stale entry is **dropped on parse**, not thrown on — the rule
`parseHiddenToolbars` and `parseEnabledFloating` both already follow. A deleted toolbar
leaves its id behind in every reader's row, and a screen that crashed on a stale entry
would be unfixable through the UI, which is the one place you would go to fix it.

## Why a floating toolbar is still not a floating component

`design.md` closes the `FLOATING_COMPONENTS` list, and this deliberately does not join
it.

That list is for self-contained accessories that own a window and a puck — the clock, the
calculator, now-playing — and each gets its own reader-facing on/off switch. A toolbar is
an **existing chrome surface gaining a placement**, and it already has a reader-facing
switch: the `toolbars_hidden` list on the Account screen. Registering it would give one
bar two separate switches that could disagree.

The rule that does still bind: nothing about *where you are* may float. That is unchanged
and unaffected — a toolbar carries shortcuts, never location, which is what `types.ts` has
said since 0125.

## Compact behaviour

A floating bar obeys `full_mode_only` exactly as a docked one does. When it **is** shown
on compact it stays draggable, parked by default above the section trigger and the music
player rather than at an arbitrary point — the bottom edge is already claimed there, and a
bar that opens underneath the player is a bar the reader cannot reach to drag.

## Rollback

```sql
-- Any bar left on 'floating' must come back to a real edge first, or the narrower
-- CHECK rejects it. 'bottom' is the closest docked equivalent to where most floating
-- bars end up parked.
UPDATE sys_toolbars SET edge = 'bottom' WHERE edge = 'floating';
```

…then re-run 0130's shape (the four-edge `CHECK`) through the same copy-rename-drop.

Safe in the sense that matters: toolbars are additive chrome, so the worst outcome is a
bar that goes back to being docked. No navigation is affected, and no reader's visibility
preference is touched. Stale `toolbar_positions` entries left behind are ignored by the
parser rather than erroring.
