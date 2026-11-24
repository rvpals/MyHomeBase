# 0183 — The Code Library's recycle bin

Adds `cod_recycled_snippets` and mirrors of its two pairing tables.

Until this migration the module had **no delete at all**, deliberately: a delete
built before the bin would have been permanent, and the module had no undo of any
kind. Delete arrives here, and it has only ever meant "move to the bin".

## Mirror tables, not a flag

The same decision `0161` made for Clips and `0079` for the Journal. A
`deleted_at` flag on `cod_snippets` would mean every existing read — the list,
the board, the filter chips, the taxonomy usage counts, the CLI — had to learn to
exclude binned rows, and one missed `WHERE` silently serves a deleted snippet. A
separate table cannot be read by accident.

## Decisions

- **All three tables are mirrored.** A restored snippet comes back with its
  categories and tags, not as a bare body. Its labels are part of what makes it
  findable; restoring without them restores something less than what was deleted.
- **The pairing mirrors key on the *bin row's* id**, not the original snippet's.
  The same snippet can be binned, restored and binned again, and keying on the
  snippet id would merge two separate deletions' labels into one.
- **The original timestamps are carried, not regenerated.** A restored snippet
  keeps the dates it had. Regenerating them would make an old snippet look new
  and silently reorder the whole list on restore.
- **Restore aims at the original id.** Nothing references a snippet today, so
  nothing breaks if the id changes — but `restoreRecycledEntries` set this
  precedent for a reason, and a later feature that does reference one would
  otherwise find a dangling id after any delete-and-restore. Falls back to a
  fresh id only when the original has been taken.
- **`is_pinned` and `card_color` ride along.** A snippet restored without its pin
  or its colour has quietly lost something the reader chose.

## Not mirrored

There is nothing like `clp_clip_images` here — a snippet has no blobs, so the
whole "orphaned rows would leave a deleted clip's screenshots live at a serving
route" problem does not arise.
