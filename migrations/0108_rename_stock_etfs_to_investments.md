# 0108 — Rename Stocks & ETFs to Investments

Renames the module from **Stocks & ETFs** to **Investments**: the slug
`stock-etfs` → `investments`, the display names, and the table prefix
`stk_` → `inv_`.

The module had outgrown its name. It already holds brokerage accounts, tax lots,
dividend income and account performance — none of which is a stock or an ETF —
so "Stocks & ETFs" described the first two things it tracked rather than what it
now is. "Investments" is the namespace that still fits the next table.

## What the `.sql` does

Three scoped `UPDATE`s, each keyed on the **old value** so a re-run is a no-op
and an admin who has already retitled the module by hand is not stomped:

| Table | Why it needs the rename |
|---|---|
| `sys_modules` | The registry row: slug, `short_name`, `long_name`, `description`. |
| `sys_module_texture` | Keyed by `module_slug` (PK), so the module's backdrop would be orphaned. |
| `sys_user_preferences` | `favorite_module_slug` is a key/value **row**; a reader who set this module as their startup target would otherwise land on a 404. |

That third one is the easiest to miss. `favorite_module_slug` is not a column —
it is a `preference_key` in a key/value table, so it needs a value-scoped
`UPDATE` rather than riding along with a schema change.

## Why the table rename is *not* in this `.sql`

The 17 `stk_` tables become `inv_`, but that rename lives in
`LEGACY_TABLE_RENAMES` in `scripts/migrate.ts`, **not** here. A numbered
migration would crash a fresh install: the historical `CREATE` migrations
(`0015`, `0035`, and the rest) already emit the `stk_` names, so a numbered
`ALTER TABLE ... RENAME` would run against tables that a fresh database has
under their new names and never had under the old. This is the same reasoning
recorded in `0024_rename_tables_to_module_prefixes.md`, and `coding-guide.md` →
*Renaming existing tables* states the rule.

The reconciler uses SQLite's native `ALTER TABLE ... RENAME TO`, which preserves
every row and auto-rewrites index and trigger *references*. No copy-drop-rebuild,
so there is no data risk here — this is a pure rename, not a constraint change.

### The two-hop trap

The pre-prefix entries already in that list (`stock_positions` →
`stk_stock_positions`, and eight more) were **retargeted straight to `inv_`**
rather than left pointing at `stk_`. Had they been left alone, a database still
on pre-prefix names would rename to `stk_*` in the first pass and then hit the
new `stk_* → inv_*` pass in the same run — renaming twice, and only by luck of
list order. Retargeting makes each legacy table rename exactly once.

The 17 `stk_* → inv_*` entries are listed *after* the pre-prefix block. Order
matters only for readability now that the first hop is gone, but the grouping
records which era each entry serves.

## Deliberate non-changes

- **`inv_investment_accounts` keeps its stuttering name.** Renaming the table
  body as well as the prefix would have doubled the blast radius for a cosmetic
  gain. Left for a follow-up if it ever grates.
- **Index object names keep `stk_`** — `idx_stk_tax_lots_ticker_date` and
  `idx_stk_ticker_favorites_created_at` still carry the old prefix while pointing
  at `inv_` tables. `coding-guide.md` → *Renaming existing tables* already records
  this as a known, deliberate deviation: bodies follow a rename automatically,
  object names do not, and prefixing them is a separate drop/recreate risk. This
  follows 0024's precedent rather than inventing a new rule.
- **Icon slot ids keep the `stock` namespace** — `stock_section_*` and
  `stock_card_*` are unchanged, and `iconNamespace="stock"` stays. Slot ids are
  permanent once uploads exist; renaming them would silently orphan every
  uploaded icon override for this module's 27 positions. Only the human-readable
  `label` / `group` / `where` strings were retitled.
- **`sequence` stays 2.** The rename does not reorder the home grid.
- **No redirect from `/modules/stock-etfs`.** Old bookmarks 404 by choice.

## Rollback

```sql
UPDATE sys_modules SET slug = 'stock-etfs', short_name = 'Stocks & ETFs',
  long_name = 'Stock & ETFs etc', description = 'Manage stock and ETF investments.'
  WHERE slug = 'investments';
UPDATE sys_module_texture SET module_slug = 'stock-etfs' WHERE module_slug = 'investments';
UPDATE sys_user_preferences SET preference_value = 'stock-etfs'
  WHERE preference_key = 'favorite_module_slug' AND preference_value = 'investments';
```

Reversing the table rename means removing the 17 `stk_* → inv_*` entries from
`LEGACY_TABLE_RENAMES` and re-pointing the pre-prefix entries back at `stk_`.
