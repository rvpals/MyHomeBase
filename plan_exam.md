# Exam — implementation plan

A Scantron-style test builder and grader: generate a blank answer sheet, hold the
answer key, photograph the students' completed sheets, read the marks, and score them.

**Status: partly built.** The library module, migration 0145, the Exam Home screen,
the Exam Maker and a CLI command exist. Print Sheets, Scan & Grade and Results do
not — and neither do the two tables grading needs. See *Build order* for what is
done and what is left.

One decision is still open, and it only bites at Scan & Grade: see *Decisions still
needed*.

This is a plan file, not a spec of shipped behaviour. When Exam is built, the
durable parts of it belong in `modules.md` (the module registry) and the migration
logs; this file can then be deleted.

---

## Where this sits

Exam is the second **section group** inside the **Classroom** module
(`/modules/classroom`), alongside Attendance. Migration 0143 created that shape; the
group and one placeholder section (`exam`) are already wired:

- `CLASSROOM_SECTIONS` already contains `"exam"`.
- `CLASSROOM_EXAM_SECTIONS` already exists as a one-entry list.
- `CLASSROOM_GROUPS.exam` is the group heading (`clipboard` glyph).
- `classroom-section.tsx` has a `case "exam"` returning a "not built yet" paragraph.
- Icon slots `classroom_section_exam` and `classroom_section_exam_group` are registered.

So adding real Exam screens is **strings in `CLASSROOM_EXAM_SECTIONS` plus route
branches** — there is no navigation work left. That was the point of stubbing it.

### Why Exam lives inside Classroom and not in its own module

Because grading needs the roster. An exam is scored against the same students and
classes attendance is taken for, so it reads `cls_students`, `cls_classes` and
`cls_class_enrollments`. As a sibling module, Exam would have to reach across a
module boundary for its most basic input — legal through `lib/attendance`'s
`index.ts`, but exactly the coupling `ARCHITECTURE.md` → *Modules* warns about, and
awkward once Exam also owns grading data of its own. Inside Classroom, those tables
are simply the module's own.

The nav tree has no level between a module and a section (`TreeSection.group` is a
flat string that `NavTree` *renders* as a nested box), so "submodule" here means
"section group". 0143's log records the whole reasoning.

---

## Feasibility: the honest version

The three parts are not equally hard.

| Part | Difficulty | Why |
|---|---|---|
| Generate a blank sheet | Easy | Deterministic layout + the existing `print-sheet` CSS. |
| Hold the key, compute scores | Easy | CRUD and arithmetic, pure functions. |
| **Read marks off a photo** | **The whole risk** | Perspective, lighting, paper distortion. |

**No new dependency, nothing paid.** `sharp` is already in `package.json` and already
used inside `src/lib/` for pixel work — `src/lib/icons/image-processor.ts` decodes to
a raw RGBA buffer behind a port, with every *decision* split into
`normalize-image.ts` so it is unit-tested against hand-built pixel arrays rather than
real images. OMR is the same shape. Deliberately **not** adding OpenCV or tesseract:
the detection maths is a few hundred lines of pure TypeScript, and keeping it in
`lib/` is what makes it testable.

### What this is not

This is "read my own printed sheet from a flat scan or a decent phone photo", **not**
a Scantron machine. Real OMR hardware uses calibrated drum scanners and printed
timing tracks. A phone photo brings perspective skew, shadow gradients and a
crumpled page. A flat, evenly-lit capture will work well; a creased sheet shot at 30°
in dim light will not, and no amount of effort inside this module changes that.

Two design choices buy most of the accuracy:

1. **Four solid corner registration squares plus a printed sheet id.** The grader
   anchors the bubble grid on the corners rather than trusting page position, which
   is what makes a slightly rotated or cropped photo still readable.
2. **An always-shown review screen.** Every detected mark is drawn over the uploaded
   image for confirmation before a score is saved. This is non-negotiable: a grader
   that silently guesses a test score is worse than no grader. If unattended batch
   grading is ever wanted, the right shape is a confidence threshold that
   *quarantines* ambiguous sheets, never one that guesses them.

---

## Decisions still needed

### Settled

- **Choices per question are configurable per exam** — a named choice set (`ABCD`,
  `ABCDE`) chosen in the New Exam card, not a free integer, so the printed sheet and
  the key cannot disagree.
- **The answer key is entered in Exam Maker**, in the New Answer card beneath the
  exam's own fields, rather than on a section of its own. The key belongs with the
  exam it attaches to.
- **Exam ID is the teacher's own**, held alongside the surrogate primary key.

- **Shaded bubbles, not brackets.** The sheet prints `○` per choice with "fill
  completely". A filled region has unambiguous mean darkness, where a circled
  bracket leaves most of its area white and the ink crosses the glyph rather than
  filling it. This is the single biggest factor in whether grading works, and it
  replaces the `[ A ]` layout of the original mockup.
- **One points value for the whole exam, no penalty.** `points_per_question` on
  `cls_exams`; score is `correct_count × points`. Wrong, blank and double-mark all
  score **0**, with a double-mark additionally *flagged* on the review screen so the
  operator sees it rather than silently accepting a zero. Per-question points can be
  added later as a nullable column on `cls_exam_questions` that falls back to the
  exam's value — no rewrite of existing rows.

### Still open

Not schema-affecting; decide at Scan & Grade time.

1. **Batch or one sheet at a time?** This decides the upload UI. `FileDropzone` is
   registered and already used by CSV Analysis and Journal import, but its `onFile`
   hands over **only the first file** — a 30-student batch means extending a shared
   component (with other callers to consider) or a different input.

---

## Files

### Library — `src/lib/exam/` (all logic lives here)

A new library module, not an addition to `src/lib/attendance/`. Exam is its own
domain concept; it *reads* the roster through `lib/attendance`'s front door.

| File | Holds |
|---|---|
| `types.ts` | `Exam`, `ExamQuestion`, `AnswerKey`, `ExamSubmission`, `GradedResult`, `DetectedMark`, `BubbleGrid`, `RawBitmap` (or reuse icons') |
| `schema.ts` | zod schemas for every boundary input, plus inferred types |
| `ports.ts` | `ExamRepository`, `SheetImageProcessor` |
| `repository.ts` | `SqliteExamRepository` — the only file that knows SQL |
| `sheet-layout.ts` | **Pure.** Question count + choices + columns → bubble centres in sheet coordinates. **One source of truth for both the printed sheet and the grader**, so the two cannot drift. |
| `sheet-image-processor.ts` | The only `sharp` file. Lazy import, decode-only, mirroring `icons/image-processor.ts` including its error message and the comment on *why* the import is deferred. |
| `detect-marks.ts` | **Pure.** Corner detection, perspective correction, per-bubble darkness sampling, confidence scoring. The interesting logic. |
| `grading.ts` | **Pure.** Marks + key + points → score. |
| `exam.ts` | The use-cases, each taking a repo port. |
| `*.test.ts` | Colocated Vitest, success **and** failure paths, fake repository, synthetic pixel arrays. |
| `index.ts` | The front door. |

Why `sheet-layout.ts` is called out: if the printer and the grader compute bubble
positions separately, they will disagree the first time either changes, and the
failure looks like bad detection rather than a layout bug.

### Migration

Next free number at implementation time. **0143 and 0144 are taken** (0144 was
untracked at the time of writing — check before claiming a number).

Tables under Classroom's existing **`cls_`** prefix — Exam claims no new prefix, the
rule that keeps `hsh_hsa_expenses` under Household:

| Table | Holds |
|---|---|
| `cls_exams` | One exam: `exam_identifier` (the teacher's own ID), name, description, `class_id`, question count, choice set, points rule, created/updated |
| `cls_exam_questions` | One row per question: `exam_id`, question number, correct choice, (maybe) points. The answer key. |
| `cls_exam_submissions` | One student's sheet: exam, student, score, image, graded-at |
| `cls_exam_submission_answers` | One row per question per submission: detected choice, confidence, whether corrected by hand |

`cls_exam_questions` is the answer key — there is no separate key table, since a key
is exactly one correct choice per question. A question with no correct choice yet is a
**partial key**, which is a legitimate saved state (see Exam Maker, point 3), so the
column is nullable or blank rather than required.

No DB-level foreign keys, matching the `jrn_`/`cls_` convention already in this
schema (`household/repository.ts` notes the same). Deleting an exam must therefore
clear its questions and submissions explicitly in the repository.

Plus the `.md` log — what changed and **why**, including anything unobvious.
`coding-guide.md` traps to re-read first: never put a date column in a unique index;
a primary-key change means a full rebuild; a settings value is blank, never `NULL`.

No new module registration and **no `DEFAULT_MODULES` change** — Classroom is already
registered. This is the payoff of the 0143 restructure.

### Presentation

| Path | Change |
|---|---|
| `classroom-sections.ts` | Add `exam-maker`, `exam-print`, `exam-scan`, `exam-results` to `CLASSROOM_SECTIONS` and `CLASSROOM_EXAM_SECTIONS` (keeping `exam` as the Home screen), with INFO + ICONS entries |
| `classroom-section.tsx` | Replace `case "exam"` with real branches; load only what each section needs. Exam Maker resolves `?edit=new` / `?edit=<id>` as Journal Reports does. |
| `[section]/page.tsx` | Pass the existing `?edit=` param through to `ClassroomSection`. It is **already** declared, destructured and parsed as `requestedReportEdit` (for Journal Reports) and is in scope in the Classroom branch — it simply isn't forwarded yet. Reuse it rather than adding a second param meaning the same thing; consider renaming it to something module-neutral if that reads oddly. |
| `exam-*-view.tsx` | One view per section. Plain data in, no `deps`. |
| `exam-actions.ts` | Server actions. **`requireModuleAccess("classroom")` on the first line of every export** — Classroom's full slug, not `"exam"`, not a route path |
| `src/lib/wiring.ts` | One line: `examRepo: new SqliteExamRepository(db)` |
| `src/lib/icons/slots.ts` + `slots.test.ts` | One slot per new section (`classroom_section_exam_maker`, `_exam_print`, `_exam_scan`, `_exam_results` — hyphens become underscores via `sectionSlotId`); extend the `classroom` list in the test so a later rename can't silently orphan an override. `classroom_section_exam` already exists. **Propose the ids and labels and wait for confirmation** — permanent once uploads exist. |
| `src/cli/` | One command, so grading is drivable from a terminal |
| `modules.md` | Update the Classroom entry; the registry is the durable home for this |

Sections (replacing the single `exam` placeholder):

| Slug | Label | Does |
|---|---|---|
| `exam` | Exam Home screen | Lists existing exams with edit / delete; "Create a new exam" links into Exam Maker |
| `exam-maker` | Exam Maker | Creates or edits one exam: the New Exam card, then the New Answer card |
| `exam-print` | Print Sheets | Render blank sheets; `print-sheet` class |
| `exam-scan` | Scan & Grade | Upload, review detected marks, commit the score |
| `exam-results` | Results | Per-student scores, per-question breakdown |

**`exam` is kept as the Home screen slug deliberately.** It is already registered as
icon slot `classroom_section_exam`, and slot ids are permanent once an upload exists
against them — renaming it to `exams` would orphan any override. The stub's slug
becomes the real list section rather than being replaced.

---

## The two screens, in detail

### Exam Home screen (`exam`)

A list of the exams that exist, each row offering **edit** and **delete**, plus a
**Create a new exam** action that links into Exam Maker. No creation happens here —
this screen is the index.

- The list is a `DataGrid` (registered, and the module's other screens already use
  it). Delete goes through `BulkConfirm` if multi-select is wanted, or `Modal`
  confirmation for a single row — both registered; check `components.md` before
  building either.
- **Edit and Create both link to Exam Maker rather than opening an inline editor**,
  following the Journal Reports precedent: `?edit=new` for a fresh one and
  `?edit=<id>` for an existing one, resolved in the section component. That pattern
  deliberately **falls back to the list on an id that no longer resolves** rather than
  404ing, so a stale link or a deleted exam lands somewhere sensible
  (`journal-section.tsx` is the worked example).
- Rows should show enough to tell two exams apart without opening them: name, class,
  question count, and whether a key is complete.

### Exam Maker (`exam-maker`)

Creates or edits one exam. Two `CollapsibleCard`s in sequence — that component is the
registered standard wrapper for a form block, and an uncontrolled one remembers
whether the reader left it open, per route.

**Card 1 — New Exam.** The exam's identity and shape:

| Field | Notes |
|---|---|
| Class | Picked from `listClasses(deps.attendanceRepo)` — Classroom's own classes. This is the whole reason Exam lives in this module. |
| Exam ID | **Human-facing, user-supplied**, not the surrogate primary key — the same split `cls_students` already makes with `studentIdentifier` ("School-assigned ID"). See *Two ids, deliberately* below. |
| Name | Required. |
| Description | Optional; empty string, never `NULL` (`coding-guide.md`). |
| Question count | Drives the sheet layout and how many answer rows Card 2 renders. |
| Choice set | `ABCD`, `ABCDE`, … — decides the bubbles per question. Settles the open "how many choices" question: **configurable per exam**, as a named set rather than a free integer, so the sheet and the key cannot disagree. |

**Card 2 — New Answer.** The answer key for this exam, one row per question,
**linked to that exam's id**. Each row takes the correct choice, selectable *or*
typeable — a picker for pointing, typing for entering twenty answers quickly without
leaving the keyboard.

Four things the implementation has to get right here:

1. **Card 2 depends on Card 1.** The number of answer rows and the choices each
   offers come from the question count and choice set above. Changing either after
   answers exist must be handled explicitly: reducing the count **discards** answers
   beyond it, and narrowing the choice set (`ABCDE` → `ABCD`) **invalidates** any
   answer of `E`. Decide whether that warns, blocks, or silently truncates — silently
   is the wrong answer. This is the main reason both cards live on one screen rather
   than on two sections: the dependency is visible.
2. **A `<select>` whose value matches no `<option>` displays the first option**, so
   render and state silently disagree. Every answer row's default must be *written to
   state*, not merely rendered — a known trap in this codebase.
3. **A partial key is a legitimate saved state.** A teacher will build a 40-question
   exam over more than one sitting, so the schema must not require a complete key,
   and the Home screen should show key completeness per the table above. Printing
   should be allowed with an incomplete key (the blank sheet doesn't depend on it);
   *grading* should not.
4. **Both cards are one save or two?** Two (create the exam, then edit its key) is
   simpler and matches "that would link to this particular exam ID" — the key needs
   an exam id to attach to, which implies the exam is saved first. Recommended: save
   Card 1 to get an id, then Card 2 writes against it, with the maker reached at
   `?edit=<id>` from then on.

### Two ids, deliberately

`cls_exams` carries both:

- `id` — the surrogate integer primary key. What `cls_exam_questions` and
  `cls_exam_submissions` reference, and what the `?edit=` URL carries. Never shown.
- `exam_identifier` — the **teacher's own** exam ID, free text, shown on screen and
  **printed on the answer sheet** so a scanned sheet can be matched back to its exam.

Keeping them apart is what stops a renamed or re-typed exam ID from orphaning every
question and submission row attached to it. `cls_students.student_identifier` is the
same decision already made once in this module.

Two consequences: the printed identifier is what the grader's review screen asks the
operator to confirm, and uniqueness needs deciding — recommended **unique per class**
rather than globally, since two classes may legitimately sit "Quiz 1". A date column
must not go in that unique index (`coding-guide.md`).

### Printing

Use the existing `print-sheet` / `no-print` / `print-grid` classes from
`globals.css` — `design.md` is explicit that printable screens opt in through those
and do not hand-roll per-view print CSS. The caller triggers `window.print()` itself.
The answer sheet is portrait; `print-landscape` is not needed.

### Narrow behaviour

Sections ride the shared bottom bar under the Exam group label — nothing custom, no
new `fixed` bar. **Scan & Grade is genuinely better on a phone** (that is where the
camera is), so the review overlay gets `max-lg:` sizing rather than a separate
component. Restyle with `max-lg:` first so the desktop classes are untouched.

---

## Third-party services and dependencies

**None, and nothing paid.** `sharp` is already a dependency. No OCR API, no cloud
vision, no new npm package.

Deploy note inherited from `icons/image-processor.ts`: `sharp` is native, so the NAS
needs the linux-arm64 build and **both** packages (the binding and the `libvips` it
dlopens). `scripts/publish-nas.mjs` already fetches and verifies both. Keep the
import lazy for the reason that file documents — a top-level `import sharp` runs on
every render through `wiring.ts` and turns an upload-only dependency into a
boot-critical one. That already caused `ERR_DLOPEN_FAILED` on ordinary page views once.

---

## Build order

Bottom-up, because each step compiles against the one below it. The risky part first,
and it needs no database:

1. **`sheet-layout.ts` + tests.** Pure geometry. Proves the layout contract.
2. **`detect-marks.ts` + tests.** Pure, against synthetic pixel arrays — a generated
   bitmap with known bubbles filled. This is where the risk is; prove it before
   building anything that depends on it.
3. **`grading.ts` + tests.** Pure arithmetic.
4. Migration (tables + `.md` log), then `repository.ts`, then `ports.ts`.
5. `exam.ts` use-cases + tests against a fake repo.
6. `wiring.ts`, then sections and routes.
7. **Exam Home screen and Exam Maker** — the two screens that make the module usable
   at all. An exam that can be created, keyed, listed, edited and deleted is worth
   shipping on its own, before any photograph is involved.
8. Print Sheets — depends on `sheet-layout.ts` from step 1 and on an exam existing.
9. Scan & Grade, then Results.
10. CLI command.
11. `modules.md`.

Steps 7 and 8 together give a working test *builder* with no grading at all. That is
a sensible place to stop and use the thing, since it is independent of the one part
that might not work.

### What is built

Done (steps 4-7, 10 — and step 1's layout file is NOT among them):

- `migrations/0145_create_classroom_exams.sql` + `.md` — `cls_exams`,
  `cls_exam_questions`, two indexes, two `updated_at` triggers.
- `src/lib/exam/` — `types.ts`, `schema.ts`, `ports.ts`, `repository.ts`, `exam.ts`,
  `sheet-layout.ts`, `index.ts`, plus `exam.test.ts`, `schema.test.ts` and
  `sheet-layout.test.ts` (58 tests, all passing).
- `src/lib/wiring.ts` — `examRepo`.
- `classroom-sections.ts` — `exam` and `exam-maker` sections in the Exam group.
- `classroom-section.tsx` — both branches, with `?edit=` resolution.
- `exam-actions.ts`, `exam-home-view.tsx`, `exam-maker-view.tsx`,
  `exam-answer-sheet.tsx`, `exam-grader-view.tsx`.
- **Grader** (`exam-grader`) — drop scanned sheets, a progress bar per file, a results
  table of student / grade / every answer in question order. `detect-marks.ts`,
  `grading.ts` and `sheet-image-processor.ts` back it.
- **Print blank answer sheets** — a row action on the Exam Home screen rather than a
  section of its own, since the exam you want sheets for is the row you are looking
  at. A dialog takes the count (1-200), and the sheets print through the shared
  `print-sheet` class.
- `attendance-instructions.tsx` — guidance for both sections.
- `src/lib/icons/slots.ts` + `slots.test.ts` — `classroom_section_exam_maker`.
- `src/cli/exams.ts` + router registration.

Left to do:

1. **Persisting results** — the migration adding `cls_exam_submissions` +
   `cls_exam_submission_answers`, and a Save on the Grader. Deliberately deferred: the
   Grader reads and scores today, and the right shape for what gets stored is clearer
   after the table has been used on real scans.
2. **A Results section** reading back saved submissions, once there are any.
3. **`modules.md`** (step 11) — update the Classroom entry once the group is complete.

### Identifying a scanned sheet

Two mechanisms, and they stack:

1. **File name** (default) — `alice-chen.jpg` matched against the class roster by
   token containment. Every token of the student's name must appear, so a shared
   surname cannot claim a student, and a tie is reported rather than guessed.
2. **A pre-shaded student-ID bubble grid** (migration 0147, opt-in per exam) — five
   columns of 0-9 encoding `cls_students.student_identifier`, shaded by the app at
   print time. `detectStudentId` reads it with the same sampling as an answer.

The grid was chosen over OCR of the printed name. OCR would mean a ~15MB dependency,
a recognition pass, a confidence threshold and a review step — all to recover a fact
the app already knew when it printed the sheet. The grid encodes that fact in a form
the detector reads natively, at no new cost.

It identifies a sheet only alongside `printStudentNames`, since that is what makes a
run one sheet per student. With that off a blank grid prints, which is legitimate but
anonymous; the Exam Maker says so rather than silently disabling the checkbox.

`detectStudentId` is **stricter** than `scoreAnswer`: any column that is not one clean
mark fails the whole read. A wrong ID silently attaches a grade to the wrong person,
so "unreadable" is the only acceptable failure, and the Grader falls back to the file
name or the picker.

### What the detector does and does not do

`detect-marks.ts` finds the two anchor bars, maps the shared `buildSheetLayout`'s
bubble positions through them, and samples mean darkness inside each circle. It is
pure arithmetic over an RGBA array — `sharp` stays behind `SheetImageProcessor`, so
the decisions are tested with synthetic bitmaps rather than photographs.

**It does not correct perspective.** A sheet photographed square-on, flat and evenly
lit reads reliably; one shot at an angle or badly creased will not, and the only
warning is the confidence score and the `anchorsFound` flag. That is why the Grader
shows every answer and flags unclear ones rather than quietly producing a number.

One bug worth remembering, caught by the round-trip test: `findAnchors` first judged a
column by its **mean darkness over the whole image**, which is ~0.17 for a solid bar on
a 5-question sheet (the grid is only 17% of the page) and so found no anchors on short
exams. It now uses the column's **longest unbroken dark run**, which is near-constant
regardless of how much of the page the grid occupies.

### The answer sheet's shape

The sheet is **always one page** — it is graded by photographing it, and a second page
means a second photo and a way for half an exam to go missing. Rather than paginating,
`buildSheetLayout` picks however many columns (up to 5) it takes to fit the questions
in the height the header leaves, stretching the row pitch between 2.2% and 3.4% of
page height. Past what even that holds, `fitsOnePage` is false and the Exam Maker
disables Print rather than emitting a cut-off sheet.

Layout, top to bottom: a header (class name, exam name, student name / date / score),
then whichever of the four options are on, then a rule, then the answer table —
a full grid of ruled cells, bold `#1` question numbers, lettered circles, and a solid
anchor bar down each side for the detector to find the answer area's extent and skew.

The four options live on `cls_exams`, not on the print dialog: the professor who set
the exam and the declaration students sign are the same on every reprint. Option (a),
*print each student's name*, makes the run one sheet per enrolled student from the
class roster, so the sheet count stops being a number anyone types.

Header heights are declared as fractions in `exam-answer-sheet.tsx` and fed to
`buildSheetLayout` as `gridTop`. That is why the layout takes the header height as a
parameter rather than assuming one — it cannot know how tall a declaration block is,
and guessing is what would push the grid onto a second page.

### The printed sheet's contract with the grader

`sheet-layout.ts` returns positions as **fractions of the printable box** (0..1), not
pixels or millimetres, and that is what makes one function serve both sides: the
renderer multiplies by whatever box it draws into, and the detector will multiply by
the photographed page's registration box. Neither needs the other's units.

Two numbers the detector will depend on, both fixed in that file: the bubble is
**2.6% of page width** (and 2.01% of height, which is the same absolute length on a
1:1.294 page, so it is a true circle), and the **anchor bars** are 1.2% of page width,
running down each side of the answer grid and spanning exactly its vertical extent.

The anchors flank the answers rather than the page corners on purpose: they move with
the grid when the header grows, so the detector locates the answer area itself rather
than the paper. The sheet number is printed in the footer so a scattered stack can be
reassembled.

Steps 1–3 are the whole gamble and are testable with no DB, no browser and no real
image. If the detector cannot be made to work on synthetic input, stop there — that
is a cheap failure, and discovering it after building four screens is not.

---

## Open risks

- **Detection accuracy on real photos is unproven.** Synthetic tests prove the
  arithmetic, not that a phone photo of a real desk survives it. Expect a round of
  tuning against actual scans, and keep the review screen regardless.
- **Perspective correction is the hard sub-problem.** A four-corner homography is
  well-understood maths but easy to get subtly wrong; it wants its own tests with a
  deliberately skewed synthetic sheet.
- **The sheet id must be machine-readable** for batch grading to match a sheet to an
  exam. Simplest workable version: print the exam id as a short number *and* have the
  operator confirm it on the review screen, rather than reaching for a barcode library.

---

## Rules that apply (from `CLAUDE.md` / `ARCHITECTURE.md`)

- All logic in `src/lib/exam/`; nothing in a `.tsx`, a route, or a CLI command.
- No `react`/`next` import under `src/lib/`.
- Every exported server action authorises on its **first line** with
  `requireModuleAccess("classroom")` — an action is its own POST endpoint, so no
  layout or page check protects it. Match the module's **full slug**.
- Every use-case callable identically from the web app and the CLI; boundary input
  validated with the module's zod schema.
- New library logic ships with colocated Vitest tests (success + failure).
- Reuse-first UI: check `components.md` before building anything, and ask before
  creating a new shared component.
- Propose icon slot ids and labels and **wait for confirmation** — permanent once
  uploads exist.
- Plan before building: present files, migration, icon slots, dependencies and open
  questions, then **stop and wait**.
- Don't run the gates. Report honestly what was and was not verified.
