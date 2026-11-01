# Migration 0165: extracted text and full-text search for Documents

**Date:** 2026-10-31
**Type:** one new table, one FTS5 virtual table, three triggers, two indexes

## What this does

Lets the Document Library search **inside** filed files, not just their titles and
descriptions. Text is recovered once per attachment, cached, and indexed.

| Table | For |
|---|---|
| `doc_attachment_text` | the recovered text, one row per attachment |
| `doc_text_fts` | the FTS5 index over it (external-content) |

Before this, `listDocuments` searched `title` and `description` with a `LIKE '%…%'`.
A lease whose title is "Lease 2026" could not be found by searching for the street it
is about. Now it can.

## Where the text comes from

Two paths, cheap one first — the split is the whole design:

1. **The embedded text layer.** Anything produced by "Print to PDF" already carries
   its text. Reading it is exact.
2. **OCR**, only for pages that come back empty: a phone photo or a flatbed scan.

Measured on the dev box against a two-page lab report rendered both ways:

| Path | Time | Result |
|---|---|---|
| Text layer (`unpdf`) | **167 ms** | 2,092 chars, exact |
| OCR @150 DPI | 2.5 s | 83% confidence, 26/27 search terms found |
| OCR @300 DPI | **3.7 s** | 89% confidence, **27/27** search terms found |

**OCR is ~22× slower for an identical result**, which is why `source` is a column and
why nothing runs OCR speculatively. 300 DPI is the setting because the extra ~1.2 s
buys the last missing term, and a term you cannot find is the failure this feature
exists to prevent.

OCR errors were punctuation, not words (`x10E3/uL` → `x10E3/ul,`, en-dash → `=`).
For search that is harmless, which is why `confidence` is advisory and never used to
reject a result.

## Why `content_hash` is on this table

`doc_attachments.content_hash` (migration 0163) already identifies the bytes. Copying
it here is what makes re-extraction correct rather than merely cheap: if the stored
hash still matches the attachment's, the cached text provably describes the *current*
file and OCR can be skipped. Re-upload a different file and the hashes diverge, so the
row is visibly stale instead of silently describing bytes that are gone.

## Why external-content FTS5

`content='doc_attachment_text'` stores only the index, not a second copy of the text.
This is the first thing in the database that can hold tens of megabytes of prose, and
duplicating it would double the file for nothing.

The three triggers are **required** — FTS5 does not observe writes to the content table
on its own. The `'delete'` command rows in the update and delete triggers are what
retract the old terms. Without them an edited row leaves its previous text permanently
searchable, which is the classic external-content bug. Verified against a scratch
database: after an UPDATE the old term returns no rows and the new one does.

## Why `unicode61` and not `trigram`

Both tokenizers are compiled into the `better-sqlite3` build in use (SQLite 3.53.0) —
checked, not assumed. The choice was measured:

| Query | `unicode61` | `trigram` |
|---|---|---|
| `escalation`, `esc*` | ✅ | ✅ |
| `cafe` matching "Café" | ✅ | ❌ no folding |
| CJK `房屋*` (prefix) | ✅ | ✅ |
| CJK `租賃` (2-char, mid-string) | ❌ | ❌ needs 3+ |
| CJK `租賃合` (3-char) | ❌ | ✅ |

`unicode61 remove_diacritics 2` folds accents and treats a CJK run as one token.
`trigram` catches mid-string fragments but folds nothing and builds a much larger
index. Carrying both was rejected as gold-plating a case this household may never hit:
the use-case falls back to `LIKE` for a short query that finds nothing, covering the
gap at no storage cost.

## No `DEFAULT_MODULES` change

No new module and no new section. The Document Library already exists (migration
0160); this adds a column's worth of capability to its existing screens.

## Rollback

```sql
DROP TRIGGER doc_attachment_text_au;
DROP TRIGGER doc_attachment_text_ad;
DROP TRIGGER doc_attachment_text_ai;
DROP TABLE doc_text_fts;
DROP TABLE doc_attachment_text;
```

Safe: both tables are a **cache**. Dropping them loses no filed content — every
document, attachment and file on the share is untouched, and the text can be
recovered by re-running extraction.
