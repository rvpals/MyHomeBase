-- Root-arrival log: one row per visit to the site root by someone who is NOT signed
-- in. This is the "who is knocking on mhb.rvpals80.synology.me" question, which
-- sys_auth_events (0045) cannot answer — that table only sees people who reached the
-- sign-in form and typed something. A scanner that requests / and leaves, or a
-- stranger who opens the URL and never tries a password, left no trace at all.
--
-- Deliberately NOT a general access log, and this is the same line 0045 drew for the
-- same reason. Only the ROOT path, and only when the request carries no valid
-- session. A signed-in arrival writes nothing, so every row here is someone who was
-- not you at the moment they arrived, and the table stays small enough to read.
-- Logging every asset, every _next chunk and every module route would turn a
-- readable list into thousands of rows a day and answer a question nobody asked.
--
-- sys_ prefix per coding-guide.md: a platform concern, not a feature module, so it
-- gets no three-letter prefix of its own. Same call as sys_auth_events.
--
-- ip_address carries the same warning as 0045, and it matters more here because this
-- table's whole job is to point a finger. Behind the NAS reverse proxy the value
-- comes from x-forwarded-for, which is only as trustworthy as the proxy in front of
-- it; a direct caller can put anything in that header. The adapter records the first
-- hop. Advisory only. Never identity, and never an authorisation input.
--
-- path exists even though only '/' is ever written today. Widening the hook later to
-- cover other unauthenticated entry points is a one-line change in the layout; a
-- column added now costs one blank-defaulted TEXT and saves a table rebuild then.
--
-- referer is recorded because it separates "typed the URL / opened a bookmark"
-- (blank) from "followed a link from somewhere", and the somewhere is occasionally
-- the interesting part. Blank is the overwhelmingly common case and is not an error.
--
-- suspicion is scored AT WRITE TIME rather than computed on read. The screen groups
-- 90 days of rows by week and by day, and re-running the heuristics over every row on
-- every render would make the page cost grow with the table. Storing the verdict also
-- means the home-screen alert is an indexed count, not a scan. The cost is that a
-- verdict can go stale when the rules change or an allowlist entry is added — both
-- paths re-score the affected rows explicitly (see 0103), which is why suspicion is a
-- plain updatable column and not GENERATED.
--
-- The CHECK list is closed on purpose: three verdicts, no free text. 'watch' exists
-- so a single weak signal has somewhere to land that is not a red flag — most rows
-- with an odd user agent are harmless, and crying wolf on them would train the reader
-- to ignore the column entirely.
--
-- reviewed_at mirrors sys_auth_events exactly, including why: the home-screen alert
-- asks "are there unreviewed suspicious visits", not "was a banner dismissed", so it
-- survives a reload and reappears the moment a new one lands. NULL until acknowledged.
--
-- No UNIQUE index, specifically none spanning created_at or ip_address. Two identical
-- requests in the same second from the same address are a real event worth counting
-- twice — that burst IS the signal this table exists to show, and deduping it would
-- erase exactly the thing worth seeing.
CREATE TABLE sys_site_visits (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ip_address  TEXT    NOT NULL DEFAULT '', -- advisory: first x-forwarded-for hop
  user_agent  TEXT    NOT NULL DEFAULT '',
  referer     TEXT    NOT NULL DEFAULT '', -- blank = typed/bookmarked, the common case
  path        TEXT    NOT NULL DEFAULT '/',
  suspicion   TEXT    NOT NULL DEFAULT 'normal' CHECK (
                suspicion IN ('normal', 'watch', 'suspicious')
              ),
  reviewed_at TEXT,                        -- NULL = not yet acknowledged by an admin
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- The Visit tab reads newest-first and buckets by week, and the 90-day prune deletes
-- by age. Both are served by this one index.
CREATE INDEX site_visits_created_at_idx ON sys_site_visits (created_at DESC);

-- "Every visit from this address", for the per-IP rollups in the week/day tree and
-- for the re-score that runs when an address is added to or removed from the
-- allowlist (0103).
CREATE INDEX site_visits_ip_idx ON sys_site_visits (ip_address);

-- Serves the home-screen alert, which runs on every admin's home-screen render and
-- must stay cheap as the table grows. Partial on both halves of the predicate, so it
-- indexes only the handful of rows that are actually unreviewed AND suspicious —
-- 'watch' and 'normal' rows never enter the index and never trigger the alert.
CREATE INDEX site_visits_unreviewed_suspicious_idx
  ON sys_site_visits (reviewed_at)
  WHERE reviewed_at IS NULL AND suspicion = 'suspicious';
