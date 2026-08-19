# 0053 — Register the Music Library module

Adds the `sys_modules` row for the module whose tables `0052` created, so it shows
on the home grid and the app bar and becomes grantable per user.

Kept as its own numbered migration rather than folded into `0052`, per the recipe in
`modules.md`: the tables and the module's *registration* are separate concerns, and
the seed is the thing that must stay in step with `DEFAULT_MODULES`.

| Field | Value |
|---|---|
| Slug | `music-library` |
| Short name | `Music Library` |
| Long name | `My Music Library` |
| Description | `Browse and stream your music collection.` |
| Sequence | 7 |
| Icon | `heart` |

**Slug.** `music-library` rather than `music`. It is hardcoded as a constant in the
route files and ends up in bookmarks, so `modules.md` treats a slug as permanent in
practice; matching the display name keeps `/modules/music-library` self-explanatory.

**Sequence 7** is the next unused integer. 1 remains vacant — it belonged to the
retired Real Estate module, along with the `rei_` prefix, which must not be reused.

**Icon `heart`** is a compromise and worth recording as one. The right glyph is a
music note, but `MODULE_ICON_NAMES` has none, and adding a concept means drawing it
for the "classic" set *and* naming candidates across all 12 sets in
`scripts/gen-icon-glyphs.mjs` — a missing module glyph is fatal there by design,
since the toolbar has no fallback artwork. `heart` is unused by any other module, so
this creates no confusing collision. Adding a real music glyph is a clean follow-up.

Also mirrored in `src/lib/modules/defaults.ts`. That duplication is not redundancy to
be tidied away: the seed builds a fresh database, and `DEFAULT_MODULES` is what admin
"Reset to Default" restores from — a module missing there vanishes the first time
anyone resets.
