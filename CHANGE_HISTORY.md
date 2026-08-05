# Change History

## 2026-08-05 00:05 — Stocks & ETFs: section tree, cost basis, daily snapshots, per-ticker news, rebuilt CSV import

The largest change to this module since it was ported. Three migrations, and the
module's single scrolling page becomes eight routed sections.

**Migrations in this release — 0035, 0036 and 0037 must be applied before the app
is served**, or the affected screens fail with "no such column".

### Migration 0035 — cost basis, identifiers, and an owning account on positions

`stk_stock_positions` is rebuilt (not `ALTER`ed): its primary key moves from
`ticker` to **`(account_id, ticker)`**, and ten columns are added.

- **Why the key changed.** `ticker` alone meant one row per symbol for the whole
  app, so importing a second broker's export silently overwrote the first instead
  of adding to it. Now "75 MSFT at Chase" and "69 MSFT at Fidelity" are two rows
  that sum. `account_id = 0` is a real, supported value meaning **Unassigned** —
  which is the state the production DB was in (4 positions, 0 accounts), so nothing
  had to be invented for existing rows.
- **New columns:** `cost_cents`, `unit_cost_cents`,
  `unrealized_gain_loss_cents`, `unrealized_gain_loss_pct`, `cusip`, `isin`,
  `asset_class`, `asset_strategy`, `est_annual_income_cents`,
  `income_earned_cents`.
- The module previously had **no cost-basis field at all**, so it could only ever
  show a day's change and never a total return. That was the gap this started from.
- `unrealized_gain_loss_pct` is stored rather than derived: a broker's own figure
  accounts for adjusted basis (wash sales, corporate actions) that
  `unrealized / cost` on stored cents can't reproduce.
- `asset_strategy` ("US Large Cap") is deliberately **not** folded into `type`
  (Stock/ETF/Bond). `type` drives the allocation split; strategy is the broker's
  cap-size bucket. Different questions, different columns.
- A rebuild forced the trigger to be dropped *before* the table and recreated
  against the compound key, and added `idx_stock_positions_ticker` — with
  `account_id` leading the primary key, "who holds NVDA" no longer has a usable key
  prefix.

### Migration 0036 — daily portfolio snapshots

New `stk_daily_snapshots`, one row per calendar day, `snapshot_date` as the primary
key so a capture **upserts**: pressing Refresh All twice in a day recalculates that
day rather than appending.

- Stores **both value and gain/loss**, per bucket (stock / ETF / other / total),
  because neither derives correctly from the other. Differencing two days' values
  isn't performance — pay $10k in on Wednesday and the diff reads as a $10k gain.
  Day gain/loss (price move × shares held that day) excludes contributions, but
  can't be reconstructed from stored values for that same reason.
- `other_*` is stored so the parts sum to the total; the portfolio holds a
  money-market sweep line, and stock + ETF alone wouldn't add up.
- **No back-fill and no gap-filling.** History starts at the first Refresh All —
  the app stores each position's *current* price, not a per-day series for whatever
  was held back then — and a day with no capture has no row. The period rollups
  report the day count they actually had rather than inventing a flat day.

### Migration 0037 — an icon per investment account

`stk_investment_accounts` gains `icon_image` (BLOB) + `icon_image_mime_type`,
following `sys_users.avatar` (0011), `exp_creditcard_accounts.card_image` (0031)
and `exp_categories.icon_image` (0034).

- Bytes are served by `/api/stocks/accounts/[id]/icon`, never inlined as a base64
  data URL. **`listAccounts` / `getAccountById` were switched from `SELECT *` to a
  named column list** in the same change — otherwise the icon bytes would ride
  along in every account list, positions page and CSV-import render.
- 128 KB cap, PNG/JPEG/WebP/GIF only. **SVG is excluded**: it can carry script and
  these bytes are served from the app's own origin.

### The module is now eight routed sections

`TreeNav` down the left, exactly like Expense — each section a real route, so it's
bookmarkable and highlights on `pathname`:

Dashboard · Positions · Transactions · Account Performance · Actionables ·
Chart & Analysis · CSV Import · Configuration

- New `stock-sections.ts` (a **plain** module, not `"use client"`, so server
  components read the labels as real values rather than client-reference proxies),
  `stock-nav.tsx`, `stock-section.tsx`, and `stock-instructions.tsx` with per-section
  guidance.
- `[section]/page.tsx` was hardcoded to Expense; it now dispatches per module, and
  each validates **its own** section names so an Expense section can't be reached
  under the Stocks slug.
- Data is loaded **per section**, so opening the dashboard no longer reads every
  watch list and analytics cache the way the old single page did.
- **Actionables** holds the watch lists and the next-day scan. **Configuration** got
  real content: the three scan thresholds are now editable in-module, writing the
  same module settings Administration → Module Configuration writes.

### Dashboard: Portfolio Summary, Daily Glance, and Refresh All

- **Refresh All** walks positions one at a time *from the client*, showing a live
  line per ticker ("NVDA — today's price is $220.15") and a progress bar. A single
  server action returns once and so can't report progress; the upstream quote fetch
  dominates either way, so this costs nothing but buys the running commentary. A
  ticker that can't be priced goes red and the loop continues. When it finishes it
  captures the day's snapshot.
- **Portfolio Summary** card — total value, today's move, the value-over-time line
  chart (total / stock / ETF), and the full snapshot history as a `DataGrid`. Its
  Day G/L column footer sums over the *filtered* set, so filtering the date column
  to one month turns the footer into that month's P&L.
- **Daily Glance** card — Stock and ETF gain/loss with percentages, then Top 5
  gainers and losers with stocks and ETFs ranked **together** and a ticker held in
  two accounts counted once. A **Measure by Total value / Per share** selector
  switches both lists: a thousand shares up a penny beats two shares up $200 on
  total value and loses badly per share. The percentage is identical under both.
- **Week / month / year to date** tiles **sum each day's move** rather than
  differencing endpoint values, for the contribution reason above. Each shows its
  day count, so a day you never captured is visible rather than silently
  under-reported.
- Headline numbers come from the live positions, not the newest snapshot, so the
  card is right even before today's Refresh All.
- Numbers that aren't known read **"—", not 0** — a position with no imported cost
  basis has a value but no return, and the dashboard says so rather than printing a
  fake 0.00%.

### Per-ticker news

New `src/lib/ticker-news/`, over Yahoo Finance's unauthenticated search endpoint
(same host as the existing quote client, no API key).

- A **News** button on each mover row fetches the story most likely to explain the
  move. Fetched on click, not prefetched: prefetching meant ten upstream calls per
  page load for stories nobody opened.
- Providers tag stories loosely — a piece headlined "AMD Stock Tumbles" comes back
  tagged `["AMD", "SPCX", "NVDA"]`, and served raw that becomes NVDA's explanation
  for the day. `pickTopStory` prefers today's stories, then ones the ticker *leads*
  or is named in the headline, then newest. When the ticker is only a passing
  mention, or nothing was published today, **the UI says so** instead of implying
  the headline explains this morning.
- Word-boundary matching, so Cloudflare (`NET`) isn't matched by "NETWORK".
- Tickers are validated against `^[A-Za-z0-9.\-^]+$` before reaching the provider
  URL.

### CSV import, rebuilt

One screen with a type selector (Positions / Transactions / Account Performance)
replacing three stacked panels. `ImportType` already had all three values, so no
enum change was needed.

- The mapping table is now the shared **`CsvMappingTable`** component; the Expense
  statement importer was refactored onto it.
- **Every row is listed, numbered and in file order** — not the 10 random samples
  the preview showed before — and each row has a **×** to leave it out. Removed
  rows stay visible, dimmed and struck through, so the numbering keeps matching the
  file. `CsvPreview` gained `rows` for this.
- **Per-row Type dropdown** on a positions import, in an importer-owned column
  before the file's own. It starts on what the file implies and you correct the
  rows that are wrong — the answer for an export that mixes ETFs and stocks without
  saying which is which. **Set all…** in its header stamps every row at once.
- **`= fixed value`** box under each mapped column: type a literal and every row
  gets it, ignoring the cells. Map any spare column to Type, type `ETF`, and the
  file imports as ETFs. Saved with the named mapping, so next quarter's export is
  one dropdown away.
- Precedence is three deep, least to most specific: **cell → column-wide fixed
  value → per-row override**.
- **Save-as-new *and* update-selected** (the old stock importer could only create).
- The **date-format box now actually works** — `importTransactionsFromCsv` honours
  it, so `03/04/2026` is read strictly rather than guessed. It was decorative
  before.
- New `restrictMapping`: auto-mapping guesses from header text without knowing the
  import type, so a positions file's "Value" column came back aimed at a
  performance-only field. Now filtered per type.
- Chase header aliases added — the sample export auto-maps 14 columns on drop.
- **Excluded rows are dropped, not reported as skips.** A skip is something that
  surprised the importer; a row you removed deliberately isn't. The count is
  reported separately. The shared `selectImportRows` helper preserves each surviving
  row's **original** number — filtering and re-indexing would have reported a
  failure on the file's row 4 as "row 2".

### Refactors this pulled in

- **`src/lib/shared/image-upload.ts`** — `decodeImageUpload` and the mime allowlist
  were private to `lib/expense`; the account icon made them a second caller.
  Promoted with tests, and Expense re-exports the old names so its surface is
  unchanged. The allowlist is a security boundary (no SVG), and two copies were one
  edit away from drifting. The cap is checked against *decoded* length, not the
  base64 string, which is ~33% longer.
- **`src/lib/shared/date.ts`** — `todayIsoLocal` was defined inline in a page file.
  Now shared with `startOfWeekIso` / `startOfMonthIso` / `startOfYearIso` and 15
  tests. The one that matters: at 23:30 local, `toISOString()` files an evening
  snapshot under *tomorrow*.
- **`POSITION_TYPES` moved into the lib**, derived from `positionTypeSchema.options`
  rather than hand-written, so a new instrument type can't exist in the schema and
  be missing from a picker.
- **`resolvePositionType`** extracted from the importer so the per-row Type dropdown
  shows what will actually be stored; duplicating the rules in the view would have
  drifted.
- `importPositionsFromCsv` takes an **options object** — it was heading for seven
  positional parameters, and `import(repo, csv, m, 0, {}, [1], {})` told a reader
  nothing.

### Behaviour worth knowing

- **Refresh All replaces `value_cents`.** It's always `currentPriceCents ×
  quantity`, recomputed server-side and never accepted from a caller. Also replaced:
  price, day range, day gain/loss, dividend rate, and `name` when the quote supplies
  a `shortName`. **Untouched:** quantity, cost basis, unit cost, CUSIP/ISIN, asset
  class/strategy, income. Anything a quote feed legitimately knows is replaced;
  anything only you or your broker knows survives.
- The unrealized gain **is** recomputed against the stored basis on refresh, so a
  fresh price can't sit next to a stale gain figure.
- `dividend_rate_cents` is overwritten from the quote, which is often 0 even for a
  payer. This doesn't affect the dashboard's Annual Income, which prefers the
  broker's `est_annual_income_cents`.
- Footnote blocks a broker appends after the data (`FOOTNOTES`, `W,"…wash sale…"`)
  are dropped by `parseCsv`'s "fewer than half the header's fields" rule. That
  threshold scales with the header, so it handles a wide export like Chase's 71
  columns but would not detect footnotes on a narrow file.

### Known issues in this release

- `src/lib/stock-positions/stock-positions.ts` carries more formatting churn than
  its logic changes warrant: `prettier` was run on it to fix indentation after a
  scripted edit, and the repo has **no checked-in prettier config**, so it
  reformatted at the default 80 columns. It was re-run at 100 to match the codebase
  (siblings run to ~110), and the code is unchanged in behaviour — but the diff is
  noisy. **The repo should get a `.prettierrc`.**
- Three pre-existing lint errors remain, all `react-hooks/set-state-in-effect` in
  `csv-analytics-view.tsx` and `chart-xy.tsx` — untouched by this work, and two
  fewer than before it.
- The CSV-import account picker is a native `<select>` and so can't show an account
  icon; that would mean swapping it for `IconSelect`.
- News results are not cached, so pressing News twice re-fetches.

Verification: 736 tests pass, typecheck clean. All three migrations were applied to
a **copy** of the production DB and checked before being run for real — row counts
preserved, compound key and trigger working, the same ticker coexisting across two
accounts, `integrity_check` ok.

## 2026-08-03 23:18 — Full-width layout, floating sidebar, Expense spend stats + auto-import switch

No schema changes in this release — every DB-backed piece rides on existing tables.

### Layout: one page width, and the sidebar floats over it

- **Every full-page screen now shares one container**, `PAGE_CONTAINER` in
  `src/app/(protected)/page-container.ts` (`mx-auto w-full max-w-[160rem]`).
  Screens used to pick their own cap — `max-w-3xl` for most modules, `4xl` for the
  admin forms, `6xl` for the wide ones, and a bespoke `EXPENSE_PAGE_CONTAINER` —
  which left most of a large display as empty margin either side of the content.
  All 12 screens under `(protected)` were converted; `containerClassFor` and
  `WIDE_LAYOUT_SLUGS` are gone. The 160rem cap deliberately sits past a 2560px
  monitor so it doesn't bind on one; it exists only to stop a table spanning a
  3440px ultrawide.
- **`Sidebar` is `fixed` and raised above the page** (`z-40`) instead of being a
  column in the flow, so the layout reserves only its *collapsed* width
  (`pl-24` = 4rem rail + 2rem gutter) and a module gets the rest of the screen.
  Expanding it overlays content rather than reflowing it.
  - `z-40` is chosen: above `DataGrid`'s sticky header (z-10), its resize handles
    (z-20), `IconSelect`'s dropdown (z-30) and Admin's floating save bar (z-20),
    but **below `Modal` (z-50)** so a dialog's overlay still covers it. Anything
    new that stacks has to respect that ceiling.
  - It carries `Button`'s hard offset shadow **rotated to point right** — a
    floor-to-ceiling slab has no bottom edge to cast from — plus a soft second
    shadow for the lift, and `rounded-r-2xl`. No press/translate mechanic: it
    isn't a button. This is a deliberate exception to "surfaces never take the
    offset-shadow treatment", now recorded in `design.md`.
  - Its `nav` scrolls independently, since a fixed viewport-height rail can no
    longer just make the page taller.
  - Collapsed, the header is only the toggle. The app glyph on its own did
    nothing — not a link, and it read as a duplicate of the Home icon below it.

### Chevrons, and per-tree collapse state

- `TreeNav`'s panel toggle and `Sidebar`'s were `«`/`»`; both are now the same
  `&rsaquo;` chevron the node rows and `CollapsibleCard` already use, rotated 180°
  when expanded.
- **The Expense section tree is collapsible.** That needed a fix first:
  `TreeNav` persisted its collapsed state under one module-level constant, so a
  second collapsible tree would have shared state with Administration's —
  collapse one, the other collapses too. New `storageKey?` prop, defaulting to the
  old key so Admin's remembered state is untouched; Expense passes its own.
- The Expense nav wrapper lost its `lg:w-64`: a collapsible `TreeNav` owns its
  width (`w-64` → `w-16`), and a fixed width on the wrapper pins the rail open.

### Expense: "Interesting stats" on the dashboard

- New collapsible card showing **top 5 spenders by vendor** and **top 5 by
  category**, side by side. It replaces the standalone "Top categories" section,
  which was the same top-5 list.
- New `src/lib/expense/vendors.ts`. A statement line carries two names for the
  same shop — the tidied `vendor` post-import processing sets, and the raw
  `transaction_description` — and only some rows have the first, so grouping on
  `vendor` alone hides most of the spend. `vendorKeyFromDescription` derives a
  brand key from the description when `vendor` is blank: upper-cases, strips
  payment-processor prefixes (`SQ *`, `TST*`, `PAYPAL *`), cuts the per-order
  reference after a `*`, drops punctuation and store numbers, skips leading filler
  (`THE`), and takes the leading brand word — so `COSTCO WHSE #1017 SEATTLE WA`
  and `COSTCO GAS #1017` roll up as `COSTCO`, and `AMAZON.COM*2A34B5C6` as
  `AMAZON`. Vendor names are upper-cased for grouping, so a tidied `Costco` and
  derived `COSTCO` rows merge, and the tidied spelling wins as the label
  (`isDerived` records which you got).
- `vendorTotals` is pure (the dashboard already holds the rows, so it doesn't
  re-read the table); `totalsByVendor` is the repo-backed use-case. No new port
  method — the fuzzy match is text work, not SQL. 15 colocated tests.

### Expense: "Automatic importing csv from folder" switch

- A master switch for the background importer, stored as the module setting
  `csv_autoimport_enabled`. Off means the scheduler never imports, whatever the
  folder and interval say.
- **A missing row reads as on**, so an install already auto-importing keeps doing
  it after this deploys. It still needs a folder and interval, so a fresh install
  is off regardless.
- The two questions were conflated in one predicate and are now split:
  `isAutoImportConfigured` (folder + positive interval — what one pass needs, and
  the guard on `runAutoImport`) versus `isAutoImportEnabled` (configured **and**
  switched on — what the scheduler asks). Consequence: **"Run import now" still
  works with the switch off**, which is how you test a folder before arming the
  service.
- No `instrumentation.ts` logic change — the 60s heartbeat already gated on
  `isAutoImportEnabled`, and it re-reads settings every tick, so flipping the
  switch takes effect within a minute with no restart.

### Two CLI commands

- `npm run cli expense-top-spenders -- --limit 10` — the same two rollups the
  dashboard card shows, for eyeballing the vendor grouping against real data.
- `npm run cli explain-rule -- --id <n>` / `-- --description <text>` — why a
  post-import rule did or didn't fire: the description JSON-quoted (so invisible
  characters show), the current field values, the `processed` flag, every rule in
  evaluation order with match/no-match, which one wins, and per field either the
  assignment or the reason it was skipped. Calls the same `listRules` /
  `planRuleApplication` the real clean-up does, so its verdict is the run's.

### Known issues, unchanged by this release

- `npm run check:lib-boundary` fails on Windows for any tree: the script is
  `! grep -rE ...` and `!` isn't a cmd builtin. The check itself passes when the
  grep is run directly.
- 5 pre-existing lint errors in files this release doesn't touch:
  `csv-analytics-view.tsx` (2× `set-state-in-effect`), `csv-import-view.tsx`
  (2× unescaped `"`), `chart-xy.tsx` (1× `set-state-in-effect`).

## 2026-08-03 15:24 — Category icons, ticker logos, grid filters/aggregates, three more themes

Four independent pieces of work that were in the tree together at this checkpoint.

### Expense: category icons (migration 0034)

- Each category can carry a small uploaded image, shown wherever the category
  appears: the picker on the transaction form and the bulk-edit dialog, the
  Category column of the grid, the post-import rules (editor and list), the
  dashboard rollup and the charts totals.
- `exp_categories` gains `icon_image` (BLOB) + `icon_image_mime_type`, both
  nullable — "no icon" is a real state. Same pattern as
  `exp_creditcard_accounts.card_image` (0031) and `sys_users.avatar`: bytes are
  served by `/api/expense/categories/[name]/icon`, never inlined in a page
  payload, with `updatedAt` as a cache-buster.
- **`listCategories` / `getCategoryByName` changed from `SELECT *` to an explicit
  column list.** Without this, adding a BLOB to that table would drag every
  category's icon bytes into every page render.
- One upload schema now covers both images: `CARD_IMAGE_MIME_TYPES` →
  `EXPENSE_IMAGE_MIME_TYPES`, `cardImageSchema`/`CardImageInput` →
  `expenseImageUploadSchema`/`ExpenseImageUploadInput`, sharing a
  `decodeImageUpload` helper. Caps stay distinct: 512 KB for card art,
  **128 KB** for icons. Uploading to a category that doesn't exist is refused.
- The category list under Meta Data is now a row per category rather than chips —
  a chip had no room for the icon controls.

### New component: `IconSelect`

- A combobox whose options carry an image, because neither `<select>` nor
  `<datalist>` can render one — which is what the three category pickers needed.
  Keyboard-driven (arrows/Enter/Esc), closes on outside click, and by default
  typing still filters *and* commits, so naming a brand-new category on a
  transaction or a rule keeps auto-registering it. Registered in `components.md`.

### Stocks: ticker logos (migration 0033)

- `stk_ticker_logos` caches logo bytes in the DB; `/api/stocks/tickers/[ticker]/logo`
  downloads on first request and serves from cache afterwards. A "nothing found"
  result is cached too, so a symbol isn't re-requested on every render.
- New `TickerLogo` component (monogram fallback — a missing logo is the normal
  case for ETFs), used across the positions, transactions, watch list, analytics
  and next-day-actions grids.

### DataGrid: filter expressions, aggregates, and a shared `Modal`

- Column filters understand comparison and range expressions
  (`parseFilterExpression` in `src/lib/shared/table.ts`).
- Columns can declare an `aggregate` (`sum`/`avg`/`min`/`max`/`count`) with a
  footer total that follows the current filters — used for net spend in the
  Expense grid.
- Dialog markup extracted into a registered `Modal` component (overlay, Esc and
  focus handling) and adopted by the views that had hand-rolled it.

### Three more themes, three more icon sets

- Themes: **Sea Glass** (second light theme), **Midnight Slate**, **Copper Vault**.
- Icon sets: **Tabler**, **Material Symbols**, **MingCute**, with glyphs baked by
  `npm run gen:icons`.

## 2026-08-02 23:28 — Expense: automatic CSV import, post-import processing, tree-nav overhaul

### Automatic CSV import

- Two module settings (`csv_autoimport_path`, `csv_autoimport_interval_minutes`)
  and a background runner armed from `src/instrumentation.ts` at server startup.
- The runner ticks on a fixed 60-second heartbeat and re-reads the settings each
  time, importing only once the configured interval has elapsed — so changing the
  interval takes effect without a restart, and a slow import can't overlap the
  next one. Guarded against dev-mode hot reload arming it twice, and it never
  throws into the server.
- The watched folder holds **one sub-folder per card, named after it**
  (`/csv_import/Visa Gold/*.csv`), which selects both the account and its saved
  column mapping; files inside can be named anything. Processed files are renamed
  `<name>_<timestamp>.backup` (which also takes them out of the `*.csv` scan) and
  failures `<name>_<timestamp>.failed`, so nothing is retried forever. A CSV left
  loose at the top level is reported rather than silently ignored.
- File access sits behind a `CsvFolderPort`, so the whole flow is tested with an
  in-memory folder against a real in-memory SQLite built from the migrations.

### Post Import Processing (migration 0032)

- Transactions gain **`vendor`** (the tidy name) and **`processed`** (the
  clean-up queue, indexed).
- Rules go from *pattern → category* to **one condition → any number of field
  assignments**: `*TGI*` can set Vendor, Category, Status and Note at once.
  `exp_category_rules` is replaced by `exp_post_import_rules` +
  `exp_post_import_rule_actions`, with existing rules migrated across (ids
  preserved) rather than discarded.
- **"Manually Run Import Clean up"** with a real progress bar and log
  (`Processing 41 of 216 — rule "*TGI*" used, vendor set to "TGI Friday"…`). It
  runs in client-driven batches, because one long server action can't report
  progress; since `processed` *is* the queue, an interrupted run resumes.
  **Re-queue all** sweeps history after adding a rule.
- A rule only fills a field that's still blank (status: still `new`), so manual
  edits are never overwritten and re-running is safe. Rows nothing matched are
  still marked processed.

### Interface overhaul

- The module is now a **`TreeNav` of six sections**, each a real bookmarkable
  route: Main (Dashboard), Transactions, Meta Data, Charts and Analysis, Import
  Transaction, Settings — each with a one-line description. Sections live under
  `[slug]/[section]` so a static `expense/` folder can't shadow `/modules/[slug]`.
- Data is loaded **per section**, so the dashboard no longer reads every
  transaction, rule and mapping. The 600-line `expense-view.tsx` is gone.
- New Charts and Analysis section (spend-by-category `ChartBar` + totals table),
  a **To processed** counter, and dashboard counters that link to the section
  where the work is. Page width widened to 120rem — the old 6xl cap left most of
  a large display as empty margin.
- Added `list`, `chart` and `upload` glyphs to `tree-icons.tsx`.

### Fix: client/server boundary crash

- Section constants were exported from the `"use client"` nav module and read by
  server components, which receive **client-reference proxies** rather than real
  values — so `EXPENSE_SECTION_INFO[section]` was `undefined` and `.label` threw
  during serialization. Moved to a plain `expense-sections.ts` that both sides
  import. Typecheck, lint and build all passed while this was broken; only
  running the app surfaced it.

### Also

- `START_PRD_SYN.bat` — a Synology/DSM production start script (bash, despite the
  name, for consistency with `START_PRD.bat`): finds node when Task Scheduler
  gives it a bare PATH, loads `.env` itself, binds `0.0.0.0`, checks the database
  path before starting, frees the port, and rotates its log. Both publish scripts
  now copy it into the deployment folder.

## 2026-08-02 09:19 — Expense tracker module; newsletter→quotes importer

### Expense — a new module

A credit-card expense tracker: record or import transactions, categorise them,
and let fuzzy vendor rules do most of the categorising.

- **Schema** (migrations `0029`, `0030`, `0031`): four `exp_` tables —
  `exp_transactions` (transaction/posting dates, account, raw description, one
  category, `amount_cents`, note, status, `created_by_user_id`),
  `exp_creditcard_accounts`, `exp_categories`, and `exp_category_rules` — plus
  the module's own row in `sys_modules` and a card image on each account.
  Charges are positive and refunds negative; money is INTEGER cents throughout.
- **Fuzzy auto-categorisation.** A rule matches the raw statement description
  with a case-insensitive glob (`AMAZON*` → `online-purchase`, optionally also
  setting a status). `*` is a wildcard, a pattern with no `*` matches anywhere,
  and every other character is literal — card descriptions are full of `*`, `#`
  and brackets, so patterns are never treated as regular expressions. Lowest
  `priority` wins. Rules only fill a **blank** category, so they never overwrite
  a manual choice and re-running them is safe; "Apply rules now" backfills
  existing rows.
- **CSV import**, plugged into the existing `csv-import` module as a new
  `Expense` type: save a column mapping per card company and pick it next time.
  Reads `$20.33`, `1,234.56`, `(45.00)` and trailing-minus amounts, supports a
  single amount column or separate debit/credit columns, offers a sign flip, and
  **skips rows already imported** (same card, date, description and amount),
  reporting them in the summary.
- **Card images.** A small BLOB per account (PNG/JPEG/WebP/GIF, ≤512 KB, SVG
  rejected as it can carry script), served by an auth-gated route exactly like
  user avatars. Account reads now list columns explicitly so the bytes never
  load with a list. The thumbnail identifies the card in the accounts list and
  the grid's Account column.
- **UI**: summary tiles, transactions grid with inline edit, spend-by-category,
  cards & categories, rules with a pattern help box and a "test this pattern"
  match count, statement import, and a collapsed **Instruction** card
  documenting the non-obvious behaviour (sign convention, duplicate matching,
  delete semantics).
- Guard rails: deleting a card is refused while transactions reference it;
  deleting a category keeps the transactions and just uncategorises them.

### Daily Quote — import from a newsletter

- Parses a pasted James Clear "3-2-1" issue into quote candidates **without an
  LLM** — the format is regular enough to read deterministically (numbered
  headings, Roman-numeral items, quoted passages, `Source:` footers).
- Blocks are sliced by section and numeral rather than by quote marks, because a
  passage can quote something internally; the closing mark is only stripped when
  the quote marks balance. Tests run against a real issue verbatim, zero-width
  characters included.
- Paste → **Parse** → review and edit each candidate (quote, author, source,
  category, include/skip) → **Import**. Parsing happens in the browser, so
  nothing is written until approved, and unrecognised sections are reported as
  warnings rather than guessed at.
- Migration `0028` adds `source` to `sys_daily_quotes` so citations survive; the
  add/edit form and grid gained the field.

## 2026-07-30 22:27 — Result grid: search, filters, sticky header, column control, row selection

Upgraded the shared `DataGrid` (the "result grid") used by User Management,
Stocks & ETFs, CSV Analytics, SQL Explorer, and MyJournal. Every change is
additive — no caller needed updating.

- **Mechanics moved into the library.** New `src/lib/shared/table.ts` holds the
  pure parts (compare/sort, search and per-column matching, page slicing, CSV
  escaping) with 16 unit tests, so null ordering, numeric-aware text sorting
  ("item 2" before "item 10"), multi-term search, and page clamping are actually
  covered. The component now holds only view state.
- **Search + per-column filters.** A toolbar search box (terms are AND-ed across
  columns, so extra words narrow the result) plus a "Filters" toggle that reveals
  a filter input per column. The record count reports "filtered from N", there's
  a Clear filters action, and a filtered-empty result gets its own message. Sort,
  pagination, and CSV export all follow the filtered set.
- **Sticky header and honest page sizes.** The header stays visible while the body
  scrolls (capped by a new `maxHeight`, default `70vh`). Page sizes are now
  10/25/50/100/200/500/1000/ALL, and pagination triggers when rows exceed the
  chosen page size — previously it was hard-wired to 100, so a caller asking for
  `defaultPageSize={25}` silently got every row on one page.
- **Column visibility and order.** A "Columns" panel with checkboxes and up/down
  reordering, plus Reset. An optional `storageKey` remembers the arrangement in
  `localStorage`. Hiding the last visible column is refused (it would leave an
  empty grid), and a saved layout naming columns that no longer exist is ignored.
- **Row selection.** Opt-in `enableSelection` adds a checkbox column with a
  select-all covering the whole filtered set (indeterminate when partial), and
  `renderSelectionActions(selectedRows, clearSelection)` supplies bulk actions.
  Checkbox clicks no longer trigger `onRowClick`.
- **Status bar is raised, not recessed** — a top highlight plus a cast shadow, the
  same bevel mechanic as the header bar. The grid container gained
  `overflow-hidden` so the toolbar/status-bar backgrounds stay inside its rounded
  corners.
- **`components.md` restructured** into a fuller registry: an index table, then a
  per-component section with source link, import line, client/server note, a props
  table, a usage snippet, and a real call site to copy from.

## 2026-07-30 00:02 — MyJournal: entry authoring, GPS + weather, entry screen, Today In History

Built out the MyJournal module from "list + CSV import" into a full authoring and
browsing experience.

Entry authoring:

- **New Journal** collapsible card on the module page: a create form (date
  defaulting to today, time, title, place, categories, tags, content) with
  autocomplete from existing categories/tags. New `createJournalEntryAction`.
- The entries list is now the **25 most recent** via a new `listRecentEntries`
  use-case (ordered `entry_date`/`entry_time`/`id` descending with a SQL `LIMIT`,
  rather than loading every row to show 25).

Locations and weather (no schema change — `jrn_entry_locations` and the entry's
weather columns already existed from migration 0027):

- **GPS location picker** built on Leaflet + OpenStreetMap (chosen over Google
  Maps so no API key or billing is needed): search a place, or click the map to
  drop a pin, with the name suggested by reverse geocoding and multiple locations
  per entry. New deps `leaflet`, `react-leaflet`, `@types/leaflet`.
- New `src/lib/geocoding` module (`GeocodingClient` port + `NominatimGeocodingClient`).
  Geocoding runs **server-side** through actions because Nominatim's usage policy
  requires a descriptive `User-Agent`, which a browser `fetch` cannot set.
- New `src/lib/weather` module (`WeatherClient` port + `OpenMeteoWeatherClient`,
  plus a WMO weather-code → description map) and a **"Fetch today's weather"**
  button that uses the entry's first location, falling back to a default location.
- **Preferences** card storing a default location and °C/°F in the journal's
  module settings (`resolveJournalPreferences` mirrors the Stocks module's
  `resolveThresholds`).

Entry screen (new route `/modules/[slug]/entries/[id]`):

- New registered `JournalEntryCard` component showing every stored field, with
  **Print/Save-PDF**, **Edit**, **Lock/Unlock** and **Delete** (behind an inline
  confirm). Blank fields are hidden so an entry only shows what it recorded.
- Printing uses a new `@media print` block in `globals.css` that prints the
  `.print-sheet` element alone as ink-on-white, independent of the app chrome.
- **Inline editing** seeds *and* resubmits weather, locations, and the pinned flag,
  because `updateEntry` replaces the whole aggregate — without that, editing text
  would silently drop them. Removing weather is an explicit checkbox.
- **Previous/Next** navigation via a new `getEntryNeighbors` use-case, using
  SQLite row-value comparison so adjacency matches the list's exact ordering.
  Previous = older, Next = newer.
- Per-location **Map** button opens a read-only Leaflet panel plus deep links to
  OpenStreetMap and Google Maps. `JournalEntryCard` itself stays free of any
  mapping dependency (it raises the intent; the route renders the map).
- Rows in both journal grids now open the entry screen — `DataGrid` gained an
  additive `onRowClick` prop (existing callers unaffected).

Other:

- **Today In History** card: past entries sharing today's month and day (any year
  but this one), each labelled "N years ago".
- **Show SQL** on the journal entries grid, admin-only. Added
  `executeReadOnlyQuery` to `src/lib/sql-explorer`, which accepts only `SELECT` —
  deliberately stricter than the existing admin `executeStatement`, whose
  non-read-only path executes writes. The admin check is enforced in the server
  action, not just by hiding the button.
- **Daily Quote widget**: a small refresh button draws another random quote
  without reloading the page.

## 2026-07-27 23:18 — MyJournal module (schema, CSV importer, UI); plus batched pre-existing tree work

MyJournal (this session):

- **Schema** — migration `0027_create_journal_tables`: 8 `jrn_` tables —
  `jrn_entries` (weather flattened to columns; multiple entries per date
  allowed), `jrn_categories`, `jrn_tags`, `jrn_entry_categories`,
  `jrn_entry_tags`, `jrn_entry_locations`, `jrn_entry_images`, `jrn_icons`.
  INTEGER keys, no DB FKs (cascade handled in the repository), `updated_at`
  triggers.
- **Library** `src/lib/journal/` — the entry as an aggregate (its categories,
  tags, and locations), zod schemas, `SqliteJournalRepository` with
  transactional create/update/delete cascades, and use-cases (create/update/
  delete, pin, lock, category & tag management), with colocated tests. Wired as
  `deps.journalRepo`. Rules: referenced categories/tags auto-register; names
  trim/de-dupe; a locked entry blocks edit and delete until unlocked.
- **CSV import** — generalized the shared `csv-import` module: per-column
  options (`delimiter`, `dateFormat`) held in a parallel map so the Stock
  importer's `ColumnMapping` was untouched; a `Journal` import type; editable
  named mappings (`updateNamedMapping`); a 10-random-row preview sample. Fixed
  `src/lib/shared/csv.ts` with a record-aware `parseCsvRecords` so multi-line
  quoted cells parse correctly (also benefits Stocks/CSV-Analysis).
- **Apply-adapter** `src/lib/journal/csv-import.ts` (record → `createEntry`,
  best-effort with a per-row summary) + `autoMapJournalHeaders`; new
  `import-journal-csv` CLI command. Verified against a real 785-row export:
  785 imported, 0 skipped.
- **Web view** — replaced the journal "Coming soon" placeholder with a
  read-only entries `DataGrid` plus a CSV import panel (file drop, sample grid,
  per-column field + option controls, named-mapping load/save/edit/delete,
  import summary). Deferred: the create/edit/pin/lock entry editor, and the
  `images`/`icons`/`widgets`/`attachments` features.

Pre-existing uncommitted work batched into this commit (described from the diff,
not this session's conversation):

- **Real Estate removed** — deleted `src/lib/real-estate/**`,
  `src/lib/property-watch/**`, their module views/actions, and 8 property CLI
  commands; dropped migrations 0013/0014 and added `0026_drop_real_estate_module`.
- **Module-prefixed table names** — every table renamed to a lowercase 3-letter
  prefix (`sys_`/`stk_`/`csv_`); historical `CREATE` migrations (0001–0023),
  affected repositories, and `scripts/migrate.ts` updated
  (`reconcileLegacyTableNames` migrates an existing DB in place). Added
  `coding-guide.md` and `0024_rename_tables_to_module_prefixes`.
- **Daily Quote** — `src/lib/daily-quote/**`, an admin management screen, and
  migration `0025_create_sys_daily_quotes` (seeded starter quotes); plus a
  `list-users` CLI command and a `show_users.bat` helper.

## 2026-07-25 22:11 — Self-signup with hidden admin elevation; user-selectable icon sets; Daybreak light theme

Self-signup (this session):

- Added a public "Create account" flow reachable from the login screen. New
  `registerUser` use-case in `src/lib/user` always creates a `user`-role
  account with zero module access (mirroring the Google auto-create policy);
  its schema deliberately has no `role` field so the form can't self-elevate.
- Optional admin elevation at signup: a matching `adminSecretKey` (compared
  constant-time via a new `src/lib/shared/secret.ts` `secureCompare`) creates
  an admin instead. The expected value comes from a new `ADMIN_SIGNUP_SECRET`
  env var wired in as `deps.adminSignupSecret`; unset means admin signup is
  off, and a wrong/absent-secret attempt is a hard failure (no silent
  downgrade). New `InvalidAdminSecretError`.
- New `/login/register` route (page + view). The "Admin secret key" field is
  hidden until the visitor types the sequence `a` `d` `m` anywhere on the
  page. On success the visitor is returned to `/login?registered=1` with a
  confirmation banner (no session is created). Colocated tests for
  `registerUser` and `secureCompare`; documented the env var in `.env.example`.

Icon sets + light theme (pre-existing uncommitted work in the tree, described
from the diff rather than this session's conversation):

- Module icons are now a user-selectable "icon set" (parallel to color
  themes): new `ICON_SETS` registry in `src/lib/settings/icon-sets.ts`, an
  `icon_set` app setting (migration `0023`, default `solar-bold-duotone`,
  mirrored in `DEFAULT_APP_SETTINGS`), an Admin → Configuration → Icons picker
  screen, and an `IconSetProvider`/`useIconSet` context read once in the root
  layout. Glyph SVGs are baked into `module-icon-sets.generated.ts` by
  `scripts/gen-icon-glyphs.mjs` (`npm run gen:icons`) from `@iconify-json/*`
  devDependencies — no runtime icon dependency.
- `ModuleCard` redesigned to lead with a prominent icon badge (solid-accent
  tile for monochrome sets, neutral `bg-paper` tile for colorful sets);
  registry (`components.md`) and `design.md` updated accordingly.
- Added **Daybreak**, the first light theme (rose accent on warm paper), plus
  design.md guidance to design for both light and dark surfaces.

Not committed: `Google_Client_Info.md` — it contains a live Google OAuth
client secret and is intentionally excluded (recommend rotating it and moving
the values into a gitignored `.env.local`).

## 2026-07-12 23:34 — User management, authentication, and Google sign-in

- Added user management: a `users` table (username, full name, description,
  hashed password via Node's `scrypt`, role, disabled flag), a
  `user_module_access` grant table, and a `sessions` table backing a
  cookie-based login flow. New `src/lib/user` and `src/lib/auth` domain
  modules, plus a `create-user` CLI command to bootstrap the first admin.
- Gated the whole app behind login: moved the existing routes into a new
  `src/app/(protected)/` route group whose layout redirects to `/login` for
  anyone without a valid session. The sidebar now shows the logged-in user's
  name and a logout button, hides "Administration" for non-admins, and only
  lists modules the user has been granted (admins implicitly get every
  module, including future ones).
- Added a "User Management" screen (new top-level Administration node) built
  on a new reusable `DataGrid` component: create users, elevate/demote,
  enable/disable, reset passwords, edit per-user module access, and delete —
  with guards preventing an admin from locking themselves out.
- Added "Sign in with Google" as an additional login method, hand-rolled
  (no new dependency): a `google_email` column links an existing account to
  a Google address; unlinked/unverified Google accounts are rejected, never
  auto-registered. Feature is off by default and only appears once
  `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REDIRECT_URI` are set
  (see new `.env.example`).
- Fixed a relative-import bug in `admin/about/page.tsx` (`../../package.json`)
  left over from the route-group move — it needed one more `../` to still
  reach the repo root.
- Fixed `.gitignore`: the blanket `.env*` rule was also swallowing
  `.env.example`, which is meant to be committed; added `!.env.example`.

## 2026-07-12 22:10 — Administration section, Module Settings, and visual polish

- Added a full Administration section: tree nav with a distinct SVG icon per
  node, a collapsible tree panel (flattens to icon-only when collapsed),
  Module/Application Configuration, 10 color themes, About, and a Change
  History page that renders this file.
- Added the Module Settings feature: a new `module_settings` table (per-module
  key/value store), a `src/lib/module-settings` domain module, and a
  `CollapsibleCard`-based editor per module, wired into the existing Save
  Settings / Reset to Default flow.
- Fixed a data-integrity bug: `resetToDefaults` on `modules` now upserts by
  slug instead of delete-then-insert, so a module's id (and its settings)
  survives "Reset to Default" instead of being silently orphaned.
- Added a second module, Stock & ETFs, and a combined home/AI-magic/finance
  themed SVG app icon (favicon + in-app branding, next to the wordmark).
- Sidebar/home screen visual pass: restyled the sidebar from dark to light per
  feedback, added Home and Administration as their own nav rows (own icons,
  out of the cramped header), centered the home screen header row, and gave
  the Administration button and module cards deeper, more separated 3D drop
  shadows.
- Rewrote the `build_project` skill into a full release checkpoint (log →
  verify → sync docs → commit).
- Initialized git and linked the GitHub remote
  (`https://github.com/rvpals/MyHomeBase.git`).
