# Encryption plans — journal entries and a secrets vault

Two designed features, written up so a later session can pick either one up without
re-deriving the reasoning. **Plan 1 (encrypted journal entries) has since been
built** — migration 0131, `src/lib/journal/encryption.ts`, `EncryptionPrompt` — see
`migrations/0131_add_journal_entry_encryption.md` and `CHANGE_HISTORY.md` (2026-10-07);
read that, not this plan, for what shipped. **Plan 2 (the secrets vault) is still
unbuilt.** The Plan 1 text below is kept as the design record.

Both plans were agreed with Min across a design conversation on 2026-10-06. The
open questions at the end of each are genuinely open — they are not rhetorical,
and the answers change the work.

Read `./ARCHITECTURE.md`, `./design.md`, `./components.md` and `./modules.md`
before building either, per `CLAUDE.md`.

---

## Shared background: what already exists

- [`src/lib/shared/password.ts`](src/lib/shared/password.ts) — `scryptSync` with a
  random 16-byte salt per password, stored `salt:hash`. This is the **only**
  salting in the app. There is no application-wide salt key and no pepper.
- [`src/lib/shared/secret.ts`](src/lib/shared/secret.ts) — `secureCompare`,
  SHA-256 then `timingSafeEqual`.
- `ADMIN_SIGNUP_SECRET` is the only secret the app reads from env. There is no
  `SESSION_SECRET`, `JWT_SECRET` or `ENCRYPTION_KEY`.
- `jrn_entries.is_locked` is an **edit guard only** — confirmed by Min. It does
  not encrypt and must not be overloaded to mean encryption. A locked *and*
  encrypted entry is simply an encrypted entry you also cannot edit.

---

# Plan 1 — Encrypted journal entries

One password **per entry**. The same password may be reused across entries, but
each entry is independently sealed. Nobody opens an entry without its password.

## Decisions already made

| Question | Decision |
|---|---|
| Where crypto runs | **Server-side in `src/lib/`.** Keeps the layering rule and CLI parity. Accepts that the password transits to the server — fine for a LAN-only NAS app. |
| What is encrypted | **Title *and* content.** Date, categories, tags and place stay plaintext. |
| Unlock lifetime | **Until navigation away.** React state only; `NavTree` remounts on every navigation, so this is the natural behaviour. |
| Editing | **Allowed while unlocked.** Save re-encrypts with the held password; close or navigate away discards, leaving ciphertext untouched. |
| Images | **Out of scope.** Attachments stay plaintext — say so in the encrypt dialog so there is no false impression. |
| Bin / restore | **No special handling.** The blob moves to the bin and back as-is. |
| Password hint | **Stored plaintext** beside the entry, shown on the unlock prompt. |

## Crypto design

New file `src/lib/journal/encryption.ts`, pure functions, no I/O:

```
encryptEntryText(plain, password) -> "v1:salt:iv:tag:ciphertext"   (all hex)
decryptEntryText(blob, password)  -> plain | throws WrongPasswordError
```

- `scryptSync(password, salt, 32)` — same primitive as `password.ts`, fresh
  16-byte random salt per encryption.
- AES-256-GCM, 12-byte random IV, 16-byte auth tag.
- `v1:` prefix so a future algorithm change is a parse branch, not a migration
  of every stored blob.
- Title and content are **separate blobs under the same password**, each with its
  own salt and IV. Never reuse an IV across two plaintexts under one key.
- **No verifier hash is stored.** The GCM auth tag *is* the password check. A
  separate verifier would be extra attack surface for zero benefit.

**Forgetting the password destroys the entry permanently.** No recovery, no admin
override, no backdoor. The encrypt dialog must say this in plain words and carry
a confirm-password field.

## Migration `0131_add_journal_entry_encryption`

Columns on `jrn_entries`:

| Column | Type | Purpose |
|---|---|---|
| `is_encrypted` | `INTEGER NOT NULL DEFAULT 0` | flag that lists and filters read |
| `title_encrypted` | `TEXT NOT NULL DEFAULT ''` | `v1:…` blob |
| `content_encrypted` | `TEXT NOT NULL DEFAULT ''` | `v1:…` blob |
| `password_hint` | `TEXT NOT NULL DEFAULT ''` | **plaintext**, shown on the prompt |

On encrypt, plaintext `title` and `content` are overwritten with `''`. The
ciphertext becomes the only copy — no shadow of the original stays behind.

Write the paired `.md` log, per `coding-guide.md`.

## The five collisions from encrypting the title

Encrypting the title reaches further than content alone. Each site below assumes
a readable title and needs a deliberate change:

| Site | Collision | Handling |
|---|---|---|
| [`repository.ts:310-335`](src/lib/journal/repository.ts#L310-L335) `searchEntries` | `title`/`content LIKE` would match `''` | Exclude encrypted entries from title/body search; still findable by date and tag |
| [`word-stats.ts:184`](src/lib/journal/word-stats.ts#L184) | tokenizes `title + content` | Skip encrypted entries, else Top 10 Words ranks nothing useful |
| [`duplicates.ts:64`](src/lib/journal/duplicates.ts#L64) | keys on `date + lowercased title` | Skip encrypted — every encrypted entry on one date would read as a false duplicate group, the same trap the untitled-entry skip at [`:83`](src/lib/journal/duplicates.ts#L83) already avoids |
| [`repository.ts:505-532`](src/lib/journal/repository.ts#L505-L532) | importer dedupe on `TRIM(title)` | Exclude encrypted from the match key so a CSV/ICS re-import can never target or overwrite one |
| [`journal-entries-view.tsx:63`](src/app/(protected)/modules/[slug]/journal-entries-view.tsx#L63), [`journal-viewer.tsx:353`](src/components/journal-viewer.tsx#L353) | render raw title | Render a placeholder when `is_encrypted` |

`calendar.ts`, `same-date.ts` and `neighbors.ts` also show titles and need the
same placeholder treatment.

## Edit-while-unlocked — the delicate part

The password must survive from unlock to save without ever being persisted.

- Held in **React state in the entry view only**. Never `localStorage`, never a
  cookie, never a DB row.
- `updateJournalEntryAction` ([`journal-actions.ts:173`](src/app/(protected)/modules/[slug]/journal-actions.ts#L173))
  gains an optional `password` parameter. When the entry is encrypted, it
  re-encrypts title and content with **fresh salt and IV** before writing.
  Reusing the old IV under the same key leaks plaintext relationships between
  versions, so new randomness on every save is mandatory.
- **Guard:** if the entry is encrypted and no password reaches the action, it
  **throws rather than writing plaintext.** Silently saving an encrypted entry's
  body in the clear is the one bug here that would be both unrecoverable and
  invisible. It gets an explicit guard and a dedicated test.
- Navigating away drops the state.

**No TTL timer.** Close-or-navigate already bounds the lifetime, and a timer
expiring mid-edit would discard writing in progress — worse than the problem it
solves. Min was offered one and declined.

## Files

**Create**
- `src/lib/journal/encryption.ts`
- `src/lib/journal/encryption.test.ts` — round-trip, wrong password, tampered
  blob, malformed blob, distinct salt/IV across calls
- `src/components/encryption-prompt.tsx` — from `src/components/_component-template.tsx`
- `migrations/0131_add_journal_entry_encryption.sql` + `.md`

**Modify**
- `src/lib/journal/types.ts`, `schema.ts` — `isEncrypted`, `passwordHint`
- `src/lib/journal/repository.ts` — four columns through select/insert/update/bin;
  the two exclusions above
- `src/lib/journal/journal.ts` — `encryptEntry` / `decryptEntry` / `removeEncryption`
- `src/lib/journal/word-stats.ts`, `duplicates.ts` — skip encrypted
- `src/lib/journal/calendar.ts`, `same-date.ts`, `neighbors.ts` — placeholder title
- `src/app/(protected)/modules/[slug]/journal-actions.ts` — three new actions plus
  `password` on the update action
- `src/components/journal-viewer.tsx` — locked state, unlock prompt, Encrypt /
  Remove-encryption buttons
- `src/app/(protected)/modules/[slug]/journal-entry-form.tsx`,
  `journal-entries-view.tsx` — carry the password through save; placeholder titles
- `components.md`, and the journal CLI commands for parity

## Server actions

Each authorises on its first line with `requireModuleAccess(JOURNAL_MODULE_SLUG)`
— the slug is `"journal"`.

- `encryptEntryAction(id, password, hint)` — encrypt, blank plaintext, set flag
- `decryptEntryAction(id, password)` — returns plaintext for display; **never writes**
- `removeEncryptionAction(id, password)` — decrypt and restore plaintext permanently

## Compact behaviour

The unlock prompt renders **inline in the entry body** — not a floating surface,
not a new bar. Nothing touches the bottom edge, which the shared nav and the music
player already claim. Restyle with `max-lg:` variants only.

## Dependencies

**None.** Node's built-in `crypto` covers all of it. Nothing paid or metered.

## Still unconfirmed — ask Min before building

1. **Icon slot ids.** Permanent once uploads exist, so confirm before creating:

   | Slot id | Label | Where |
   |---|---|---|
   | `journal-entry-encrypted` | Encrypted entry | Lock badge on encrypted rows in lists, viewer header, calendar cells |
   | `journal-encrypt-action` | Encrypt entry | The Encrypt button in the viewer toolbar |

   Deliberately **not** slotted: the unlock prompt's own glyph and the
   wrong-password error icon — both are state glyphs inside one component, which
   the icon rule keeps as bare glyphs.

2. **The component name `EncryptionPrompt`.** It will appear in the viewer and
   possibly the editor, so by the reuse-first rule it belongs in
   `src/components/` and in `components.md`.

---

# Plan 2 — A KeePass-style secrets vault

One master password unlocks **many** secrets. This is a **new module**, not a
feature: new slug, `DEFAULT_MODULES` entry, migration, sections,
`module-sections.ts` registration, tree wiring, icon slots. Materially bigger
than Plan 1. No slug has been chosen yet.

## Why the key hierarchy, and not the obvious thing

Do **not** encrypt secrets with the master password directly. Use two layers:

```
master password
      |  Argon2id (or scrypt), per-vault salt
      v
  master key ---- unwraps ----> vault key (random 32 bytes)
                                      |
                                      | AES-256-GCM, own IV per secret
                                      v
                             each secret's ciphertext
```

The **vault key** is random, generated once, never derived. It is stored only in
*wrapped* form. Unlocking derives the master key, unwraps the vault key, and
holds that in memory.

Why the indirection earns its keep:

- **Changing the master password is instant** — re-wrap one 32-byte key. The
  direct alternative means re-encrypting every secret on every password change,
  and a crash midway leaves the vault half-readable under each password.
- Each secret gets its own IV under the shared vault key, so no two secrets leak
  relationships.
- One verification point instead of N.
- It is what makes multiple unlock factors nearly free (see below).

This is KeePass's composite-key design.

## KDF: Argon2id preferred

Plan 1 uses `scryptSync` because it is already in the codebase and the threat is
modest. A vault holding *every* password you own deserves better.

| | scrypt | Argon2id |
|---|---|---|
| In Node core | yes | no — needs a dependency |
| GPU resistance | good | **better** |
| Side-channel resistance | — | **designed for it** |
| Status | solid | **current OWASP recommendation** |

Dependency options, both **free and MIT**: `argon2` (native, needs build tools on
Windows) or `hash-wasm` (pure WASM, no build step — **preferred on Min's setup**).

Parameters: OWASP minimum is 19 MiB / 2 iterations / 1 parallelism. Go higher —
**64 MiB, 3 iterations** — since unlock is rare and 0.5s is invisible to a human
but expensive for an attacker. Store `kdf_params` as JSON so cost can be raised
later without breaking existing vaults.

Zero-dependency fallback: `scryptSync` at `N=2^17, r=8, p=1` (~128 MB) is still
genuinely strong. A legitimate choice, just not the best one.

## Schema sketch — `vlt_` prefix

**`vlt_vault_keys`** — one row per unlock factor. This table is what makes
multi-factor and factor-rotation cheap.

| column | notes |
|---|---|
| `id` | |
| `kind` | `"password"` \| `"keyfile"` \| `"webauthn"` |
| `kdf_salt`, `kdf_params` | null for a raw key file |
| `wrapped_vault_key` | `iv:tag:ciphertext` — the **same** vault key in every row |
| `label` | "my password", "USB backup" |
| `kdf_version` | |

**`vlt_secrets`**

| column | notes |
|---|---|
| `id` | |
| `title` | **plaintext** — see trade below |
| `username_encrypted`, `password_encrypted`, `notes_encrypted`, `url_encrypted` | |
| `created_at`, `updated_at` | |

**Titles stay plaintext**, unlike Plan 1. A password manager you cannot browse
while locked is painful, and "Gmail" is not the secret — the password is. This is
a real trade and Min has **not** yet confirmed it.

## Where the unlocked vault key lives

The design question that actually matters.

- **Server-side session (recommended).** Vault key in a server-side map keyed by
  session, TTL ~15 min, cleared on logout. Fits the `src/lib/` layering, works
  with the CLI, fully testable. Cost: the key sits in server process memory.
- **Client-side WebCrypto.** True zero-knowledge, but crypto logic leaves
  `src/lib/` and the CLI could never decrypt — breaking two project rules.
- **Hybrid.** More work, defers the choice.

For a LAN-only NAS app where Min is the only user, **server-side session is the
right answer**: the threat model justifying client-side crypto is "I don't trust
the server operator," and Min *is* the server operator.

## Second factors — what works and what does not

Min asked specifically about Google Authenticator. **TOTP is the wrong primitive
and should not be used here.** Recorded so it is not revisited from scratch:

- A TOTP code **rotates every 30 seconds** — a key that changes cannot open what
  the previous key sealed.
- Six digits is **~20 bits**. Even frozen, that is 10^6 guesses, cracked in well
  under a second against a stolen DB file.
- TOTP proves *presence now*; encryption needs a secret that *persists*.

| Approach | Real 2FA? | Server can bypass? | Survives lost factor? |
|---|---|---|---|
| TOTP as a gate before unwrapping | no — bypassed by anyone running the crypto directly | **yes** | yes |
| TOTP shared secret in the KDF | partly | **yes** — the app must store the secret to verify codes, so it sits in the same DB as the wrapped key | no |
| **Key file** | **yes** | no | with backup |
| **WebAuthn PRF** | **yes** | no | with a 2nd credential |

**Key file** is what KeePass actually does and the recommended path: a random
32-byte blob on removable media, composited into derivation as
`Argon2id(password ‖ keyfile_bytes, salt)`. Genuine "something you have", full
256 bits, stable, and copyable so it can be backed up.

**WebAuthn PRF** is strictly better if available — the authenticator
deterministically derives a stable high-entropy secret, so a biometric or YubiKey
touch replaces carrying a file. **Requires HTTPS**, which the NAS app may not
have on the LAN. Check before planning around it.

## AND versus OR — Min's follow-up question

Min asked whether the key file alone could decrypt, *without* remembering the
password. **Yes** — and the indirection makes it nearly free: store the same
vault key wrapped once under each factor, as separate `vlt_vault_keys` rows.
Unlock tries whichever credential is presented; the GCM auth tag says whether it
worked. Adding a factor is one insert; revoking one is one delete; **no secret is
ever re-encrypted.**

But be deliberate about which you build:

| | Composite (AND) | Alternative (OR) |
|---|---|---|
| Strength | **both** needed | only the **weakest** needed |
| Key file stolen alone | vault safe | **vault open** |
| Password forgotten | vault lost | vault fine |
| Key file lost | vault lost | vault fine |

With OR, security equals whichever factor is easiest to steal. A 32-byte key file
has far better entropy than a memorable password, but it is a **bearer token**:
whoever holds it is you — no typing, no second check, no trace.

If the goal is "don't lock me out when I forget the password", the recommended
shape is password-alone for daily use **plus** key-file-alone as a **recovery
key**, with one hard rule:

> **The key file must never live anywhere the encrypted database also lives.** A
> key file sitting on the NAS beside `//NAS_DS223/app/myhomebase/data/` provides
> *zero* protection against anyone who can read that share.

This mirrors 1Password's Secret Key and most disk-encryption schemes.

Alternative worth offering Min: a long passphrase written down and stored
physically gets the same resilience with no bearer-token risk — paper does not
get copied by a sync client.

## Things that are easy to get wrong

- **Never store a hash of the master password.** The GCM auth tag on the wrapped
  vault key is the verification. A separate verifier is extra attack surface for
  no benefit.
- **Clipboard auto-clear** ~30s after copying a password out.
- **Lock on idle**, not only on logout.
- **No recovery path.** A recovery mechanism is a backdoor by another name. The
  multi-factor wrapping above is the sanctioned way to stay resilient.
- **Back up the DB file.** A corrupted vault with no backup is total loss, and the
  live DB is on the NAS.
- **Store multiple wrapped copies of the vault key** so losing one factor does not
  destroy the vault. Nearly free, and the single highest-value safeguard here.

## Open questions for Min

1. **Argon2id with a dependency (`hash-wasm` preferred), or scrypt with none?**
2. **Plaintext titles** — confirm the browse-while-locked trade is acceptable.
3. **AND or OR** for the second factor — or password-only for v1, adding factors
   later (cheap, by design).
4. **Module slug, names, icon and sections** — nothing chosen. Read `modules.md`
   and follow the recipe; the module must not build its own navigation.
5. **Shared crypto helper?** A common `src/lib/shared/crypto.ts` for AES-GCM
   envelope encrypt/decrypt would serve both plans. By the project's "a piece two
   modules want" rule that is where it belongs — but only build it when the second
   caller actually exists, i.e. when the vault is started, not during Plan 1.

---

## Status

Plan 1 is **built (2026-10-06/07), not yet verified on screen** — slots
`journal_entry_encrypted` and `journal_encrypt_action` registered. Plan 2 is **designed,
approved in principle, and unbuilt**; it needs its five open questions answered and a module registration
decided before any code.

Per `CLAUDE.md`, present a plan and wait for approval before writing code for
either — and do not run any quality gate unless Min explicitly asks.
