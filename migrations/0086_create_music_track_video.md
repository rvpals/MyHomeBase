# 0086 — Cache a YouTube video pick per track

Adds `mus_track_video`, backing the music player's new **Video** tab: given a track's
artist and title, find the song on YouTube and remember which video it was.

| Field | Value |
|---|---|
| Table | `mus_track_video` |
| Prefix | `mus_` (existing — Music Library) |
| Rows | one per track anyone has pressed "Find video" on |
| Module | `music` (no `DEFAULT_MODULES` change — this is a tab, not a section) |

## Why a table and not a column on `mus_tracks`

The same two reasons `0054` gave for `mus_track_lyrics`, which this table deliberately
mirrors:

- **It would ride along in every browse query.** The library screen reads tracks in
  pages of fifty; a video id, title and channel on each row is payload nobody asked for.
- **A nullable column cannot express the outcomes.** "Never asked", "asked and found
  nothing", and "asked and could not reach YouTube" are three different states, and only
  two of them should ever be retried.

## The status column is the point of the table

```
'found'     -- video_id holds the pick
'not_found' -- YouTube returned nothing worth standing behind   (retryable)
'failed'    -- the request could not be made                    (retryable)
```

**No terminal miss.** `mus_track_lyrics` has `'instrumental'` because LRCLIB can
authoritatively say a track has no words — a real answer that must never be retried.
YouTube has no equivalent: it can never say a song *has* no video, only that our search
and ranking did not find one. So every miss here stays retryable, and the tab always
offers "Try again".

A `'not_found'` is as likely to be our fault as YouTube's — the ranking rules in
[`src/lib/youtube/youtube.ts`](../src/lib/youtube/youtube.ts) refuse a candidate that
scores below a floor, so a genuinely obscure recording and an over-strict rule look
identical from here. That is why the row is cheap to discard and the panel always shows a
search link.

## Fetched on a button press, never on a scan

The Video tab has an explicit **Find video** button. This is a deliberate choice, not an
unfinished automatic fetch: a scan of this library would otherwise mean 20,272 scrapes of
a free service, and even auto-fetching per *played* track would be a request the listener
never asked for. Lyrics works the same way (`0054`); Story is the odd one out and it
caches nothing at all.

Once fetched, a repeat visit costs zero requests — which is the whole reason this table
exists rather than the story path's fetch-every-time.

## Snapshot columns, and the ones that make a bad pick diagnosable

`video_title` and `channel` are stored as YouTube reported them **at fetch time**,
taken from oEmbed (the official, keyless endpoint) rather than the scraped search page,
because the two can disagree and oEmbed is the documented one. They are a snapshot: a
re-uploaded video can change either, and `fetched_at` is what dates them.

`search_artist` / `search_title` record what was actually queried, which is not always
what the tags say — an untagged file falls back to parsing its filename. Without these
columns a wrong pick is undiagnosable, which is the lesson `0054` already learned.

`duration_seconds` is nullable, unlike the text columns: a live stream genuinely has no
length, and `0` would be a lie.

## Constraints

- `idx_mus_track_video_track` — **unique** on `track_id`. One cached answer per track; a
  refetch replaces the row. The unique index makes the upsert honest rather than trusting
  the caller to delete first.
- `idx_mus_track_video_status` — "which tracks are worth retrying", without scanning a
  table that eventually holds a row per track anyone has opened.
- `mus_track_video_set_updated_at` — the same `AFTER UPDATE` trigger every other table
  in this schema carries.

No foreign key on `track_id`, matching `mus_track_lyrics`: a rescan can replace track
rows, and a cascade that silently discarded cached picks would cost more requests than
the orphaned rows cost bytes.

## Third-party service

youtube.com, read as a public web page. **Free, no API key, no account, unmetered.**

The official YouTube Data API v3 was considered and rejected: `search.list` costs 100
quota units against a 10,000/day allowance — about **100 lookups a day** — and requires a
Google Cloud project. Not a basis for a music library. Verified free alternatives in use:
the results page for search, and `youtube.com/oembed` (official, keyless) to confirm the
pick.

The accepted risk is that the results page's JSON is undocumented and Google can reshape
it. The parser is written to fail soft — a shape change yields an empty candidate list,
recorded as `'failed'` and retryable — never a crash. This is the same bet the Songfacts
and Yahoo Finance clients already make.

## Rollback

```sql
DROP TRIGGER IF EXISTS mus_track_video_set_updated_at;
DROP INDEX IF EXISTS idx_mus_track_video_status;
DROP INDEX IF EXISTS idx_mus_track_video_track;
DROP TABLE IF EXISTS mus_track_video;
```

Dropping the table loses only cached picks; every one can be fetched again with the
button. Nothing else in the schema references it.
