# Migration 0159: the Document Library's tables

**Date:** 2026-10-28
**Type:** six tables created, with their indexes and triggers

## What this does

Creates the `doc_` namespace and the six tables behind the Document Library: filed
documents carrying categories and tags, each holding one or more attachment files kept
on a configured folder on the NAS.

| Table | Holds |
|---|---|
| `doc_documents` | The document itself — title, description, who filed it |
| `doc_attachments` | One row per attached file; the **index** to a file on the share |
| `doc_categories` | Managed category list, each with an optional icon |
| `doc_tags` | Managed tag list, same shape |
| `doc_document_categories` | Document ↔ category pairings |
| `doc_document_tags` | Document ↔ tag pairings |

## Why a new prefix

Documents are not a Household feature. The Household module is recipes, receipts and
the HSA; this module is reachable, searchable and taggable on its own. `coding-guide.md`'s
rule decides it: a prefix is a module namespace, so the Document Library takes `doc_`.
It is a module namespace rather than an abbreviation of the first table, which is the
lesson `pho_` and `tol_` both record.

## The four decisions worth knowing

### 1. The file bytes are not in the database

`doc_attachments.relative_path` locates a file inside the configured document folder;
the file store reads and writes it. Nothing here holds the bytes.

This is the same split the Household's HSA receipts use, and migration 0079 recorded
the cost of the alternative when it dropped `jrn_entry_images` for storing attachments
as inline base64. A household's paperwork is gigabytes of scans — an order of magnitude
beyond what belongs in a SQLite file that lives on a NAS and gets copied for every
verify run.

The trade is that the database and the share can disagree: a file moved or deleted by
hand leaves a row pointing at nothing. That is treated as a **normal state**, not an
error — the document still lists the attachment and the serving route answers 404. The
alternative, a scheduled reconciliation job, would be a background process whose only
job is to delete the user's rows, which is worse.

### 2. One folder per document, flat, with no year folders

Files live at `doc_<id>/<name>`, directly under the configured root.

The HSA receipts file under a year (`2026/…`) because an expense has a date. **A
document does not**, and that is the second decision: a `doc_date` column was
considered and deliberately dropped. A lease has a term, a warranty has an expiry, a
manual has neither — one date column would have meant something different for each, and
the module would have been asking for a value that is often a guess. `created_at`
records when it was filed, which is the only date this module can state honestly.

With no date there is no year to file under, so the layout is flat. One folder per
document still keeps the root to one entry per record however many files it holds.

### 3. The mime type is derived from the stored extension, never from the upload

`doc_attachments.mime_type` is computed from the sanitised file name against a fixed
allowlist, and anything unlisted is stored as `application/octet-stream`.

A client can send any `Content-Type` it likes, and this column is what the serving
route later hands back. Trusting the upload's claim would let someone store a file that
the browser then renders as HTML **from our own origin** — which is XSS with a file
picker in front of it. For the same reason `isInlineRenderable` permits only images and
PDFs inline, and explicitly refuses `image/svg+xml`: an SVG is a document that can carry
script.

### 4. Shared, not per-user

Every reader granted the module sees every document. `created_by` is attribution for
the household and nothing filters on it — the same choice `clp_clips` made (0155) and
`tol_todo_items` before it (0123).

This is the household's paperwork, not one person's diary. The Journal is per-user
because an entry is something one person wrote; a lease belongs to whoever needs it.
There is also no encryption here, unlike `jrn_entries` and `clp_clips`: the files sit
in the clear on the NAS regardless, so encrypting only the title and description would
be security theatre over an unprotected attachment.

## Deletion, and why nothing is ever unlinked

Deleting a document asks whether to delete its files too, and the default is **no** —
the destructive reading is never the default one. The record going while the files stay
is recoverable by hand; the reverse is not.

Even when the answer is yes, **nothing is unlinked**. The document's folder is moved to
`_deleted/doc_<id>_<timestamp>/` under the same root. A mistaken delete is recoverable
on the NAS, and the timestamp means deleting, re-filing and deleting again cannot
collide (a plain `rename` onto an existing folder fails on Windows). Removing a single
attachment behaves the same way.

The ordering between the two stores matters and is fixed in `documents.ts`: adding
writes the file **first**, then the row (a crash leaves a harmless orphan file rather
than a broken download link); deleting removes the rows **first**, then moves the files
(a crash leaves files under a document that no longer exists, rather than deleting the
files of a document that survived).

## Settings: no migration needed

The document folder is a `sys_module_settings` row (`document_root`), exactly as the
Journal's `photo_root` and the Household's `hsa_receipt_root` are. The per-file size
and per-document count ceilings are `sys_app_settings` rows set in Admin → Configuration
— they are an operational bound on what the server will buffer, not a preference about
documents. Both tables already exist, so neither needs schema.

Both limits parse **forgivingly**: a blank, a non-number, a zero or a hand-edited
nonsense value falls back to the default rather than throwing, and a value above the
hard ceiling is clamped rather than rejected. A settings row can outlive the thing it
names, and `modules.md` requires parsing to survive that.

## No foreign keys

Per project convention. The repository maintains the cascades: `deleteDocument` removes
the document, its taxonomy pairings and its attachment **rows** in one transaction.
Deleting a category removes its pairings and the category, so a document simply stops
being filed under it — deleting a category never deletes a document, because the
taxonomy is a way of finding things rather than the thing itself.
