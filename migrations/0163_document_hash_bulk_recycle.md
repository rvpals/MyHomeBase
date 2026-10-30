# Migration 0163: content hashes, bulk operations and a recycle bin for Documents

**Date:** 2026-10-30
**Type:** one new column + one index on `doc_attachments`, four new tables

## What this does

Three Document Library features land together:

1. **Content hashes** — every uploaded file is hashed (SHA-256) at upload, so the
   library can say *"this file is already attached to **Lease 2026**"*.
2. **Bulk operations** — tick several documents and retag, recategorise or recycle
   them in one go. **No schema change at all** (see below).
3. **A recycle bin** — deleting a document moves it to a bin instead of destroying
   its index.

| Table / column | Mirrors | For |
|---|---|---|
| `doc_attachments.content_hash` | — | duplicate detection |
| `doc_recycled_documents` | `doc_documents` | the bin |
| `doc_recycled_attachments` | `doc_attachments` | the bin |
| `doc_recycled_document_categories` | `doc_document_categories` | the bin |
| `doc_recycled_document_tags` | `doc_document_tags` | the bin |

## Why bulk operations needed no schema

They are the existing writes applied to several ids inside one transaction. The
work was a use-case and a `DataGrid` already carrying `enableSelection` — nothing
about a document changes because it was edited as part of a selection. Recorded
here because its absence from this file is otherwise a question.

## Why mirror tables and not a `deleted_at` flag

The reasoning migration 0161 recorded for clips and 0079 for the journal, unchanged.
A flag is the smaller migration and the worse design: every existing read in this
module — the list, the filter, the taxonomy pairings, the attachment aggregate
behind `DocumentSummary`'s count and total size — would have to learn to exclude
binned rows, and **one missed `WHERE` silently serves a deleted document** as though
nothing happened. A separate table cannot be read by accident.

## How this bin differs from the Clips bin: the files are not in the database

This is the one place a reader who knows migration 0161 should slow down.

A clip's images are BLOBs, so binning a clip moves every byte it owns into the
mirror tables and a restore is purely a database operation. **A document's bytes
live on the NAS**, and `doc_attachments` is only the index to them.

Half of that was already solved before this migration. `deleteDocument` called
`moveToDeleted`, which renames `doc_17/` to `_deleted/doc_17_<timestamp>/` — so the
**bytes already survived a delete**. What did *not* survive was the index: the rows
saying which file was which, what it was originally called, and what it belonged to.
The surviving folder was a pile of files nobody could identify. This bin preserves
the index.

### `deleted_folder`, and why it is stored rather than derived

`moveToDeleted` stamps its destination with a timestamp, because deleting a
document, re-filing it and deleting it again would otherwise collide on
`_deleted/doc_17` — and on Windows a rename onto an existing non-empty folder fails.
That stamp is generated at the moment of the move and recorded nowhere else.

Without `deleted_folder`, a restore would have to *guess* which of
`doc_17_2026-01-01…` or `doc_17_2026-06-14…` belonged to the row it is restoring,
and with two deletes of the same document in the bin it would be a coin flip. So
`moveToDeleted` now returns where it put the folder, and the bin writes it down.

### Why a restore rewrites attachment paths

A document's attachment paths **hardcode its id**: `doc_17/lease.pdf`. A clip's
images carry no such dependency, which is why `restoreRecycledClips` can fall back
to a fresh id when the original is taken and lose nothing.

Here that fallback would be silent corruption — the document comes back as id 42
while every one of its attachment rows still says `doc_17/…`, pointing at a folder
belonging to a *different* document. Downloads would serve another document's files.

So restore does the work instead:

| Case | What happens |
|---|---|
| Original id still free | Restore at it. Move `_deleted/doc_17_<stamp>/` → `doc_17/`. Paths unchanged. |
| Original id taken | Restore at a fresh id. Move `_deleted/doc_17_<stamp>/` → `doc_42/`. **Rewrite every `relative_path`** `doc_17/x.pdf` → `doc_42/x.pdf`. |

This is why `restoreRecycledDocuments` is `async` and takes a file store, while the
clips equivalent is synchronous and takes only a repository.

### What a restore does not do

It does not merge. A restored document is added back; it is never reconciled with
something written since. Same stance Clips takes, and the same reason: a merge would
have to guess which of two edits was meant to win.

## Why the hash column defaults to `''` rather than being backfilled

`''` means "never hashed", and that is every row existing today. Backfilling in the
migration would mean reading **every file on the share over SMB** — the live DB is on
the NAS — which does not belong in a migration that must run fast and offline.

Un-hashed rows simply do not take part in duplicate detection. A separate CLI command
(`documents-backfill-hashes`) walks the share and fills them in when you choose to.
The index is partial (`WHERE content_hash != ''`) so those blank rows stay out of it.

## Duplicate detection warns, it never blocks

Filing the same scan under two documents is sometimes deliberate — a receipt that is
both a warranty and a tax record. The upload surfaces *"already attached to X"* and
proceeds. A check that refused would make a legitimate action impossible, and the
library has no way to know which case it is looking at.

## Rollback

```sql
DROP TABLE doc_recycled_document_tags;
DROP TABLE doc_recycled_document_categories;
DROP TABLE doc_recycled_attachments;
DROP TABLE doc_recycled_documents;
DROP INDEX idx_doc_attachments_hash;
-- doc_attachments.content_hash is additive with a default; leaving it costs nothing
-- and dropping it rewrites the table. Leave it unless the column is genuinely in the way.
```

Anything in the bin at rollback is lost from the index, but **the files themselves
remain** under `_deleted/` on the share — exactly where they were before this
migration existed.
