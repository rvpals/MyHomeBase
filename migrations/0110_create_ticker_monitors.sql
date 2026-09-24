-- Per-ticker monitors: "tell me when this holding approaches a number I care
-- about".
--
-- Three kinds, all of them about unrealized gain or loss, because that is the
-- figure a decision actually hangs on -- a price target means nothing without
-- knowing what you paid:
--
--   gain_near_amount        unrealized gain approaching $X
--   loss_near_amount        unrealized loss approaching $X; $0 is the useful
--                           case -- "the bad one has nearly recovered"
--   gain_near_pct_of_cost   unrealized gain approaching X% of cost basis
--
-- Evaluated when a price refresh runs. The evaluation itself is a pure
-- function in src/lib/ticker-monitors; this table is storage only.
--
-- HOUSEHOLD-WIDE, like the holdings they watch and like sys_messages (0109).
-- A monitor is a fact about a shared position, so there is no user_id here.
CREATE TABLE inv_ticker_monitors (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker       TEXT NOT NULL,
  monitor_type TEXT NOT NULL,

  -- The target, in whichever unit the type reads. Both columns always exist and
  -- the unused one holds 0, rather than one nullable "value" column that means
  -- different things by row: a cents figure and a percentage are different
  -- units, and collapsing them would make every read guess which it was looking
  -- at. Money is CENTS everywhere in this codebase (src/lib/shared/money.ts).
  target_cents INTEGER NOT NULL DEFAULT 0,
  target_pct   REAL    NOT NULL DEFAULT 0,

  -- What "near" means: the value is within this percent of the target. A band
  -- rather than a fixed dollar tolerance because it scales -- 5% is a sensible
  -- default against a $500 target and against a $100,000 one, and the same
  -- number reads correctly for the percent-of-cost type.
  --
  -- Per row rather than a global setting: "near $10,000" and "near break-even"
  -- want different tolerances, and the reader is the one who knows which.
  band_pct     REAL    NOT NULL DEFAULT 5,

  -- Off without deleting. Keeps the row's trigger history, which is the point.
  is_enabled   INTEGER NOT NULL DEFAULT 1,

  -- THE FIRE-ONCE LATCH, and the reason this table has state at all.
  --
  -- Without it a monitor sitting inside its band files an identical message on
  -- every refresh, and a reader who refreshes hourly finds forty copies of the
  -- same sentence. So: the message is filed on the transition from outside the
  -- band to inside it. While it stays inside, the warning icon keeps showing
  -- (that is derived live, not stored) but nothing new is filed. Leaving the
  -- band clears the latch and re-arms it.
  is_triggered      INTEGER NOT NULL DEFAULT 0,
  last_triggered_at TEXT,
  -- What was said when it last fired, so the ticker's warning modal can show it
  -- without re-deriving the sentence from figures that have since moved.
  last_message      TEXT NOT NULL DEFAULT '',

  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Every read is "the monitors for this ticker" -- the viewer's Monitor screen,
-- and the per-ticker warning marker.
CREATE INDEX idx_ticker_monitors_ticker ON inv_ticker_monitors (ticker);

-- Deliberately NOT unique on (ticker, monitor_type): two gain targets on one
-- holding is an ordinary thing to want ("tell me at $5,000 and again at
-- $10,000"), and a unique index would silently make the second one impossible.
-- See coding-guide.md, "Never put a DATE column in a unique index", for the
-- general rule this follows -- a unique index may only span columns that
-- identify the row exactly, and these do not.

CREATE TRIGGER inv_ticker_monitors_set_updated_at
AFTER UPDATE ON inv_ticker_monitors
FOR EACH ROW
BEGIN
  UPDATE inv_ticker_monitors SET updated_at = datetime('now') WHERE id = old.id;
END;
