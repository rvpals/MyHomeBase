# Migration 0084: seed the Picture Gallery module

**Date:** 2026-09-09
**Type:** data-only (no schema change — `sys_modules` already exists)

## What this does

Adds the `picture-gallery` row to `sys_modules` so the Picture Gallery module
appears on the home grid and in the app bar for users granted access.

| Field | Value |
|---|---|
| `slug` | `picture-gallery` |
| `short_name` | Picture Gallery |
| `long_name` | My Picture Gallery |
| `description` | Browse the photo archive and the pictures you have kept. |
| `sequence` | 9 (after Games, which is 8) |
| `is_visible` | 1 |
| `icon` | `heart` (from `MODULE_ICON_NAMES`) |

## Why this module owns no table

Unusually for a module, this one adds **no table and no prefix**. It presents
photographs that already exist elsewhere: the archive itself is a folder on the
photo share (configured in the Journal module, read through
`src/lib/journal-photos`), and the kept pictures are `fav_photos`, created in
migration 0073. A module that stored a third copy of either would be a
synchronisation problem invented for its own sake.

It follows that Picture Gallery has no library module of its own under
`src/lib/`. Its two sections are presentation over `journal-photos` and
`fav-photos`, both already tested where they live.

## The icon is a placeholder — resolved in 0085

`MODULE_ICON_NAMES` is a fixed enum with no photography glyph in it — the closest
available is `heart`, which is what this row uses. That is the same borrowing
Music Library did in 0053 before gaining a real glyph in 0055, and it should be
resolved the same way: adding a `photo` name means a hand-drawn component in
`module-icons.tsx` **and** regenerating all thirteen sets in
`module-icon-sets.generated.ts`, which is a change worth making on its own rather
than folded into seeding a module. Until then the module wears a heart, which at
least reads as "the pictures you kept".

**This was done in `0085_picture_gallery_photo_icon`**, which added a `photo` concept
and repointed this row at it. The paragraph above is left as written because it records
why the row was seeded the way it was.

Changing it later is an admin edit, not a migration.

## What moved here

The **Random Photo** card was previously a home-screen widget on `/`, and the
**Favorite photos** list was a standalone screen at `/favorite-photos` belonging
to no module. Both now live under this module, as its two sections.

No migration is needed for either move:

- The home screen's card list is the `home_widgets` app setting (migration 0067),
  and `resolveHomeWidgets` **drops an id that is no longer a card**. Retiring
  `randomPhoto` from the catalogue is therefore a code change only — a saved
  layout naming it is cleaned up on read.
- `/favorite-photos` keeps working as a route; it is not deleted.

The card's icon slot id, `homescreen_card_random_photo`, is **deliberately
unchanged** despite the card no longer being on the home screen. Slot ids are
permanent once an upload exists against them, and renaming this one would
silently orphan any icon a user had already uploaded for it. Only its group and
`where` copy moved.

Mirrored in `src/lib/modules/defaults.ts` (`DEFAULT_MODULES`) — both must stay in
sync, because "Reset to Default" on the Module Configuration screen restores the
table from that list, and a module missing there would be silently dropped.

Access is not granted automatically: admins see every module, and other users
need the module assigned in User Management.

## Rollback

```sql
DELETE FROM sys_modules WHERE slug = 'picture-gallery';
```
