# 0059 — The play queue, visible and persistent

Adds `mus_play_queue` (one row per queued entry, ordered) and
`mus_play_queue_state` (a single row: what is current, repeat mode, shuffled flag).

## Why

The queue was already there. `MusicPlayerProvider` has held `queue: PlayableTrack[]`
since 0052 — `TrackList` sets it on every click, so "next" walks whatever list you were
looking at. Two things were wrong with it, and only one of them is a schema problem:

1. **Nothing rendered it.** You could not see what was coming, remove a track you did
   not want, or jump forward three songs. That is the Queue section, and it needed no
   database at all.
2. **It died with the page.** Reload, or come back tomorrow, and a 60-track queue you
   built by hand was gone. That is this migration.

The second is the reason a table exists. Worth stating plainly because the in-memory
version was a defensible shipping choice, not an oversight: a queue is *ephemeral* in
most players, and "it resets when you close the tab" is a behaviour many listeners would
never notice. What makes it wrong here is the NAS: this library is 20,000 files, the
Magic Playlist can spend real time assembling a 50-track list from a query, and losing
that to an accidental refresh means doing it again.

## Why two tables

`mus_play_queue` is a *list*; `mus_play_queue_state` is a *cursor plus two settings*.
Folding the state into the entries table would mean either repeating `repeat_mode` on
every row (and then deciding what it means when two rows disagree) or a nullable
`is_current` column with no way to enforce that only one row carries it. Neither is
worse in storage; both make an invalid state representable.

## Why the entries table copies `mus_playlist_tracks` (0056)

Same shape, same reasoning, deliberately not unified:

- **`position` is an explicit integer, not rowid order.** A queue is reorderable and a
  shuffle is a move; rowid order cannot express one.
- **`position` is not unique.** A shuffle rewrites every row in one transaction, and a
  unique index fights the intermediate states of that rewrite. Ties break on `id`.
- **A track may appear twice.** For a playlist that was "a set list can repeat a song".
  For a queue it is more ordinary still — queue an album, then queue it again.

## Why the cursor is an entry id, not a track id

`current_entry_id` points at `mus_play_queue.id`, not `mus_tracks.id`. Because a track
may be queued twice, "which copy of this song am I on" is a question with a real answer,
and a track id cannot give it. The in-memory version got this wrong in a way nobody had
hit yet: `step()` did `queue.findIndex((entry) => entry.id === current.id)`, which for a
duplicated track always finds the *first* copy — so reaching the second copy and pressing
Next would jump you back to just after the first.

## Why `repeat_mode` is TEXT with a CHECK

SQLite has no enum, so the alternatives were an integer code or a checked string. The
string is readable in a SQL client, which matters for a value that will be eyeballed far
more often than it is written; the `CHECK` is what stops it accepting `'ONE'`, `'loop'`
or `''`. Without the constraint a typo in one write path becomes a mode that silently
reads as "off" forever.

## Why `is_shuffled` is stored rather than derived

After a shuffle, the rows *are* the new order. Nothing remains in the data to compare
against, so "has this been shuffled" is unanswerable from the entries alone — the flag is
the only place that fact can live. The UI needs it to light the Shuffle button, and a
listener needs it to know why the order looks the way it does.

It is honest about its limits: it says the order was shuffled at some point, not that the
current order is a permutation of any particular original. Restoring a pre-shuffle order
would need the original positions kept alongside, which is a second column pair and a
feature nobody asked for. Shuffle is one-way; re-queue the list to get it back.

## Single-row table, and the CHECK that enforces it

`CHECK (id = 1)` with the row seeded in this migration. Two consequences, both wanted:
every reader can assume the row exists (no "insert if missing" before an `UPDATE`), and
a second row fails loudly rather than leaving two candidate states with readers picking
whichever they saw first.

The alternative was four rows in `sys_app_settings`. Rejected for one specific reason,
not tidiness: `sys_app_settings.value` is `TEXT NOT NULL`, so `current_entry_id` would be
a string every reader parses back to an integer, with blank-means-nothing as the sentinel
(see the "settings value is blank, never NULL" note in `coding-guide.md`). For a cursor
that changes on every track this is the stringly-typed state that goes wrong quietly.

## No `user_id`

Consistent with every other `mus_` table — `mus_playlists` (0056) and `mus_magic_list`
(0057) both made this call explicitly, and the reasoning carries over unchanged: this is
a household music library and there is one pair of speakers.

The consequence is sharper here than for playlists, so it is worth naming: **there is one
queue, and two people using the app at once share it.** Someone queueing an album on the
kitchen tablet changes what the person at the desktop sees. For a shared player in a
house that is arguably correct — it is the same music coming out of the same NAS — but it
is a real behaviour, not an accident, and the fix if it ever bites is a `user_id` column
plus a decision about who owns the existing rows.

## No foreign keys, consistent with the rest of the schema

`track_id` is a comment-documented reference rather than a declared `REFERENCES`, matching
`mus_playlist_tracks` and `mus_play_events`. A queue entry pointing at a track a rescan has
deleted is therefore possible, and it is handled on **read**: the queue view joins to
`mus_tracks` and an entry with no matching row is skipped rather than rendered as a blank.
`idx_mus_play_queue_track` is what makes deliberate cleanup cheap when a scan does find a
file has vanished.
