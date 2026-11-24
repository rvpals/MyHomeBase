# 0180 — Categories and tags for the Code Library

Adds `cod_categories`, `cod_tags`, `cod_snippet_categories` and `cod_snippet_tags`.
Same shape as the Clips taxonomy (`0155`) and the Journal's before it.

## Why a taxonomy when `language` already exists

Three different questions, and filing by one does not answer the others:

| Question | Answered by |
|---|---|
| What is it written **in**? | `cod_snippets.language` |
| What **kind** of thing is it? | a category — Query, Shell one-liner, Config |
| What is it **about**? | a tag — postgres, docker, this-project |

A single flat list would collapse all three and make "every Python snippet about
Docker" unaskable.

## Decisions

- **Its own `cod_` namespace, not shared with `clp_`.** A prefix is a module
  namespace, and the two vocabularies are genuinely separate: "Receipts" is a
  useful clip category and a meaningless snippet one. Sharing the tables would
  mean every chip list in either module offering the other's words.
- **Name as the primary key**, with `COLLATE NOCASE` on a unique *index* rather
  than on the column. The stored value keeps the writer's capitalisation while a
  near-duplicate is refused — "Shell" and "shell" are indistinguishable as chips.
- **No `icon_image` columns**, deliberately diverging from `clp_categories`.
  Carrying icon bytes on a taxonomy row forces every read to name its columns or
  drag every icon into memory; Clips needed `TAXONOMY_COLUMNS` in its repository
  purely to avoid that. Snippet chips are text. If they ever want artwork, that is
  a migration then, not two unused columns and a trap now.
- **AND semantics for filtering**, enforced in the repository with a
  `HAVING COUNT(DISTINCT …)` over the pairings, matching `listClips`. Picking two
  tags means snippets carrying **both** — an `IN` alone would quietly mean either.
- **No foreign keys**, per project convention. The repository clears a snippet's
  pairings in the same transaction as the snippet.

## What is not here

Pinning. It is a column on `cod_snippets` rather than a taxonomy table, so it gets
its own migration.
