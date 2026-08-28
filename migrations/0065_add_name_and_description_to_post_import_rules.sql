-- A post-import rule gains a human name and a longer description.
--
-- Until now a rule was identified by its glob pattern, so the clean-up log read
-- `rule "*TGI*" used` and the rule list showed the same. A pattern says what a
-- rule matches, never why it exists, and the two are not the same thing:
-- "*TGI*" doesn't tell you it's there because the card prints TGI Friday's under
-- three different names.
--
-- name is required going forward (enforced by the zod schema, as the rest of
-- this module's invariants are). description stays optional.
ALTER TABLE exp_post_import_rules ADD COLUMN name        TEXT NOT NULL DEFAULT '';
ALTER TABLE exp_post_import_rules ADD COLUMN description TEXT NOT NULL DEFAULT '';

-- Back-fill: an existing rule is named after the pattern it already carried.
-- That is what identified it in the UI before this migration, so every old rule
-- keeps reading exactly as it did — and, more importantly, no existing rule is
-- left with a blank name that the now-required field would refuse on next edit.
--
-- TRIM guards the one case the default would otherwise survive: a pattern that
-- is only whitespace can't stand in as a name.
UPDATE exp_post_import_rules
SET name = TRIM(pattern)
WHERE TRIM(name) = '' AND TRIM(pattern) <> '';

-- No unique index on name. Names are for humans; priority and id already order
-- and identify rules, so two rules may share a name.
