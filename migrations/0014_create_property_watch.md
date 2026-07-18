# Migration 0014: create watched_properties and property_snapshots tables

**Date:** 2026-07-17
**Type:** new tables

## What this does

Backs the "Property Lookup" / watch list feature: look up any address via the
RentCast API, optionally add it to a watch list, and keep a history of every
refresh as a separate snapshot row (append-only, never edited).

## `watched_properties`

| Column | Type | Notes |
|---|---|---|
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | internal PK |
| `address` | `TEXT NOT NULL UNIQUE` | one watch entry per address |
| `created_at` | `TEXT NOT NULL DEFAULT (datetime('now'))` | |

No `updated_at` — this row never changes after insert; all change history
lives in `property_snapshots`.

## `property_snapshots`

| Column | Type | Notes |
|---|---|---|
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | internal PK |
| `watched_property_id` | `INTEGER NOT NULL` | no FK constraint (project convention); indexed for the "history for this address" query |
| `source` | `TEXT NOT NULL` | data provider, e.g. `rentcast` |
| `property_type` | `TEXT` (nullable) | |
| `bedrooms` | `REAL` (nullable) | |
| `bathrooms` | `REAL` (nullable) | can be fractional (e.g. 2.5) |
| `square_footage` | `INTEGER` (nullable) | |
| `year_built` | `INTEGER` (nullable) | |
| `lot_size` | `REAL` (nullable) | square feet |
| `tax_assessment_year` / `tax_assessed_value_cents` | `INTEGER` (nullable) | latest tax assessment at fetch time |
| `annual_tax_year` / `annual_tax_cents` | `INTEGER` (nullable) | latest property tax bill at fetch time |
| `last_sale_date` | `TEXT` (nullable) | |
| `last_sale_price_cents` | `INTEGER` (nullable) | |
| `raw_data` | `TEXT NOT NULL` | JSON — the full normalized lookup result (owner details, HOA, full sale history, etc.) |
| `fetched_at` | `TEXT NOT NULL DEFAULT (datetime('now'))` | |

## Deliberate exception: `raw_data` JSON column

Project convention rejects JSON blobs for structured data. This is a
flagged exception: the source data's shape varies address-to-address and can
change on the provider's side without notice, so the columns above capture
the fields we actually compare over time, and `raw_data` is an escape hatch
for everything else (owner names/mailing address, HOA fee, full sale/tax
history, property features) rather than modeling every possible provider
field as a column. Approved by Min.

## Index

`idx_property_snapshots_watched_property_id` — the only query pattern against
this table is "all snapshots for one watched property, newest first."

## No seed data

Both tables start empty.

## Rollback

```sql
DROP TABLE property_snapshots;
DROP TABLE watched_properties;
```
