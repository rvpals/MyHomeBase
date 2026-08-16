# Coding guide

Project-specific coding conventions. This complements — does not replace —
`ARCHITECTURE.md` (layering), `components.md` (reusable UI), and `design.md`
(styling). Read the relevant section before writing code that touches its area.

## Database table naming

Every table carries a **lowercase three-letter module prefix** so its owning
module is obvious from the name alone. New tables must follow this.

| Prefix | Module | Example tables |
|---|---|---|
| `sys_` | Platform — not a feature module | `sys_modules`, `sys_app_settings`, `sys_module_settings`, `sys_user_preferences`, `sys_users`, `sys_user_module_access`, `sys_sessions`, `sys_schema_migrations`, `sys_daily_quotes` |
| `stk_` | Stocks & ETFs (brokerage accounts **and** per-stock tables — one prefix) | `stk_investment_accounts`, `stk_stock_positions`, `stk_stock_transactions`, `stk_stock_watch_lists`, `stk_stock_volatility_cache`, `stk_ticker_risk_cache`, `stk_ticker_logos`, `stk_daily_snapshots` |
| `csv_` | CSV Analysis (incl. user-generated per-entry tables from `buildTableName`) | `csv_analytics_entries`, `csv_chart_presets`, `csv_govee` |
| `jrn_` | MyJournal | `jrn_entries`, `jrn_categories`, `jrn_tags`, `jrn_entry_categories`, `jrn_entry_tags`, `jrn_entry_locations`, `jrn_entry_images`, `jrn_saved_filters` |
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

### Never put a DATE column in a unique index

`stk_stock_transactions` carried
`UNIQUE (transaction_at, action, ticker, total_amount_cents)` so that re-importing a
broker CSV was a safe no-op. **`transaction_at` is a date, not a timestamp**, so two
buys of the same ticker for the same amount on the same day were identical on all four
columns and the second was rejected — silently dropping every lot after the first.
Buying a position in several lots through one day is completely ordinary.

Adding a column doesn't fix this. At date granularity the rows genuinely *are*
identical, so no combination of columns can separate them. The rule that generalises:
**a unique index may only span columns that identify the row exactly.** Where the
source system gives a reference number, be unique on that and nothing else, with a
partial index so rows lacking one aren't all colliding on a shared empty string:

```sql
CREATE UNIQUE INDEX idx_stock_transactions_external_id
  ON stk_stock_transactions (external_id)
  WHERE external_id <> '';
```

Where it doesn't, duplicate detection belongs in the **importer**, which can see the
whole file at once: count how many matching rows the file holds against how many are
stored, and insert the shortfall. The database can't make that call — it can't tell a
real second lot from an accidental re-import. Worked through in
`migrations/0038_add_brokerage_firm_to_stock_transactions.md`.

### A settings value is blank, never NULL

`sys_app_settings.value` is `TEXT NOT NULL` (migration 0002), so a setting that means
"nothing set" stores the **empty string**, not NULL. `STARTUP_MESSAGE` (0041) is the
first one that needs the distinction: blank means there is no message to show.

Making the column nullable to model that honestly would mean the full
create-copy-drop-rename rebuild — SQLite can't relax a `NOT NULL` in place — for no
behavioural gain. So the sentinel is blank, and **the mapping to `undefined` happens
once, in the use-case** (`getStartupMessage` trims and returns `undefined` for a blank
or whitespace-only value). Callers never compare against `""`; if you find that test
in a component, the use-case is missing.

One consequence worth knowing: `settingUpdateSchema` still requires `.min(1)`, because
it is what the admin Application Configuration screen posts and blanking
`application_name` there would leave the UI with no wordmark. A setting that is
legitimately blankable gets its own schema and its own repository write
(`setValue`, an upsert) rather than loosening the shared one for everything.

### Per-row images

A per-row image is a `BLOB` column plus a `<name>_mime_type` column, served by a
dedicated route — never inlined as a base64 data URL. Five tables do this:
`sys_users.avatar` (0011), `exp_creditcard_accounts.card_image` (0031),
`exp_categories.icon_image` (0034), `stk_investment_accounts.icon_image` (0037),
`sys_modules.carousel_image` (0040).

Adding one carries a **non-obvious obligation**: every normal read of that table must
switch from `SELECT *` to an explicit column list that omits the blob, or the bytes
ride along in every list and page render. Decoding and the mime allowlist live in
`src/lib/shared/image-upload.ts` — use it rather than re-deriving the rules, and note
that SVG is excluded on purpose (it can carry script, and these bytes are served from
the app's own origin).

**Expose presence, not bytes.** A caller usually only needs to know *whether* there is
an image, to choose between the artwork and a fallback. Derive that in SQL
(`carousel_image IS NOT NULL AS has_carousel_image`) and put the boolean on the domain
type; the bytes then have exactly one reader, the serving route. This matters most on
`sys_modules`, which is read on every authenticated page — see
`migrations/0040_add_carousel_image_to_modules.md`.

### Uploading one: send a File, not a base64 string

The early image uploads pass base64 as a plain server-action argument. That works for a
128 KB icon and **breaks for anything larger**, in two ways that both surface as
confusing framework errors rather than validation messages:

- Base64 inflates a file by ~33%, and Next's server-action body limit defaults to 1 MB —
  so an 800 KB image failed before any of our own code ran. `next.config.ts` now sets
  `experimental.serverActions.bodySizeLimit` to `4mb`.
- Next serialises a long string argument into nested arrays and rejects it outright:
  *"Maximum array nesting exceeded."* Raising the body limit does not help.

**Put the `File` in a `FormData` and pass that to the action** — it streams as ordinary
multipart with neither problem, and needs no `FileReader` in the browser. Convert to
base64 server-side if the use-case wants it. `saveModuleCarouselImageAction` is the
worked example. Also check the size **client-side** before uploading, so an oversized
file is refused instantly with the app's own wording instead of a 500.
