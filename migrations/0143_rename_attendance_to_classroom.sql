-- Rename the Attendance module to Classroom.
--
-- Slug `attendance` -> `classroom`, and the display names with it. Attendance
-- becomes a section *group* inside Classroom rather than a module of its own,
-- alongside a second group for Exam. The nav tree is two levels deep by design
-- (src/lib/navigation/types.ts), so a module cannot contain a module — the same
-- shape Household uses for Recipes + HSA Tracker.
--
-- This UPDATEs the existing row rather than inserting a new module and deleting
-- the old one. That is deliberate: `sys_user_module_access` is keyed by
-- `module_id`, so a rename preserves every user's access grant where an
-- insert/delete would revoke it from everyone.
--
-- Every UPDATE is scoped by the old value so a re-run is a no-op and an admin who
-- has already retitled the module by hand is left alone.
--
-- The att_ -> cls_ table rename is NOT here: a numbered migration would crash a
-- fresh install, because migrations 0047, 0051, 0080, 0082 and 0092 already emit
-- the att_ names. It lives in LEGACY_TABLE_RENAMES in scripts/migrate.ts.
-- See the .md log beside this file.

-- `icon` is deliberately left alone: the module keeps `roster`, which
-- MODULE_ICON_NAMES describes as "a class register" and which fits Classroom at
-- least as well as it fitted Attendance. There is no `classroom` module icon, and
-- adding one would mean naming it in all eleven icon sets (a missing module
-- concept is fatal in scripts/gen-icon-glyphs.mjs) for no visible gain.
UPDATE sys_modules
SET slug = 'classroom',
    short_name = 'Classroom',
    long_name = 'Classroom',
    description = 'Attendance registers and exams.'
WHERE slug = 'attendance';

-- The texture table is keyed by slug, so the module's backdrop would be orphaned
-- without this.
UPDATE sys_module_texture
SET module_slug = 'classroom'
WHERE module_slug = 'attendance';

-- Anyone who set Attendance as their startup module would land on a 404 after the
-- rename. `sys_user_preferences` stores this as a key/value row, not a column.
UPDATE sys_user_preferences
SET preference_value = 'classroom'
WHERE preference_key = 'favorite_module_slug' AND preference_value = 'attendance';
