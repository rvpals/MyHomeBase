# 0178 — Create the Code Library tables

Adds `cod_snippets`, the first table of the Code Library module. The module is
registered separately, in `0179_seed_code_library_module.sql`.

## Why a new module and not a Clips feature

Clips already has categories, tags, a recycle bin and encryption, and reusing it
was the first thing considered. It was rejected on the storage format, not on
taste.

`clp_clips.content_html` holds **sanitized HTML**, because a clip is pasted email
and `src/lib/clips/sanitize-html.ts` is a real hostile-input boundary. Code wants
verbatim text. Four problems all follow from that one mismatch:

| Symptom in Clips | Actual cause |
|---|---|
| Pasted code loses its indentation | HTML collapses runs of whitespace |
| No way to mark a block as code | the body is rich text, and the editor's toolbar has no `pre` action |
| Syntax highlighting impossible | `sanitizeClipHtml` drops every `class` attribute, deliberately |
| Search misses `List<string>`, `a && b` | the body is stored entity-escaped |

Storing the body as plain `TEXT` removes all four at once, and leaves the clip
sanitizer's allowlist untouched — the alternative was widening a security boundary
to let a `pre` carry `class="language-py"`, which is exactly the kind of change
that file argues against.

## Decisions recorded in the schema

- **`code` is verbatim.** Nothing escapes it on the way in. The presentation layer
  escapes on output, and nothing may render it with `dangerouslySetInnerHTML`.
  A reader must get back exactly the bytes they pasted; that round-trip is the
  module's purpose.
- **`language` is a column, not a tag.** The highlighter needs it, and a tag is
  free text nothing can rely on. The closed list lives in
  `src/lib/code-library/schema.ts`. An unrecognised stored value reads back as
  `text` rather than throwing, so dropping a language from the list later degrades
  its snippets instead of breaking them.
- **`created_by` is attribution, never access.** The same rule `clp_clips`
  records: a snippet is shared with everyone granted the module. Nullable, because
  a snippet written from the CLI has no session behind it.
- **No `deleted_at` flag.** The recycle bin, when it arrives, will be mirror
  tables in a later migration, following `clp_recycled_clips` (0161) and
  `jrn_recycled_entries` (0079). A flag would mean every existing read had to
  learn to exclude binned rows, and one missed `WHERE` silently serves a deleted
  snippet.

## Prefix

`cod_`, a new namespace. Checked against the table in `coding-guide.md` — it was
unused. Code Library references nothing in Clips and is filterable and searchable
on its own, so it takes its own prefix rather than extending `clp_`.
