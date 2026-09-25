# Coding guide

Project-specific coding conventions. This complements — does not replace —
`ARCHITECTURE.md` (layering), `components.md` (reusable UI), and `design.md`
(styling). Read the relevant section before writing code that touches its area.

## Database table naming

Every table carries a **lowercase three-letter module prefix** so its owning
module is obvious from the name alone. New tables must follow this.

| Prefix | Module | Example tables |
|---|---|---|
| `sys_` | Platform — not a feature module | `sys_modules`, `sys_app_settings`, `sys_module_settings`, `sys_user_preferences`, `sys_users`, `sys_user_module_access`, `sys_sessions`, `sys_schema_migrations`, `sys_daily_quotes`, `sys_scheduled_runs`, `sys_dashboard_texture`, `sys_module_texture`, `sys_fav_photo`, `sys_deployments`, `sys_auth_events`, `sys_site_visits`, `sys_ip_allowlist`, `sys_messages`, `sys_saved_sql_queries` |
| `inv_` | Investments (brokerage accounts **and** per-stock tables — one prefix) | `inv_investment_accounts`, `inv_stock_positions`, `inv_stock_transactions`, `inv_stock_watch_lists`, `inv_stock_volatility_cache`, `inv_ticker_risk_cache`, `inv_ticker_logos`, `inv_index_logos`, `inv_daily_snapshots`, `inv_tax_lots`, `inv_ticker_monitors` |
| `csv_` | CSV Analysis (incl. user-generated per-entry tables from `buildTableName`) | `csv_analytics_entries`, `csv_chart_presets`, `csv_govee` |
| `jrn_` | MyJournal | `jrn_entries`, `jrn_categories`, `jrn_tags`, `jrn_entry_categories`, `jrn_entry_tags`, `jrn_entry_locations`, `jrn_entry_images`, `jrn_saved_filters`, `jrn_locations`, `jrn_location_categories`, `jrn_location_tags` |
| `exp_` | Expense tracker | `exp_transactions`, `exp_creditcard_accounts`, `exp_categories`, `exp_vendors`, `exp_post_import_rules`, `exp_post_import_rule_actions`, `exp_rule_types` |
| `att_` | Attendance | `att_students`, `att_classes`, `att_class_enrollments`, `att_attendance_records`, `att_attendance_entries`, `att_student_actions`, `att_attendance_entry_actions` |
| `ico_` | Icon customisation — platform-wide, not a feature module | `ico_slot_overrides` |
| `mus_` | Music Library | `mus_tracks`, `mus_albums`, `mus_scan_runs`, `mus_track_lyrics`, `mus_playlists`, `mus_playlist_tracks`, `mus_play_events`, `mus_magic_list`, `mus_magic_list_tracks`, `mus_play_queue`, `mus_play_queue_state` |
| `gam_` | Games | `gam_scores` |
| `pho_` | Picture Gallery | `pho_albums`, `pho_album_photos`, `pho_magic_list`, `pho_magic_list_photos`, `pho_photo_index`, `pho_magic_scan_run` |
| `tol_` | Tools | `tol_uploaded_databases`, `tol_uploaded_csv_files` |

The `rei_` prefix (Real Estate Investment) was retired when that module was
removed — see migration `0026_drop_real_estate_module`.

**Investments was `stk_` until migration 0108**, when the module was renamed from
Stocks & ETFs. The old prefix named the first two things the module tracked, but it
had grown to hold brokerage accounts, tax lots, dividend income and account
performance — none of which is a stock or an ETF. `inv_` is the module namespace, so
it still fits the next table; this is the same lesson `pho_` and `tol_` record.

Note the tables keep their own names under the new prefix: `inv_investment_accounts`
stutters, and `inv_stock_positions` still says "stock". Renaming table bodies as well
as the prefix would have doubled the blast radius of an already wide change for a
cosmetic gain. The prefix is what carries the namespace.

**Picture Gallery had no prefix until migration 0087**, and the reason it now has one is
worth knowing. The module was built presenting *other modules'* data — the archive is the
folder configured in Journal and read through `journal-photos`, the kept pictures are
`sys_fav_photo` — so it owned nothing and a prefix would have been a namespace with
nothing in it. Albums are the first concept that is genuinely its own, so `pho_` arrives
with them. See `modules.md` → *Per-module detail* → **Picture Gallery**.

Note the prefix is `pho_` (photo, the module's domain) and not `alb_` (album, the first
table needing one) — a prefix is a **module namespace**, so it has to still fit the second
table this module gains.

**Tools is `tol_` and not `sql_`** (migration 0097), for the same reason. The SQLite File
Browser is the module's first utility, not its domain — Tools is explicitly a container
for more of them, so naming the namespace after the first one would have aged badly the
moment a second tool arrived.

That prediction came due at migration 0100: the **CSV File Browser** is the second
utility, and `tol_uploaded_csv_files` sits under the same prefix without a rename. Had
the namespace been `sql_`, a CSV tool's table would have had to either live under a
wrong name or force a table rename — which is the expensive thing this rule exists to
avoid.

**A new table also wants a line in
[`src/lib/sql-explorer/table-reference.ts`](src/lib/sql-explorer/table-reference.ts)**,
which is what the SQL Explorer's *Table references* card renders. Missing one isn't
fatal — the table falls into an "Unclassified" group rather than disappearing — but the
card is the only place the purpose of a table is stated in the running app.

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

`inv_stock_transactions` carried
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
  ON inv_stock_transactions (external_id)
  WHERE external_id <> '';
```

Where it doesn't, duplicate detection belongs in the **importer**, which can see the
whole file at once: count how many matching rows the file holds against how many are
stored, and insert the shortfall. The database can't make that call — it can't tell a
real second lot from an accidental re-import. Worked through in
`migrations/0038_add_brokerage_firm_to_stock_transactions.md`.

`att_attendance_records` carries a documented exception to this rule: it is unique on
`(class_id, attendance_date)`, so re-taking attendance **overwrites** the day rather
than appending a second register.

That exception has been retired once and reinstated, which makes it the best worked
example in the schema of how such a carve-out lives and dies:

- `migrations/0049_allow_multiple_attendance_sessions.md` **dropped** it, on the premise
  that "a morning and an afternoon register are two facts, not a correction of one".
- `migrations/0092_one_attendance_record_per_class_day.md` **restored** it, because that
  premise was never true of how the module is used. One register per class per day is
  the real specification, and without the constraint re-opening a class showed a blank
  sheet while every re-save left another row behind.

The lesson cuts both ways. An exception dies when its premise ("there is no second event
by specification") stops holding — and it comes back when the premise was mis-stated in
the first place. Check the premise against actual use, not against what the domain could
conceivably support.

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
`exp_categories.icon_image` (0034), `inv_investment_accounts.icon_image` (0037),
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

## The message queue: telling the reader something after the fact

`sys_messages` (migration 0109) is the app-wide place for a notice nobody was
watching for. Anything in the app can file one:

```ts
createMessage(deps.messageRepo, {
  title: "NVDA: monitor triggered",
  body: "NVDA unrealized gain is $9,900.00, approaching your $10,000.00 target.",
  source: "Investments monitor",
});
```

Three things about it are worth knowing before adding a second writer.

**It is household-wide.** One queue, one read state — marking a message read
marks it read for everyone. That matches what the app is, and it keeps the table
one row per message instead of a message table plus a per-reader join. The
premise to check it against, and the shape to move to if it stops holding, are in
`migrations/0109_create_system_messages.md`.

**Use it for what survives the screen closing.** A status line is right for
something the reader is watching happen — the refresh control's per-ticker
progress stays a status line. The queue is for the thing they will want to know
about an hour later. Filing both is how a queue becomes noise nobody reads.

**`source` is free text and not a foreign key.** A message outlives the thing
that wrote it: deleting a monitor next week must not delete the messages it
filed, because the record that something was reported at a point in time is the
whole value of the queue.

The bell is `MessageQueue`, mounted by every shell through `MessageQueueHost`
(see `components.md`). It is tier 3 — header, not floating — because it acts on
the whole app; see design.md, *Adding a UI element to the shell*.

### A repeating condition needs a latch, not a message per check

`inv_ticker_monitors` (migration 0110) is the first writer, and it is the case
that shows the trap. A monitor sitting inside its band is true on **every**
refresh, so filing on truth alone puts forty copies of one sentence in the queue
for a reader who refreshes hourly.

So the row carries `is_triggered`, and the message is filed on the **transition**
into the band. The evaluator returns both facts separately, and the distinction
is load-bearing:

| Field | Means | Drives |
|---|---|---|
| `isNear` | The condition is true **right now** | The warning marker beside the ticker |
| `shouldNotify` | True **and not already reported** | Filing a message, setting the latch |

Keeping them apart is what lets the marker show for as long as the condition
holds while the queue gets exactly one entry per crossing. Leaving the band
clears the latch and re-arms it; **editing a monitor clears it too**, so the
first crossing of a new target is not swallowed by the old one's.

Anything else that reports a recurring condition should copy this shape rather
than inventing a de-duplication rule at the call site.

### The evaluation is a pure function, and that is where the tests are

`evaluateMonitor(monitor, valuation)` takes two plain objects and returns a
verdict — no repository, no clock, no I/O ([evaluate.ts](src/lib/ticker-monitors/evaluate.ts)).
`runMonitors` is the thin part that loops, files and latches.

Two rules the evaluator encodes that are easy to get wrong if you re-derive them:

- **A zero target takes its band from cost basis, not from the target.** "Loss
  near $0" is the most useful monitor of the three — the bad one has nearly
  recovered — and 5% of $0 is $0, so a band off the target would make the one
  monitor you most want the one that can never fire.
- **`costCents` of 0 means *unknown*, not free.** No monitor fires against it.
  Firing would report a gain equal to the whole market value. This is the same
  guard `computePortfolioSummary` applies, and a ticker held across several
  accounts sums only the holdings that report a basis.

### Where "run the monitors" is called from

Four callers, and all four exist on purpose:

| Caller | Why it is separate |
|---|---|
| `stock-refresh-control.tsx` | The dashboard's walk is client-driven so it can report progress; it calls the action as one more step |
| `stock-glance-refresh.tsx` | The home card's copy of that same loop |
| `refreshAllPositionsAction` | The Positions grid refreshes everything in **one** round trip, so the call belongs inside the action |
| `runScheduledRefresh` | The timer, so a monitor fires overnight and not only when somebody presses a button |

The monitor step always runs **last**, against the prices the pass just wrote —
running it earlier judges the previous refresh's figures. Every caller swallows
its failures: a monitor is a courtesy on top of the refresh, and it must never
turn a successful price update into an error.

### Watch-list watches are the second writer, and deliberately separate

`inv_stock_watch_list_items` carries its own watch condition (migration 0111),
and `runWatchListWatches` files into the same queue from the same place in the
refresh pass. It is not a duplicate of the monitors, and the difference is the
thing to keep hold of:

| | `inv_ticker_monitors` (0110) | Watch on a list row (0111) |
|---|---|---|
| Watches | Unrealized gain/loss on a position you **hold** | A ticker you are **considering** |
| Baseline | Cost basis | `price_when_added_cents` |
| Kinds | Three, all gain/loss | Six, incl. price, range, dividend, split |
| Lives on | Its own table, keyed by ticker | The list row, and dies with it |

A monitor has a cost basis to measure against; a watch-list row does not,
because you own none of it — which is why the price kinds that 0110's log
argues against are the right thing here. The full defence is in
`migrations/0111_add_watch_condition_to_watch_list_items.md`.

Two rules from it that are easy to get wrong:

- **The event kinds latch on a date, not on a band.** A dividend is a dated fact
  that stays true forever, so a boolean latch would fire once and swallow next
  quarter's. `watch_last_triggered_at` doubles as an event cursor, and
  `added_date` is the floor — otherwise adding a row announces last quarter's
  dividend as news.
- **"We did not look" is not "there was nothing."** Dividends and splits need one
  events call per ticker, so the manual button skips them and only the scheduled
  pass supplies the client. A skipped kind is left alone rather than evaluated
  against an empty list, which would clear a latch nobody re-checked.

## Icons: use a slot, not a bare glyph name

Every icon that marks a **place** in the app goes through `SlotIcon` and a registered
entry in `ICON_SLOTS` ([src/lib/icons/slots.ts](src/lib/icons/slots.ts)) — never
`<TreeIcon name="chart" />` at the call site. Every current position is wired this way —
`slots.test.ts` fails on a registered slot with no call site — and a new feature or
module should not reintroduce the old pattern.

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
- **A glyph whose job is to contrast with the one beside it.** Two cases, same reasoning.
  `ai-spark` — the Consult AI button in the ticker viewer's header — sits immediately right
  of the `star`/`star-filled` favourite toggle and exists only to not be mistaken for it. A
  themed set's "AI" artwork is very often a star or a sparkle, which is exactly the
  confusion the glyph was drawn to avoid, so it is in `ALWAYS_CLASSIC` and has no slot; it
  is a button, not a place. And `photo-stack` — the
  Random Photo card's button to the My Favorite Photos screen — sits two controls from
  the `heart`/`heart-filled` toggle, and exists only to not be mistaken for it. It is in
  `ALWAYS_CLASSIC` because a themed set's "favourites" artwork is usually a heart. The
  screen it opens *does* have a slot (`favorite_photos_page`); the button doesn't. Note
  that `ALWAYS_CLASSIC` blocks only the *themed sets* — `SlotIcon` checks a user's
  upload before it consults the set — so keeping a glyph out of the slot registry is a
  separate decision from keeping it out of the themed tables, and this needs both.

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
  `image-processor.ts` is the only file in `lib/icons/` that imports `sharp`.
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

## Carousel graphics get the same treatment

Module carousel images (`sys_modules.carousel_image`) follow the identical shape, for the
identical reason — they were stored at whatever size was uploaded, up to 2 MB, and then
downloaded whole to fill a 192px tile, which made the home screen paint in slowly.

- Decisions in `src/lib/modules/resize-carousel-image.ts` (plain arithmetic over a width
  and a height), pixels in `src/lib/modules/carousel-image-processor.ts` behind the
  `CarouselImageProcessor` port. Uploads are downscaled to fit 800px and re-encoded as
  WebP; it never upscales and never crops.
- **An animated GIF is passed through untouched.** `sharp` would flatten it to its first
  frame, and unlike a 20px icon a carousel graphic is the thing being looked at.
- `resize-carousel-images` (CLI, `--dry-run` first) backfills graphics stored before the
  resizer existed. There is no undo but a database restore.
- The serving route sends `immutable` with a one-year max-age, so **every caller must
  address the image with `?v=<module.updatedAt>`**. A replaced graphic is only ever seen
  because that URL changes; a version that isn't derived from `updatedAt` (a per-component
  counter, say) would pin stale bytes in one browser for a year.

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
silently.

**A slot that outlives the screen it was named for keeps its id.** When the home
screen's Clock card was retired, its slot moved to the Floating Clock's window header
and is still `homescreen_card_clock` — a now-inaccurate name that is nonetheless
cheaper than orphaning an upload. The `label`, `group` and `where` *do* move with the
slot, since those are what the admin list renders; only the id is frozen. Prefer a
stale id with a comment explaining it over a tidy one that loses a file. Once uploads exist, an id change needs an `UPDATE ico_slot_overrides`
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

## The floating layer: a component that lives over the page

A **floating component** has two shapes — a small image parked in a screen corner (the
*puck*), and a window card it expands into — and three states: `open`, `minimized`,
`closed`. The Floating Clock is the first and the pattern for the rest.

The pieces, and which layer each belongs to:

| Piece | Where | What it owns |
|---|---|---|
| `FLOATING_COMPONENTS` | [src/lib/floating/registry.ts](src/lib/floating/registry.ts) | THE registry: id, label, description, whether it ships enabled |
| `resolvePuckSlots` | [src/lib/floating/layout.ts](src/lib/floating/layout.ts) | Which puck parks where, as an **index** — never a pixel offset |
| `minimizeState` / `restoreState` / `closeState` / `effectiveState` | the same file | The state rules, unit-tested with no browser |
| `resolveFloatingStates` | [src/lib/floating/state.ts](src/lib/floating/state.ts) | One reader's stored states, keys derived from the registry |
| `FloatingLayerProvider` | [src/components/floating-layer.tsx](src/components/floating-layer.tsx) | The current value; mounted **once**, in the protected layout |
| `FloatingWindow` / `FloatingPuck` | [src/components/floating-window.tsx](src/components/floating-window.tsx) | The two shapes |
| `.floating-puck` | `globals.css` | The offset arithmetic |

### Adding one

1. Add the id to `FloatingId` ([types.ts](src/lib/floating/types.ts)) and an entry to
   `FLOATING_COMPONENTS`.
2. Add the id to `enabledFloatingSchema` ([schema.ts](src/lib/floating/schema.ts)) and to
   `floatingStateUpdateSchema` in `user-preferences`. These are the one place the
   registry isn't the single source — the type error if you forget is deliberate.
3. Build the component itself: read `useFloatingLayer()`, return `null` when `closed`,
   render `FloatingPuck` when `minimized` and `FloatingWindow` when `open`. Keep it thin
   — [floating-clock.tsx](src/components/floating-clock.tsx) is wiring and a small SVG.
4. Render it inside `FloatingHost` ([floating-host.tsx](src/components/floating-host.tsx)).

Steps 1–2 alone are inert: a registered component nothing renders shows up on the admin
screen as a switch that does nothing, so do all four together.

### The rules that keep it from breaking the layout

- **Never write a new `fixed bottom-0`.** The bottom-right corner is *already* the music
  player's minimized puck, and the bottom edge carries the compact section trigger and
  the player bar. `.floating-puck` composes with `--section-trigger-height`,
  `--music-player-height` and `env(safe-area-inset-bottom)`; `resolvePuckSlots` decides
  the queue order. Two pucks overlapping is invisible to `/verify` — WebKit doesn't
  emulate safe-area insets — which is exactly why that ordering is a tested `lib`
  function rather than a CSS guess.
- **`lib` owns the order, CSS owns the pixels.** `resolvePuckSlots` returns an index and
  a corner. Nothing under `src/lib/` may know a puck's height or an edge inset.
- **Stacking is per corner.** The reader docks each component in one of four corners
  (`PUCK_CORNERS`), so each corner queues independently and only bottom-right reserves
  a slot for the music puck. Adding a corner means a `PUCK_CORNERS` entry *and* a
  `.floating-puck[data-corner=…]` rule — the type error if you forget one is the point.
- **Stay at `z-30`.** `Modal` owns `z-50` so a dialog still covers a puck, and
  `design.md` caps chrome at `z-40`.
- **A window is `Modal size="window"`, not a second draggable panel.** That variant
  already solves dragging, viewport clamping, maximize/restore and focus return. Extend
  `Modal`; don't build a parallel implementation.
- **Say what compact does.** A draggable 80vw window is a worse full-screen sheet on a
  phone, so `FloatingWindow` forks on `useIsCompact()` and gives compact
  `Modal size="full"`. This is a genuine component fork, not a restyle — a `max-lg:`
  variant can't switch off a drag.

### The components that exist

| Id | What it is | Puck shows | Extra storage |
|---|---|---|---|
| `clock` | Digital/analog clock with date, weekday, weather | A live analog dial | none — preferences only |
| `calculator` | Scientific calculator with a history tape | **The last result** | `sys_calculator_history` (migration 0095) |
| `scratchpad` | Notepad with a tab per note category | **The open tab and its note count** | `sys_scratchpad_categories` + `sys_scratchpad_notes` (migration 0096) |

The clock is the stateless case and the calculator is the stateful one, which is what
makes the pair worth reading together: the layer itself only ever stores
`open`/`minimized`/`closed`, and anything else a component needs to remember is that
component's own business (user preferences for the calculator's angle mode and last
result, a table for its tape).

The scratchpad adds the third shape, and two things about it are worth copying:

- **Its storage has two owners.** The categories are household-wide, configured by an
  admin; the notes are per-reader. So `src/lib/scratchpad` has **two ports** —
  `NoteCategoryRepository` (unscoped) and `ScratchpadRepository` (every method scoped by
  `userId`) — rather than one repository with a mixed surface. The admin screen is wired
  only to the first, which is what makes it structurally unable to read anyone's notes.
  The one household-wide count it does need (`countNotes`, for the delete guard) returns
  **numbers only**.
- **It is the first floating component whose content is typed**, so it is the only one
  that autosaves: 800ms after the last keystroke, plus a flush on blur, on a tab switch
  and on minimize/close — the debounce is an optimisation, not the only thing standing
  between a note and the database. Unlike the calculator's fire-and-forget tape, a failed
  save is **surfaced**, because a dropped note save loses the reader's own writing rather
  than a record of something still on screen.

**Deleting a note category is refused while notes are filed under it** (`deleteCategory`
returns a reason; `describeDeleteRefusal` turns it into the sentence both the admin screen
and the CLI print). Cascading would let an admin destroy other people's notes from a
settings screen with no way for a non-admin to recover them — see migration 0096 for the
two alternatives that were rejected.

**A puck shows whatever reads best at 56px, not a miniature of the window.** The clock's
window may be digital while its puck is always an analog dial; the calculator's puck is
the last result, abbreviated by `formatForPuck` (`1.2e8`, not `123456789`) with the full
value in the `title`. Deciding that is the component's job — the layer just gives it a
circle.

### Actions are assigned, never wrapped — this one bites at runtime

A floating component's server actions arrive as a prop (a file under `src/components/`
must not import from `src/app/`). The mount site therefore builds an object of them —
and **every value in it must be the action itself**:

```ts
// RIGHT — the action, assigned.
const floatingActions: FloatingActions = { saveState: saveFloatingStateAction };

// WRONG — compiles, typechecks, passes lint, fails on every request.
const floatingActions: FloatingActions = {
  saveState: (id, state) => saveFloatingStateAction({ id, state }),
};
```

A `"use server"` function can cross into a client component because React recognises
*that specific function*. An arrow around it is an ordinary closure, so serializing the
prop throws **`Functions cannot be passed directly to Client Components`** — at request
time, in the server log, with nothing failing in `typecheck`, `lint`, `build` or the unit
tests. It shipped to the NAS once exactly this way.

The consequence for design: **a port mirrors its action's signature**, even when a
tidier one is available. `CalculatorActions.record` returns the action's
`{ ok, history? }` rather than a clean `CalculationEntry[]`, and
`FloatingActions.saveState` takes one object rather than two arguments, because the
alternative is an adapter — and an adapter is a closure. Any shape-changing belongs
*inside the client component*, which is free to unwrap what it receives.

`MusicQueueActions` has followed this rule since it was written; the floating layer
learned it the hard way.

### Enabled is app-wide; the state is per reader

Two settings, deliberately in two places, because they answer different questions:

| | Where | Stored as |
|---|---|---|
| Which components **exist** | Administration › Display Settings › Floating Components (admin only) | one `sys_app_settings` row, `floating_enabled` |
| Whether **mine** is open | Account › Floating Components (every reader) | `floating_state_<id>`, one `usr_preferences` row each |
| Which **corner** mine docks in | the same panel | `floating_corner_<id>`, one row each |

A component's **own** configuration is a third thing again, and it goes wherever that
component's data belongs rather than into either row above. The Scratchpad's categories
are the worked example: they are household structure an admin arranges, so they live in
`sys_scratchpad_categories` with their own screen (Administration › Display Settings ›
Scratchpad Categories) — *not* in `floating_enabled`, which answers only "does this
component exist at all".

The corner is a **separate key from the state**, deliberately: a corner is a standing
choice made once, while a state changes on every minimize, so one combined write would
let either clobber the other's field. Same reasoning as the calculator's angle mode
versus its last result.

**Disabled wins** (`effectiveState`): turning a component off takes it off every screen
at once, whatever a reader had stored. Their row is *not* rewritten, so re-enabling
restores what they had rather than resetting everyone to closed.

The per-reader half has to be on a page every reader can reach. `✕` is deliberately
final — it closes the window *and* the component — so Account is the only way a
non-admin gets a closed component back. Putting that control in Administration alone
would mean a non-admin who pressed `✕` had lost it for good.

### The calculator's evaluator: no `eval`, and no dependency

`src/lib/calculator` parses and evaluates expressions with a hand-written tokeniser plus
a shunting-yard evaluator — about 200 lines across `tokenize.ts`, `evaluate.ts` and
`functions.ts`.

**Never reach for `eval()` or `new Function()` here.** Those are arbitrary code execution
on a string, and this codebase already treats uploaded SVG as hostile and sanitises it to
an allowlist (`coding-guide.md` → *Uploaded SVG is sanitized on write*); accepting an
expression and *running* it would hold a weaker standard for the same class of input. The
evaluator can only ever produce a number.

A dependency (`mathjs`) was also considered and rejected: ~180KB for a feature this
contained, and it would be the app's first runtime math dependency.

Three rules the implementation holds, each of which has a test:

- **Two passes, not one.** `toPostfix` decides precedence and associativity; a separate
  `evaluatePostfix` walks the result. That is what lets `2+3*4 → "2 3 4 * +"` be asserted
  directly rather than inferred from the number 14.
- **Every function declares its own domain.** `sqrt(-1)`, `ln(0)`, `asin(2)` and
  `tan(90°)` return a *typed error*, never `NaN` or `1.633e16` displayed as an answer.
  A new function adds a `domainError` to its spec, not a branch in the evaluator.
- **`evaluate` never throws.** It is called on every `=`, so a mistyped expression is a
  routine return value (`EvaluationResult`), not an exception the caller must remember to
  catch.

**Rounding belongs to the formatter, not the evaluator.** `evaluate("0.1+0.2")` returns
the true IEEE value; `formatResult` is what turns it into `"0.3"` (12 significant digits,
exponent form outside 1e-7…1e12). Rounding earlier would compound through a longer
expression.

### The keypad is a catalogue, and the keyboard reads from it

`keypad.ts` declares all 36 keys as data — label, tone, what it inserts, and which
physical keys trigger it. The view is a `.map` over that table, and
`keyForKeyboardEvent` is built from the same list, so **the on-screen pad and the
keyboard cannot disagree**.

Keyboard capture is bound to the **keypad's own subtree, never `document`**. The floating
window is non-modal, so a global handler would swallow digits meant for the page behind
it — a reader typing in a form with the calculator open would lose every number. An
unmapped key (Tab, the arrows, anything with Ctrl/Cmd/Alt) is left alone entirely.

Keys are plain `<button>`s with the `.calc-key` classes, **not `Button`**. `design.md`
reserves `Button`'s hard offset shadow for discrete page-level actions, and 36 of them in
one panel is visually deafening; this follows `.sudoku-cell`'s precedent for a dense grid
of pressable cells.

### `AC` never clears the history

Clearing the display and clearing the tape are separate actions with separate controls. A
calculator that forgot your working-out because you pressed clear would be a bug, so
`applyKey`'s `clear` case resets the display only, and wiping the tape is an explicit
"Clear history" control wired to its own action.

For the same reason a **failed** expression is not recorded: the tape is a record of
results, and filling it with mistypes would push real answers off the end of a 50-row cap.

### Neither *enable/open* setting needs a migration

Both are key/value rows — `sys_app_settings` and `usr_preferences` (migration 0044) — so
registering a floating component ships with no `.sql` at all.

A component's *own* data is a separate question. The clock needs none; the calculator's
history tape is a growing, ordered, capped, clearable list, which is a table's job, so it
brought migration 0095. The test is the one in that migration's log: a single scalar read
whole is a preference row, a list is a table.

**"A list is a table" is about growth, not about arity.** `floating_enabled` is a list of
ids in one `sys_app_settings` row, and the navigation tree's `nav_expanded_modules` is a
list of module slugs in one `sys_user_preferences` row — both correctly *not* tables. The
distinction that matters is whether rows accumulate and are queried individually. The
calculator's tape grows without bound, is ordered, and is read by the slice; those two
lists are bounded by something that already exists (the registered components, the module
table), are always read and written whole, and are never queried by element. A row per
module would also need cleaning up every time a module was deleted, which is a migration's
worth of work to store a set of ten short strings.

One trap, and it is a real one: **`updateSettings` cannot create a row.** It is a plain
`UPDATE ... WHERE key = ?`, so against a database with no `floating_enabled` row it
reports success and writes nothing. `setEnabledFloating` uses the repository's
`setValue`, which upserts. Any new app-wide setting that isn't seeded by a migration has
to do the same.

### The floating state is written on its own

`saveFloatingState` writes **one key**, and `userPreferencesToEntries` deliberately
excludes the floating states (note its `Omit<…, "floating">` parameter). The Preferences
form writes every key it carries, so folding window positions in would mean pressing
Save on an unrelated form reset whatever shape your clock was in — and every minimize
would have to resend the whole preference set, letting a stale tab clobber a favorite.

`saveFloatingStateAction` also takes **no `revalidatePath`**: it fires on every minimize
and restore, and revalidating the layout each time would re-render every page in the app
to persist a position the client already applied optimistically.
