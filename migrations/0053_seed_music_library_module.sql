-- Registers the Music Library module so it appears on the home grid and app bar.
-- Mirrored in src/lib/modules/defaults.ts (DEFAULT_MODULES) — keep both in sync,
-- since "Reset to Default" restores the table from that list.
--
-- Icon is 'heart' from MODULE_ICON_NAMES: there is no music glyph in the set, and
-- adding one is not a one-line change (it must be hand-drawn for the classic set
-- and named in candidate maps for all 12 generated sets, or scripts/gen-icon-glyphs.mjs
-- fails by design). Nothing else uses 'heart', so there is no confusing collision.
-- A proper music note is worth doing as its own deliberate change — see
-- migrations/0050_journal_and_roster_module_icons.md for what that involves.
INSERT INTO sys_modules (slug, short_name, long_name, description, sequence, is_visible, icon)
VALUES ('music-library', 'Music Library', 'My Music Library', 'Browse and stream your music collection.', 7, 1, 'heart');
