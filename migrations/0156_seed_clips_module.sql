-- Registers the Clips module so it appears on the home grid and in the navigation.
-- Mirrored in src/lib/modules/defaults.ts (DEFAULT_MODULES) — keep both in sync,
-- since "Reset to Default" restores the table from that list.
--
-- Sequence 12: the next unused integer (11 is Household). Sequence 1 stays vacant —
-- it belonged to the retired Real Estate module, per modules.md.
--
-- Icon `folder`, not a new `clip` glyph. Adding a name to MODULE_ICON_NAMES means
-- drawing it in all twelve generated icon sets, because a missing module concept is
-- fatal in gen-icon-glyphs.mjs — that is its own job with its own migration, exactly
-- as Music Library (0053 -> 0055) and Picture Gallery (0085) each needed one. This
-- seeds a real existing glyph rather than a placeholder that would crash generation,
-- and a later migration can swap it the way 0055 and 0085 did.
INSERT INTO sys_modules (slug, short_name, long_name, description, sequence, is_visible, icon)
VALUES (
  'clips',
  'Clips',
  'Clips',
  'Rich-text notes with tags and pasted images, linkable to a journal entry.',
  12,
  1,
  'folder'
);
