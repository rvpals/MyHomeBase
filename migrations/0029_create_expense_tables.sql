-- Expense tracker module. Money is stored as INTEGER cents (never floats), the
-- same convention as the stk_*_cents columns. No DB-level foreign keys — the
-- repository maintains the links, per project convention.

-- Credit-card accounts a transaction can belong to.
CREATE TABLE exp_creditcard_accounts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT    NOT NULL,
  description       TEXT    NOT NULL DEFAULT '',
  credit_line_cents INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TRIGGER exp_creditcard_accounts_set_updated_at
AFTER UPDATE ON exp_creditcard_accounts
FOR EACH ROW
BEGIN
  UPDATE exp_creditcard_accounts SET updated_at = datetime('now') WHERE id = old.id;
END;

-- Editable category list. Keyed by name (the identity a transaction references),
-- same natural-key approach as jrn_categories.
CREATE TABLE exp_categories (
  name        TEXT PRIMARY KEY,
  description TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TRIGGER exp_categories_set_updated_at
AFTER UPDATE ON exp_categories
FOR EACH ROW
BEGIN
  UPDATE exp_categories SET updated_at = datetime('now') WHERE name = old.name;
END;

-- One card transaction. Exactly one category per transaction; blank means
-- "not categorised yet", which is how imported rows arrive.
CREATE TABLE exp_transactions (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_date        TEXT    NOT NULL,               -- YYYY-MM-DD
  posting_date            TEXT    NOT NULL DEFAULT '',    -- blank when the statement omits it
  transaction_account_id  INTEGER NOT NULL,               -- -> exp_creditcard_accounts.id
  transaction_description TEXT    NOT NULL DEFAULT '',    -- raw vendor text; the fuzzy-match input
  category_name           TEXT    NOT NULL DEFAULT '',    -- -> exp_categories.name; '' = uncategorised
  amount_cents            INTEGER NOT NULL DEFAULT 0,     -- charges positive, credits/refunds negative
  note                    TEXT    NOT NULL DEFAULT '',    -- added by the user later
  status                  TEXT    NOT NULL DEFAULT 'new', -- new | reconciled | irreconcilable
  created_by_user_id      INTEGER NOT NULL,               -- -> sys_users.id
  created_at              TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_exp_transactions_transaction_date ON exp_transactions (transaction_date);
CREATE INDEX idx_exp_transactions_account          ON exp_transactions (transaction_account_id);
CREATE INDEX idx_exp_transactions_category         ON exp_transactions (category_name);
CREATE INDEX idx_exp_transactions_status           ON exp_transactions (status);

CREATE TRIGGER exp_transactions_set_updated_at
AFTER UPDATE ON exp_transactions
FOR EACH ROW
BEGIN
  UPDATE exp_transactions SET updated_at = datetime('now') WHERE id = old.id;
END;

-- Fuzzy vendor rules: match the raw description and assign a category (and
-- optionally a status). Applied during import and re-runnable over existing
-- rows. Rules are global — they apply to every card.
CREATE TABLE exp_category_rules (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern       TEXT    NOT NULL,             -- glob, case-insensitive: AMAZON*, *UBER*
  category_name TEXT    NOT NULL,             -- category to assign on a match
  apply_status  TEXT    NOT NULL DEFAULT '',  -- optional status to set; '' = leave unchanged
  priority      INTEGER NOT NULL DEFAULT 0,   -- lowest number wins when several match
  is_enabled    INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_exp_category_rules_priority ON exp_category_rules (priority, id);

CREATE TRIGGER exp_category_rules_set_updated_at
AFTER UPDATE ON exp_category_rules
FOR EACH ROW
BEGIN
  UPDATE exp_category_rules SET updated_at = datetime('now') WHERE id = old.id;
END;
