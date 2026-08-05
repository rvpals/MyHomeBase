# Coding guide

Project-specific coding conventions. This complements — does not replace —
`ARCHITECTURE.md` (layering), `components.md` (reusable UI), and `design.md`
(styling). Read the relevant section before writing code that touches its area.

## Database table naming

Every table carries a **lowercase three-letter module prefix** so its owning
module is obvious from the name alone. New tables must follow this.

| Prefix | Module | Example tables |
|---|---|---|
| `sys_` | Platform — not a feature module | `sys_modules`, `sys_app_settings`, `sys_module_settings`, `sys_users`, `sys_user_module_access`, `sys_sessions`, `sys_schema_migrations`, `sys_daily_quotes` |
| `stk_` | Stocks & ETFs (brokerage accounts **and** per-stock tables — one prefix) | `stk_investment_accounts`, `stk_stock_positions`, `stk_stock_watch_lists`, `stk_stock_volatility_cache`, `stk_ticker_logos`, `stk_daily_snapshots` |
| `csv_` | CSV Analysis (incl. user-generated per-entry tables from `buildTableName`) | `csv_analytics_entries`, `csv_chart_presets`, `csv_govee` |
| `jrn_` | MyJournal | `jrn_entries`, `jrn_categories`, `jrn_tags`, `jrn_entry_categories`, `jrn_entry_tags`, `jrn_entry_locations`, `jrn_entry_images`, `jrn_icons` |
| `exp_` | Expense tracker | `exp_transactions`, `exp_creditcard_accounts`, `exp_categories`, `exp_post_import_rules`, `exp_post_import_rule_actions` |

The `rei_` prefix (Real Estate Investment) was retired when that module was
removed — see migration `0026_drop_real_estate_module`.

Rules for adding tables:

- **New feature module** → choose a new lowercase 3-letter prefix. **Platform /
  cross-cutting** table → `sys_`.
- The prefix is a **namespace**, not an abbreviation of a word — this is the one
  intentional exception to the "no abbreviations" rule in the coding standards.
- Column names stay `snake_case`, self-documenting, no abbreviations (unchanged).
- SQLite-internal tables (`sqlite_sequence`) are left untouched.

### Renaming existing tables

- A pure rename uses SQLite's native `ALTER TABLE ... RENAME TO` — **not** the
  copy-rename-drop pattern (that's only for column/constraint changes). `RENAME TO`
  preserves all rows, and SQLite auto-rewrites index/trigger *references*.
- Renames of an existing database are applied by `reconcileLegacyTableNames()` in
  `scripts/migrate.ts` — idempotent and guarded (renames only when the old name
  exists and the new one does not). This is **not** a numbered `.sql` migration: a
  numbered rename would crash a fresh install, because the historical `CREATE`
  migrations already emit the prefixed names. The same step renames the
  `sys_schema_migrations` tracker, which a `.sql` migration cannot do (it is written
  to mid-run).
- **Known deviation:** trigger and index *object names* keep their original
  (unprefixed) names; only their bodies/targets follow the rename. This keeps a fresh
  install byte-for-byte identical to a reconciled one and avoids drop/recreate risk.
  Prefixing those names is a separate follow-up.

Reference: migration log `migrations/0024_rename_tables_to_module_prefixes.md`.

### Changing a primary key

SQLite can add a column in place but **cannot change a primary key**, so a key change
means the full create-copy-drop-rename rebuild. Two things that are easy to get wrong,
both worked through in `migrations/0035_add_cost_basis_and_account_to_stock_positions.md`:

- **Drop dependent triggers before the table and recreate them after.** A trigger
  body naming the old table survives the rename and then fires against the wrong
  shape.
- **Re-check your indexes.** Adding a leading key column silently removes the index
  prefix every "find by the old key" query relied on — `(account_id, ticker)` left
  lookups by `ticker` alone with nothing to ride, so they needed an explicit index.

The runner wraps each migration in a transaction (`scripts/migrate.ts`), so a rebuild
that fails part way rolls back rather than leaving a half-built table. Rehearse it
against a **copy** of the production DB before running it for real.

### Per-row images

A per-row image is a `BLOB` column plus a `<name>_mime_type` column, served by a
dedicated route — never inlined as a base64 data URL. Four tables do this:
`sys_users.avatar` (0011), `exp_creditcard_accounts.card_image` (0031),
`exp_categories.icon_image` (0034), `stk_investment_accounts.icon_image` (0037).

Adding one carries a **non-obvious obligation**: every normal read of that table must
switch from `SELECT *` to an explicit column list that omits the blob, or the bytes
ride along in every list and page render. Decoding and the mime allowlist live in
`src/lib/shared/image-upload.ts` — use it rather than re-deriving the rules, and note
that SVG is excluded on purpose (it can carry script, and these bytes are served from
the app's own origin).
