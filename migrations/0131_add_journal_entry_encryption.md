# Migration 0131: per-entry encryption for journal entries

**Date:** 2026-10-06
**Type:** four column adds + one index on `jrn_entries`

## What this does

| Object | Change |
|---|---|
| `jrn_entries.is_encrypted` | **added**, `INTEGER NOT NULL DEFAULT 0` |
| `jrn_entries.title_encrypted` | **added**, `TEXT NOT NULL DEFAULT ''` |
| `jrn_entries.content_encrypted` | **added**, `TEXT NOT NULL DEFAULT ''` |
| `jrn_entries.password_hint` | **added**, `TEXT NOT NULL DEFAULT ''`, **plaintext** |
| `idx_jrn_entries_is_encrypted` | **added** |

Every existing row reads as a normal unencrypted entry: `is_encrypted = 0`, both
blob columns `''`. Nothing is rewritten and no entry changes meaning.

## What an encrypted entry looks like

| Field | State |
|---|---|
| `title`, `content` | overwritten with `''` |
| `title_encrypted`, `content_encrypted` | `v1:salt:iv:tag:ciphertext` |
| date, time, place, weather, categories, tags, locations | **unchanged, plaintext** |
| images | **unchanged, plaintext** — attachments are out of scope |

The metadata stays readable on purpose: the entry still has to appear in the
entry list, on the calendar and under its tags. What is sealed is what the reader
wrote.

## The blob format

`v1:salt:iv:tag:ciphertext`, every field hex, written by
[`src/lib/journal/encryption.ts`](../src/lib/journal/encryption.ts).

- `scryptSync(password, salt, 32)` — the same primitive as `@/lib/shared/password`
- AES-256-GCM, **fresh 16-byte salt and 12-byte IV on every encryption**
- Title and content are separate blobs under the same password, each with its own
  salt and IV — never one key, two plaintexts, one IV
- The `v1` prefix makes a future cipher change a parse branch rather than a
  migration over every row

**No verifier hash is stored anywhere.** The GCM authentication tag is the
password check: a wrong key makes `final()` throw. A separate hash would add an
offline cracking target independent of the ciphertext and tell us nothing new.

## There is no recovery

Forgetting an entry's password destroys that entry permanently. No admin
override, no reset, no backdoor — that is the point of the feature, not a gap in
it. The encrypt dialog says so in plain words and requires the password twice.

The **hint is stored in the clear**, which is what makes it usable before
decryption and also what makes it dangerous: it must never contain the password.
The UI says this where the hint is typed.

## Why `is_locked` is not involved

`is_locked` guards editing and nothing else — confirmed with Min before this
shipped. It has never encrypted anything, and overloading it would have made a
pre-existing lock silently mean "encrypted" on upgrade. The two flags are
independent: an entry can be locked, encrypted, both, or neither.

## Knock-on behaviour elsewhere

Encrypted entries are deliberately excluded from four places that would otherwise
read `''` as real content:

| Where | Why |
|---|---|
| `searchEntries` | a `LIKE` over blanked columns would match everything or nothing |
| `word-stats` | Top 10 Words would rank the empty string |
| `duplicates` | every encrypted entry on one date would group as a false duplicate, the same trap untitled entries are already skipped for |
| the importer's `TRIM(title)` match key | a CSV/ICS re-import must never target or overwrite an encrypted entry |

Lists, the viewer, the calendar and the neighbour strip show a placeholder in
place of the title.

## Rollback

```sql
DROP INDEX IF EXISTS idx_jrn_entries_is_encrypted;
ALTER TABLE jrn_entries DROP COLUMN password_hint;
ALTER TABLE jrn_entries DROP COLUMN content_encrypted;
ALTER TABLE jrn_entries DROP COLUMN title_encrypted;
ALTER TABLE jrn_entries DROP COLUMN is_encrypted;
```

**Rolling back destroys the text of every encrypted entry.** The ciphertext is
the only copy — the plaintext columns were blanked when it was encrypted. Decrypt
and remove encryption from every entry *before* rolling this back, or those
entries are lost.
