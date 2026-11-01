# 0169 — Document Library prefill templates

Adds `doc_prefill_templates`: one row per named template, its field values held as
JSON, plus a NOCASE unique index on the name and an `updated_at` trigger.

This is the Journal's 0062 brought to the Document Library. Where the reasoning is
identical it is not re-argued here — the differences are what this log is for.

## Why

Documents of a kind repeat the same handful of values. Every utility bill is the
same category, the same tags, and a title that differs only by a month; every
insurance policy is filed the same way; every kid's school form carries the same
two tags. Only the attached file is genuinely new.

Today all of that is retyped for every document, which is both tedious and the
reason taxonomies drift — `Utilities` one month, `utilities` the next, and now the
Document Tree has two branches for one idea.

A prefill template stores those values once under a name. The New Document form
grows a picker; choosing a template fills the fields it names and leaves the rest
alone.

## Why the fields are JSON, not child rows

The same call 0062 made, for the same reason, and that log holds the full argument.
In short: a template is read and written **whole**, every time. There is no path
that reads one field of one template, or updates one field in place. A child table
would buy one query nothing asks for in exchange for a join on every read and a
delete-insert on every write.

The stored shape is an array of `{ field, mode, value }`. It is validated by
`saveDocumentPrefillTemplateSchema` on the way in, and read back through
`parseStoredDocumentPrefillFields`, which is **forgiving** in the way
`parseStoredPrefillFields` is: an unreadable row comes back as an empty field list,
and an unknown field key is dropped rather than throwing. A template whose JSON has
rotted should show up empty and be re-editable, not 500 the Prefill Templates
screen.

## Why `mode` is here when only one value is legal

`mode` currently accepts **`literal` only**. The schema rejects every other value,
on every field.

Journal's `mode` exists because an entry has a date, and a stored literal date would
pin every new entry to a fixed day in the past — so `date` and `time` carry a
`now` option resolved at apply-time. **A document has no date or time field.** Its
form is Title, Description, Categories, Tags, and there is no "current title".

The column is kept anyway, carrying one legal value, because:

- **The two modules' templates are the same object**, and a reader who has learned
  one should recognise the other. A `fields_json` that differed in shape between
  `jrn_` and `doc_` would be two formats to learn for no gain.
- **It is the cheap half of a decision that gets expensive later.** If the Document
  Library ever grows a filed-on or expires-on field — and a document library is
  exactly the sort of thing that does — the dynamic mode arrives as a schema change
  with no migration and no backfill. Adding `mode` to a populated JSON column later
  means rewriting every stored row.

What this costs today is one column that is always `'literal'`. That is honest to
record as slack, not as a feature.

## Why `is_enabled`, rather than only delete

A template for a filing season that has passed — last year's taxes, a closed
insurance claim, a house move that finished — should stop cluttering the New
Document picker without losing values that took time to assemble. Disabled
templates stay listed and editable on the Prefill Templates screen; only the editor
form filters on the flag. Same as 0062.

## Categories and tags are stored as text, not arrays

A document's categories and tags are `string[]` on `Document`, but a template
stores them as one comma-separated string per field.

This is deliberate and it is the one place the Document Library's template differs
from the shape of the thing it fills. The alternative — a nested array inside
`fields_json` — would make `value` two types depending on which `field` it sits
beside, which every reader and every parser then has to branch on. One string type
for every field keeps the JSON uniform, keeps the editor's value control uniform,
and puts the split in exactly one place: `splitPrefillList` in
`src/lib/documents/prefill.ts`, which the form and the CLI both go through.

## Fields are copied, not linked

Applying a template copies its values into the form. Nothing on `doc_documents`
points back at the template that seeded it — same as 0062, same reasons: a template
is a starting point rather than a classification, and no link means deletion is free
of cascades, orphans and "this template is used by 340 documents" dialogs.

The cost, recorded as 0062 recorded it: you cannot later ask "how many documents
came from the Utility Bill template", and answering it then means a new column and a
backfill that can only guess.

## Not user-scoped

No `user_id`, consistent with `doc_documents` itself — documents are **shared**,
everyone granted the module sees every one of them, and `created_by` is attribution
rather than a permission check. A template only one person could see would be the
odd one out in a module whose entire premise is a shared filing cabinet.

## Reversibility

`DROP TABLE doc_prefill_templates` — the index and trigger go with it. Nothing else
references the table, no other table gained a column, and no existing row was
modified, so backing this out costs nothing beyond the templates themselves.
