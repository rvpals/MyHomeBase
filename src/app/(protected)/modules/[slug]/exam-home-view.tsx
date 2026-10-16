"use client";

// Exam Home screen: every exam that exists, with edit, delete and "create a new one".
//
// Deliberately NOT an editor. Creating and editing both link into Exam Maker
// (`?edit=new` / `?edit=<id>`), following the Journal Reports precedent — so there is
// one screen that writes an exam and one that lists them.
//
// Printing blank sheets lives here rather than on a section of its own: the exam you
// want sheets for is the row you are already looking at. The sheets render into a
// hidden-on-screen block that `window.print()` picks up — see `ExamAnswerSheet`.

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/button";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import { Modal } from "@/components/modal";
import type { ExamSummary } from "@/lib/exam";
import { ExamAnswerSheet } from "./exam-answer-sheet";
import { deleteExamAction } from "./exam-actions";

const MAKER_PATH = "/modules/classroom/exam-maker";

/** How many blank sheets one print run may emit. */
const MIN_COPIES = 1;
const MAX_COPIES = 200;
const DEFAULT_COPIES = 25;

export function ExamHomeView({ exams }: { exams: ExamSummary[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [confirming, setConfirming] = useState<ExamSummary>();
  // The exam whose blank sheets are being printed, and how many to emit. Both are
  // cleared after printing so a stray Ctrl+P later prints the page, not a stale run.
  const [printing, setPrinting] = useState<ExamSummary>();
  const [copies, setCopies] = useState(DEFAULT_COPIES);
  const [copiesText, setCopiesText] = useState(String(DEFAULT_COPIES));
  /**
   * The exam whose sheets are mounted for printing.
   *
   * Separate from `printing` (which drives the dialog) on purpose: closing the dialog
   * must not unmount the sheets, or there would be nothing left for `window.print()`
   * to pick up.
   */
  const [printTarget, setPrintTarget] = useState<ExamSummary>();

  function handleDelete(exam: ExamSummary) {
    setError(undefined);
    startTransition(async () => {
      const result = await deleteExamAction(exam.id);
      if (!result.ok) {
        setError(result.error ?? "Failed to delete the exam.");
        return;
      }
      setConfirming(undefined);
      router.refresh();
    });
  }

  /**
   * Unmounts the sheets once the print dialog closes.
   *
   * Without this they stay in the DOM, so a later Ctrl+P — or the browser's own
   * print button — would silently reprint the last run of blank sheets instead of
   * the screen. `afterprint` fires on both printing and cancelling, which is exactly
   * the moment the sheets stop being wanted.
   */
  useEffect(() => {
    if (!printTarget) return;
    const clear = () => setPrintTarget(undefined);
    window.addEventListener("afterprint", clear);
    return () => window.removeEventListener("afterprint", clear);
  }, [printTarget]);

  /**
   * Mounts the blank sheets for the chosen exam, then prints them.
   *
   * Three things happen in one click, and the order matters: close the dialog (it
   * must not land on page one), mount the sheets, and only then call
   * `window.print()` — which is synchronous and blocking, so it has to run *after*
   * React has committed both.
   *
   * `requestAnimationFrame` twice rather than a `setTimeout` guess: React commits
   * before the next paint, the first frame fires at that paint, and the second
   * fires after it. That is the cheapest dependable point at which the sheets are
   * in the layout `print` reads and the dialog is gone from it.
   */
  function handlePrint() {
    if (!printing) return;
    const exam = printing;
    setPrinting(undefined);
    setPrintTarget(exam);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.print();
      });
    });
  }

  // `value` is the raw primitive (sort, search, filter, CSV export); `render` is the
  // cell UI, and carries the em-dash placeholder so an export gets the real blank
  // rather than a dash. Both are needed — `render` is required on the column type.
  const columns: DataGridColumn<ExamSummary>[] = [
    {
      key: "examIdentifier",
      header: "Exam ID",
      value: (row) => row.examIdentifier,
      render: (row) => row.examIdentifier || "—",
    },
    { key: "name", header: "Name", value: (row) => row.name, render: (row) => row.name },
    {
      key: "className",
      header: "Class",
      value: (row) => row.className,
      render: (row) => row.className || "—",
    },
    {
      key: "questionCount",
      header: "Questions",
      value: (row) => row.questionCount,
      render: (row) => row.questionCount,
    },
    {
      key: "choiceSet",
      header: "Choices",
      value: (row) => row.choiceSet,
      render: (row) => row.choiceSet,
    },
    {
      key: "points",
      header: "Points each",
      value: (row) => row.pointsPerQuestion,
      render: (row) => row.pointsPerQuestion,
    },
    {
      // The reason this column exists: an exam with a partial key can be printed but
      // not graded, and that has to be visible without opening it.
      key: "key",
      header: "Answer key",
      // Sorts and exports on the keyed count rather than the label, so "9 of 10"
      // orders after "2 of 10" instead of alphabetically.
      value: (row) => row.keyedCount,
      render: (row) =>
        row.keyedCount >= row.questionCount
          ? "Complete"
          : `${row.keyedCount} of ${row.questionCount}`,
    },
    {
      key: "actions",
      header: "",
      // Row actions don't belong in a read-out of the record.
      excludeFromRecordView: true,
      sortable: false,
      render: (row) => (
        // `size="sm"` per components.md: small inside a grid.
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" href={`${MAKER_PATH}?edit=${row.id}`}>
            Edit
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setError(undefined);
              setCopies(DEFAULT_COPIES);
              setCopiesText(String(DEFAULT_COPIES));
              setPrinting(row);
            }}
          >
            Print blank answer sheet
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setConfirming(row)}
            disabled={pending}
          >
            Delete
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {exams.length === 0
            ? "No exams yet."
            : `${exams.length} exam${exams.length === 1 ? "" : "s"}.`}
        </p>
        <Button href={`${MAKER_PATH}?edit=new`}>Create a new exam</Button>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      <DataGrid
        columns={columns}
        rows={exams}
        getRowKey={(row) => row.id}
        emptyMessage="No exams yet. Create one to get started."
        exportFileName="exams"
      />

      {confirming && (
        <Modal
          title="Delete this exam?"
          size="sm"
          isBusy={pending}
          onClose={() => setConfirming(undefined)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirming(undefined)}>
                Cancel
              </Button>
              {/* The verb, never "OK". */}
              <Button variant="danger" onClick={() => handleDelete(confirming)} disabled={pending}>
                Delete
              </Button>
            </>
          }
        >
          <p className="text-sm text-muted">
            <strong className="text-ink">{confirming.name}</strong> and its answer key will be
            deleted. This cannot be undone.
          </p>
        </Modal>
      )}

      {printing && (
        <Modal
          title="Print blank answer sheets"
          size="sm"
          onClose={() => setPrinting(undefined)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setPrinting(undefined)}>
                Cancel
              </Button>
              <Button onClick={handlePrint}>Print</Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">
              Blank sheets for{" "}
              <strong className="text-ink">
                {printing.examIdentifier ? `${printing.examIdentifier} — ` : ""}
                {printing.name}
              </strong>
              : {printing.questionCount} question
              {printing.questionCount === 1 ? "" : "s"}, choices {printing.choiceSet}.
            </p>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-muted">
                How many sheets
              </span>
              <input
                className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
                type="number"
                min={MIN_COPIES}
                max={MAX_COPIES}
                value={copiesText}
                // The text is what the reader typed; `copies` is the clamped number
                // actually printed. Keeping them apart means a half-typed "" or "12"
                // doesn't fight the input, and the field never silently rewrites a
                // keystroke mid-entry.
                onChange={(event) => {
                  setCopiesText(event.target.value);
                  const parsed = Number(event.target.value);
                  if (Number.isFinite(parsed)) {
                    setCopies(Math.min(MAX_COPIES, Math.max(MIN_COPIES, Math.floor(parsed))));
                  }
                }}
                onBlur={() => setCopiesText(String(copies))}
              />
              <span className="text-xs text-muted">
                One per student. {MIN_COPIES}–{MAX_COPIES}.
                {printing.printStudentNames &&
                  " This exam prints one named sheet per enrolled student, so the count is its roster."}
              </span>
            </label>
          </div>
        </Modal>
      )}

      {/* The sheets themselves. Mounted only while printing, and hidden on screen:
          `window.print()` reads the layout, not the viewport, so `hidden print:block`
          keeps them off the page while still printing. Unmounted again by the
          afterprint handler, so a later Ctrl+P prints the screen rather than a stale
          run of sheets. */}
      {printTarget && (
        <div className="hidden print:block">
          <ExamAnswerSheet
            exam={{
              examIdentifier: printTarget.examIdentifier,
              name: printTarget.name,
              className: printTarget.className,
              questionCount: printTarget.questionCount,
              choiceSet: printTarget.choiceSet,
              pointsPerQuestion: printTarget.pointsPerQuestion,
              printStudentNames: printTarget.printStudentNames,
              includeSignature: printTarget.includeSignature,
              includeProfessor: printTarget.includeProfessor,
              professorName: printTarget.professorName,
              includeStudentId: printTarget.includeStudentId,
              includeDeclaration: printTarget.includeDeclaration,
              declarationText: printTarget.declarationText,
            }}
            copies={copies}
          />
        </div>
      )}
    </div>
  );
}
