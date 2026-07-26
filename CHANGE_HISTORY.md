# Change History

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
