-- Remove the Real Estate Investment module entirely (core real estate + property watch).
-- Idempotent: IF EXISTS on drops, and the DELETEs are naturally no-ops on a fresh install.

DROP TABLE IF EXISTS rei_property_snapshots;
DROP TABLE IF EXISTS rei_watched_properties;
DROP TABLE IF EXISTS rei_properties;

-- Clean up the module registration and its dependent rows (no DB-level FKs, so manual).
DELETE FROM sys_module_settings
  WHERE module_id IN (SELECT id FROM sys_modules WHERE slug = 'real-estate-investment');
DELETE FROM sys_user_module_access
  WHERE module_id IN (SELECT id FROM sys_modules WHERE slug = 'real-estate-investment');
DELETE FROM sys_modules WHERE slug = 'real-estate-investment';
