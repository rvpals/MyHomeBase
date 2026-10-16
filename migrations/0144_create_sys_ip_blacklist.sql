-- Addresses the reader has explicitly distrusted. A blacklisted IP always scores
-- 'suspicious' in sys_site_visits, no matter what the heuristics would otherwise say
-- about its user agent or its request rate. The exact mirror of sys_ip_allowlist
-- (0103), pointing the other way.
--
-- The problem it solves: the heuristics in src/lib/site-visits/suspicion.ts are
-- deliberately conservative — a bare `curl` with no history scores 'watch', not
-- 'suspicious', because the reader might have run it themselves. That is the right
-- default for a scorer with no context, and the wrong answer once the reader has
-- LOOKED at an address and formed a judgement the scorer cannot reach: a netblock
-- they recognise from a botnet, a hosting range nothing legitimate reaches them from.
-- Without this table that judgement has nowhere to live, so the same address is
-- re-triaged by hand every time it comes back.
--
-- This table MARKS, it does not BLOCK. Nothing in this migration refuses a request,
-- and nothing in src/lib may be changed to make it do so without re-reading the
-- paragraph below. A blacklisted address is served exactly as before; the only thing
-- that changes is the colour of its row and the reason printed beside it.
--
-- This is NOT an authorisation input, and nothing in src/lib may treat it as one —
-- the same rule 0103 states for the allowlist, and it binds harder here because a
-- blacklist is the shape of thing somebody will eventually be tempted to wire into
-- the request path. The addresses come from x-forwarded-for behind the NAS reverse
-- proxy, where a direct caller can set the header to any value. So:
--
--   * Blocking on it would stop nothing determined. The attacker sets the header, or
--     arrives from a different hop, and is through. The only traffic reliably stopped
--     by a spoofable-header blacklist is traffic that was not attacking you.
--   * Blocking on it CAN lock the reader out. The household's own address arrives
--     through the same proxy. One wrong entry and the front door is shut from the
--     inside, with the admin screen that would undo it on the far side of the lock.
--
-- If a blocking gate is ever wanted it belongs in the reverse proxy on the NAS, where
-- the connection is real and the operator has a way back in — not in this table.
--
-- sys_ prefix per coding-guide.md: platform, not a feature module.
--
-- ip_address is UNIQUE, for the identical reason 0103 gives: the column identifies
-- the row exactly. An address is either distrusted or it is not, there is no second
-- row to add, and the uniqueness is what makes "add if missing" safe to call
-- repeatedly from the bulk action over ticked rows that often share an address.
--
-- An address must never be on both lists — 'always trust' and 'always suspect' are a
-- contradiction the scorer would have to break a tie in. Rather than encode a
-- precedence nobody can see from the screen, blockIpAddress() deletes any
-- sys_ip_allowlist row for the address in the same transaction, and allowIpAddress()
-- does the mirror of that. The invariant is maintained by those two use-cases; it
-- cannot be expressed as a constraint because it spans two tables.
--
-- label is the reason, in the reader's own words — "scanning /wp-admin all week",
-- "hosting range, nothing good comes from here". Blank-string sentinel per the
-- project convention (0041, 0044, 0045, 0103) rather than NULL, so no caller tests
-- for both. Worth filling in: a blacklist entry outlives the reader's memory of why
-- they added it, and an unexplained one is an entry nobody dares remove.
--
-- added_by_user_id has no DB-level foreign key, per project convention and for the
-- same reason 0045 and 0103 give: deleting a user must not delete the record of a
-- decision they made. The row survives as an orphan pointing at a departed id.
-- Nullable because the CLI can add an entry with no session behind it.
CREATE TABLE sys_ip_blacklist (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  ip_address       TEXT    NOT NULL UNIQUE,
  label            TEXT    NOT NULL DEFAULT '', -- why it is distrusted, in plain words
  added_by_user_id INTEGER,                     -- -> sys_users.id; NULL when added by CLI
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Read on EVERY site-visit write, to decide the verdict before the row is inserted —
-- alongside the allowlist read that 0103 added. Expected to hold a handful of rows,
-- so this is belt and braces rather than a hot-path necessity; the UNIQUE constraint
-- above already creates an index on ip_address, which is the only lookup this table
-- serves, so no second index is declared here.
