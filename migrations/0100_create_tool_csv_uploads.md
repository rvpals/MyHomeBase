# Migration 0100: the Tools module's uploaded CSV / text files

**Date:** 2026-09-20
**Type:** new table (1)

## What this does

Adds the one table behind the **Tools** module's second utility, the **CSV File
Browser**. One row per delimited text file a reader has uploaded to work on.

| Table | What it holds |
|---|---|
| `tol_uploaded_csv_files` | One uploaded `.csv`/`.txt`/`.tsv`/`.tab`/`.psv` file: its original name, the two generated names it is stored under, how it is read, its columns and size, and who brought it |

### `tol_uploaded_csv_files`

| Column | Type | Notes |
|---|---|---|
| `id` | `INTEGER PK AUTOINCREMENT` | |
| `original_file_name` | `TEXT NOT NULL` | The name on the reader's machine. **Display only** — no path is built from it |
| `stored_file_name` | `TEXT NOT NULL UNIQUE` | The generated name of the uploaded text, inside the upload root |
| `table_file_name` | `TEXT NOT NULL UNIQUE` | The generated name of the SQLite **sidecar** the rows were loaded into — see below |
| `delimiter` | `TEXT NOT NULL` | One of `,` `\t` `;` `|`, sniffed at import or corrected by the reader |
| `has_header_row` | `INTEGER NOT NULL DEFAULT 1` | Whether row 1 was consumed as column names |
| `column_names` | `TEXT NOT NULL` | JSON array, in file order — see below |
| `row_count` | `INTEGER NOT NULL` | Rows at import, corrected as rows are deleted |
| `byte_size` | `INTEGER NOT NULL` | What the list shows, and what the upload cap was checked against |
| `uploaded_by_user_id` | `INTEGER` | → `sys_users.id`, `ON DELETE SET NULL` |
| `uploaded_at` | `TEXT NOT NULL` | `datetime('now')` |

Plus `idx_tol_uploaded_csv_files_uploaded_at` on `(uploaded_at DESC)`, the only
ordering this table is ever read in.

## Why `tol_` and not a new prefix

Tools already owns `tol_` (migration 0097), and `coding-guide.md` is explicit that a
prefix is a **module namespace**, not an abbreviation of the first table that needed
one. That is exactly the case 0097 anticipated when it chose `tol_` over `sql_`: *"Tools
is explicitly a container for further utilities, so naming the namespace after the first
one would have aged badly the moment a second tool arrived."* This is that second tool,
and the prefix held.

## Why the rows go into a SQLite sidecar instead of staying text

This is the decision the whole table is shaped around, and it is what makes this
different from 0097.

A delimited text file has **no row identity and no random access**. The screen has to
page, filter, edit and delete individual rows, and none of those have an answer in a
text file:

- **Editing or deleting a line in place means rewriting the whole file.** At the cap
  that is the file's full size written per click, and the *second* reader to click
  clobbers the first — there is no transaction to lose to.
- **There is no stable way to name a row.** Line number is not identity: the grid sorts
  and filters, and a delete renumbers everything after it. The SQLite browser addresses
  rows by `rowid` precisely because position is not identity, and the same argument
  applies here with more force.
- **Every read would be a full parse.** Showing rows 50,000–50,100 of a large file means
  scanning from the top, because a quoted field may contain newlines and so byte offsets
  cannot be guessed.

So the import parses the text **once** into a per-upload SQLite file and everything
afterwards reads and writes that. A row gets a real `rowid`, a page is an indexed
`LIMIT/OFFSET`, an edit is an `UPDATE` in a transaction, and — the part that actually
saved work — it is the *same* read/write shape `sqlite-browser` already proved out,
rather than a second bespoke one.

**The cost, stated plainly: the sidecar becomes the source of truth and the uploaded
text is never rewritten.** Edits therefore leave through **Export**, which regenerates
the file from the sidecar in its original delimiter. The original is kept rather than
discarded so the bytes as uploaded are still recoverable, but nothing reads it after
import. A reader who expects their edits to appear in the file they uploaded will not
find them there — that is a deliberate trade, and the instructions card says so.

Both files live in `MYHOMEBASE_TOOLS_CSV_UPLOAD_ROOT` (defaulting to `csv-uploads/`
beside the database), separate from the SQLite browser's `tool-uploads/` so that
clearing one tool's workspace does not touch the other's. As with 0097, **the folder can
be wiped without the rows going with it** — every read checks the sidecar is still there
and reports "upload it again" rather than surfacing the driver's error.

The two names are two columns rather than one name plus a convention (`<name>.sqlite`).
A convention would pair the files by string manipulation, and a single bad row would
silently pair one upload's text with another's rows.

## Why `column_names` is JSON and not its own table

It is read and written **whole, always with its file**, and never joined or filtered on.
A child table would add a join to serve no query that exists. The same reasoning
`jrn_saved_filters` uses for its stored filter JSON.

What the column list actually does is name the sidecar's columns. The sidecar stores
columns **positionally** — `c0`, `c1`, … `cN` — and holds no names of its own. That is
what lets a real-world header like `select`, `1st Qtr`, or a duplicated `Total` be
addressed by an edit without quoting trouble, and makes it impossible for a header to
collide with `rowid`. The mapping between a change keyed by column name and the column
actually written happens in exactly one place, `csv-table-store.ts`.

## Reading these rows forgivingly

`delimiter` and `column_names` are both parsed defensively on read: an unrecognised
delimiter resolves to a comma and a malformed `column_names` resolves to an empty list,
rather than either throwing. These rows are reachable from the admin SQL Explorer, and a
hand-edit should degrade one file rather than break the picker for all of them — the
same rule `resolveToolsSettings` follows in clamping instead of rejecting.

## The upload cap is shared, not new

The tool reuses `tools_max_upload_bytes` (the Tools module setting added alongside
migration 0097, edited at **Admin → Configuration → Application**). No new setting and
no migration for one: it governs how much of the NAS volume one upload can take, which
is the same question for both browsers, and two separately-configurable caps in one
module would be two things to keep in sync for no gain.

## Rollback

```sql
DROP INDEX IF EXISTS idx_tol_uploaded_csv_files_uploaded_at;
DROP TABLE IF EXISTS tol_uploaded_csv_files;
```

Dropping the table does **not** remove the uploaded files or their sidecars from the
workspace folder. Clear `csv-uploads/` by hand if that is wanted; nothing else reads it.
