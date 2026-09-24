-- An application-wide message queue.
--
-- The app has had no way to tell the reader something after the fact. Every
-- notice it produces today is tied to a screen that happens to be open: the
-- refresh control's status line, a startup message, an alert banner. Anything
-- that happens while nobody is looking -- a monitor firing during a price
-- refresh -- had nowhere to go and was simply lost.
--
-- This is that place. A message is a small, permanent record: when it was
-- filed, what it says, and whether anyone has read it yet.
--
-- HOUSEHOLD-WIDE, NOT PER READER. There is one queue and one read state, so
-- marking a message read marks it read for everyone. That matches what the
-- app already is -- a household's own site, where the Investments module's
-- holdings are "ours" rather than any one person's -- and it keeps the table a
-- single row per message instead of a message table plus a per-reader join.
--
-- The alternative (a sys_message_reads join keyed by (message_id, user_id))
-- was rejected for now on that basis, but note the shape it would take if the
-- premise ever changes: this table stays as it is minus `read_at`, and the
-- read state moves out. That is a migration, not a rewrite.
--
-- read_at IS GENUINELY NULLABLE, and this is deliberate rather than an
-- oversight against coding-guide.md's "a settings value is blank, never NULL".
-- That rule is about sys_app_settings.value -- a TEXT NOT NULL key/value store
-- where a nullable column would mean a full table rebuild for no gain. Here the
-- column is a timestamp, NULL is the honest encoding of "has not happened yet",
-- and the partial index below can only exist because of it.
CREATE TABLE sys_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- NULL = unread. Stamped once, when somebody reads it.
  read_at    TEXT,
  title      TEXT NOT NULL,
  -- Blank is allowed: a title-only message is a legitimate one-liner.
  body       TEXT NOT NULL DEFAULT '',
  -- Who filed it, e.g. 'Investments monitor'. Free text, blank when unattributed.
  -- Not a foreign key to anything: a message outlives the thing that wrote it,
  -- and a monitor deleted next week must not delete its own history.
  source     TEXT NOT NULL DEFAULT ''
);

-- The unread tab is the one the reader opens, and on a queue that has been
-- running a year it is the small half of a large table. A partial index means
-- that query reads only the unread rows rather than filtering the whole table.
--
-- This is why `read_at` is NULL rather than '': a partial index needs a
-- predicate SQLite can test, and `WHERE read_at IS NULL` is it.
CREATE INDEX idx_messages_unread
  ON sys_messages (created_at DESC)
  WHERE read_at IS NULL;

-- The read tab, and the count beside it. Ordered the same way -- newest first
-- is what both halves of the screen read in.
CREATE INDEX idx_messages_created_at
  ON sys_messages (created_at DESC);
