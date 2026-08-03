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
| `stk_` | Stocks & ETFs (brokerage accounts **and** per-stock tables — one prefix) | `stk_investment_accounts`, `stk_stock_positions`, `stk_stock_watch_lists`, `stk_stock_volatility_cache`, `stk_ticker_logos` |
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
