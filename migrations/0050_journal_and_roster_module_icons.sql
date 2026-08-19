-- Repoints the Journal and Attendance module icons off the shared `book` glyph.
--
-- Both modules seeded with `book` (0012 and 0048), so they were visually identical in
-- the app bar and on the home grid. `journal` is a bound journal with a quill and
-- `roster` is a class register — two new concepts added to MODULE_ICON_NAMES.
--
-- Mirrored in src/lib/modules/defaults.ts (DEFAULT_MODULES) — keep both in sync, since
-- "Reset to Default" restores the table from that list.
--
-- Scoped by slug AND by the old value: if someone has already picked a different icon
-- for either module, that choice is theirs and this migration leaves it alone.
UPDATE sys_modules SET icon = 'journal' WHERE slug = 'journal' AND icon = 'book';
UPDATE sys_modules SET icon = 'roster' WHERE slug = 'attendance' AND icon = 'book';
