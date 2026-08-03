-- Post-import processing: transactions gain a cleaned-up vendor name and a
-- processed flag, and the rules engine grows from "set a category (and maybe a
-- status)" to "set any number of fields".
--
-- A rule is now one condition plus many assignments, so the old category_name /
-- apply_status columns no longer fit on the rule row. The table is replaced
-- rather than altered — SQLite can't drop columns cleanly on older versions, and
-- the new name stops the schema claiming these are only category rules.

-- 1. New transaction columns ---------------------------------------------------
-- Existing rows get processed = 0, so the first clean-up run applies the rules
-- to the whole back catalogue. That's intended: it's how history gets vendors.
ALTER TABLE exp_transactions ADD COLUMN vendor TEXT NOT NULL DEFAULT '';
ALTER TABLE exp_transactions ADD COLUMN processed INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_exp_transactions_processed ON exp_transactions (processed);

-- 2. The rule itself: just the condition ---------------------------------------
CREATE TABLE exp_post_import_rules (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern    TEXT    NOT NULL,           -- glob, case-insensitive: *TGI*, AMAZON*
  priority   INTEGER NOT NULL DEFAULT 0, -- lowest number wins when several match
  is_enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_exp_post_import_rules_priority ON exp_post_import_rules (priority, id);

CREATE TRIGGER exp_post_import_rules_set_updated_at
AFTER UPDATE ON exp_post_import_rules
FOR EACH ROW
BEGIN
  UPDATE exp_post_import_rules SET updated_at = datetime('now') WHERE id = old.id;
END;

-- 3. What a matching rule sets --------------------------------------------------
-- field_name is validated in the zod schema (categoryName | vendor | status |
-- note) rather than by a CHECK, keeping the allowlist in one place in code.
CREATE TABLE exp_post_import_rule_actions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id     INTEGER NOT NULL,          -- -> exp_post_import_rules.id
  field_name  TEXT    NOT NULL,
  field_value TEXT    NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_exp_post_import_rule_actions_rule ON exp_post_import_rule_actions (rule_id);

-- 4. Carry existing rules across -------------------------------------------------
-- Ids are preserved so nothing that referenced a rule is orphaned.
INSERT INTO exp_post_import_rules (id, pattern, priority, is_enabled, created_at, updated_at)
SELECT id, pattern, priority, is_enabled, created_at, updated_at FROM exp_category_rules;

INSERT INTO exp_post_import_rule_actions (rule_id, field_name, field_value, sort_order)
SELECT id, 'categoryName', category_name, 0
FROM exp_category_rules
WHERE TRIM(category_name) <> '';

INSERT INTO exp_post_import_rule_actions (rule_id, field_name, field_value, sort_order)
SELECT id, 'status', apply_status, 1
FROM exp_category_rules
WHERE TRIM(apply_status) <> '';

-- Dropping the table takes its index and trigger with it.
DROP TABLE exp_category_rules;
