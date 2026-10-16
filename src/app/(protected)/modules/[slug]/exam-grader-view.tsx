"use client";

// Grader: drop a stack of scanned answer sheets, grade them against the key, and read
// the results in a table.
//
// ## One file per request
//
// Files are graded one at a time rather than in one batch call. A server action's
// payload is capped and a batch of photographs would exceed it, but the better reason
// is feedback: twenty sheets in one request means twenty decodes before anything
// appears, with no progress and no way for one unreadable file to fail on its own.
// Grading per file gives a real progress bar and turns a bad scan into one red row.
//
// ## What is NOT here
//
// Nothing is saved. There are no submission tables yet (see plan_exam.md), so this
// screen grades and displays. That is deliberate rather than unfinished: the shape of
// what gets stored should be decided once the table has been used on real scans.

import { useState } from "react";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import { Modal } from "@/components/modal";
import { MultiFileDropzone } from "@/components/multi-file-dropzone";
import { Progress3D } from "@/components/progress-3d";
import type { ExamSummary, GradedScan } from "@/lib/exam";
import { gradeScanAction } from "./exam-actions";
import { headerHeight, qrTop } from "./exam-answer-sheet";

/** Image types a scanner or phone produces. */
const ACCEPTED = "image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp";

export interface GraderStudent {
  id: number;
  name: string;
}

/** One row of the results table. */
interface ResultRow extends GradedScan {
  /** Stable across re-grades, so React keys and the student override survive. */
  key: string;
  /**
   * The scan itself, kept so the row can open it for comparison.
   *
   * Held in memory rather than uploaded anywhere: the grader never stores a scan, it
   * reads one and keeps the result. The consequence is that the view button works
   * until the page is reloaded, which is the right trade for a review aid — storing
   * exam scans server-side is a decision with its own weight, and this screen does not
   * need it to be useful.
   */
  file?: File;
  /** Set when the reader corrected the student by hand. */
  overriddenStudentId?: number;
}

export function ExamGraderView({
  exams,
  rosterByClassId,
}: {
  exams: ExamSummary[];
  rosterByClassId: Record<number, GraderStudent[]>;
}) {
  // A <select> whose value matches no <option> shows the first one, so the default is
  // written to state rather than merely rendered.
  const [examId, setExamId] = useState<number>(exams[0]?.id ?? 0);
  const [files, setFiles] = useState<File[]>([]);
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [done, setDone] = useState(0);
  const [isGrading, setIsGrading] = useState(false);
  const [error, setError] = useState<string>();
  const [detail, setDetail] = useState<ResultRow>();

  const exam = exams.find((item) => item.id === examId);
  const roster = exam ? (rosterByClassId[exam.classId] ?? []) : [];
  const keyIsComplete = exam ? exam.keyedCount >= exam.questionCount : false;

  async function handleGrade() {
    if (!exam || files.length === 0) return;
    setError(undefined);
    setRows([]);
    setDone(0);
    setIsGrading(true);

    // The header height the sheet was PRINTED with. Sampling against a different
    // value reads as a page of blanks rather than as an error, so it is derived from
    // the exam's own options rather than assumed.
    const printed = {
      examIdentifier: exam.examIdentifier,
      name: exam.name,
      className: exam.className,
      questionCount: exam.questionCount,
      choiceSet: exam.choiceSet,
      pointsPerQuestion: exam.pointsPerQuestion,
      printStudentNames: exam.printStudentNames,
      includeSignature: exam.includeSignature,
      includeProfessor: exam.includeProfessor,
      professorName: exam.professorName,
      includeStudentId: exam.includeStudentId,
      includeDeclaration: exam.includeDeclaration,
      declarationText: exam.declarationText,
    };
    const gridTop = headerHeight(printed);
    // Where the QR was printed, or undefined when this exam prints none.
    const qrTopFraction = qrTop(printed);

    const collected: ResultRow[] = [];
    for (const [index, file] of files.entries()) {
      try {
        const base64 = await fileToBase64(file);
        const result = await gradeScanAction(
          exam.id,
          file.name,
          base64,
          gridTop,
          qrTopFraction,
        );
        if (result.ok && result.graded) {
          collected.push({ ...result.graded, key: `${file.name}-${index}`, file });
        } else {
          setError((previous) => previous ?? result.error);
        }
      } catch (cause) {
        setError(
          (previous) =>
            previous ?? `Could not read ${file.name}: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
      // Incremental, so the bar and the table fill as work proceeds rather than
      // jumping at the end.
      setDone(index + 1);
      setRows([...collected]);
    }

    setIsGrading(false);
  }

  function setStudent(rowKey: string, studentId: number) {
    setRows((previous) =>
      previous.map((row) =>
        row.key === rowKey
          ? {
              ...row,
              overriddenStudentId: studentId || undefined,
              studentId: studentId || undefined,
              studentName: roster.find((student) => student.id === studentId)?.name,
              needsStudent: !studentId,
              // A hand-picked student is no longer "matched by QR". Leaving the old
              // provenance would caption a name the operator typed with evidence that
              // did not produce it.
              identifiedBy: "none" as const,
            }
          : row,
      ),
    );
  }

  const columns: DataGridColumn<ResultRow>[] = [
    {
      // Sits first so it lands beside DataGrid's own record-view eye, which is a
      // leading column this screen cannot inject into.
      key: "source",
      header: "",
      excludeFromRecordView: true,
      sortable: false,
      render: (row) =>
        row.file ? (
          <button
            type="button"
            onClick={() => openScan(row.file!)}
            aria-label={`Open ${row.fileName}`}
            title={`Open ${row.fileName} in a new tab`}
            // Matched to DataGrid's record-view button so the two read as a pair.
            className="rounded-md p-1 text-brass-dark transition-colors hover:bg-brass-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
          >
            <ScanViewIcon />
          </button>
        ) : null,
    },
    {
      key: "student",
      header: "Student",
      value: (row) => row.studentName ?? "",
      render: (row) => (
        <>
          <select
            className="w-full rounded-md border border-line bg-paper px-2 py-1 text-sm text-ink"
            value={row.studentId ?? 0}
            onChange={(event) => setStudent(row.key, Number(event.target.value))}
          >
            <option value={0}>— pick a student —</option>
            {roster.map((student) => (
              <option key={student.id} value={student.id}>
                {student.name}
              </option>
            ))}
          </select>
            {/* How this name was arrived at. A QR read came off the sheet itself and
                was generated from the roster; a file-name match is a fuzzy guess at
                whatever the scanner called the file. The operator is about to commit
                grades against these names, so the two must not look alike. */}
            {row.identifiedBy === "qr" ? (
              <span className="mt-0.5 block text-[0.65rem] text-muted">
                matched by QR code
              </span>
            ) : row.identifiedBy === "file-name" ? (
              <span className="mt-0.5 block text-[0.65rem] text-muted">
                guessed from file name &mdash; check this
              </span>
            ) : null}
        </>
      ),
    },
    {
      key: "file",
      header: "File",
      value: (row) => row.fileName,
      render: (row) => <span className="text-xs text-muted">{row.fileName}</span>,
    },
    {
      key: "score",
      header: "Grade",
      value: (row) => row.sheet.score,
      render: (row) => (
        <span className="font-semibold tabular-nums">
          {row.sheet.score}/{row.sheet.maxScore}
        </span>
      ),
    },
    {
      key: "correct",
      header: "Correct",
      value: (row) => row.sheet.correctCount,
      render: (row) => (
        <span className="tabular-nums">
          {row.sheet.correctCount}/{row.sheet.answers.length}
        </span>
      ),
    },
    {
      key: "answers",
      header: "Answers, by question",
      sortable: false,
      // The whole point of the screen: every answer in question order, at a glance.
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.sheet.answers.map((answer) => (
            <span
              key={answer.questionNumber}
              title={`Q${answer.questionNumber}: read ${answer.detected || "blank"}, key ${answer.correct || "unkeyed"}${answer.issue === "none" ? "" : ` (${answer.issue})`}`}
              className={[
                "inline-flex min-w-6 items-center justify-center rounded border px-1 text-xs tabular-nums",
                // `emerald-400` rather than a `positive` token: there is no such
                // token, and this is the green the admin About screen's badges use.
                answer.isCorrect
                  ? "border-emerald-400/50 text-emerald-400"
                  : "border-danger/50 text-danger",
                // A flagged answer is advisory, so it is marked but not blocking.
                answer.issue === "none" ? "" : "border-dashed font-semibold",
              ].join(" ")}
            >
              {answer.detected || "·"}
            </span>
          ))}
        </div>
      ),
    },
    {
      key: "flags",
      header: "Flags",
      value: (row) => row.sheet.flaggedCount,
      render: (row) => {
        const notes: string[] = [];
        if (!row.anchorsFound) notes.push("no anchors");
        if (row.needsStudent) notes.push("no student");
        if (row.sheet.flaggedCount > 0) notes.push(`${row.sheet.flaggedCount} unclear`);
        return notes.length === 0 ? (
          <span className="text-xs text-muted">—</span>
        ) : (
          <span className="text-xs text-danger">{notes.join(", ")}</span>
        );
      },
    },
    {
      key: "actions",
      header: "",
      excludeFromRecordView: true,
      sortable: false,
      render: (row) => (
        <Button variant="secondary" size="sm" onClick={() => setDetail(row)}>
          Details
        </Button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <CollapsibleCard title="Scan answer sheets" defaultOpen>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3 max-lg:grid-cols-1">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-muted">
                Exam
              </span>
              <select
                className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink"
                value={examId}
                onChange={(event) => setExamId(Number(event.target.value))}
                disabled={isGrading}
              >
                {exams.length === 0 && <option value={0}>No exams yet</option>}
                {exams.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.examIdentifier ? `${item.examIdentifier} — ` : ""}
                    {item.name} ({item.className || "no class"})
                  </option>
                ))}
              </select>
            </label>
          </div>

          {exam && !keyIsComplete && (
            <p role="alert" className="text-sm text-danger">
              This exam&apos;s answer key is {exam.keyedCount} of {exam.questionCount}.
              Unkeyed questions can never be marked correct, so grading now will understate
              every score. Finish the key in Exam Maker first.
            </p>
          )}

          <MultiFileDropzone
            files={files}
            onFilesChange={setFiles}
            accept={ACCEPTED}
            label="Drop scanned answer sheets here, or click to browse"
            disabled={isGrading}
          />

          <p className="text-xs text-muted">
            Name each file after the student — <code>alice-chen.jpg</code> — and the grader
            matches it to the class roster. Anything it cannot match is left for you to pick
            in the table.
          </p>

          {isGrading && (
            <Progress3D
              label="Grading"
              value={done}
              max={files.length}
              showValue
              formatValue={(value, max) => `${value} of ${max}`}
            />
          )}

          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}

          <div className="flex justify-end">
            <Button
              onClick={handleGrade}
              disabled={isGrading || files.length === 0 || !exam}
            >
              {isGrading ? "Grading…" : `Grade ${files.length || ""} sheet${files.length === 1 ? "" : "s"}`}
            </Button>
          </div>
        </div>
      </CollapsibleCard>

      {rows.length > 0 && (
        <CollapsibleCard title="Results" defaultOpen>
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">
              {rows.length} sheet{rows.length === 1 ? "" : "s"} graded. Nothing is saved —
              this is a read of the scans as they are.
            </p>
            <DataGrid
              columns={columns}
              rows={rows}
              getRowKey={(row) => row.key}
              emptyMessage="No sheets graded yet."
              exportFileName="exam-results"
            />
          </div>
        </CollapsibleCard>
      )}

      {detail && (
        <Modal
          title={`${detail.studentName ?? detail.fileName} — ${detail.sheet.score}/${detail.sheet.maxScore}`}
          size="lg"
          onClose={() => setDetail(undefined)}
          footer={
            <Button variant="secondary" onClick={() => setDetail(undefined)}>
              Close
            </Button>
          }
        >
          <div className="flex flex-col gap-2">
            {!detail.anchorsFound && (
              <p className="text-sm text-danger">
                The anchor bars were not found on this scan, so the bubble grid was located
                from the page edges instead. Check these answers carefully.
              </p>
            )}
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="py-1">Q</th>
                  <th>Read</th>
                  <th>Key</th>
                  <th>Result</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {detail.sheet.answers.map((answer) => (
                  <tr key={answer.questionNumber} className="border-t border-line">
                    <td className="py-1 tabular-nums">{answer.questionNumber}</td>
                    <td className="font-semibold">{answer.detected || "—"}</td>
                    <td>{answer.correct || "—"}</td>
                    <td className={answer.isCorrect ? "text-emerald-400" : "text-danger"}>
                      {answer.isCorrect ? "correct" : "wrong"}
                    </td>
                    <td className="text-xs text-muted">
                      {answer.issue === "none" ? "" : answer.issue}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </div>
  );
}

/**
 * Opens a scan in a new tab.
 *
 * An object URL rather than a data URL: a multi-megabyte photograph as base64 in the
 * address bar is slow and some browsers refuse it outright. Revoked on a timer rather
 * than immediately, because the new tab needs the URL to still resolve when it loads —
 * revoking in the same tick shows a blank page.
 */
function openScan(file: File): void {
  const url = URL.createObjectURL(file);
  window.open(url, "_blank", "noopener,noreferrer");
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** A magnifier over a page — "look at the scan this row came from". */
function ScanViewIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 1.5h6l3.5 3.5v9.5H3z" />
      <circle cx="7.5" cy="9" r="2.4" />
      <path d="m9.4 10.9 1.8 1.8" />
    </svg>
  );
}

/** A File to base64, since a server action cannot take a File. */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file."));
    reader.onload = () => {
      const result = String(reader.result);
      // A data URL: strip the "data:image/png;base64," prefix.
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}
