# 0184 — Snippet encryption, source URL and notes

Two unrelated additions in one migration, because both are plain `ADD COLUMN` on
the same two tables and splitting them would mean rewriting the same file twice.

## 1. Per-snippet encryption

The columns and the blob format are the Journal's (`0131`), and the
implementation is shared — `encryption.ts` was promoted to `src/lib/shared/` when
Clips became the second caller, and this is the third. Nothing new is invented.

- **Why a snippet would be sealed.** A snippet is often the shape of a
  credential: a connection string with a password in it, an API call carrying a
  token, a config block with a secret. Exactly the things worth keeping, and
  exactly the things that should not sit in plaintext in a shared library.
- **Ownership, and there is no recovery.** A journal entry belongs to one
  person; a snippet is the household's, like a clip. Anyone granted the module
  who has the password can open it, and anyone who forgets it loses that snippet
  **for everyone**. No admin override, no reset, no backdoor.
- **Taxonomy and language stay plaintext**, mirroring Clips. A sealed snippet is
  still findable by its labels and filterable by language; its text is not
  searchable while sealed, which is the point.
- **The bin mirrors the encryption columns too.** Without them, deleting a
  sealed snippet and restoring it would hand back an empty one — the ciphertext
  is the only copy of the content.

One difference from Clips worth noting: the column is `code_encrypted`, not
`content_encrypted`, to match this module's `code` column. The format inside it
is identical.

## 2. `source_url` and `notes`

- **`source_url`** — a snippet is frequently lifted from somewhere, and six
  months later the question is not what the code does but whether there is a
  newer version of it. A URL answers that; nothing else in the row does.
- **`notes`** — the sentence that does not belong in the code: why this
  approach, what it breaks, which version it needs. Deliberately **not** the
  body. The body has to stay copy-pasteable verbatim, and commenting an
  explanation into it would mean pasting that explanation into a terminal
  every time.

Both are blank-not-NULL, like every other optional text column here.
