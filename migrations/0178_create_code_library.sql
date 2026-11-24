-- Code Library: reusable code snippets, filed and searchable.
--
-- WHY THIS IS NOT A CLIPS FEATURE. Clips already carries categories, tags, a bin
-- and encryption, and the obvious move was to keep snippets there. It was evaluated
-- and rejected for one reason: `clp_clips.content_html` stores **sanitized HTML**,
-- because a clip is pasted email and that is a hostile-input boundary. Code wants
-- the opposite. Four separate problems all fall out of that single mismatch --
-- a pasted snippet loses its indentation (HTML collapses whitespace runs), there is
-- no way to mark a code block in the clip editor, syntax highlighting is impossible
-- because `sanitizeClipHtml` drops every `class` attribute by design, and a LIKE
-- search over entity-escaped HTML can never match `List<string>` or `a && b`.
--
-- Storing the body as plain TEXT, as below, removes all four at once and keeps the
-- clip sanitizer's fail-closed posture untouched. Nothing here is escaped on the way
-- in; the presentation layer escapes on the way out, which is the normal direction.
--
-- WHY `cod_`. A prefix is a module namespace, per `coding-guide.md`. Code Library is
-- reachable, searchable and filterable on its own and references nothing in Clips,
-- so it takes its own namespace rather than borrowing `clp_`.
--
-- No DB-level foreign keys, per project convention.

-- One snippet. Shared: every reader granted the module sees every snippet, exactly
-- as Clips is shared. There is no per-user snippet.
CREATE TABLE cod_snippets (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Optional, and blank rather than NULL so no reader handles two kinds of nothing
  -- -- the mapping `clp_clips.title` and `tol_todo_items.notes` both use. An
  -- untitled snippet is a normal thing to paste in a hurry.
  title           TEXT    NOT NULL DEFAULT '',

  -- The snippet itself, **verbatim plain text**. Not HTML, not Markdown, not
  -- escaped: exactly the bytes the reader pasted, so that copying it back out
  -- returns exactly what they put in. That round-trip is the module's whole point
  -- and the reason this column is TEXT and not the `content_html` Clips uses.
  --
  -- Nothing sanitises this on the way in and nothing may render it with
  -- `dangerouslySetInnerHTML`. React escapes it on output, which is where escaping
  -- belongs for text that has to survive unchanged in storage.
  code            TEXT    NOT NULL DEFAULT '',

  -- Which language, from the closed list in `src/lib/code-library/schema.ts`.
  -- A column and not a tag: the highlighter needs it, "copy as a .py file" would
  -- need it, and a tag is free text that nothing can rely on. Defaults to 'text',
  -- which is also what an unrecognised stored value degrades to on read -- a
  -- language dropped from the list later must not make its snippets unreadable.
  language        TEXT    NOT NULL DEFAULT 'text',

  -- Attribution only, never a permission check -- the same rule
  -- `clp_clips.created_by` records. Every reader granted the module may edit every
  -- snippet. Nullable because a snippet written by the CLI has no session behind it.
  created_by      INTEGER,                          -- -> sys_users.id

  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- The list's default order: most recently touched first, id breaking the tie so a
-- page of snippets saved in the same second is still deterministic.
CREATE INDEX idx_cod_snippets_updated ON cod_snippets (updated_at DESC, id DESC);

-- Filtering the list by language, which is the one filter that exists before
-- categories and tags arrive.
CREATE INDEX idx_cod_snippets_language ON cod_snippets (language);

CREATE TRIGGER cod_snippets_set_updated_at
AFTER UPDATE ON cod_snippets
FOR EACH ROW
BEGIN
  UPDATE cod_snippets SET updated_at = datetime('now') WHERE id = old.id;
END;
