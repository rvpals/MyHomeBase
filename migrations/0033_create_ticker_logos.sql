-- Cached company/ETF logos for the Stocks & ETFs module, keyed by ticker.
--
-- Stored as a BLOB with its mime type, the same approach as sys_users.avatar and
-- exp_creditcard_accounts.card_image: the bytes are served by a dedicated route
-- rather than inlined, so they never bloat a page payload and the browser can
-- cache them. Downloading once and keeping it here also means the app keeps
-- working when the upstream logo service is unreachable.
--
-- A row with a NULL image is a **negative cache**: "we looked and there wasn't
-- one." Without it, every page render would re-request a logo for tickers that
-- simply don't have one. `fetched_at` lets a negative result be retried
-- eventually rather than never.
CREATE TABLE stk_ticker_logos (
  ticker          TEXT PRIMARY KEY,
  image           BLOB,             -- NULL = looked up, nothing found
  image_mime_type TEXT,             -- NULL alongside a NULL image
  source          TEXT NOT NULL DEFAULT '',  -- URL it came from, for when the service changes
  fetched_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
