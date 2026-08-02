-- Registers the Expense module so it appears on the home grid and sidebar.
-- Mirrored in src/lib/modules/defaults.ts (DEFAULT_MODULES) — keep both in sync,
-- since "Reset to Default" restores the table from that list.
INSERT INTO sys_modules (slug, short_name, long_name, description, sequence, is_visible, icon)
VALUES ('expense', 'Expense', 'Expense Tracker', 'Track credit-card spending by category.', 5, 1, 'wallet');
