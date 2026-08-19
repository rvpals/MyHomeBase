# 0052 — Create the Music Library tables

Adds `mus_tracks`, `mus_albums`, `mus_scan_runs`, `mus_playlists` and
`mus_playlist_tracks`. New module prefix: `mus_`.

The module catalogs audio files already sitting on the NAS and streams them to a
browser. It does not import, move, convert or write to them — the file store port
is deliberately **read-only**, so a bug in the app cannot touch the actual music.

## What the library actually looks like

Measured at `/volume1/MEDIA/AUDIO` before designing this, because the shape of
the data drove most of the decisions below:

| Format | Files | Playable in a browser |
|---|---|---|
| mp3  | 10,574 | yes |
| flac |  8,591 | yes |
| ape  |    886 | **no** |
| wma  |     90 | **no** |
| ogg  |     84 | yes |
| m4a  |     25 | yes |
| wav  |     22 | yes (large) |

20,272 files total, nested 2–8 levels deep. There is **no** `Artist/Album/Track`
convention: the top level mixes languages (`CHINESE`), genres (`CLASSICAL`),
alphabet buckets (`ENGLISH/A`, `ENGLISH/B`) and junk (`NO MUSIC`, `unsort`).
398 `.cue` sheets are present.

## Decisions and why

**Audio bytes are never stored in SQLite.** Only metadata plus a relative path.
An album of FLAC is ~300 MB against a whole database currently measured in tens
of megabytes, and `better-sqlite3` is synchronous — serving a 40 MB blob would
block every other page render. `mus_albums.cover_image` is the one BLOB, at ~100 KB
per album, and it carries the `coding-guide.md` per-row-image obligation: ordinary
reads use an explicit column list exposing only `has_cover_image`, and the
cover-serving route is the single reader of the bytes.

**Paths are relative to `MYHOMEBASE_MUSIC_ROOT`, never absolute.** The root differs
per environment — `//NAS_DS223/MEDIA/AUDIO` over SMB from Windows in dev,
`/volume1/MEDIA/AUDIO` locally on the NAS in production. An absolute path would make
the catalog non-portable between the two, which matters because the same database
file moves between them.

**Folder structure is not trusted for metadata.** With depth varying 2–8 and no
positional rule, there is no reliable "the parent folder is the album". Embedded
tags are the only source of truth; filename is the last resort; an untagged file
groups under a real "Unknown Album" rather than a wrong guess.

**`file_mtime` + `file_size` make re-scanning cheap.** A full scan opens every file
to read tags — many minutes over SMB. A re-scan compares these first and skips
anything unchanged, so the expensive walk happens once and subsequent scans take
seconds.

**`is_streamable` is denormalized on purpose.** No browser can play APE
(Monkey's Audio) or WMA — no HTML5 support, no prospect of it. Those 976 files can
be catalogued but never played. Storing the verdict lets a list query grey out play
without re-deriving format rules per row; `src/lib/music/formats.ts` is the one
place that decides it. A module setting controls which extensions a scan accepts at
all, so the default (mp3 + flac) never even records the unplayable ones.

**`has_cue_sheet` is a flag, not a feature.** A `.cue` marks track boundaries inside
one file holding a whole CD. Those 398 are catalogued as **one track each**; playing
an individual track inside one means seeking to a byte offset mid-file, which is a
separate feature. The column exists so that feature can find its candidates later
without a re-scan.

**Playlists are shared, with no `user_id`.** This is a household library; a playlist
someone built is meant to be playable by anyone with module access. Adding a
per-user column later is a migration — but guessing wrong now would mean every
other listener seeing an empty list. The same track may appear twice in one
playlist (a set list can repeat a song), so there is no unique constraint on
`(playlist_id, track_id)`; `position` is explicit because rowid order cannot
express a reorder.

**`mus_scan_runs` exists because a scan cannot fit in an HTTP request.** The NAS is
a DS223 — 2 GB RAM, quad Cortex-A55, already swapping at idle (see
`scripts/publish-nas.mjs`) — and tag-reading 20k files there takes minutes to tens
of minutes. So the web action *starts* a scan and returns; the UI polls this row.
Progress held in memory would vanish on a page refresh and would be invisible to a
scan started from the CLI. It also has no `updated_at` trigger, deliberately: a scan
updates its progress row thousands of times and sets the column explicitly in the
same statement, so a trigger would double every one of those writes.

**A worker thread was considered and rejected.** It is the textbook fix for
synchronous writes blocking the event loop, and it would work — but it needs a
third bundled entry point in `publish-nas.mjs` and a worker path that resolves both
under `next dev` and in the standalone build, which is real deployment risk for a
job that is expensive exactly once. Instead the scan commits in batches and yields
between them, and the expensive first run is done from the CLI over SSH where
blocking nothing. Because the use-case is a plain function behind ports, moving it
into a worker later changes how it is invoked, not what it does.

## Follow-ups this migration does not do

- Cue-sheet track splitting (398 candidates, flagged by `has_cue_sheet`).
- APE/WMA playback, which would need on-the-fly transcoding. Deliberately out:
  an aarch64 ffmpeg binary on a 2 GB NAS would peg the CPU and break seeking.
  Converting those files to FLAC offline is the cheaper answer.
