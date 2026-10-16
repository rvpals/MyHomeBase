# 0147 — The student-ID bubble grid

Adds `cls_exams.include_student_id`: print a bubble grid encoding the student's ID on
each answer sheet, **pre-shaded by the app** rather than filled in by the student.

## What it is for

It is how a scanned sheet says whose it is.

The Grader currently identifies a sheet by its **file name** (`alice-chen.jpg`,
matched against the class roster). That works, and stays the default, but it has two
limits: it depends on whoever scans naming the files correctly, and it disappears
entirely if a batch of sheets arrives as one multi-page document, where there is one
file name for thirty students.

A bubble grid carries the identity **on the page**, so it survives both. And because
the app prints it already shaded — it knows whose sheet it is at print time — the
student does nothing and cannot get it wrong.

## Why not OCR the printed name instead

That was the alternative considered. The sheet already prints the student's name when
`print_student_names` is on, so reading it back with OCR is possible.

It was rejected because it is the expensive answer to a question already solved. OCR
means a new ~15MB dependency, a recognition pass per sheet, a confidence threshold,
and a review step — all to recover a fact the app knew when it printed the sheet. The
bubble grid encodes that same fact in a form `detectMarks` **already reads**: the same
sampling, the same thresholds, the same reliability as an answer bubble. No new
dependency at all.

## Why it needs `print_student_names`

The grid identifies a sheet only when `print_student_names` is also on, because that
is the option that makes a print run emit one sheet *per student* — which is the only
point at which the app knows whose ID to shade.

With it off, a blank grid prints. That is deliberate rather than an error: a blank
grid is a legitimate sheet that simply identifies nobody, exactly as a blank name line
is. The Exam Maker says so rather than silently disabling the checkbox, because the
two options are independently meaningful and coupling them in the UI would hide why.

## The encoding

Five columns of 0-9, one shaded per column, from `cls_students.student_identifier`:

- **Punctuation and letters are stripped** — `"S-2019"` and `"2019"` encode the same.
  A hand-typed roster is not consistent about this, and the grid holds digits anyway.
- **Right-aligned, truncated from the left.** An ID longer than five digits keeps its
  **last** five: the tail distinguishes students within an institution, where a shared
  leading year or campus code does not.
- **A short ID leaves its leading columns blank**, which `detectStudentId` reads back
  as a short ID rather than inventing zeros.

Geometry lives in `buildIdGridLayout` (`sheet-layout.ts`) and is shared by the printer
and the detector, exactly as the answer grid is — the one arrangement that stops the
two drifting apart.

## Reading it back refuses rather than guesses

`detectStudentId` is **stricter** than `scoreAnswer`. The marks are printed, not
pencilled, so a column that does not read as one clean mark means a bad scan, not a
careless student. Any such column makes the whole read return `undefined`.

That asymmetry is the point: a wrong student ID silently attaches a grade to the wrong
person, which is the worst failure this module has. "I could not read it" is the only
acceptable way for it to fail, and the Grader then falls back to the file name or to
the picker.

## Why a separate migration

Same reasoning as 0146, whose log records it at length: 0145 was applied to the live
database and then edited, so the edit reached no database at all and the running code
queried columns that were not there. An applied migration is history; a new file is
the only way to move a live schema forward.

0146 may already have run on the live database, so this is 0147 rather than an edit to
it. Additive `ALTER TABLE ... ADD COLUMN` with a `NOT NULL DEFAULT 0`, which backfills
every existing row — the correct reading for an exam created before the option
existed.
