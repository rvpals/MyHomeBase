-- Registers the Games module so it appears on the home grid and app bar.
-- Mirrored in src/lib/modules/defaults.ts (DEFAULT_MODULES) — keep both in sync,
-- since "Reset to Default" restores the table from that list.
--
-- Icon is 'game', a new concept added to MODULE_ICON_NAMES in this same change:
-- hand-drawn for the classic set in src/components/module-icons.tsx and named in
-- the candidate maps for all 12 generated sets in scripts/gen-icon-glyphs.mjs.
-- Unlike Music Library (0053, which borrowed 'heart' until 0055), this one ships
-- with its real glyph rather than a placeholder — every installed icon package was
-- checked to have a genuine gamepad, so no set falls back to a keyword guess.
INSERT INTO sys_modules (slug, short_name, long_name, description, sequence, is_visible, icon)
VALUES ('games', 'Games', 'Games & Puzzles', 'Play a quick game and keep a high-score board.', 8, 1, 'game');
