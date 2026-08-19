# Modules

The registry of MyHomeBase's feature modules, and the recipe for adding another
one consistently.

This complements — does not replace — `ARCHITECTURE.md` (layering and the
module boundary rules), `coding-guide.md` (table prefixes and migrations),
`components.md` (reusable UI), and `design.md` (styling). Read this one before
creating a module or changing what a module *is*; read those for how to write the
code inside it.

## What a module is here

Two senses of the word, and they must not be confused:

- **A registered feature module** — a row in `sys_modules`. It has a slug, names,
  a description, a sequence, an icon, and optional carousel artwork. It appears
  on the home grid and the app bar, is grantable per-user, and is reachable at
  `/modules/<slug>`. That's what this document registers.
- **A library module** — a folder under `src/lib/`, used only via its `index.ts`
  (`ARCHITECTURE.md` → *Modules*). A feature module owns one or more of these;
  plenty of library modules (`auth`, `weather`, `settings`) back no feature
  module at all.

## The registry

Field names below are the domain type's (`Module` in
[src/lib/modules/types.ts](src/lib/modules/types.ts)); the `sys_modules` columns
are the `snake_case` equivalents.

| Slug | Short name | Long name | Description | Seq | Icon | Prefix |
|---|---|---|---|---|---|---|
| `stock-etfs` | Stocks & ETFs | Stock & ETFs etc | Manage stock and ETF investments. | 2 | `chart` | `stk_` |
| `journal` | Journal | My Journal | A place to keep a journal with daily recordings. | 3 | `journal` | `jrn_` |
| `csv-analysis` | CSV Analysis | CSV Data Analysis | Import a CSV file for analytics. | 4 | `folder` | `csv_` |
| `expense` | Expense | Expense Tracker | Track credit-card spending by category. | 5 | `wallet` | `exp_` |
| `attendance` | Attendance | Class Attendance | Take daily attendance for a class. | 6 | `roster` | `att_` |
| `music-library` | Music Library | My Music Library | Browse and stream your music collection. | 7 | `music` | `mus_` |

Sequence 1 is deliberately vacant: it belonged to the Real Estate module, retired
in `migrations/0026_drop_real_estate_module`. Its `rei_` prefix is retired with
it and must not be reused.

`sys_` is the platform prefix — settings, users, sessions, module registration
itself. It is not a feature module and never appears in the table above.

Short name is what the UI shows (home grid, app bar, nav badge). Long name is the
fuller title for admin screens. Both are **admin-editable at runtime**, so no
component may hardcode either — read them from the module row, as
[attendance-section.tsx](src/app/(protected)/modules/[slug]/attendance-section.tsx)
does before badging the nav.

### Per-module detail

**Stocks & ETFs** (`stock-etfs`) — the largest module. Brokerage accounts,
positions, transactions, watch lists, a daily-glance dashboard, ticker detail
with news and risk, and CSV import from broker statements. Backed by several
library modules (`stock-positions`, `stock-analytics`, `stock-watchlist`,
`stock-daily-snapshot`, `investment-accounts`, `market-data`, `ticker-*`) that
all share the one `stk_` table prefix.

**Journal** (`journal`) — dated entries with categories, tags, locations (with a
map), and images; saved filters; CSV import. A filter query travels in the URL
(`?filter=`) so a filtered list is linkable. Library: `src/lib/journal`.

**CSV Analysis** (`csv-analysis`) — import an arbitrary CSV, which creates a
per-entry table (`csv_<name>`, from `buildTableName`), then chart and analyse it.
The one module with **no tree nav and no sections**: its whole UI is a single
view. Library: `src/lib/csv-analytics`, `src/lib/csv-import`.

**Expense** (`expense`) — credit-card transactions imported from CSV, categorised
by post-import rules, with a dashboard and charts. Library: `src/lib/expense`.

**Attendance** (`attendance`) — students, classes, enrollment, and daily
registers with a printable report. A class may be registered several times a day;
each save is its own timestamped session. A teacher-editable catalog of **student
actions** (Late, Extra Credit, …) is recorded per student per session and printed
on the report — the actions carry their own small glyph set
(`ATTENDANCE_ACTION_ICONS`), deliberately outside the user-selectable icon sets;
`migrations/0051_create_attendance_student_actions.md` records why. The newest
module and the cleanest template to copy. Library: `src/lib/attendance`.

**Music Library** (`music-library`) — catalogs audio files already on the NAS and
streams them to a browser over HTTP Range. **Read-only by construction**: the
`MusicFileStore` port has no write, move or delete method, so no code path can modify
the collection; album art is copied *into* SQLite rather than written back beside a
track. Lyrics are fetched on demand from LRCLIB (free, no API key) and cached — never
scraped from Google, and never written to a `.lrc` file; see
`migrations/0054_create_music_track_lyrics.md` for why. APE and WMA are catalogued but
not playable, because no browser decodes them. A scan is two-phase so the progress bar
can show a real percentage: a fast walk counts candidates, then a slower pass reads
tags.

The **Library** section is eight views over the one catalog — All Songs, Artists, Genres,
Playlists, Most Played, Years, Folders and Folder Hierarchy — with the active view in the
URL (`?view=`) so it is linkable. Six read data the scanner already stores; Playlists and
Most Played needed `migrations/0056`. Playlists are **shared, not per-user**, and a play is
counted when playback **starts**, so the count measures "opened" as much as "listened to" —
`migrations/0056` records that tradeoff and why it is reversible. Library: `src/lib/music`.

### Icons

`icon` must be one of `MODULE_ICON_NAMES` in
[src/lib/modules/icon-names.ts](src/lib/modules/icon-names.ts): `building`,
`home`, `briefcase`, `wallet`, `chart`, `folder`, `shield`, `heart`, `book`,
`tool`, `journal`, `roster`, `music`.

**Prefer the closest existing fit.** Adding a concept is not a one-line change: it
has to be drawn by hand for the "classic" set *and* named in `TREE_CAND`-style
candidate maps for all 12 sets in `scripts/gen-icon-glyphs.mjs`, or the generator
fails — a missing module glyph is fatal there by design, since the toolbar has no
other artwork to fall back on. Reach for a new concept only when two modules would
otherwise share one glyph and the collision is confusing: that's what happened with
Journal and Attendance, which both sat on `book` until
`migrations/0050_journal_and_roster_module_icons.md` split them into `journal` (a
bound journal with a quill) and `roster` (a class register). It happened again with
Music Library, which borrowed `heart` from `0053` until
`migrations/0055_music_library_music_icon.md` added `music` (a beamed pair of eighth
notes) — worth reading as the worked example of what a new concept costs.

There is no admin UI for a module's icon, so changing one **is** a migration — an
`UPDATE sys_modules`, scoped by slug *and* by the old value so it doesn't stomp a
hand-picked choice. Keep `DEFAULT_MODULES` in step, or "Reset to Default" will put
the old icon back.

Section icons in a tree nav are a **different, larger set**, resolved by
`TreeIcon` ([src/components/tree-icons.tsx](src/components/tree-icons.tsx)) and
keyed by plain strings — `grid`, `users`, `classroom`, `chart`, `gear`. Don't
confuse the two lists.

### Carousel image

Optional per-module artwork on the home carousel, stored as a `BLOB` on
`sys_modules` (migration 0040) and served by its own route. Domain code sees only
`hasCarouselImage`, never the bytes — `sys_modules` is read on every
authenticated page, so a `SELECT *` here would ship a megabyte per render. Rules
in `coding-guide.md` → *Per-row images*.

## Creating a new module

Plan first and wait for approval — `CLAUDE.md` requires it for any multi-file
change, and a module is the largest one there is. The plan must name the files,
the migration number and 3-letter prefix, any third-party dependency and whether
it's free, and the open questions.

Then work in this order. Bottom-up, because each step compiles against the one
below it.

### 1. Pick the slug, names, and prefix

- **Slug** — lowercase kebab-case, the URL segment. Permanent in practice:
  it's in bookmarks, in `DEFAULT_MODULES`, and hardcoded as a constant in the
  route files. Rename only with a migration.
- **Short and long name, description** — admin-editable later, so getting them
  perfect now doesn't matter much.
- **Sequence** — next unused integer. Ordering on the home grid; admin-editable.
- **Table prefix** — a new lowercase 3-letter namespace, not an abbreviation of a
  word. Check it against the table in `coding-guide.md`, and don't reuse `rei_`.

### 2. The library module — `src/lib/<name>/`

All logic lives here. Nothing in this folder may import `react` or `next`.
Mirror [src/lib/attendance/](src/lib/attendance/):

| File | Holds |
|---|---|
| `types.ts` | Domain types. No zod, no SQL. |
| `schema.ts` | The zod schemas that validate boundary input, plus their inferred types. |
| `ports.ts` | The `…Repository` interface the use-cases depend on — not a database. |
| `repository.ts` | The `Sqlite…Repository` implementation. The only file that knows SQL. |
| `<name>.ts` | The use-cases: functions taking data and returning data. |
| `<name>.test.ts` | Colocated Vitest, success **and** failure paths, against a fake repository. |
| `settings.ts` | Only if the module needs preferences — see step 6. |
| `index.ts` | The front door. Everything outside imports from here and nowhere else. |

### 3. The migration

Two files in [migrations/](migrations/), same number, next in sequence:

- `NNNN_create_<thing>.sql` — the module's tables, each named `<prefix>_<thing>`
  with `snake_case` columns. Read `coding-guide.md` first for the traps that have
  already cost time here: never put a date column in a unique index; a primary-key
  change means a full rebuild; a settings value is blank, never `NULL`.
- `NNNN_create_<thing>.md` — the log: what changed and *why*, including the
  reasoning behind anything unobvious. These logs are load-bearing documentation,
  not a formality.

Then a **separate, later-numbered** seed pair registering the module itself, like
[migrations/0048_seed_attendance_module.sql](migrations/0048_seed_attendance_module.sql):

```sql
INSERT INTO sys_modules (slug, short_name, long_name, description, sequence, is_visible, icon)
VALUES ('<slug>', '<Short>', '<Long>', '<Description>', <seq>, 1, '<icon>');
```

### 4. Register in `DEFAULT_MODULES`

Add the same values to
[src/lib/modules/defaults.ts](src/lib/modules/defaults.ts). **This is not
optional and not a duplicate to be tidied away**: the seed migration builds a
fresh database, and `DEFAULT_MODULES` is what admin "Reset to Default" restores
the table from. A module missing here vanishes the first time anyone resets. The
file says so at the top — keep both in sync, and update its comment to name your
new seed migration.

### 5. Wire the repository

Add one line to `deps` in [src/lib/wiring.ts](src/lib/wiring.ts):

```ts
<name>Repo: new Sqlite<Name>Repository(db),
```

This is the composition root. A presentation file must never construct a
repository itself.

### 6. Module settings — only if needed

Preferences go in `sys_module_settings` as key/value rows, not in a new table.
Add a `settings.ts` to the library module with a `…_SETTING_KEYS` map, a typed
`…Settings` interface, a `resolve…Settings(rows)` parser, and a
`…SettingsToEntries` writer — [src/lib/attendance/settings.ts](src/lib/attendance/settings.ts)
is the pattern. Parsing must be **forgiving**: a settings row can outlive the
thing it names, so a stale id is "not set", never a thrown error.

### 7. Sections and the nav

Skip this whole step for a single-screen module — CSV Analysis has no nav, and
that's a legitimate shape.

Otherwise, three files under
[src/app/(protected)/modules/[slug]/](src/app/(protected)/modules/[slug]/),
named `<module>-*`:

- **`<module>-sections.ts`** — the section list `as const`, its type, an
  `is<Module>Section()` guard, a `…_SECTION_INFO` record of label + description,
  a `…_SECTION_ICONS` record, and a `…SectionHref()` helper where `main` maps to
  the module root and everything else to a child route. **Not** a `"use client"`
  file: server components read these as real values, and a client module would
  hand them client-reference proxies instead, so `INFO[section]` would come back
  `undefined`. This has bitten before — the comment at the top of
  [attendance-sections.ts](src/app/(protected)/modules/[slug]/attendance-sections.ts)
  records it.
- **`<module>-nav.tsx`** — `"use client"`. Maps the section list into
  `TreeNode[]` and renders the shared `TreeNav`. Give it **its own**
  `storageKey` (`myhomebase:<module>-nav-collapsed`) so collapsing one tree
  doesn't collapse the others.
- **`<module>-section.tsx`** — a **server** component. Reads `deps`, loads only
  the data the requested section needs, renders `SectionLayout` with the heading,
  a `CollapsibleCard` of instructions, and the section body. Views get plain
  data, never `deps`.

Then register the nav in
[section-layout.tsx](src/app/(protected)/modules/[slug]/section-layout.tsx): add
the slug to the `nav` union and a branch to the picker. The nav is passed by
*name*, not as a component, because a server parent can't hand a client child a
render prop.

### 8. The routes

Both route files dispatch on the slug, and both need editing:

- [page.tsx](src/app/(protected)/modules/[slug]/page.tsx) — the module root. Add
  a slug constant and a branch in `ModuleBody` returning your section shell with
  `section="main"`. Without this the module renders the "Coming soon"
  placeholder.
- [[section]/page.tsx](src/app/(protected)/modules/[slug]/[section]/page.tsx) —
  every child route. Add a branch to `renderSection` gated on **both** the slug
  and your own `is<Module>Section(section)`. The double gate is deliberate: it
  stops one module's section name resolving under another module's slug, which
  would render a nav pointing at routes that don't exist.

Sections live under the dynamic `[slug]` segment on purpose. A static `expense/`
folder would shadow `/modules/[slug]` and break the module page itself.

Anything a screen should survive a refresh or a bookmark on — which class, which
date, which filter — travels as a search param, parsed in the route (take the
first element of a repeated value; never join) and passed down. Not client state.

### 9. Views and server actions

- `<module>-<section>-view.tsx` per screen, client components taking plain data.
- `<module>-actions.ts` — `"use server"`. Each action validates with the module's
  zod schema, calls the use-case through `index.ts`, and revalidates. No logic.
- `<module>-instructions.tsx` — per-section guidance. Give each section only its
  own text; the whole document above every screen is noise.

Before building any of it, read `components.md` and reuse what fits. If something
new looks reusable, ask "should this be reusable? give it a name", then put it
in `src/components/` and register it there.

Every screen must work at 1024px and below. Reach for `max-lg:` variants first —
they leave the desktop classes untouched, so a wide screen provably can't
regress. Only a genuinely *different component* justifies reading
`useViewport()` / `useIsCompact()`. Say how the screen behaves narrow when you
report the work.

### 10. The CLI path

Every use-case must be callable identically from the web and the CLI. Add a
command under [src/cli/](src/cli/) for the module's main use-case — importing
from the same `index.ts`, using the same `deps` — and register it in
`CLI_registry.md`. [src/cli/take-attendance.ts](src/cli/take-attendance.ts) is
the recent example.

### 11. Access

A module is granted per-user through `sys_user_module_access`. Both route files
already enforce it via `userHasModuleAccess`, so a new module needs no new
plumbing — but a freshly seeded module is granted to nobody. Grant it in admin
*User Management*, or the module 404s for everyone including you.

## Checklist

- [ ] Slug, names, description, sequence, 3-letter prefix chosen
- [ ] `src/lib/<name>/` with types, schema, ports, repository, use-cases, `index.ts`
- [ ] Colocated Vitest covering success and failure
- [ ] `NNNN_create_*.sql` + `.md` log
- [ ] `NNNN_seed_<slug>_module.sql` + `.md` log
- [ ] `DEFAULT_MODULES` updated, with its comment naming the new seed migration
- [ ] Repository added to `deps` in `wiring.ts`
- [ ] `<module>-sections.ts` (no `"use client"`), `-nav.tsx`, `-section.tsx`
- [ ] Nav registered in `section-layout.tsx`
- [ ] Branch added in **both** `page.tsx` and `[section]/page.tsx`
- [ ] Views, `-actions.ts`, `-instructions.tsx`
- [ ] Reused registered components; anything new added to `components.md`
- [ ] Works at 1024px and below, and you can say how
- [ ] CLI command added and registered in `CLI_registry.md`
- [ ] Module granted to at least one user
- [ ] This file's registry table updated
- [ ] `coding-guide.md` table-prefix table updated
- [ ] `/verify` green end to end
