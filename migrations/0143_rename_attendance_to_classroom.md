# 0143 — Rename Attendance to Classroom

Renames the module from **Attendance** to **Classroom**: the slug `attendance` →
`classroom`, the display names, and the table prefix `att_` → `cls_`.

Attendance becomes one **section group** inside Classroom, with a second group for
**Exam**. The driver is data sharing: Exam needs the roster and the classes that
Attendance already owns (`cls_students`, `cls_classes`, `cls_class_enrollments`).
As two sibling modules, Exam would have to reach across a module boundary for its
most basic input — legal through `lib/attendance`'s front door, but exactly the
coupling `ARCHITECTURE.md` → *Modules* warns about. As one module they simply share
their own tables, and there is no boundary to negotiate.

## Why not nest Attendance *under* Classroom as a module?

Because the navigation tree is two levels deep and that is a deliberate design, not
a limitation to work around. `NavigationTree → TreeModule[] → TreeSection[]`
(`src/lib/navigation/types.ts`), and `TreeSection.group` is a flat string whose own
comment says it is "a *rendering* of this field, not a second level of data".
`module-sections.ts` repeats it: "The tree spends its one level of nesting on the
module." Routes resolve as `/modules/[slug]/[section]` — one segment.

So a module cannot contain a module. Household already solves this shape: one
module, `HOUSEHOLD_RECIPE_SECTIONS` + `HOUSEHOLD_HSA_SECTIONS`, rendering as two
labelled groups. Classroom copies it.

## What the `.sql` does

Three scoped `UPDATE`s, each keyed on the **old value** so a re-run is a no-op and
an admin who has already retitled the module by hand is not stomped:

| Table | Why it needs the rename |
|---|---|
| `sys_modules` | The registry row: slug, `short_name`, `long_name`, `description`. |
| `sys_module_texture` | Keyed by `module_slug` (PK), so the module's backdrop would be orphaned. |
| `sys_user_preferences` | `favorite_module_slug` is a key/value **row**; a reader who set this module as their startup target would otherwise land on a 404. |

That third one is the easiest to miss — `favorite_module_slug` is not a column but
a `preference_key`, so it needs a value-scoped `UPDATE`. Migration 0108 records the
same trap.

### The icon is deliberately unchanged

The module keeps `roster`. `MODULE_ICON_NAMES` (`src/lib/modules/icon-names.ts`)
describes that glyph as "a class register", which fits Classroom at least as well
as it fitted Attendance, and there is no `classroom` entry in that list. Adding one
is not free: `scripts/gen-icon-glyphs.mjs` treats a module concept missing from any
of the eleven installed icon sets as fatal, so a new name means naming it eleven
times — the follow-up migrations 0055 and 0085 exist because Music Library and
Picture Gallery shipped before their glyphs did. No visible gain here to justify it.

### Why it UPDATEs rather than inserts a new module

`sys_user_module_access` is keyed by `module_id`, not by slug
(`src/lib/user/repository.ts`). Renaming the existing row therefore preserves every
user's access grant. Inserting "Classroom" and deleting "Attendance" would have
silently revoked access from everyone who had it, and the module's uploaded carousel
image with it.

## Why the table rename is *not* in this `.sql`

The seven `att_` tables become `cls_`, but that rename lives in
`LEGACY_TABLE_RENAMES` in `scripts/migrate.ts`, **not** here. A numbered migration
would crash a fresh install: migrations `0047`, `0051`, `0080`, `0082` and `0092`
already `CREATE` and `ALTER` the `att_` names, so a numbered
`ALTER TABLE ... RENAME` would run against tables that a fresh database has under
their new names and never had under the old. Same reasoning as
`0024_rename_tables_to_module_prefixes.md` and `0108`; `coding-guide.md` →
*Renaming existing tables* states the rule.

The reconciler uses SQLite's native `ALTER TABLE ... RENAME TO`, which preserves
every row and auto-rewrites index and trigger *references*. No copy-drop-rebuild,
so there is no data risk — this is a pure rename, not a constraint change.

### No two-hop trap here

0108 had to retarget its pre-prefix entries straight to `inv_` so a legacy database
renamed once rather than twice. That problem does not arise for these seven tables:
Attendance arrived at migration `0047`, **after** the `0024` prefixing, so its
tables were born as `att_*` and no pre-prefix entry in `LEGACY_TABLE_RENAMES`
targets them. The seven new entries are appended and stand alone.

### Why `cls_` and not `cla_att_`

A compound prefix was considered and rejected. `coding-guide.md` specifies a
**lowercase three-letter** module prefix, and `cla_att_` is neither three letters
nor one namespace: it encodes a hierarchy, which makes prefix length variable and
breaks every lookup that assumes three characters (`MODULE_SLUG_BY_PREFIX`,
`table-reference.ts`). It also implies a nesting the nav tree cannot express.

`cls_` names the **module's domain**, not its first feature — the rule that made
Picture Gallery `pho_` rather than `alb_`, and Tools `tol_` rather than `sql_`. It
still fits the second thing Classroom gains, which is the whole point: Exam's tables
land under `cls_` with no further rename.

## One knock-on: already-filed messages

`MESSAGE_MODULES` (`src/lib/messages/schema.ts`) lists `classroom` in place of
`attendance`, so any `sys_messages` row already filed under the old slug no longer
matches the enum. That degrades gracefully rather than breaking: `readModule` in
`src/lib/messages/repository.ts` falls back to `system` for an unrecognised slug,
precisely so one stale row cannot take the admin queue screen down.

Those rows are therefore readable but lose their module attribution, showing as
"system" instead of "Attendance". Not worth a data migration — the queue is a log of
transient notifications, and `sys_messages` has no scheduled prune, so the rows age
out of relevance on their own. Noted here so the behaviour is not mistaken for a bug.

## Historical migrations are untouched

Migrations `0047`–`0092` keep their `att_` names. A migration is immutable once it
has run anywhere (`coding-guide.md`), and the runner records applied filenames in
`sys_schema_migrations` and skips them — so editing them would change nothing on an
existing database while breaking a fresh build.

## Deploy ordering

`scripts/migrate.ts` must run against the live database **before** the new code
serves traffic. The renames are in the reconciler, which runs on every
`npm run db:migrate`; until it has run, every Classroom query targets a `cls_` table
that does not exist yet.
