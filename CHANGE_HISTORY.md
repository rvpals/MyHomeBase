# Change History

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
