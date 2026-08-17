-- Cached reference data per ticker for the Stocks & ETFs module: the sector a
-- symbol belongs to, so the dashboard can chart allocation by sector without a
-- provider round-trip per position on every render.
--
-- Yahoo's `assetProfile` carries this and rides along in the quoteSummary call
-- the ticker detail tab already makes, so there is no new service and no key.
-- What it does not carry is a sector for a fund: an ETF returns nothing here,
-- which is a real answer rather than a failure.
--
-- A row whose `sector` is blank is a **negative cache**: "we looked and the
-- provider reported none." Without it, every dashboard render would re-request
-- a sector for every ETF in the portfolio. `fetched_at` lets a blank result be
-- retried eventually rather than never.
--
-- Blank rather than NULL throughout, matching sys_app_settings.value: the
-- distinction between "unset" and "empty" is drawn once, in the use-case.
CREATE TABLE stk_ticker_profiles (
  ticker        TEXT PRIMARY KEY,
  sector        TEXT NOT NULL DEFAULT '',  -- '' = looked up, none reported
  industry      TEXT NOT NULL DEFAULT '',  -- stored alongside; free in the same payload
  manual_sector TEXT NOT NULL DEFAULT '',  -- user override, wins over `sector` when set
  source        TEXT NOT NULL DEFAULT '',  -- provider it came from, for when that changes
  fetched_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
