-- Document Library: extracted text and the full-text search index.
--
-- Two tables, one of them virtual:
--
--   doc_attachment_text  -- the text itself, one row per attachment
--   doc_text_fts         -- the FTS5 index over that text
--
-- The bytes still live on the NAS and `doc_attachments` is still only the index to
-- them. This adds a THIRD thing: what the file says, recovered once and cached, so
-- searching the library never has to touch the share.

-- One attachment's recovered text.
--
-- Keyed by attachment_id as the PRIMARY KEY rather than its own autoincrement id:
-- an attachment has exactly one extraction, and making that a key rather than a
-- convention means a second extraction REPLACEs instead of quietly accumulating
-- duplicate rows that the FTS index would then double-count.
--
-- No REFERENCES clause, per project convention (migration 0074's log): the row is
-- cleaned up by the use-case, and an orphan here is harmless -- it is a cache.
CREATE TABLE doc_attachment_text (
  attachment_id INTEGER PRIMARY KEY,        -- -> doc_attachments.id
  document_id   INTEGER NOT NULL,           -- -> doc_documents.id, for per-document lookup

  -- The recovered text, already normalised (see text-extract.ts): whitespace runs
  -- collapsed, layout padding stripped. Stored even when empty so `status` alone
  -- tells a reader what happened.
  body          TEXT    NOT NULL DEFAULT '',

  -- 'extracted' | 'needs-ocr' | 'unsupported' | 'failed'.
  -- Not a lookup table: a closed set fixed by TextExtractionStatus, validated by the
  -- module's zod schema on the way in, exactly as gam_pictionary_words.tier is.
  status        TEXT    NOT NULL,

  -- 'text-layer' | 'ocr'. Which path produced `body`.
  --
  -- Worth a column because the two are not equally trustworthy: a text layer is
  -- exact, OCR is a reading. A reader looking at a surprising search hit deserves to
  -- know which one they are looking at, and a future re-index can target only the
  -- OCR rows when the engine improves.
  source        TEXT    NOT NULL DEFAULT 'text-layer',

  page_count    INTEGER NOT NULL DEFAULT 0,
  char_count    INTEGER NOT NULL DEFAULT 0,

  -- OCR's self-reported confidence, 0-100, or NULL for a text-layer read.
  --
  -- Advisory and never used to reject a result. Measured against a real lab report,
  -- an 89%-confidence read still matched 27/27 of the terms a reader would search
  -- for; the errors were punctuation, not words.
  confidence    REAL,

  -- How long the extraction took. Kept because it is what the OCR button reports
  -- back to the reader, and because it is the only record of what this costs on the
  -- NAS -- the dev box's 3.7s/page says nothing about a DS223.
  elapsed_ms    INTEGER NOT NULL DEFAULT 0,

  -- The SHA-256 the attachment carried when this text was extracted (migration 0163).
  --
  -- This is what makes re-extraction cheap and correct: if the stored hash still
  -- matches the attachment's, the cached text is known to describe the current bytes
  -- and OCR can be skipped. A re-upload that changes the file changes the hash, and
  -- the row is then visibly stale rather than silently wrong.
  content_hash  TEXT    NOT NULL DEFAULT '',

  indexed_at    TEXT    NOT NULL DEFAULT (datetime('now')),

  -- Empty unless status = 'failed'. Shown to the reader verbatim.
  error         TEXT    NOT NULL DEFAULT ''
);

-- The work list: "which attachments still need reading", and "which are scans".
CREATE INDEX idx_doc_attachment_text_status ON doc_attachment_text (status);

-- Every extraction for one document, for the per-document view and for cleanup.
CREATE INDEX idx_doc_attachment_text_document ON doc_attachment_text (document_id);

-- The search index.
--
-- ## Why an external-content table
--
-- `content='doc_attachment_text'` means FTS5 stores only the index, not a second copy
-- of every document's text. The library is the first thing here that could hold tens
-- of megabytes of prose, and duplicating it would double the database for nothing.
--
-- ## Why unicode61 and not trigram
--
-- Measured, not assumed. `unicode61 remove_diacritics 2` folds accents, so searching
-- "cafe" finds "Café" -- which matters for a household that files documents from
-- anywhere. It also treats a CJK run as a single token, so a prefix query (房屋*)
-- matches while a mid-string fragment does not.
--
-- `trigram` would catch those mid-string fragments but only at 3+ characters, misses
-- 2-character CJK queries entirely, folds no diacritics, and builds a much larger
-- index. Carrying both was rejected as gold-plating a case this household may never
-- hit: the use-case falls back to LIKE for a short query that finds nothing, which
-- covers the gap at no storage cost.
CREATE VIRTUAL TABLE doc_text_fts USING fts5(
  body,
  content='doc_attachment_text',
  content_rowid='attachment_id',
  tokenize='unicode61 remove_diacritics 2'
);

-- The three triggers that keep the index in step with the table.
--
-- Required for an external-content table: FTS5 does not observe writes to the content
-- table by itself. The 'delete' command rows are how FTS5 is told to retract the old
-- terms -- without them an UPDATE leaves the previous text permanently searchable,
-- which is the classic external-content bug.
CREATE TRIGGER doc_attachment_text_ai AFTER INSERT ON doc_attachment_text BEGIN
  INSERT INTO doc_text_fts (rowid, body) VALUES (new.attachment_id, new.body);
END;

CREATE TRIGGER doc_attachment_text_ad AFTER DELETE ON doc_attachment_text BEGIN
  INSERT INTO doc_text_fts (doc_text_fts, rowid, body) VALUES ('delete', old.attachment_id, old.body);
END;

CREATE TRIGGER doc_attachment_text_au AFTER UPDATE ON doc_attachment_text BEGIN
  INSERT INTO doc_text_fts (doc_text_fts, rowid, body) VALUES ('delete', old.attachment_id, old.body);
  INSERT INTO doc_text_fts (rowid, body) VALUES (new.attachment_id, new.body);
END;
