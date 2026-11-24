-- Two unrelated additions to a snippet, in one migration because both are plain
-- `ADD COLUMN` on the same table and splitting them would mean rewriting the
-- same file twice.
--
-- ============================================================================
-- 1. Per-snippet encryption
-- ============================================================================
--
-- The columns and the blob format are the Journal's (migration 0131) and the
-- implementation is literally shared — `encryption.ts` was promoted to
-- `src/lib/shared/` for Clips to reuse, and this is the third caller. Nothing
-- new is invented here.
--
-- WHY A SNIPPET WOULD BE SEALED. A snippet is often the shape of a credential: a
-- connection string with a password in it, an API call carrying a token, a
-- config block with a secret. Those are exactly the things worth keeping and
-- exactly the things that should not sit in plaintext in a shared library.
--
-- OWNERSHIP, AND THERE IS NO RECOVERY. A journal entry belongs to one person; a
-- snippet is the household's, like a clip. Anyone granted the module who has the
-- password can open it, and anyone who forgets it loses that snippet **for
-- everyone**. No admin override, no reset, no backdoor. The UI says so before
-- sealing anything.
--
-- THE TAXONOMY AND THE LANGUAGE STAY PLAINTEXT, mirroring Clips: a sealed
-- snippet is still findable by its labels and still filterable by language. Its
-- text is not searchable while sealed, which is the point.
ALTER TABLE cod_snippets ADD COLUMN is_encrypted INTEGER NOT NULL DEFAULT 0;

-- `v1:salt:iv:tag:ciphertext`, hex, written by @/lib/shared/encryption. Blank
-- while the snippet is open. Title and body are separate blobs under the same
-- password, each with its own salt and IV — never one key, two plaintexts, one IV.
ALTER TABLE cod_snippets ADD COLUMN title_encrypted TEXT NOT NULL DEFAULT '';
ALTER TABLE cod_snippets ADD COLUMN code_encrypted  TEXT NOT NULL DEFAULT '';

-- Stored in the CLEAR, which is what makes it readable before decryption and
-- also what makes it dangerous: it must never contain the password. The schema
-- refuses the obvious case (a hint containing the password verbatim); it cannot
-- catch a subtle one.
ALTER TABLE cod_snippets ADD COLUMN password_hint TEXT NOT NULL DEFAULT '';

-- The bin mirrors the whole row, so a sealed snippet is binned sealed and comes
-- back sealed. Without these, deleting a sealed snippet would restore it as an
-- empty one — the ciphertext is the only copy of the content.
ALTER TABLE cod_recycled_snippets ADD COLUMN is_encrypted    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cod_recycled_snippets ADD COLUMN title_encrypted TEXT    NOT NULL DEFAULT '';
ALTER TABLE cod_recycled_snippets ADD COLUMN code_encrypted  TEXT    NOT NULL DEFAULT '';
ALTER TABLE cod_recycled_snippets ADD COLUMN password_hint   TEXT    NOT NULL DEFAULT '';

-- ============================================================================
-- 2. Where it came from, and the prose around it
-- ============================================================================
--
-- A snippet is frequently lifted from somewhere — a Stack Overflow answer, a
-- README, a vendor's docs — and six months later the question is not what the
-- code does but whether there is a newer version of it. A URL answers that and
-- nothing else in the row does.
--
-- `notes` is for the sentence that does not belong in the code: why this
-- approach, what it breaks, which version it needs. Deliberately NOT the body:
-- the body has to stay copy-pasteable verbatim, and commenting an explanation
-- into it would mean pasting that explanation into a terminal.
ALTER TABLE cod_snippets ADD COLUMN source_url TEXT NOT NULL DEFAULT '';
ALTER TABLE cod_snippets ADD COLUMN notes      TEXT NOT NULL DEFAULT '';

ALTER TABLE cod_recycled_snippets ADD COLUMN source_url TEXT NOT NULL DEFAULT '';
ALTER TABLE cod_recycled_snippets ADD COLUMN notes      TEXT NOT NULL DEFAULT '';
