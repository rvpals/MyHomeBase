# Coding guide

Project-specific coding conventions. This complements — does not replace —
`ARCHITECTURE.md` (layering), `components.md` (reusable UI), and `design.md`
(styling). Read the relevant section before writing code that touches its area.

## Database table naming

Every table carries a **lowercase three-letter module prefix** so its owning
module is obvious from the name alone. New tables must follow this.

| Prefix | Module | Example tables |
|---|---|---|
| `sys_` | Platform — not a feature module | `sys_modules`, `sys_app_settings`, `sys_module_settings`, `sys_user_preferences`, `sys_users`, `sys_user_module_access`, `sys_sessions`, `sys_schema_migrations`, `sys_daily_quotes`, `sys_scheduled_runs`, `sys_dashboard_texture`, `sys_module_texture`, `sys_fav_photo` |
| `stk_` | Stocks & ETFs (brokerage accounts **and** per-stock tables — one prefix) | `stk_investment_accounts`, `stk_stock_positions`, `stk_stock_transactions`, `stk_stock_watch_lists`, `stk_stock_volatility_cache`, `stk_ticker_risk_cache`, `stk_ticker_logos`, `stk_daily_snapshots` |
| `csv_` | CSV Analysis (incl. user-generated per-entry tables from `buildTableName`) | `csv_analytics_entries`, `csv_chart_presets`, `csv_govee` |
| `jrn_` | MyJournal | `jrn_entries`, `jrn_categories`, `jrn_tags`, `jrn_entry_categories`, `jrn_entry_tags`, `jrn_entry_locations`, `jrn_entry_images`, `jrn_saved_filters` |
| `exp_` | Expense tracker | `exp_transactions`, `exp_creditcard_accounts`, `exp_categories`, `exp_vendors`, `exp_post_import_rules`, `exp_post_import_rule_actions` |
| `att_` | Attendance | `att_students`, `att_classes`, `att_class_enrollments`, `att_attendance_records`, `att_attendance_entries`, `att_student_actions`, `att_attendance_entry_actions` |
| `ico_` | Icon customisation — platform-wide, not a feature module | `ico_slot_overrides` |
| `mus_` | Music Library | `mus_tracks`, `mus_albums`, `mus_scan_runs`, `mus_track_lyrics`, `mus_playlists`, `mus_playlist_tracks`, `mus_play_events`, `mus_magic_list`, `mus_magic_list_tracks`, `mus_play_queue`, `mus_play_queue_state` |
| `gam_` | Games | `gam_scores` |

The `rei_` prefix (Real Estate Investment) was retired when that module was
removed — see migration `0026_drop_real_estate_module`.

Rules for adding tables:

- **New feature module** → choose a new lowercase 3-letter prefix. **Platform /
  cross-cutting** table → `sys_`.
- The prefix is a **namespace**, not an abbreviation of a word — this is the one
  intentional exception to the "no abbreviations" rule in the coding standards.
- Column names stay `snake_case`, self-documenting, no abbreviations (unchanged).
- SQLite-internal tables (`sqlite_sequence`) are left untouched.

### Renaming existing tables

- A pure rename uses SQLite's native `ALTER TABLE ... RENAME TO` — **not** the
  copy-rename-drop pattern (that's only for column/constraint changes). `RENAME TO`
  preserves all rows, and SQLite auto-rewrites index/trigger *references*.
- Renames of an existing database are applied by `reconcileLegacyTableNames()` in
  `scripts/migrate.ts` — idempotent and guarded (renames only when the old name
  exists and the new one does not). This is **not** a numbered `.sql` migration: a
  numbered rename would crash a fresh install, because the historical `CREATE`
  migrations already emit the prefixed names. The same step renames the
  `sys_schema_migrations` tracker, which a `.sql` migration cannot do (it is written
  to mid-run).
- **Known deviation:** trigger and index *object names* keep their original
  (unprefixed) names; only their bodies/targets follow the rename. This keeps a fresh
  install byte-for-byte identical to a reconciled one and avoids drop/recreate risk.
  Prefixing those names is a separate follow-up.

Reference: migration log `migrations/0024_rename_tables_to_module_prefixes.md`.

### Changing a primary key

SQLite can add a column in place but **cannot change a primary key**, so a key change
means the full create-copy-drop-rename rebuild. Two things that are easy to get wrong,
both worked through in `migrations/0035_add_cost_basis_and_account_to_stock_positions.md`:

- **Drop dependent triggers before the table and recreate them after.** A trigger
  body naming the old table survives the rename and then fires against the wrong
  shape.
- **Re-check your indexes.** Adding a leading key column silently removes the index
  prefix every "find by the old key" query relied on — `(account_id, ticker)` left
  lookups by `ticker` alone with nothing to ride, so they needed an explicit index.

The runner wraps each migration in a transaction (`scripts/migrate.ts`), so a rebuild
that fails part way rolls back rather than leaving a half-built table. Rehearse it
against a **copy** of the production DB before running it for real.

### Never put a DATE column in a unique index

`stk_stock_transactions` carried
`UNIQUE (transaction_at, action, ticker, total_amount_cents)` so that re-importing a
broker CSV was a safe no-op. **`transaction_at` is a date, not a timestamp**, so two
buys of the same ticker for the same amount on the same day were identical on all four
columns and the second was rejected — silently dropping every lot after the first.
Buying a position in several lots through one day is completely ordinary.

Adding a column doesn't fix this. At date granularity the rows genuinely *are*
identical, so no combination of columns can separate them. The rule that generalises:
**a unique index may only span columns that identify the row exactly.** Where the
source system gives a reference number, be unique on that and nothing else, with a
partial index so rows lacking one aren't all colliding on a shared empty string:

```sql
CREATE UNIQUE INDEX idx_stock_transactions_external_id
  ON stk_stock_transactions (external_id)
  WHERE external_id <> '';
```

Where it doesn't, duplicate detection belongs in the **importer**, which can see the
whole file at once: count how many matching rows the file holds against how many are
stored, and insert the shortfall. The database can't make that call — it can't tell a
real second lot from an accidental re-import. Worked through in
`migrations/0038_add_brokerage_firm_to_stock_transactions.md`.

`att_attendance_records` briefly carried a documented exception to this rule — it was
unique on `(class_id, attendance_date)` to make re-taking attendance overwrite the day.
**That exception is retired** (`migrations/0049_allow_multiple_attendance_sessions.md`):
a class may now be registered several times a day, so the date genuinely doesn't
identify a session and the rule applies here with no carve-out. The index is still
there for lookups, just not `UNIQUE`. Worth knowing as a worked example of how such an
exception dies: the premise was "there is no second event by specification", and the
specification changed.

### A settings value is blank, never NULL

`sys_app_settings.value` is `TEXT NOT NULL` (migration 0002), so a setting that means
"nothing set" stores the **empty string**, not NULL. `STARTUP_MESSAGE` (0041) is the
first one that needs the distinction: blank means there is no message to show.

Making the column nullable to model that honestly would mean the full
create-copy-drop-rename rebuild — SQLite can't relax a `NOT NULL` in place — for no
behavioural gain. So the sentinel is blank, and **the mapping to `undefined` happens
once, in the use-case** (`getStartupMessage` trims and returns `undefined` for a blank
or whitespace-only value). Callers never compare against `""`; if you find that test
in a component, the use-case is missing.

One consequence worth knowing: `settingUpdateSchema` still requires `.min(1)`, because
it is what the admin Application Configuration screen posts and blanking
`application_name` there would leave the UI with no wordmark. A setting that is
legitimately blankable gets its own schema and its own repository write
(`setValue`, an upsert) rather than loosening the shared one for everything.

### Per-row images

A per-row image is a `BLOB` column plus a `<name>_mime_type` column, served by a
dedicated route — never inlined as a base64 data URL. Nine tables do this:
`sys_users.avatar` (0011), `exp_creditcard_accounts.card_image` (0031),
`exp_categories.icon_image` (0034), `stk_investment_accounts.icon_image` (0037),
`sys_modules.carousel_image` (0040), `jrn_categories`/`jrn_tags.icon_image` (0042),
`sys_dashboard_texture.image` (0063), `sys_module_texture.image` (0064) and
`exp_vendors.icon_image` (0068).

`exp_vendors` is the one to copy for a new table that needs an icon: the blob and its
mime column are in the initial `CREATE` rather than bolted on by a later `ALTER`, which
is what the `exp_categories` 0029 → 0034 two-step had to do.

The last two are worth reading before adding another: both are tables whose *only*
purpose is to hold one picture and its display settings, which is what kept the bytes
out of `sys_app_settings` (a `TEXT NOT NULL` key/value store read on every
authenticated page) and off a second `sys_modules` column. When a picture is
application- or module-wide rather than a property of a domain row, its own table is
usually the answer.

Adding one carries a **non-obvious obligation**: every normal read of that table must
switch from `SELECT *` to an explicit column list that omits the blob, or the bytes
ride along in every list and page render. Decoding and the mime allowlist live in
`src/lib/shared/image-upload.ts` — use it rather than re-deriving the rules, and note
that SVG is excluded on purpose (it can carry script, and these bytes are served from
the app's own origin).

**Expose presence, not bytes.** A caller usually only needs to know *whether* there is
an image, to choose between the artwork and a fallback. Derive that in SQL
(`carousel_image IS NOT NULL AS has_carousel_image`) and put the boolean on the domain
type; the bytes then have exactly one reader, the serving route. This matters most on
`sys_modules`, which is read on every authenticated page — see
`migrations/0040_add_carousel_image_to_modules.md`.

### Uploading one: send a File, not a base64 string

The early image uploads pass base64 as a plain server-action argument. That works for a
128 KB icon and **breaks for anything larger**, in two ways that both surface as
confusing framework errors rather than validation messages:

- Base64 inflates a file by ~33%, and Next's server-action body limit defaults to 1 MB —
  so an 800 KB image failed before any of our own code ran. `next.config.ts` now sets
  `experimental.serverActions.bodySizeLimit` to `4mb`.
- Next serialises a long string argument into nested arrays and rejects it outright:
  *"Maximum array nesting exceeded."* Raising the body limit does not help.

**Put the `File` in a `FormData` and pass that to the action** — it streams as ordinary
multipart with neither problem, and needs no `FileReader` in the browser. Convert to
base64 server-side if the use-case wants it. `saveModuleCarouselImageAction` is the
worked example. Also check the size **client-side** before uploading, so an oversized
file is refused instantly with the app's own wording instead of a 500.

## Icons: use a slot, not a bare glyph name

Every icon that marks a **place** in the app goes through `SlotIcon` and a registered
entry in `ICON_SLOTS` ([src/lib/icons/slots.ts](src/lib/icons/slots.ts)) — never
`<TreeIcon name="chart" />` at the call site. All 79 current positions are wired this
way; a new feature or module should not reintroduce the old pattern.

**Why.** A glyph name is a *concept*, and concepts are shared: `grid` is the dashboard
in all five modules, `chart` is four different reports, `palette` is two admin screens.
So a bare name is not addressable — there is no way to re-skin the Journal dashboard
without also re-skinning Expense's, and nothing can enumerate where icons appear in
order to offer the choice. A slot is a stable id for one position that *declares* a
default concept, which makes the position addressable while keeping the glyph unchanged
until someone overrides it.

### Adding one

1. Register the slot: `id`, `label`, `group`, `where` (the click path, shown in the
   admin list), `defaultConcept` (a glyph that already renders correctly), `namespace`,
   and `wired: true` once step 2 is done.
2. At the call site, `const FOO_SLOT = getIconSlot("…")!` at **module scope** — the
   registry is static, so this is not I/O — then `<SlotIcon slot={FOO_SLOT} … />`.

A slot with no override renders exactly what the concept rendered before, so step 1
alone changes nothing and step 2 is safe in isolation.

### Propose the labels — don't invent them silently

A slot's `id`, `label` and `where` are **user-facing and permanent**, so when a new module
or feature introduces icon positions, **suggest the names and get them confirmed before
writing them.** Present a short table — proposed id, label, where, default concept — and
ask. Do not bury the naming inside the first implementation edit.

The reason is the asymmetry: the `id` is written into `ico_slot_overrides.slot_id` and
cannot be changed later without orphaning uploads, while `label` and `where` are the only
things telling an admin which of seventy-odd rows they are about to replace. Both are
cheap to get right up front and expensive to fix afterwards. It is also the point where a
second opinion actually helps — whether a position deserves a slot at all (is it a place,
or a row action?) and what to call it are judgement calls, not mechanical ones.

Propose in this shape, then wait:

| Proposed id | Label | Where | Default |
|---|---|---|---|
| `budget_section_main` | Dashboard | Budget → section panel → Dashboard. | `grid` |
| `budget_card_forecast` | Forecast card | Budget → Dashboard → the Forecast card header. | `chart` |

Follow the conventions already in the registry so a suggestion is easy to accept:
`<area>_<kind>_<name>` in lower snake_case; `label` is the on-screen wording, not a
restatement of the id; `where` is a click path ending in a full stop; `group` matches the
sibling entries. Flag anything you decided *not* to slot and why — that list is as useful
to review as the slots themselves.

### Bespoke default artwork: `fallback`

One slot's original icon is not a glyph from either table — `chrome_rail_home`, the app
mark at the top of the module rail, is a multi-colour brass badge (`AppIcon`). A
`defaultConcept` cannot express that, so slotting it naively would have quietly replaced
the mark with a flat line-art house for everyone who has uploaded nothing.

`SlotIcon` therefore takes an optional `fallback` node, used only when no override
exists. The rail passes `<AppIcon />`. **Do not reach for this elsewhere**: if a glyph
needs slotting, it belongs in `TREE_ICONS`/`MODULE_ICONS` so every icon set can draw its
own version. `fallback` exists for application identity, which by definition no set
should redraw.

### Data-driven navs derive the id instead

A nav rendered from a map (`*_SECTION_ICONS`, `adminNav`, `LIBRARY_VIEW_ICONS`) has no
call site to name a slot at. Those pass a namespace once and derive per row —
`sectionSlotId(namespace, node.id)` or `tabSlotId(namespace, view)`. This is why 51
section icons became replaceable through one change in `section-panel.tsx` rather than
51 edits. **A new module's sections need only `iconNamespace="<slug>"` on its shell plus
the registry entries** — no per-section wiring.

The derivation makes slot ids load-bearing: they must equal
`<namespace>_section_<slug>` with hyphens turned to underscores (Expense's slugs are
kebab, as are all of `adminNav`'s). A mismatch **does not throw** — it silently stops
matching the override — so `slots.test.ts` enumerates every real section and tab slug
and asserts each resolves. Extend those lists when adding a module.

### What must NOT become a slot

- **Row actions** — pencil, trash, refresh, search. They are buttons, and
  `ALWAYS_CLASSIC` in `tree-icons.tsx` keeps them hand-drawn so an inline delete control
  can't become full-colour artwork that weakens the destructive read.
- **State glyphs** — `star`/`star-filled`, `heart`/`heart-filled`, play/pause, the
  now-playing marker. The outline-vs-solid contrast *is* the information; overriding
  half a pair destroys it.
- **A module's own icon.** Already user-editable under Admin → Configuration → Module
  Configuration, backed by `sys_modules.icon`. A slot would be a second, competing way
  to set one value. (Administration is the sole exception: it has no `sys_modules` row,
  so its glyph is a constant with no other way to change it.)
- **A glyph chosen to mean something specific.** `Comments` slots only its default
  `info` chip; a caller that asked for `note` or `clip` meant that, and routing all
  three through one slot would let a single upload overwrite three meanings.

### Uploaded rasters are normalised, not stored as sent

An icon upload goes through `normalizeIconImage` before it reaches the database: a
flattened transparency checkerboard is turned back into real alpha, empty margin is
cropped, and the result is re-encoded as a 256px PNG. A real upload went from a 108 KB
1024px JPEG to 19 KB.

The reason is that **JPEG has no alpha channel**, so exporting icon art to JPEG writes the
editor's grey/white checkerboard into the file as literal pixels. It looks fine at 1024px
and becomes a grey smudge at the 16-20px a slot icon actually renders at — worst on the
compact "Sections" trigger, where the icon is the only content in the control.

Two rules worth keeping if you touch this:

- **Decisions live in `src/lib/icons/normalize-image.ts`, pixels in the adapter.** The
  arithmetic — is this border a checkerboard? where does the artwork end? — is plain maths
  over an RGBA array, testable with a hand-built canvas and no native module.
  `image-processor.ts` is the only file that imports `sharp`.
- **Detection declines rather than guesses.** A photo, a screenshot, or art that bleeds to
  the edge is left alone; a false positive would punch holes in someone's artwork, where a
  false negative merely costs a slightly worse icon. If normalisation throws, `saveOverride`
  keeps the original bytes rather than failing the upload.

One trap found the hard way: cluster border colours at the *wide* tolerance. Lossy
compression turns a flat backdrop tone into a spread — one real upload had 38 distinct
colours in a single row — so clustering strictly split a genuine checkerboard into buckets
too small to pass the agreement threshold, and detection declined an image it should plainly
have cleaned.

`normalize-icon-overrides` (CLI) re-runs the pipeline over rows stored before it existed.

**`sharp` is a native module**, so `scripts/publish-nas.mjs` swaps its linux-arm64 build at
publish time, exactly as it does for `better-sqlite3`. Adding any further native dependency
means extending that script, or the NAS fails at runtime rather than at publish. Three
things that cost real time here:

- **`sharp` is two packages,** the binding (`@img/sharp-<platform>`) and the `libvips`
  library it dlopens. Shipping the binding alone gets `ERR_DLOPEN_FAILED:
  libvips-cpp.so...: cannot open shared object file` on first use.
- **Read the libvips version from the arm64 binding's `optionalDependencies`, after
  downloading it.** Not from the installed win32 binding — on Windows libvips is statically
  linked in, so that package declares no libvips dependency at all and the lookup returns
  `undefined`. And not by guessing: sharp 0.34.5 wants libvips **1.2.4**, where the
  version numbers alone suggest 1.2.3.
- **Git Bash's GNU tar cannot take a `C:\...` path for `-f`.** It reads the drive letter as
  a remote host and dies with `Cannot connect to C: resolve failed`; `--force-local` does
  not help. Run tar with `cwd` set to the destination and a *relative* tarball path.

**Import a native module lazily if it is reached through `wiring.ts`.** That file is the
composition root every page imports, so a top-level `import sharp` runs on every render —
which is how a broken install turned an upload-only dependency into `app.log` filling with
`ERR_DLOPEN_FAILED` on ordinary page views. `image-processor.ts` defers the import to first
use, so the same broken install now costs one failed upload and nothing else.

That failure is also the one case the pipeline does **not** swallow. An unreadable *image*
keeps the original bytes, because it should not cost the reader their upload; a processor
that is *unavailable* throws, because storing the raw upload would look like success while
silently producing the muddy icon the pipeline exists to prevent.

### Ids are permanent

Slot ids are written to `ico_slot_overrides.slot_id`. Renaming one — or renaming a
module section slug that an id is derived from — orphans a user's uploaded icon
silently. Once uploads exist, an id change needs an `UPDATE ico_slot_overrides`
alongside it. Two mismatches were caught during the initial build and were free to fix
only because nothing had shipped.

### Uploaded SVG is sanitized on write

`src/lib/shared/image-upload.ts` refuses SVG, correctly, because those bytes are served
verbatim from our own origin. Slot overrides accept it anyway because the markup is
**inlined**, which is what lets a custom glyph inherit `currentColor` and tint to the
theme. Inlining also means the `sandbox` CSP in `api/journal/icon-response.ts` does not
apply — it protects a file served as a document, not markup running in the page. So
`sanitizeSvg` reduces the upload to an **allowlist** of drawing elements and
presentation attributes at write time. If you ever store SVG for a new purpose, reuse
that function; don't hand-roll a blocklist.
