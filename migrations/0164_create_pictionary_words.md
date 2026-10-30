# Migration 0164: a custom Pictionary word bank

**Date:** 2026-10-30
**Type:** one new table (`gam_pictionary_words`)

## What this does

Lets a household **import its own Pictionary words** — a pasted list or an uploaded
text/CSV file — from Games → Configuration. Imported words sit alongside the built-in
bank; a session can draw from both, from only the built-ins, or from only the custom
list.

## Why this is data when the catalogue and the built-in words are code

The Games module has been firm that *what the app can do is code, only what the user did
is data* (migration 0074's log, and the comment at the top of `catalogue.ts`). Two
earlier lists stayed in code on that reasoning, and this table does not contradict
either:

| List | Where | Why |
|---|---|---|
| The games themselves | `catalogue.ts` | A game exists when the code that draws it does. A row naming a game this build can't run is a broken card. |
| The built-in words | `pictionary-words.ts` | Ships with the app, same for every install, and needs no screen. A seed would need a migration to fix a typo. |
| **Custom words** | **this table** | **Content a household authored.** Nobody but them knows that their kids' prompts should be in the bank. |

The distinction that matters: a game key is *executable* — the catalogue promises code
exists to run it. A word is *content* — the app needs no code to show a new noun, so a
word nobody foresaw is not a broken anything. Pictionary is also the only game here
whose fun has a shelf life: a fixed 120-word bank goes stale in a household that plays
it weekly, where no amount of play exhausts Tetris.

So this is not "the catalogue became data". It is the first thing in this module that
was always content, and it gets a table for the usual reason content does.

## Why not a JSON blob in `sys_module_settings`

That is where this module would otherwise put configuration, and it was the first
option considered. Rejected because a word list is a *collection*, not a setting:

- Importing 300 words means rewriting one ever-growing JSON string, and two people
  importing at once silently lose one list.
- Deduplicating against what's already there means parsing the blob in application code
  on every import, where a `UNIQUE` index does it correctly and atomically.
- "Delete the word `volcano`" is a row delete here and a read-modify-write there.

The unique index is the main prize. Re-importing the same file is a thing people
actually do, and it should be a no-op rather than something the importer has to be
clever about.

## The uniqueness rule

`UNIQUE (tier, word COLLATE NOCASE)` — a word is unique **within a tier**, ignoring
case, so:

- importing the same list twice adds nothing the second time;
- `Volcano` and `volcano` are the same prompt, because they draw the same;
- the same word **may** appear in two tiers, deliberately. One household's "easy" is
  another's "hard", and a session only ever reads one tier, so there is no ambiguity
  about which row applies.

## `created_by` without a foreign key

Per the convention set in migration 0074: better-sqlite3 enforces foreign keys, so a
`REFERENCES sys_users(id)` here would make deleting a user who had imported words fail
outright. The column records who added a word so Configuration can say so; a word whose
importer has since been deleted is still a perfectly good word.

## Scoring is untouched

No change to `gam_scores`, and no new score key. Custom words score exactly as built-in
ones do — the tier decides the points, and a custom word carries a tier. A household
that imports only trivial words into `hard` will inflate its own scoreboard, which is
true of a household that only ever picks `easy` as well and is not something this
migration tries to police.
