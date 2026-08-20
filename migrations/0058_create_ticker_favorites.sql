-- Favorite tickers for the Stocks & ETFs module: one bit per symbol, for quick access.
--
-- The star in the ticker viewer's header writes here; the star on the dashboard
-- heading reads it back as a jump list.
--
-- `ticker` is the primary key, not an autoincrement id with a unique index beside
-- it. A favorite has no identity of its own -- the symbol *is* the row -- and the
-- sibling per-ticker table `stk_ticker_logos` (0033) is keyed the same way. It
-- also makes the toggle an INSERT/DELETE on a known key rather than a lookup
-- followed by a write.
--
-- COLLATE NOCASE so "aapl" and "AAPL" cannot both become favorites. Every write
-- path already normalizes to upper case (`normalizeTicker`), so this guards
-- against a future one that forgets rather than against today's callers.
CREATE TABLE stk_ticker_favorites (
  ticker     TEXT PRIMARY KEY COLLATE NOCASE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Favorites are listed newest-first (the natural reading of a jump list: what you
-- just starred is what you are working on), and the list is read on every open of
-- the dashboard menu.
CREATE INDEX idx_stk_ticker_favorites_created_at
  ON stk_ticker_favorites (created_at DESC);
