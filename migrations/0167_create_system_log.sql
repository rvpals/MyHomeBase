-- A system log: two kinds of line, each behind its own switch.
--
-- THE THIRD CHANNEL, and the reason it is not one of the first two:
--
--   sys_messages (0109)             -- a notice FOR A READER. Every row lights the
--                                      header's unread badge and waits to be
--                                      dismissed. Low volume, high value.
--   sys_scheduled_run_history (0135) -- one row PER PASS of a background job: when
--                                      it started, when it finished, how it went.
--   sys_system_log (here)            -- what the app was DOING, in its own words.
--
-- Routing diagnostics into `sys_messages` was considered and rejected: every insert
-- there increments a household-wide badge, so a debugging session would bury the
-- monitor alerts the bell exists to deliver, and the queue has no scheduled prune to
-- survive the volume. Routing them into 0135 was rejected too -- that table answers
-- "how did the pass go", one row per pass, and a per-file line would destroy it.
--
-- TWO KINDS, TWO SWITCHES, NOT A SEVERITY LADDER.
--
--   'debug'       -- lines planted at a specific place while something is being
--                    diagnosed. Verbose, short-lived, written by whatever code is
--                    under investigation.
--   'operational' -- routine "the system did a thing": a scheduled job triggering,
--                    a pass finishing.
--
-- They are independent booleans rather than levels because they answer different
-- questions and are wanted at different times -- operational alone to watch the
-- scheduler on the NAS, debug alone to chase one bug. A ladder would force "debug
-- implies operational", which is not the relationship between them.
--
-- BOTH DEFAULT OFF. See migrations/0168 for the switches themselves.
CREATE TABLE sys_system_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Stamped by the database, never by the caller. Every line carries a time: that
  -- is the point of a log, and making it a parameter would let one caller forget.
  -- SQLite-style UTC ('YYYY-MM-DD HH:MM:SS'), matching every other table here.
  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  -- 'debug' | 'operational'. Validated at the boundary by `systemLogKindSchema`
  -- (src/lib/system-log/schema.ts) rather than by a CHECK constraint, for the same
  -- reason 0142 kept `module` unconstrained: a CHECK cannot be altered later without
  -- rebuilding the table, and the enum already fails loudly at the use-case.
  kind       TEXT NOT NULL,

  -- Where the line came from, e.g. 'documents/text-index' or 'scheduled-jobs'.
  --
  -- FREE TEXT, deliberately unlike `sys_messages.module`, which is a fixed enum.
  -- That list is a closed set of modules a reader can filter the bell by; this is a
  -- code location, and requiring a schema edit before a new file may log a line is
  -- exactly the friction that stops lines being planted when they are needed.
  source     TEXT NOT NULL DEFAULT '',

  -- The line itself, already rendered. Not a format string plus arguments: nothing
  -- re-renders these, and a template language here would be a parser to maintain.
  message    TEXT NOT NULL,

  -- Optional second half: a stack, a JSON blob, a long value. Split from `message`
  -- so the grid can show one readable line per row and put the bulk behind a cell.
  --
  -- Blank, never NULL -- coding-guide.md's rule for a TEXT column where "nothing
  -- here" is an honest empty string rather than an unanswered question.
  detail     TEXT NOT NULL DEFAULT ''
);

-- ONE INDEX, and it is the only read this table has.
--
-- Every query is newest-first over the whole log; the screen's kind and source
-- filters narrow an already-bounded page rather than driving the scan. `id DESC`
-- serves that without parsing a timestamp, and serves the prune below, which deletes
-- by the same ordering.
--
-- A second index on `kind` was considered and rejected on the same grounds 0142 gave
-- for not indexing `module`: this table's whole problem is INSERT volume -- a debug
-- pass over a document library writes a line per file -- and an extra index taxes
-- every one of those to speed up a filter that reads 200 rows.
CREATE INDEX idx_system_log_recent ON sys_system_log (id DESC);

-- REVERSAL
--
--   DROP TABLE sys_system_log;
--
-- Loses nothing but the log. Nothing references this table, no other table
-- references it, and with both switches off (the default) nothing writes to it.
