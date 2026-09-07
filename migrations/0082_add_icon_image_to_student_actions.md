# Migration 0082: add an uploadable icon image to student actions

**Date:** 2026-09-05
**Type:** additive columns
**Table(s) affected:** `att_student_actions`

## What this does

Lets a teacher upload their own artwork for a student action, instead of being
limited to the ten built-in glyphs in `src/lib/attendance/action-icons.ts`. The
upload is set in Attendance → Actions, on the action's edit dialog, and shows
everywhere the action appears: the picker on the attendance sheet and the small
code chip beside a student's name.

| Column | Type | Notes |
|---|---|---|
| `icon_image` | `BLOB` (nullable) | the icon bytes; NULL when no upload is set |
| `icon_image_mime_type` | `TEXT` (nullable) | e.g. `image/png`; NULL alongside a NULL image |

Both nullable rather than defaulted: "no upload" is a real state, and an empty
blob would be a lie.

## Why a per-row column and not an ICON_SLOTS entry

The app already has a slot-based icon override system (`ICON_SLOTS` in
`src/lib/icons/slots.ts`, persisted in `ico_slot_overrides.slot_id`), and it is
the wrong tool here. A slot id is code-registered and permanent — it exists
because some call site reads it, and renaming one orphans a user's upload. A
student action is a row a teacher creates at runtime, so there is no id to
register at build time and no call site that knows it. The per-row icon pattern
is the only one that fits, and it is already the app's established answer.

## Why a BLOB and not a base64 data URL

Mirrors `sys_users.avatar` (0011), `exp_creditcard_accounts.card_image` (0031),
`exp_categories.icon_image` (0034), `stk_investment_accounts.icon_image` (0037)
and the journal taxonomy icons (0042), for the same reasons:

- The bytes are served by a dedicated route
  (`/api/attendance/actions/[id]/icon`), so they never ride along in a page's
  JSON payload.
- Reads of the catalog therefore keep **selecting columns explicitly**.
  `STUDENT_ACTION_COLUMNS` in `src/lib/attendance/repository.ts` already existed
  and is unchanged in substance — it gains only `icon_image_mime_type`, never
  `icon_image` — so the blob stays out of every picker, register and report.
  Only the icon-serving path reads the blob column.

Plain `ALTER TABLE ADD COLUMN`: simple additive nullable columns, no rebuild
needed, existing rows are valid as they stand. No new index — the table is small
and keyed by `id`.

## Relationship to the existing `icon` column

`icon` (a key into `ATTENDANCE_ACTION_ICONS`, `''` for none) stays and keeps its
meaning. An upload **wins while it is present**; removing the upload falls back
to the built-in glyph, which is why the glyph choice is not cleared on upload.
An action with neither still draws its code alone, exactly as before.

## Constraints enforced in code, not the database

The use-case rejects anything that isn't `image/png`, `image/jpeg`, `image/webp`
or `image/gif` and caps the decoded size at 128 KB
(`MAX_ATTENDANCE_ACTION_ICON_BYTES`) — the same cap as an expense category and a
journal taxonomy icon, since all three render small. SVG is deliberately excluded:
it can carry script and would be served from the app's own origin. Decoding and
validation reuse `src/lib/shared/image-upload.ts`, so the allowlist can't drift
per module.

## Data handling

Existing actions get NULL for both columns — no upload — and render exactly as
they did before, from their built-in glyph. Nothing is backfilled.

## Rollback

```sql
ALTER TABLE att_student_actions DROP COLUMN icon_image_mime_type;
ALTER TABLE att_student_actions DROP COLUMN icon_image;
```
