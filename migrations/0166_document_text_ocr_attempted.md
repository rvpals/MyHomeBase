# Migration 0166: remember that OCR was attempted

**Date:** 2026-10-31
**Type:** one new column on `doc_attachment_text`, one partial index, one backfill

## What this does

Lets a scheduled job tell *"nobody has OCR'd this yet"* from *"OCR ran and found
nothing"*. Both previously left `status = 'needs-ocr'`.

## Why the hash was not enough

Migration 0165's `content_hash` already answers **"does the stored text describe the
bytes that are there now?"** — which is what stops a re-read of a file nobody has
touched, and it is genuinely most of what "don't do it twice" needs.

What it cannot answer is whether the expensive path has been *tried*. For the OCR
button that gap is harmless: a reader pressing it is explicitly asking to try again,
and `extractAttachmentText` deliberately re-runs on a cached `needs-ocr` for exactly
that reason. For a **background job** the same rule is a treadmill — every scan that
OCR cannot read would be re-recognised on every pass, forever, at ~10s a page on the
DS223, producing the same nothing each time.

## Why not derive it from `source`

`source = 'ocr'` survives only on a row where OCR **succeeded**. A failed attempt
stores `status = 'needs-ocr'` with `source = 'text-layer'` — which is precisely the
row the job must learn to skip. Deriving the flag would therefore skip the successes
and repeat the failures, exactly backwards.

## The backfill

```sql
UPDATE doc_attachment_text SET ocr_attempted = 1 WHERE source = 'ocr';
```

A row OCR produced is a row OCR was run against. Everything else stays `0`, which is
both true (0165 shipped with no OCR pass of its own) and the safe direction: the job's
first run picks those up rather than skipping them forever.

## The rule the job follows

An attachment is **work** when any of these holds:

| Condition | Meaning |
|---|---|
| no `doc_attachment_text` row | never read |
| `content_hash = ''` | read before hashes existed |
| `content_hash <> ` the attachment's | **the file changed** — re-read it |
| `status <> 'extracted'` and `ocr_attempted = 0` | a scan nobody has recognised yet |

And it is **done** — skipped forever — when the text was extracted, or when OCR has
been attempted against these exact bytes and came back empty.

Re-uploading a file changes its hash, which makes every one of those tests fail and
the attachment becomes work again. That is the "until a new file is uploaded" part of
the requirement, and it falls out of 0165's hash rather than needing anything new.

The OCR **button** is unaffected: it still forces a re-read on demand, because a
person asking for one is not the same as a timer asking for one.

## Rollback

```sql
DROP INDEX idx_doc_attachment_text_pending;
ALTER TABLE doc_attachment_text DROP COLUMN ocr_attempted;
```

Safe. The column is scheduling bookkeeping, not content — dropping it makes the job
re-attempt unreadable scans, which is wasteful but not wrong. No filed document,
attachment or file on the share is touched.

Verified against a scratch database: the backfill sets exactly the OCR-produced rows,
and 0165's three FTS triggers still fire correctly after the `ALTER` — an `UPDATE`
still retracts the old terms and indexes the new ones.
