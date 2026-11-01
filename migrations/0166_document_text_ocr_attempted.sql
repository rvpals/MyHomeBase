-- Document Library: remember that OCR was ATTEMPTED, so a background job never
-- repeats work that already came back empty.
--
-- ## The gap this closes
--
-- Migration 0165 can already answer "does the stored text describe the current
-- bytes?" -- that is what `content_hash` is for, and it is what stops a re-read of a
-- file nobody has touched.
--
-- What it could NOT answer is the difference between:
--
--   (a) a scan nobody has run OCR over yet, and
--   (b) a scan OCR has run over and genuinely could not read.
--
-- Both leave `status = 'needs-ocr'`. For the OCR button that conflation is harmless:
-- a reader pressing it is explicitly asking to try again. For a scheduled job it is
-- the difference between a feature and a treadmill -- every unreadable scan would be
-- re-recognised on every pass, forever, at ~10s a page on the DS223, to produce the
-- same nothing each time.
--
-- `ocr_attempted` records the attempt itself rather than its outcome, which is the
-- fact the job actually needs.

-- 0 = OCR has never run against these bytes. 1 = it has, whatever it found.
--
-- NOT NULL DEFAULT 0 so every existing row reads as "never attempted", which is both
-- true (0165 shipped without an OCR pass of its own) and the safe direction: the job's
-- first run picks them up rather than skipping them forever.
--
-- Deliberately NOT derivable from `source`: `source = 'ocr'` only survives on a row
-- where OCR SUCCEEDED. A failed attempt stores `status = 'needs-ocr'` with
-- `source = 'text-layer'`, which is exactly the row the job must learn to skip.
ALTER TABLE doc_attachment_text ADD COLUMN ocr_attempted INTEGER NOT NULL DEFAULT 0;

-- Backfill the rows where an attempt is provable.
--
-- A row that OCR produced is, by definition, a row OCR was run against. Rows left by
-- the cheap text-layer pass stay at 0 -- correct, since nothing has recognised them.
UPDATE doc_attachment_text SET ocr_attempted = 1 WHERE source = 'ocr';

-- The background job's work list, in index order: "rows this pass still has to look
-- at". Partial, because the job only ever asks about rows that are NOT finished, and
-- an index over the whole table would be mostly dead weight once the library is
-- indexed.
CREATE INDEX idx_doc_attachment_text_pending
  ON doc_attachment_text (ocr_attempted, status)
  WHERE status <> 'extracted';
