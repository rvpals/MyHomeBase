# Lessons learned

A running log of mistakes worth not repeating — what broke, why it happened, and
the rule that would have prevented it.

This is deliberately **not** a changelog. A bug belongs here only when the *way*
it happened generalises: a habit to drop, a signal that was ignored, a trap the
codebase sets for the next person. Fixes that were simply wrong-and-then-right
go in `CHANGE_HISTORY.md`.

Newest first.

---

## 2026-11-28 — OCR worked on the dev box and hung on the NAS: the server loaded a different copy of tesseract.js

**Date:** 2026-11-27 to 2026-11-28
**Module:** Documents (OCR), Admin → Code Tester → Dependency test
**Files:** `src/lib/documents/text-engines.ts`, `src/lib/documents/ocr-worker-files.ts`,
`scripts/publish-nas.mjs`, `src/lib/code-test/dependency-probes.ts`
**Severity:** feature dead on the NAS only; first the whole server process died with it

**What broke.** On the NAS, OCR never started. The browser said only "An unexpected
response was received from the server". On the dev box everything passed, every time.
It took four rounds to find, and each round fixed something real that was hiding the
next problem:

1. **`gzip: false` was missing.** With `MYHOMEBASE_TESSDATA` set, tesseract.js looked for
   `eng.traineddata.gz`, but the folder holds the uncompressed file.
2. **A worker start failure killed the server.** tesseract.js 7 swallows a failure
   while loading the model inside `createWorker`. With no `errorHandler`, the worker
   rethrows it uncaught and the process dies. With one, the promise never settles.
3. **The worker's own files never shipped.** The worker is started with
   `new Worker(path)`, which Next's file tracing can't follow. The standalone build
   held 21 of tesseract.js's 42 files, and none of `wasm-feature-detect` or `bmp-js`.
4. **The server loaded a half copy anyway.** With `node_modules/tesseract.js` now
   complete, the start still hung. The server doesn't `require("tesseract.js")`. It
   requires Turbopack's hashed alias, `.next/node_modules/tesseract.js-<hash>`, which
   is a symlink in the build. The publish's "Materialising symlinks" step turned it into
   a real copy of the traced half package, and that step runs *before* the step that
   completes `node_modules/tesseract.js`. tesseract.js derives its worker path from its
   own `__dirname`, so it started the worker from the half copy.

**Why it happened.** Two things the dev box can't show you:

- **The NAS runs the published package, not `node_modules`.** On the dev box every
  require resolves against a complete install, so "it passes here" said nothing about
  the package. The final check proved this: run directly from
  `node_modules/tesseract.js`, the worker answered in 385 ms on the NAS, while the real
  start, one second later, got nothing in 120 s.
- **A worker thread's failures are invisible by default.** tesseract.js attaches only a
  `'message'` listener to its Worker. A thread that throws, exits or stalls produces no
  error anywhere. So a crash, a hang and a missing file all looked identical from outside.

**The fix.** `startOcrWorker()` passes tesseract.js an **explicit `workerPath`**, which
is the script `checkOcrWorkerFiles()` has just verified, so the worker never comes from
whichever copy the server happened to load. It also checks the worker's whole require
graph before spawning, rejects on the first worker error or after 120 s, and always sets
`errorHandler`. `publish-nas.mjs` copies tesseract.js and its dependency closure, then
overwrites every `.next/node_modules/tesseract.js-*` alias with the full package and
checks it.

### The rules

1. **On the NAS, a package can exist twice: `node_modules/<pkg>` and
   `.next/node_modules/<pkg>-<hash>`.** The server loads the second one. Anything the
   publish adds or patches in a package has to land in **both** places. Fixing only
   `node_modules/` looks finished and changes nothing the server runs.
2. **Mind the publish order.** "Materialising symlinks" snapshots whatever the alias
   points at *when it runs*. A step that completes a package after it doesn't reach
   the copy.
3. **A dependency that starts a worker thread is untraceable.** Next's file tracing
   follows `import`/`require`, not `new Worker(path)`. Ship the package by hand, and
   pass the worker path explicitly rather than trusting `__dirname`.
4. **Wrap a worker you don't control with every listener.** For each of `online`,
   `error`, `exit` and `messageerror`, log the event *as it happens*, not at the end.
   If the process dies, the lines before it survive. The Dependency test's "Worker
   thread smoke test" step does this.
5. **Diagnose on the box that fails.** Make the failing environment report on itself
   (the System Log with DEBUG, a "starting" line before every step, memory on each
   line). Four rounds of laptop passes proved nothing. One NAS log with a step that ran
   the worker directly ended it.

---

## 2026-11-27 — A drag out of a text box closed the dialog

**Date:** 2026-11-27
**Module:** every module (shared `Modal`)
**Files:** `src/components/modal.tsx`
**Severity:** lost work (a half-filled form vanishes with no warning)

**What broke.** In any form dialog, drag-selecting text in a field and letting go
past the panel's edge, over the dark backdrop, closed the whole dialog. Nothing
was saved and nothing warned.

**Why it happened.** The backdrop's `onClick` closed the dialog when
`event.target === event.currentTarget`, and a comment claimed that check stopped
a drag off a text selection from closing it. It doesn't. The browser fires
`click` on the **nearest common ancestor** of where the press started and where
it ended. Press in an input and release on the backdrop, and the common ancestor
*is* the backdrop, so `target === currentTarget` is true and the dialog closes.
The check only rules out clicks that start *and* end inside the panel.

**The fix.** The backdrop records on `pointerdown` whether the press began on the
backdrop itself, and `onClick` closes only when both ends were on the backdrop.
Escape and a real backdrop click still close.

### The rules

1. **"Click outside to close" must check where the press started, not only where
   the click landed.** `target === currentTarget` on `click` alone is the classic
   broken version. Record the target on `pointerdown` (or `mousedown`) and
   require it too.
2. **A comment describing a guard is not proof that the guard works.** This one
   stated the exact case it failed. Test the edge case the comment names.
3. **Fix it in the shared component.** Every form dialog had the bug because
   they all use `Modal`; one fix covers them. A hand-rolled overlay that skips
   `Modal` has to repeat the press-start check itself, which is one more reason
   not to hand-roll one.

---

## 2026-11-26 — A dropdown's z-index can't leave its card

**Date:** 2026-11-26
**Module:** Journal → New entry
**Files:** `src/app/(protected)/modules/[slug]/journal-entry-editor.tsx`,
`src/components/icon-select.tsx`, `src/components/collapsible-card.tsx`
**Severity:** a control you can't use (the picker opens, but you can't see or click its items)

**What broke.** On the New Journal entry screen, clicking the **Prefill Template**
picker opened its list *behind* the Date/Time card underneath, so you couldn't
see or click any template.

**Why it happened.** `IconSelect` draws its list as `absolute z-30`, and that
number looks like it should win. But a z-index only counts within the
element's nearest **stacking context**. Each form section is a separate
`CollapsibleCard`, and the cards are siblings. When a card becomes a stacking
context, its children's z-index stays inside it, and the card as a whole is
layered against its siblings in DOM order. Date/Time comes after Prefill
Template, so it painted over the whole Prefill card, list included.

What made the cards stacking contexts: the Glass theme puts
`backdrop-filter` on `.card-raised` (`globals.css`, the
`[data-color-theme="glass"]` block). `filter`, `transform`, `opacity < 1`,
`isolation`, `will-change` and a positioned element with a z-index all have
the same effect. So the bug **depends on the theme**: a dropdown that looks fine
in one theme can sink in another.

### The fix

Lift the card, not the list. `CollapsibleCard`'s outer `div` now carries:

```tsx
has-[[role=combobox][aria-expanded=true]]:relative
has-[[role=combobox][aria-expanded=true]]:z-10
```

While a picker inside it is open, the card becomes a positioned `z-10` and
paints above its non-positioned siblings, and the list's `z-30` comes along
with it. Raising the list's own z-index to `z-50` or
`z-[9999]` would do **nothing**, because the ceiling is the card.

### The rules

1. **When an overlay hides behind a sibling, look at the ancestors, not at
   the overlay's z-index.** Walk up from the popup and find the first ancestor
   that forms a stacking context. That ancestor's z-index is the one that
   matters. Raising the popup's number is the guess that never works.
2. **Check every theme before calling a layering bug fixed.** Stacking
   contexts here come from theme CSS (`backdrop-filter` on Glass), so one
   theme proves nothing.
3. **Fix it once in the shared component, not card by card.** The first fix
   added `relative z-10` to the Prefill card alone, and the Category and Tag
   pickers in the cards below had the same bug straight away, as did
   Calendar import and Taxonomy Combos. The fix that lasted is in
   `CollapsibleCard`: while a `[role=combobox][aria-expanded=true]` inside
   it is open, the card lifts itself to `relative z-10`. That covers every
   `TokenPicker` and `IconSelect` in a card, in every module.
4. **A dropdown inside a `Modal` is a different problem.** The dialog body is
   `overflow-auto`, so the list gets clipped by the dialog's scroll area
   instead of being covered by a sibling. Lifting a card can't fix that. If
   it needs fixing, render the list in a portal.

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
- **A popup hidden behind the next card is a stacking-context problem, not a
  z-index one.** Lift the card that holds the popup. The Glass theme's
  `backdrop-filter` turns every `.card-raised` into a stacking context.
- **Uncommitted work in the tree is unverified work**, including your own from an
  earlier session. Documented ≠ finished ≠ wired up.
- **A backdrop click must check where the press started.** A drag from inside a
  dialog that's released on the backdrop sends `click` to the backdrop.
  `Modal` handles this now; a hand-rolled overlay doesn't get that for free.
- **On the NAS the server loads `.next/node_modules/<pkg>-<hash>`, not
  `node_modules/<pkg>`.** The publish materialises that alias early, so a package the
  publish patches later must be refreshed there too. A dependency that starts a
  `new Worker(path)` is invisible to file tracing. Check it with Admin → Code Tester →
  Dependency test on the NAS, not on the dev box.
