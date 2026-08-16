# Migration 0044: create user preferences

**Date:** 2026-08-15
**Type:** new table
**Table(s) affected:** `sys_user_preferences` (created)

## What this does

Gives each account its own settings, separate from the ones everybody shares. Until now
every stored setting in this app was global: `sys_app_settings` holds the theme, icon set
and application name for the whole install, and `sys_module_settings` holds a module's
configuration for everyone who opens it. Two people using the same MyHomeBase got the
same answer from every key.

This table is the per-user counterpart. The first two keys let someone skip the home
screen entirely: pick a **favorite module**, turn on **open it on startup**, and logging
in drops you straight into the module you actually use. Leave the favorite unset (or the
flag off) and nothing changes — the home screen with its carousel, quote and
today-in-history stays exactly as it was.

| Column | Type | Notes |
|---|---|---|
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | Surrogate key. Nothing references it; the natural key is the pair below. |
| `user_id` | `INTEGER NOT NULL` | Owner — `sys_users.id`. No DB-level FK (see below). Indexed. |
| `preference_key` | `TEXT NOT NULL` | `favorite_module_slug`, `open_favorite_module_on_startup`. Key names live in `USER_PREFERENCE_KEYS`. |
| `preference_value` | `TEXT NOT NULL` | Always text; typing happens in the resolver. Blank means "not set" — never NULL. |
| `created_at` | `TEXT NOT NULL DEFAULT (datetime('now'))` | |
| `updated_at` | `TEXT NOT NULL DEFAULT (datetime('now'))` | Maintained by trigger `sys_user_preferences_set_updated_at`. |

## Why key/value, and why UNIQUE (user_id, preference_key)

Two shapes were available and both are already in the codebase.

`sys_app_settings` (0002) is `key TEXT PRIMARY KEY` — the key *is* the identity. That
can't work here, because the same key exists once per user. Adding `user_id` to that
table would also mean the full create-copy-drop-rename rebuild (SQLite cannot change a
primary key) and would mix global and per-user settings in one place, where a reader
could no longer tell which is which by looking at the row.

`sys_module_settings` (0006) is the right precedent: a surrogate `id`, an owner FK column,
and `UNIQUE (module_id, setting_key)`. Swapping `module_id` for `user_id` gives exactly the
semantics needed. The unique constraint makes a save a **single upsert by key** rather than
separate create and update paths, and it doubles as the index for a one-key lookup.

**Deliberate divergence from 0006:** module settings are written with
`replaceForModule` — delete every row for the module, then insert the new set. This table
writes **per key** (`setValue`, an `ON CONFLICT ... DO UPDATE` upsert) instead. Replacing
the whole set would mean any code path that saves one preference has to know, and resend,
every other preference the user has — so a new preference added later would silently wipe
itself whenever an older screen saved. Per-key writes make each preference independent.

**Consequence to know:** saving the same key twice for one user overwrites; it does not
accumulate history.

## Key/value rather than a column per preference

A typed column per preference would let SQLite enforce the types. It was rejected for the
same reason both existing settings tables were built this way: a new preference would then
need a migration, and there will be more of these. As key/value, adding one is a new
entry in `USER_PREFERENCE_KEYS` plus a field on the resolver — no schema change.

The cost is real and it moves into code: every value is `TEXT`, so coercion and defaulting
have to happen somewhere trustworthy. That somewhere is `resolveUserPreferences` in
`src/lib/user-preferences/preferences.ts`, which turns rows into a typed
`UserPreferences` object, and `userPreferencesToEntries` going the other way — the same
pair `resolveJournalPreferences` / `journalPreferencesToEntries` already uses for the
journal module. No caller reads a raw row.

## Blank, not NULL

`preference_value` is `TEXT NOT NULL`, so "no favorite module" is stored as the **empty
string**. This follows `STARTUP_MESSAGE` (0041) and its reasoning: making the column
nullable to model absence honestly would require the full create-copy-drop-rename rebuild,
because SQLite cannot relax a `NOT NULL` in place, and would buy no behavioural change.

The mapping from blank to `undefined` happens **once, in the resolver**. If you find a
`=== ""` test in a component or a page, the resolver is being bypassed.

## The obligations this carries

Three things SQL can't enforce here, all handled in code:

- **Deleting a user must delete their preferences.** There is no FK to cascade.
  `SqliteUserRepository.deleteUser` already runs a transaction that clears
  `sys_user_module_access` before deleting the row; the preference delete joins that same
  transaction. A user module's repository writing another module's table is the existing
  pattern there, not a new exception.
- **A favorite module can stop being valid.** Slugs are stored, not module ids — a slug
  survives a re-seed, which an autoincrement id doesn't. But a module can be hidden, or
  the user's access to it revoked, after they favorited it. `resolveStartupDestination`
  therefore takes the user's currently-accessible modules and returns `undefined` when the
  favorite isn't among them, so a stale preference degrades to the home screen instead of
  redirecting somebody into a module they can't open. That function is pure and is where
  the redirect decision is tested.
- **The redirect must not loop.** The home page is the only place that redirects, and it
  redirects to `/modules/<slug>`, never to itself. A module page has no startup logic, so
  there is nothing to bounce back.

## No seed data

The table starts empty, and empty is a meaningful state: no row for a user means no
favorite and no startup redirect, which is the behaviour every existing account already
has. Nothing needs backfilling, and `resetSettingsToDefaults` deliberately does not touch
this table — the same choice 0006 made for module settings, because wiping everyone's
personal preferences is not what "reset the application settings" should mean.

## Rollback

```sql
DROP TRIGGER IF EXISTS sys_user_preferences_set_updated_at;
DROP INDEX IF EXISTS user_preferences_user_id_idx;
DROP TABLE IF EXISTS sys_user_preferences;
```
