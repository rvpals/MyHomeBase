# 0089 — Remember what the calendar sent, so a re-import keeps your notes

**Date:** 2026-09-11
**Type:** new column (`jrn_entries.external_content`, and the same on `jrn_recycled_entries`)

## What this does

Adds the **"Keep my own notes and edits when refreshing an event"** option to Calendar
Import — ticked by default.

Before this, a re-import of an event already in the journal replaced the whole entry.
That is correct for the fields Google owns (title, date, time, location) and wrong for
the one field the reader also writes into: `content`. Type "Skylar got a personal best
today" under an imported practice, re-export the calendar next month, and the note was
gone.

The importer couldn't do better, because it could only see the *combined* content. It had
no record of which part it had written itself.

## The mechanism

`external_content` stores the `DESCRIPTION` (plus any note prefix) this importer last
wrote into `content`, verbatim. On a refresh the split is arithmetic:

```
stored content   = "Bring a towel\n\nSkylar got a PB!"
external_content = "Bring a towel"
                 → the reader's part is "Skylar got a PB!"

Google now sends = "Bring a towel and goggles"
new content      = "Bring a towel and goggles\n\nSkylar got a PB!"
new external     = "Bring a towel and goggles"
```

So an edited `DESCRIPTION` still reaches the reader, and their own writing survives.

## Why a column, and not a marker line

The alternative was to write a separator (`--- my notes ---`) into `content` and replace
only what sits above it. Rejected for two reasons:

- **It puts scaffolding in the reader's prose.** Every imported entry would carry a
  marker line, visible in the viewer, the calendar cell, search results and CSV exports.
- **It is forgeable.** Content is free text; a reader who typed that line themselves, or
  deleted it while editing, would silently change how the next refresh splits their
  entry. A column can't be edited by accident.

The cost is one nullable column that only one importer reads. That is cheaper than either
a marker convention or a child table.

## What happens to entries imported before this

They have `external_content = ''`, so the split can't be computed for them.

`''` is read as **"all of the stored content is the reader's, and the split is not
known"** — the conservative direction. On the first refresh after this ships, such an
entry keeps its `content` **verbatim**: its title, date, time and place update, but the
text is left exactly as it stands. `external_content` is recorded on that pass, so every
refresh after it splits normally.

Keeping the content verbatim rather than re-prepending the DESCRIPTION matters, and a
test pins it. A pre-0089 entry *already contains* the DESCRIPTION the importer wrote
there, so treating the whole field as "the reader's" and then putting the calendar's text
back on top would duplicate it — the content would read "Bring a towel", then "Bring a
towel" again, then the note. That is what `splitExternalContent`'s `known` flag prevents.

The opposite reading (treat `''` as "none of it is theirs") would have deleted exactly
the notes this migration exists to protect, on the very first run.

The same `known: false` path covers a second case: an entry whose *calendar half* the
reader has rewritten, so the remembered text no longer matches the start of the content.
There the importer can no longer tell which words were once its own, so it leaves the
text alone rather than guessing.

## What "keep my notes" covers

On a matched event with the option on:

| Field | Behaviour |
|---|---|
| `title`, `date`, `time`, `placeName` | overwritten from the calendar |
| `content` | the external part replaced, the reader's part kept — or kept verbatim when the split isn't known |
| `categories`, `tags` | **merged** — the presets are added, anything added by hand stays |
| `isPinned`, `isLocked`, `weather`, `locations` | untouched |

Unticking it restores the previous behaviour: a full replace. The CLI's `--replace` flag
is the same choice.

Tags and categories **merge rather than replace**, which has one consequence worth
knowing: a preset tag removed from an entry by hand comes back on the next refresh.
Tracking which tags arrived from a preset would need a second `external_*` column, and
that was judged too much machinery for the size of the problem.

## Locking is no longer the only defence

0088 noted that a **locked** entry is refused by the importer, which was then the only way
to protect a note from being overwritten. With this option on, that protection is the
default and locking is no longer needed for it.

A locked entry is still refused. A lock means "do not touch this entry at all", which is
a stronger statement than "keep my notes", and the importer honours it as before.

## Reversibility

SQLite can't drop a column in the versions this project targets, so a rollback would
rebuild the table. There is no need: the column defaults to `''`, every statement that
predates it still runs, and with the option unticked the importer behaves exactly as it
did before 0089.
