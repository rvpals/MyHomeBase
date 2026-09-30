-- Registers the Household module so it appears on the home grid and app bar.
-- Mirrored in src/lib/modules/defaults.ts (DEFAULT_MODULES) — keep both in sync,
-- since "Reset to Default" restores the table from that list.
INSERT INTO sys_modules (slug, short_name, long_name, description, sequence, is_visible, icon)
VALUES ('household', 'Household', 'Household', 'Recipes, receipts and the HSA — the household''s paperwork.', 11, 1, 'household');
