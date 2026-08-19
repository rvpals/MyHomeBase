# 0051 — Attendance: pre-defined student actions

## What changed

Two new tables:

- **`att_student_actions`** — the teacher-editable catalog of actions. `name`,
  `code`, `description`, `icon`, `sequence`, `is_active`.
- **`att_attendance_entry_actions`** — which actions a student picked up in one
  saved session. `(attendance_record_id, student_id, action_id)` plus a
  denormalized `action_code` and `action_name`.

Seeded with the two actions the feature ships with: **Late / `L` / turtle** and
**Extra Credit / `EC` / `$+`**.

## Why

Taking the register answers one question — was this student here. A teacher
marking it also wants to note a handful of other things about the day: they
arrived late, they went up to the board and earned extra credit. Those are a
small, closed, teacher-editable set of facts.

That's why it's a catalog plus a join table rather than a `note TEXT` column on
`att_attendance_entries`. A free-text note can be read but not counted; a code
can be tallied ("late four times this term"), filtered, and printed as a chip.
The catalog is a table rather than a hardcoded list because which actions matter
is a per-teacher, per-term judgement, and changing it must not be a deploy.

## Decisions worth recording

**Many-to-many, not a column.** A student can be late *and* earn extra credit in
the same lesson. A single `action_id` column on the entry row would force a
choice between two facts that don't compete. Hence the join table, with a unique
index on `(attendance_record_id, student_id, action_id)` so recording the same
action twice in one session is rejected rather than silently doubled — that's a
caller bug, not a second fact.

**Keyed on `(record_id, student_id)`, not on `att_attendance_entries.id`.** The
entries table has a surrogate `id`, so pointing at it would work. Keying on the
record and the student instead makes this table read exactly the way the entries
do — both hang off the record — and means a reader joining the two needs no
knowledge of the entry's surrogate key.

**`action_code` and `action_name` are denormalized on purpose.** Same reasoning
as `class_name` and `student_name` in 0047: a report printed last term has to keep
reading the way it did when it was taken. Renaming "Extra Credit" to "Bonus"
must not rewrite what was already printed. `action_id` is kept alongside them
because the cross-session tally ("how many times was this student late") wants to
count the *current* catalog entry, and a code can be renamed.

**No date in any unique index.** The coding guide's rule, which 0049 restored to
this module with no carve-out. Nothing here is keyed on `attendance_date` — the
session's record id is the identity, and it identifies a session exactly.

**`is_active` rather than a hard delete.** Once an action has been recorded, its
catalog row is the only place the icon and the description live; the recorded rows
carry only the code and the name. Hard-deleting would leave past sessions
half-described, so retiring sets `is_active = 0` and drops the action out of the
picker while leaving the history readable. The repository still hard-deletes a
row that has **never** been used, because an action created by a typo shouldn't
linger as a tombstone.

**`code` is unique `COLLATE NOCASE`.** `l` and `L` are the same code to a
teacher, and two catalog rows differing only in case would be indistinguishable
in the chip a report prints.

## Icons — why a third registry

`icon` is a key into `ATTENDANCE_ACTION_ICONS`
(`src/lib/attendance/action-icons.ts`), rendered by
`src/components/attendance-action-icon.tsx`. It is deliberately **not** a module
icon concept and **not** a `TreeIcon` concept.

`modules.md` records why: adding a concept to either of those means hand-drawing
it for the `classic` set *and* naming a candidate for all 12 generated sets in
`scripts/gen-icon-glyphs.mjs`, or the generator fails. That cost is right for a
module's identity glyph. It is wrong here, where the whole point is that a teacher
picks an icon from a menu at runtime without a code change — and where a turtle
and a `$+` are concepts no general icon set is going to carry anyway.

So this is a small, hand-drawn, monochrome set local to the Attendance module,
outside the user's icon-set choice. A key the set doesn't know draws nothing
rather than throwing: a catalog row can outlive a glyph, exactly as
`resolveAttendanceSettings` treats a stale class id as "not set".

## Seeding the two actions

An empty catalog would make the new ⚡ button on the register look broken the
first time anyone taps it — a picker with nothing in it reads as a bug, not as an
invitation to go and configure one. The two seeded rows are also what the user
asked for by name.

They are inserted here rather than in a separate seed migration because they are
this feature's *content*, not a module registration — nothing in
`DEFAULT_MODULES` mirrors them, and "Reset to Default" has no opinion about them.
