-- Rename the Stocks & ETFs module to Investments.
--
-- Slug `stock-etfs` -> `investments`, and the display names with it. Every
-- UPDATE is scoped by the old value so a re-run is a no-op and an admin who has
-- already retitled the module by hand is left alone.
--
-- The `stk_` -> `inv_` table rename is NOT here: a numbered migration would
-- crash a fresh install, because the historical CREATE migrations already emit
-- the `stk_` names. It lives in LEGACY_TABLE_RENAMES in scripts/migrate.ts.
-- See the .md log beside this file.

UPDATE sys_modules
SET slug = 'investments',
    short_name = 'Investments',
    long_name = 'Investments',
    description = 'Manage stock, ETF and fund investments.'
WHERE slug = 'stock-etfs';

-- The texture table is keyed by slug, so the module's backdrop would be orphaned
-- without this.
UPDATE sys_module_texture
SET module_slug = 'investments'
WHERE module_slug = 'stock-etfs';

-- Anyone who set Stocks & ETFs as their startup module would land on a 404 after
-- the rename. `sys_user_preferences` stores this as a key/value row, not a column.
UPDATE sys_user_preferences
SET preference_value = 'investments'
WHERE preference_key = 'favorite_module_slug' AND preference_value = 'stock-etfs';
