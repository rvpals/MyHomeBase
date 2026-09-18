# Migration 0097: the Tools module's uploaded SQLite files

**Date:** 2026-09-17
**Type:** new table (1)

## What this does

Adds the one table behind the **Tools** module's first utility, the **SQLite File
Browser**. One row per SQLite file a reader has uploaded to poke at.

| Table | What it holds |
|---|---|
| `tol_uploaded_databases` | One uploaded SQLite file: its original name, the name it was stored under, its size, and who brought it |

### `tol_uploaded_databases`

| Column | Type | Notes |
|---|---|---|
| `id` | `INTEGER PK AUTOINCREMENT` | |
| `original_file_name` | `TEXT NOT NULL` | The name on the reader's machine. **Display only** — see below |
| `stored_file_name` | `TEXT NOT NULL UNIQUE` | The generated name inside the upload root |
| `byte_size` | `INTEGER NOT NULL` | What the list shows, and what the 50 MB cap was checked against |
| `uploaded_by_user_id` | `INTEGER` | → `sys_users.id`, `ON DELETE SET NULL` — see below |
| `uploaded_at` | `TEXT NOT NULL` | `datetime('now')` |

Plus `idx_tol_uploaded_databases_uploaded_at` on `(uploaded_at DESC)`, the only
ordering this table is ever read in.

## Why `tol_`, and why a new prefix at all

`coding-guide.md` wants a new lowercase three-letter **namespace** per feature module,
and Tools is a feature module — a row in `sys_modules`, on the home grid, grantable
per user.

The prefix is `tol_` (Tools, the module's domain) rather than `sql_` (SQLite, the first
utility that happened to need a table). That is the distinction the guide draws when it
explains why Picture Gallery is `pho_` and not `alb_`: **a prefix is a namespace, so it
has to still fit the second table.** Tools is explicitly a container for further
utilities, so naming the namespace after the first one would have aged badly the moment
a second tool arrived.

`too_` was rejected as unpleasant to read and easy to mistype as `foo_`.

## Why the bytes are not a BLOB in this table

This is the load-bearing decision.

An uploaded database is up to 50 MB, and it is **written to** — the browser's whole
point is deleting rows out of it. Storing it as a BLOB would mean, on every delete:
read the entire file out of `myhomebase.db` into memory, write it to a temp file so
`better-sqlite3` can open it (the driver opens *paths*, not buffers), apply the delete,
read it back, and write the whole blob again. A one-row delete would rewrite 50 MB of
the app's own database.

It would also bloat the file everyone's real data lives in, and land in every backup
of it, for what is explicitly scratch space.

So the bytes live in a workspace folder named by `MYHOMEBASE_TOOLS_UPLOAD_ROOT`
(defaulting to `tool-uploads/` beside the database), and this table holds only the
pointer. `better-sqlite3` opens that path directly, which is also what makes writing
back a normal transaction rather than a copy-modify-copy dance.

The tradeoff is accepted deliberately: **the folder can be wiped without the rows
going with it.** That is treated as a supported state rather than corruption — the
upload root is a workspace, and clearing it is a reasonable thing for someone to do.
Every use-case checks `exists` before opening, and a missing file reports *"the file
for X is no longer on disk. Upload it again"* instead of surfacing the driver's error.

## Why the stored name is generated, and the original kept separately

Two different jobs, so two columns.

`stored_file_name` is a UUID plus the original extension, chosen by the file store.
Two readers uploading `data.db` must not collide, and a filename off a file dialog can
carry `..` or a path separator — so **no path is ever built from the reader's string.**
`original_file_name` exists purely so the picker can say `chinook.db` rather than
`f47ac10b-58cc-4372-a567-0e02b2c3d479.db`.

`UNIQUE` on the stored name is a cheap backstop: if the generated name ever did
collide, two rows would otherwise silently share one file, and deleting either would
break the other.

## Why `ON DELETE SET NULL` and not `CASCADE`

Uploads are **shared** with everyone granted the module — that was the explicit
requirement. Deleting a user account must therefore not delete files other people are
working with, which is exactly what `CASCADE` would do.

The repository `LEFT JOIN`s `sys_users` for the display name, so an orphaned upload
reads as "Unknown" and stays usable. Same reasoning as `gam_scores`, where a score
outlives the account that set it.

Note this is a real FK, where several older tables here take the convention of an
un-constrained `user_id`. It is warranted: the `SET NULL` behaviour *is* the feature,
and getting it from the database is more reliable than remembering to null the column
in application code on every account deletion path.

## What is *not* in this table

**Nothing about the contents of an uploaded file.** No cached table list, no row
counts, no schema snapshot. The file is the source of truth and the module writes to
it, so any cache here would be wrong the moment someone deleted a row — and reading
`sqlite_master` out of a local file is fast enough that caching buys nothing.

**No per-user ownership for access.** `uploaded_by_user_id` is attribution, not
permission: anyone granted the Tools module sees every upload, per the requirement.

## Rollback

```sql
DROP TABLE tol_uploaded_databases;
```

Leaves the uploaded files themselves in the upload root as orphans — delete that
folder by hand if the module is being retired for good. Nothing else references this
table.
