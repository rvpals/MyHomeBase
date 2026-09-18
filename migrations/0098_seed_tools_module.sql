-- Registers the Tools module so it appears on the home grid and app bar.
-- Mirrored in src/lib/modules/defaults.ts (DEFAULT_MODULES) — keep both in sync,
-- since "Reset to Default" restores the table from that list.
INSERT INTO sys_modules (slug, short_name, long_name, description, sequence, is_visible, icon)
VALUES ('tools', 'Tools', 'Tools & Utilities', 'This module list all the utilities and tools', 10, 1, 'tool');
