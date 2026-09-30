# Lessons learned

A running log of mistakes worth not repeating — what broke, why it happened, and
the rule that would have prevented it.

This is deliberately **not** a changelog. A bug belongs here only when the *way*
it happened generalises: a habit to drop, a signal that was ignored, a trap the
codebase sets for the next person. Fixes that were simply wrong-and-then-right
go in `CHANGE_HISTORY.md`.

Newest first.

---

## 2026-09-29 — An editor wired to a list row

**Date:** 2026-09-29
**Module:** Household → Recipes
**Files:** `src/app/(protected)/modules/[slug]/household-recipes-view.tsx`,
`src/app/(protected)/modules/[slug]/household-actions.ts`
**Severity:** silent data loss on save (not merely a display fault)

**What broke.** Clicking **Edit** on a recipe showed blank Description,
Ingredients, Directions, Notes and Source URL — on recipes that demonstrably held
those values in `hsh_recipes` when read with the SQL Explorer. Both entry points
were affected: the row's own Edit button, and Edit inside the recipe viewer.

**Why it was worse than blank boxes.** `updateRecipe` replaces *every* column
(there is no partial-update path; the bulk editor is the only thing that writes
selectively). So pressing Save on that blank form would write `''` back over the
stored ingredients and directions. The display fault and the data-loss path were
the same bug.

### The logic

`listRecipes` deliberately projects the long text away. From
`src/lib/household/repository.ts`, the list's SELECT names its columns and
derives the picture flag rather than reading bytes:

```sql
r.id, r.name, r.description, r.made_count, r.rating, r.source_url,
r.picture IS NOT NULL AS has_picture,
(SELECT group_concat(t.tag_name, ',') ...) AS tags,
r.created_at, r.updated_at
--  no r.ingredients, no r.directions, no r.notes, no r.picture
```

That projection is the contract behind the two domain types in
`src/lib/household/types.ts`: `RecipeSummary` for a list row, `Recipe extends
RecipeSummary` adding `ingredients`, `directions`, `notes`. A 200-recipe list
must not pull 200 methods and 200 photographs into the payload.

**The broken wiring.** `toForm` had been typed to accept a list row anyway:

```ts
// BEFORE — compiles, and is always wrong for the three block fields
function toForm(
  recipe: RecipeSummary & Partial<{ ingredients: string; directions: string; notes: string }>,
): RecipeForm {
  return {
    ingredients: recipe.ingredients ?? "",   // a summary has no such key -> ""
    directions:  recipe.directions  ?? "",   // -> ""
    notes:       recipe.notes       ?? "",   // -> ""
    ...
  };
}

// and both call sites handed it a grid row:
onClick={() => setDialog({ kind: "edit", id: row.id, form: toForm(row) })}
onEdit={()  => setDialog({ kind: "edit", id: dialog.recipe.id, form: toForm(dialog.recipe) })}
```

`row` is a `RecipeSummary`. The intersection with `Partial<…>` made that
type-check; the `?? ""` turned three `undefined` reads into three empty strings.

**Evidence.** Run against a real in-memory SQLite built from migration 0118,
after importing the Memento CSV:

```
=== what the GRID row has (old editor path) ===
  ingredients: undefined
  directions : undefined
  notes      : undefined

=== what getRecipeById returns (new editor path) ===
  ingredients: "2 cup all purpose flour\n3 tsp baking powder\n6 tbsp…"
  directions : "Preheat oven to 375 F\nPrepare cup cake pan.\nSift o…"
  notes      : "makes about 11 Muffins"
```

### The fix

```ts
// AFTER — the full record only; passing a summary is now a compile error
function toForm(recipe: Recipe): RecipeForm {
  return {
    ingredients: recipe.ingredients,
    directions:  recipe.directions,
    notes:       recipe.notes,
    ...
  };
}

// one opener, used by BOTH Edit buttons, that fetches before opening
async function openEditor(id: number) {
  const result = await getRecipeAction(id);
  if (!result.ok || !result.recipe) { setError(result.error ?? "Could not load that recipe."); return; }
  setDialog({ kind: "edit", id, form: toForm(result.recipe) });
}
```

plus a new `getRecipeAction(id)` in `household-actions.ts`, authorising on its
first line like every other action. "Add recipe" still opens on `EMPTY_FORM` —
it has no record to fetch.

**Why it happened.** The compiler *would* have caught this: `RecipeSummary`
genuinely lacks those fields, and passing one should have been an error. The
`Partial<>` and the `?? ""` were written to make that error go away, turning a
caught mistake into a silent one. The summary/full split is documented in both
`types.ts` and migration 0118, and the wiring went straight past the distinction
those comments exist to enforce.

**The rules.**

1. **A type refusing your argument is usually the type being right.** Fix the
   call site, not the signature. Widen only when you can say why the looser
   contract is correct. Treat `Partial<>`, `?? ""`, `as`, and newly-optional
   fields as red flags when they appear in response to an error — each converts
   a compile-time failure into a runtime one.
2. **Never fill an editor or detail view from a list row.** Where a repository
   exposes a `…Summary` and a full record, that split is a performance guarantee
   enforced in the SELECT, not an accident. Fetch the record (`getRecipeAction`).
   Type the form-filling function to take the **full** record, so passing a
   summary cannot compile.
3. **If you're unsure whether to widen a type — ask.** Don't quietly take the
   permissive option. One line naming the call site and the two readings settles
   it in seconds.

**Testing note.** The hand-written fake in `household.test.ts` stores whole
`Recipe` objects, so every field is present on a list row there — the fake
**cannot** catch this class of bug. The regression test has to run against real
SQLite; see `src/lib/household/repository.test.ts`, which asserts that a summary
lacks the three fields and that an editor-style read-modify-write round-trips
without losing them. *When a fake and the real repository can disagree about
shape, test the shape against the real one.*

---

## 2026-09-29 — Debugging the layer that wasn't broken

**Date:** 2026-09-29 (same session as the entry above)
**Cost:** ~30 minutes, and the bug was in neither place I looked

**What happened.** The symptom was first reported as *"ingredients and directions
not imported at all"*, then restated precisely: *"they're showing blanks, but the
data was imported successfully and displays in the raw SQLite table."* That second
sentence isolates the read path — the writer is exonerated by the reporter's own
observation. Roughly thirty minutes went into re-testing the **import** anyway.

**The sequence, and what each pass actually proved:**

| # | Hypothesis tested | Result |
|---|---|---|
| 1 | `parseCsvRecords` mishandles multi-line quoted cells | clean — newlines preserved |
| 2 | `applyMapping` loses the delimiter | clean — `{"delimiter":"\\n"}` arrives intact |
| 3 | The saved mapping's `\n` is mangled by zod → JSON → parse | clean — round-trips as `[92, 110]` |
| 4 | CRLF line endings break the cell split | clean |
| 5 | A UTF-8 BOM shifts the header indices | clean |
| 6 | End-to-end against real SQLite | clean — **9 lines / 3 lines stored correctly** |

Six green runs. Pass 6 in particular wrote the data correctly to a real database
and read it back correctly, which is the exact thing the reporter had already
said was working. A fix was then drafted for an unrelated `toBlock` edge case
that could not have produced the reported symptom.

**Why it happened.** Each green result was read as *"haven't reproduced it yet"*
rather than *"you are testing the wrong layer."* That reading makes the next
identical run feel justified. The correct inference was available after pass 2.

**One genuine find, to be fair to the exercise:** pass 6's variations surfaced a
real defect — an **empty-string delimiter** makes `splitDelimited` split on
whitespace (`delimiter.trim() === "" ? trimmed.split(/\s+/)` in
`src/lib/csv-import/mapping.ts`), shredding an ingredients block into one word per
line. Real, worth fixing, and **not** the reported bug. Finding an unrelated
defect while looking in the wrong place is not vindication for looking there.

**The rules.**

1. **Take the reporter's boundary seriously.** "Correct in the database, wrong on
   screen" means *don't touch the writer.* When someone tells you which side of a
   boundary the bug is on, start there and only widen if that side comes back
   clean.
2. **A test that keeps passing is evidence about the test, not the bug.** If two
   attempts to reproduce succeed at reproducing nothing, the hypothesis is wrong.
   Change layers rather than changing inputs.
3. **Correct wiring is worth more than good debugging**, because correct wiring
   means the debugging never happens. Finding a bug eventually is not recovery —
   the hunt is the cost.

---

## Standing traps in this codebase

Short pointers to things that have already cost real time. Full detail in
`CLAUDE.md`.

- **A UI change that "isn't taking effect" is a stale `.next` cache** until proven
  otherwise. Clear it and hard-reload before hunting a bug.
- **Before restyling a component, prove where it renders.** A JSX call site is
  evidence; a mention in a doc, a comment or an import is not. `TreeNav` reads
  like the app's tree navigation and is rendered by nothing but Admin → SQL
  Explorer.
- **Uncommitted work in the tree is unverified work**, including your own from an
  earlier session. Documented ≠ finished ≠ wired up.
