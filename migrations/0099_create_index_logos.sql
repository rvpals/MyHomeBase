-- Cached icons for the market indexes on the Stocks & ETFs dashboard, keyed by
-- the provider symbol (`^GSPC`, `GC=F`, `DX-Y.NYB`).
--
-- Separate from stk_ticker_logos (0033) rather than sharing it, because the two
-- are keyed by different things and filled from different services. A ticker is
-- a company and has a stock-logo endpoint; an index is not, and its icon comes
-- from the website of the body that publishes it (S&P Global, Nasdaq, Cboe, the
-- Treasury). Sharing one table would also mean an index symbol had to satisfy
-- the ticker validator, which none of them do.
--
-- Same BLOB-plus-mime-type shape as stk_ticker_logos and sys_users.avatar: the
-- bytes are served by a dedicated route, so they never bloat a page payload,
-- and the board keeps its icons when the icon service is unreachable.
--
-- A row with a NULL image is a **negative cache**: "we looked and there wasn't
-- one." `fetched_at` lets that be retried eventually (the use-case treats one
-- older than 30 days as worth another try) rather than never.
CREATE TABLE stk_index_logos (
  symbol          TEXT PRIMARY KEY,
  image           BLOB,             -- NULL = looked up, nothing found
  image_mime_type TEXT,             -- NULL alongside a NULL image
  source          TEXT NOT NULL DEFAULT '',  -- URL it came from, for when the service changes
  fetched_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
