-- The Household module's HSA Tracker: one table of expenses, one of cards.
--
-- Same hsh_ prefix as the recipe box (0118) — the prefix is the module's namespace,
-- not an abbreviation of its first feature.
--
-- No DB-level foreign keys, following the jrn_/att_ convention: nothing here
-- references another table anyway, because an expense records the card it was paid
-- with as TEXT (see paid_with below).

CREATE TABLE hsh_hsa_expenses (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  -- When the expense was recorded. Two columns, not one timestamp, matching
  -- jrn_entries: both are the writer's own wall-clock reading, defaulted in the
  -- browser and editable so a past receipt can be entered under its real date.
  entry_date        TEXT    NOT NULL,           -- YYYY-MM-DD
  entry_time        TEXT    NOT NULL DEFAULT '', -- HH:MM
  -- Integer cents, never a float: a sum of receipts must equal the sum of what was
  -- typed. Always positive — a refund is a different fact and is not modelled here.
  amount_cents      INTEGER NOT NULL,
  product_service   TEXT    NOT NULL,
  -- One of Pharmacy, Medical, Dental, Vision, Transportation, Dependent Care,
  -- Other. Enforced in zod rather than by a CHECK, so the message reaches the form
  -- and adding a type later needs no table rebuild (SQLite cannot alter a CHECK).
  type              TEXT    NOT NULL DEFAULT 'Other',
  payee             TEXT    NOT NULL,           -- the store or the doctor's office
  -- Optional: a prescription is bought the day it is filled, but a bill can arrive
  -- weeks after the visit, and that earlier date is the one that matters for
  -- eligibility.
  service_date      TEXT,                       -- YYYY-MM-DD, NULL = not recorded
  -- The card's NAME as it was when the expense was entered — a snapshot, not an id.
  -- Renaming or deleting a card in Configuration must never rewrite or orphan a
  -- receipt from years ago. Blank = not recorded.
  paid_with         TEXT    NOT NULL DEFAULT '',
  note              TEXT    NOT NULL DEFAULT '',
  is_reimbursed     INTEGER NOT NULL DEFAULT 0, -- 0 = No (the default), 1 = Yes
  -- The attached receipt. Held in the database for now, as recipe pictures are
  -- (0118); the NAS naming and storage scheme is meant to replace this, and the
  -- columns live here so that is an additive change.
  --
  -- "Receipt attached?" is DERIVED (`receipt_file IS NOT NULL`) rather than stored
  -- as a Y/N column: a stored flag can disagree with the file it describes.
  --
  -- Reads of the LIST must select columns explicitly and derive `has_receipt`,
  -- never SELECT *, or every list pulls every receipt.
  receipt_file      BLOB,                       -- NULL = no receipt
  receipt_mime_type TEXT,
  receipt_file_name TEXT    NOT NULL DEFAULT '',
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- The list's default ordering (newest first).
CREATE INDEX idx_hsh_hsa_expenses_entry ON hsh_hsa_expenses (entry_date, entry_time);
-- "Still to reimburse" is the question this table exists to answer.
CREATE INDEX idx_hsh_hsa_expenses_reimbursed ON hsh_hsa_expenses (is_reimbursed);
-- The Product or Service box's SELECT DISTINCT.
CREATE INDEX idx_hsh_hsa_expenses_product
  ON hsh_hsa_expenses (product_service COLLATE NOCASE);

CREATE TRIGGER hsh_hsa_expenses_set_updated_at
AFTER UPDATE ON hsh_hsa_expenses
FOR EACH ROW
BEGIN
  UPDATE hsh_hsa_expenses SET updated_at = datetime('now') WHERE id = old.id;
END;

-- The pick list behind "Paid with", maintained in the HSA Tracker's Cards section.
CREATE TABLE hsh_hsa_cards (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  -- Inactive cards drop out of the editor's pick list but stay listed in
  -- Configuration, so a retired card can be hidden without being deleted.
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- One card per name, however it is cased.
CREATE UNIQUE INDEX idx_hsh_hsa_cards_name ON hsh_hsa_cards (name COLLATE NOCASE);
