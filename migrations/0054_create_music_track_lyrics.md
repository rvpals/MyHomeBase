# 0054 - Cache fetched lyrics per track

Adds `mus_track_lyrics`, filled on demand when the listener presses the lyrics
button in the player. One row per track that has been asked about.

## Why not Google

The feature was originally specified as "fetch Google with song title + artist".
That was not built, deliberately, and the reasons are worth recording because the
request will come up again:

- Server-side requests to Google search from one IP get throttled to 429s and
  CAPTCHA pages quickly. The NAS would make exactly that pattern of request.
- Google's result markup is obfuscated and changes without notice, so any parser is
  a scraper that silently starts returning empty strings rather than failing loudly.
- Automated scraping is against Google's terms, and the lyrics shown in their panels
  are licensed from third parties -- not Google's to redistribute.

The net effect would have been a feature that demos once and then rots.

## LRCLIB instead

`https://lrclib.net` -- free, **no API key**, no rate limit, purpose-built for music
players. Verified against real tracks from this library before committing to it
(including Cantonese-titled ones, which matters for the CHINESE half of the
collection).

`GET /api/get?artist_name=&track_name=[&album_name=&duration=]` returns
`plainLyrics`, `syncedLyrics`, `duration` and `instrumental`.

Only **plain** lyrics are stored. Synced (timestamped LRC) lyrics are returned by the
same call and would let the current line highlight during playback, but that needs an
LRC parser and a per-frame sync loop, so it stays out until it is actually wanted.
Nothing here forecloses it -- the column holds plain text and a future `synced_lyrics`
column is additive.

## The four statuses, and why a nullable text column is not enough

Measured directly against the API:

| Situation | API | Stored status | Retry? |
|---|---|---|---|
| Lyrics exist | 200, `plainLyrics` set | `found` | no |
| Track has no words | 200, `instrumental: true`, `plainLyrics: null` | `instrumental` | **no** |
| Nobody has them | **404** `TrackNotFound` | `not_found` | yes |
| Request itself failed | network error / 5xx | `failed` | yes |

`instrumental` is a real answer and must never be retried -- treating it as a miss
would mean re-requesting the same track forever. `not_found` is retryable because
LRCLIB's database is community-contributed and grows. `failed` is kept separate from
`not_found` so an offline NAS is not remembered as "this song has no lyrics", which
is the bug that would be hardest to notice and hardest to explain.

## Fetch timing

**On button press only, then cached.** Not during a scan: 20,272 tracks would mean
20,272 requests to a service that asks nothing in return. Not automatically on play
either -- that is an outbound request per track played, which is traffic the owner
did not ask for.

## Duration is deliberately a fallback, not a filter

The API accepts `duration` and matches it strictly -- asking for a 290-second track
with `duration=5` returns 404 rather than a loose match. Sending our duration always
would therefore turn a slightly-differently-mastered copy into a miss, so the fetch
tries without it first and only uses `/api/search` plus duration to disambiguate when
the exact lookup misses.

## Separate table, not columns on `mus_tracks`

A lyric body is a few kilobytes against a track row read fifty at a time on the
library screen, so it would ride along in every browse query -- the same reasoning
`coding-guide.md` applies to per-row images. It also keeps `mus_tracks` purely a
description of a file on disk, which is what the scanner owns.

**Nothing is written to the music files.** Lyrics are cached in the database only;
no `.lrc` or `.txt` is ever created beside a track. The file store port has no write
method and this feature does not need one.
