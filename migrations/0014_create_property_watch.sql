CREATE TABLE watched_properties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  address TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE property_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  watched_property_id INTEGER NOT NULL,
  source TEXT NOT NULL,
  property_type TEXT,
  bedrooms REAL,
  bathrooms REAL,
  square_footage INTEGER,
  year_built INTEGER,
  lot_size REAL,
  tax_assessment_year INTEGER,
  tax_assessed_value_cents INTEGER,
  annual_tax_year INTEGER,
  annual_tax_cents INTEGER,
  last_sale_date TEXT,
  last_sale_price_cents INTEGER,
  raw_data TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_property_snapshots_watched_property_id ON property_snapshots(watched_property_id);
