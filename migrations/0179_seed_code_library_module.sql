-- Registers the Code Library module so it appears on the home grid and in the
-- navigation. Mirrored in src/lib/modules/defaults.ts (DEFAULT_MODULES) — keep both
-- in sync, since "Reset to Default" restores the table from that list.
--
-- Sequence 14: the next unused integer (13 is the Document Library). Sequence 1
-- stays vacant — it belonged to the retired Real Estate module, per modules.md.
--
-- Icon `book`, which is in MODULE_ICON_NAMES and was not yet used by any module.
-- A `code` glyph would have to be hand-drawn for the classic set and named in the
-- candidate maps for all twelve generated sets in scripts/gen-icon-glyphs.mjs, or
-- generation fails outright — that is its own job with its own migration, exactly
-- as Music Library (0053 -> 0055) and Picture Gallery (0085) each needed one.
--
-- `book` is also the better fit than the obvious alternatives: `folder` is already
-- carrying three modules (CSV Analysis, Clips and the Document Library) and
-- `tool` belongs to Tools & Utilities. A library of snippets is a library.
INSERT INTO sys_modules (slug, short_name, long_name, description, sequence, is_visible, icon)
VALUES (
  'code-library',
  'Code Library',
  'Code Library',
  'Reusable code snippets, filed by language and kept as plain text.',
  14,
  1,
  'book'
);
