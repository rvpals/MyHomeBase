# 0058 — Favorite tickers

Adds `stk_ticker_favorites`: one row per favorited symbol, plus an index on
`created_at` for the newest-first jump list.

## Why

The Stocks & ETFs dashboard grew a ticker search (symbol lookup by partial match), which
solves "open a symbol I can name". It does not solve "open one of the six symbols I look
at every morning" — for that, typing the name is the wrong interaction. Favorites are a
short, hand-picked jump list: a star in the ticker viewer's header marks a symbol, and a
star on the dashboard heading lists what's marked.

## Why a table, not a column on `stk_stock_positions`

The obvious cheaper option was `is_favorite INTEGER NOT NULL DEFAULT 0` on the positions
table. Rejected, and the reason is not storage:

**You must be able to favorite a symbol you don't hold.** Half the point is watching
something before buying it — and a position row for a symbol you own nothing of would be
a lie that every other query in the module would then have to filter out. The same
argument rules out a column on `stk_stock_watch_list_items`, which would additionally tie
a favorite's lifetime to a list membership.

A favorite is therefore its own fact about a *symbol*, alongside `stk_ticker_logos` (0033),
`stk_ticker_profiles` (0046) and `stk_ticker_risk_cache` (0039) — all keyed by ticker, none
of them requiring the symbol to be held.

## Why `ticker` is the primary key

No autoincrement `id`, unlike most tables in this schema. A favorite has no identity of
its own: the symbol *is* the row, there can only be one, and nothing will ever reference
it by a surrogate key. Keying on the ticker makes the toggle an `INSERT`/`DELETE` against
a known key instead of a select-then-write, and it removes the "same symbol twice" bug
class outright rather than guarding it with a separate unique index.

`COLLATE NOCASE` on the key so `aapl` and `AAPL` cannot both be stored. Every write path
normalizes to upper case before it gets here; the collation is there for the future path
that forgets to.

## Favorites are independent of watch lists

A symbol can be favorited without being on any watch list, and unfavoriting never touches
a list. The two look similar and are deliberately not unified:

| | Watch-list item | Favorite |
|---|---|---|
| Carries | shares, price-when-added, a reminder | nothing but the symbol |
| Belongs to | one named list | the module |
| Answers | "how has this moved since I noticed it?" | "let me open this again" |

Folding favorites into watch lists would have meant either a magic list name (`__favorites`)
that every list-management screen then has to hide, or a `kind` column making half of
`stk_stock_watch_list_items`' columns meaningless for one kind of row — the same trap
`0057` declined between playlists and magic lists.

## No `user_id`

Consistent with every other `stk_` table: none of them are user-scoped. This is a household
app, and a favorited symbol is a statement about the portfolio rather than about a person.

Stated plainly because it is the reversible-but-annoying kind of choice: adding `user_id`
later is a migration (and one that has to decide who existing rows belong to), but adding
it *now* and guessing wrong means everyone but the first user sees an empty list. The
existing shape of the module is the better guide, and `0056` made the same call for
playlists.

## No cascade, no cleanup

Nothing deletes a favorite automatically — not selling the position, not deleting the watch
list, not a failed quote lookup. A symbol you have exited is still a symbol you may want to
open, and a favorite costs one row.

The consequence is that a favorite can outlive anything the app knows about its symbol:
delist `XYZ` and the star remains. That is handled on **read**, not by pruning — the viewer
already renders a symbol it has no data for (that is exactly what the search's unknown-symbol
path does), so a stale favorite opens a dialog that reports it has nothing, which is the
truthful answer.
