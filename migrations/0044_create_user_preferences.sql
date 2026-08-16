-- Per-user preferences. Unlike sys_app_settings (0002) and sys_module_settings
-- (0006), which are both shared by every user, a value here belongs to one
-- account: two people using the same install get different answers from the
-- same key. The first two keys are `favorite_module_slug` and
-- `open_favorite_module_on_startup`, which together let someone land straight
-- in the module they actually use instead of the home screen.
--
-- Shaped after sys_module_settings (0006) rather than sys_app_settings (0002):
-- the owner has to be part of the identity, so the key alone can't be the
-- primary key. UNIQUE (user_id, preference_key) makes a save a single
-- upsert-by-key, the same shape module settings and jrn_saved_filters (0043)
-- already use, and it doubles as the lookup index for "one preference for this
-- user". The separate user_id index serves the list-them-all read, which is how
-- the account screen and the home page both fetch (one query, resolved into a
-- typed object in code).
--
-- Key/value rather than one column per preference, matching both existing
-- settings tables: a new preference is then a new key and a field on the
-- resolver, with no migration at all. The cost is that values are TEXT and
-- typing happens in code — `resolveUserPreferences` in
-- src/lib/user-preferences owns that coercion, and the zod schema guards the
-- write, so no caller parses a raw row.
--
-- preference_value is TEXT NOT NULL, so "no favorite module" stores the empty
-- string, not NULL — the same sentinel STARTUP_MESSAGE uses (0041), for the
-- same reason: relaxing NOT NULL in SQLite means a full create-copy-drop-rename
-- rebuild for no behavioural gain. The mapping from blank to `undefined`
-- happens once, in the use-case; callers never compare against "".
--
-- No DB-level foreign key, per project convention. That leaves an obligation in
-- code rather than in SQL: deleting a user must delete these rows too, which
-- SqliteUserRepository.deleteUser does in the same transaction it already uses
-- to clear sys_user_module_access.
CREATE TABLE sys_user_preferences (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL, -- -> sys_users.id
  preference_key   TEXT    NOT NULL,
  preference_value TEXT    NOT NULL,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, preference_key)
);

CREATE INDEX user_preferences_user_id_idx ON sys_user_preferences (user_id);

CREATE TRIGGER sys_user_preferences_set_updated_at
AFTER UPDATE ON sys_user_preferences
FOR EACH ROW
BEGIN
  UPDATE sys_user_preferences SET updated_at = datetime('now') WHERE id = old.id;
END;
