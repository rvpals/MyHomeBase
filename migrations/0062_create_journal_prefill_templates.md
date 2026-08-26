# 0062 — Journal prefill templates

Adds `jrn_prefill_templates`: one row per named template, its field values held as
JSON, plus a NOCASE unique index on the name and an `updated_at` trigger.

## Why

Most journal entries of a kind repeat the same handful of values. A gym entry is
always the same categories, the same tags and the same place; a work-trip entry is
always the same category and a place that changes rarely. Only the content is
genuinely new each time. Today all of that is retyped for every entry, which is
both tedious and the reason categories drift — `FAMILY` one day, `Family` the next.

A prefill template stores those values once under a name. The New Entry form grows a
dropdown; picking a template fills the fields it names and leaves the rest alone.

## Why the fields are JSON, not child rows

A template is read and written **whole**, every time. The editor loads all of it to
populate the form, and a save rewrites all of it — there is no path that reads one
field of one template, or updates one field in place.

A `jrn_prefill_template_fields` child table would therefore buy exactly one query —
"which templates mention Title" — that nothing in the product asks, in exchange for a
join on every read and a delete-insert on every write. `mus_magic_list` (0057) made
this call for the same reason, and `jrn_saved_filters.filter_json` (0043) already made
it inside this very module, which is the closer precedent: a saved filter is the same
shape of thing — a small structured document, edited as a unit, belonging to one row.

The stored shape is an array of `{ field, mode, value }`. It is validated by
`savePrefillTemplateSchema` on the way in, and read back through
`parseStoredPrefillFields`, which is **forgiving** in the way
`parseStoredJournalFilter` is: an unreadable row comes back as an empty field list and
an unknown field key is dropped, rather than throwing. A template whose JSON has rotted
should show up empty and be re-editable, not 500 the Templates screen.

## Why `mode` exists, rather than storing only a string

This is the one non-obvious column, and it comes directly from the date field.

A stored *literal* date would pin every new entry to a fixed day in the past. A
template saved on 2026-08-22 with `date = "2026-08-22"` is wrong on 2026-08-23 and
every day after, so it would need re-editing daily to stay useful — the exact opposite
of what a template is for. But a date prefill is still wanted, because "an entry for
today" is what almost every use of the feature means.

So date and time carry a choice: a literal value, or **current date** / **current
time**, resolved at apply-time. `mode` records which.

Stored as its own field rather than inferred from a sentinel string like `@now`,
because a sentinel is indistinguishable from someone legitimately typing that text —
`@now` in a *title* is a perfectly reasonable thing to want, and a sentinel scheme
either corrupts it or needs an escaping rule nobody will remember.

`'now'` is only legal on `date` and `time`; the schema rejects it on the text fields.
There is deliberately no "current place" or "current weather" mode: both already have
GPS-backed buttons on the entry form that resolve them live, and better than a stored
template could.

Resolution happens in the **browser**, not on the server. An entry's date is the
calendar day the writer is living in, not an instant — the same reasoning
`0044`/the calendar work applied to `todayIsoLocal()`. Resolving `now` on the server
would file a late-evening entry under tomorrow for anyone east of the server, or
yesterday for anyone west of it.

## Why `is_enabled`, rather than only delete

A template that is out of season — a holiday one, a project that paused — should stop
cluttering the New Entry dropdown without losing values that took time to assemble.
Disabled templates stay listed and editable on the Templates screen; only the entry
form filters on the flag.

## Fields are copied, not linked

Applying a template copies its values into the form. Nothing on `jrn_entries` points
back at the template that seeded it, and that is on purpose:

- **A template is a starting point, not a classification.** The writer edits the
  entry after applying, so a stored link would claim a relationship the content may no
  longer bear out.
- **It makes deletion free.** No cascade, no orphan handling, no "this template is
  used by 340 entries" dialog. Deleting a template affects exactly one row.

The cost is that you cannot later ask "how many entries came from the Gym template".
Recorded here because it is the kind of question that gets asked eventually — and
answering it then means a new column and a backfill that can only guess, not a
schema this migration should have paid for up front.

## Not user-scoped

No `user_id`, consistent with every other `jrn_` table and with `stk_ticker_favorites`
(0058), `mus_playlists` (0056) and the rest. This is a household app and the journal
itself is not partitioned by user, so a template that only one person could see would
be the odd one out.

## Reversibility

`DROP TABLE jrn_prefill_templates` — the index and trigger go with it. Nothing else
references the table, no other table gained a column, and no existing row was
modified, so backing this out costs nothing beyond the templates themselves.
