# 0181 — Pinning for the Code Library

Adds `cod_snippets.is_pinned` and replaces the list index to match the new sort.

## Decisions

- **A column, not a table.** A pin is one bit about the snippet, the same shape
  `clp_clips.is_pinned` takes (migration `0157`).
- **Shared, not per-reader.** There is no per-user snippet in this module, so
  there is no per-user pin — everyone granted the module sees the same library and
  the same pinned band. A per-reader pin would need its own table keyed by user,
  and would be the first thing here that two people could disagree about.
- **The ordering lives in the repository's single `ORDER BY`.** Not in a view, not
  in a component. That is what guarantees the list and any later board render the
  same order rather than each sorting its own way — the rule Clips records for the
  same reason.
- **The index is replaced, not added to.** `0178` created
  `idx_cod_snippets_updated` on `(updated_at DESC, id DESC)`, which no longer
  matches the query now that every read leads with the pin. Leaving both would
  keep an index SQLite has no reason to choose and that every write still has to
  maintain.

`ALTER TABLE … ADD COLUMN` with a `NOT NULL DEFAULT` is a cheap in-place change in
SQLite — no table rebuild, which `coding-guide.md` reserves for a primary-key
change.
