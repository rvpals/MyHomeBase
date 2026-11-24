# 0179 — Seed the Code Library module

Registers `code-library` in `sys_modules` so it appears on the home grid and in
the navigation tree. The tables it uses were created in
`0178_create_code_library.sql`.

A separate, later-numbered migration from the table creation, following
`0156_seed_clips_module.sql` and `0160_seed_documents_module.sql`.

## Values

| Column | Value | Why |
|---|---|---|
| `slug` | `code-library` | Permanent in practice — it is in bookmarks, in `DEFAULT_MODULES`, and duplicated as a constant across the route and action files. Renaming one needs a migration; `0108` is the worked example. |
| `sequence` | 14 | Next unused integer; 13 is the Document Library. Sequence 1 stays vacant (retired Real Estate module). |
| `icon` | `book` | See below. |
| `is_visible` | 1 | |

## Why `book`

`book` is already in `MODULE_ICON_NAMES` and was not used by any module, so this
introduces no glyph work and no collision.

Adding a `code` concept instead is not a one-line change: it has to be drawn by
hand for the classic set *and* named in the candidate maps for all twelve sets in
`scripts/gen-icon-glyphs.mjs`, because a missing module glyph is fatal there by
design — the toolbar has no fallback artwork. `modules.md` says to reach for a new
concept only when two modules would otherwise share one and the collision confuses.

Of the existing names, `folder` is already shared by three modules (CSV Analysis,
Clips and the Document Library) and `tool` belongs to Tools & Utilities. A library
of snippets is a library, so `book` is a real fit rather than a placeholder. A later
migration can swap it the way `0055` and `0085` did for Music Library and Picture
Gallery.

## Access

A freshly seeded module is granted to nobody. Admins bypass `sys_user_module_access`
by role, so an existing admin account needs no backfill; every other user needs the
grant adding in Administration → User Management, or the module 404s for them.
