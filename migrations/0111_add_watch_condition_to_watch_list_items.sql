-- An optional watch condition on a watch-list row: "tell me when this ticker
-- does X".
--
-- Six kinds, stored in `watch_kind`. The empty string means the row is not
-- watched at all, which is the default and the common case -- a watch list is
-- still primarily a list.
--
--   ''               not watching
--   price            the live price reaches watch_value (cents)
--   price_range      the live price sits inside [watch_value, watch_value_high]
--   dividend         a dividend is issued (no value)
--   split            a split happens (no value)
--   gain_loss_pct    the price has swung +/- watch_value percent since added
--   gain_loss_price  the price has swung +/- watch_value cents per share
--
-- Evaluated when a price refresh runs. The evaluation is a pure function in
-- src/lib/stock-watchlist/watch-condition.ts; these columns are storage only.
--
-- Distinct from inv_ticker_monitors (0110), which watches UNREALIZED GAIN on a
-- position you actually hold. A watch-list row is a ticker you are considering,
-- so there is no cost basis to measure against -- the baseline is
-- price_when_added_cents, which 0017 already snapshots. That difference is why
-- this is a column on the item rather than a monitor row: the condition belongs
-- to the list entry, and dies with it.
ALTER TABLE inv_stock_watch_list_items
  ADD COLUMN watch_kind TEXT NOT NULL DEFAULT '';

-- ONE VALUE COLUMN, AND WHY IT IS NOT TWO.
--
-- 0110 used a cents column and a percent column side by side so a SQL Explorer
-- reader never has to guess the unit. That does not scale to six kinds: most of
-- them read cents, one reads a percent, two read nothing, and one reads a pair.
-- A column per unit would leave every row with four zeroes in it.
--
-- So: REAL, and `watch_kind` states the unit. Cents for `price`, `price_range`
-- and `gain_loss_price`; percent for `gain_loss_pct`; unread for `dividend` and
-- `split`. REAL rather than INTEGER because the percent case is genuinely
-- fractional (a 2.5% swing); the cents kinds still store whole numbers, and the
-- domain type rounds them.
ALTER TABLE inv_stock_watch_list_items
  ADD COLUMN watch_value REAL NOT NULL DEFAULT 0;

-- Only `price_range` reads this -- the high bound, with watch_value as the low.
-- A second column rather than a "10-15" text field because a range is two
-- numbers, and storing it as a string would make every read parse it.
ALTER TABLE inv_stock_watch_list_items
  ADD COLUMN watch_value_high REAL NOT NULL DEFAULT 0;

-- THE FIRE-ONCE LATCH, copied deliberately from 0110.
--
-- Every one of these conditions is true on EVERY refresh for as long as it
-- holds: a price inside its range stays inside it. Filing on truth alone puts
-- one sentence in the queue forty times over for a reader who refreshes hourly.
-- So the message is filed on the TRANSITION into the condition; leaving it
-- clears the latch and re-arms it.
--
-- The dividend and split kinds latch on the event's date instead, which is
-- stored in watch_last_triggered_at -- see the .md log.
ALTER TABLE inv_stock_watch_list_items
  ADD COLUMN watch_is_triggered INTEGER NOT NULL DEFAULT 0;

ALTER TABLE inv_stock_watch_list_items
  ADD COLUMN watch_last_triggered_at TEXT;

-- What was said when it last fired, so the row can show it without re-deriving
-- the sentence from a price that has since moved.
ALTER TABLE inv_stock_watch_list_items
  ADD COLUMN watch_last_message TEXT NOT NULL DEFAULT '';

-- Every evaluation read is "the rows that are actually watched", which is a
-- small slice of the table -- most rows carry ''. A partial index keeps that
-- scan off the unwatched majority.
CREATE INDEX idx_watch_list_items_watch_kind
  ON inv_stock_watch_list_items (watch_kind)
  WHERE watch_kind <> '';
