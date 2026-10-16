"use client";

// The printable blank answer sheet.
//
// Route-local rather than a registered shared component: nothing outside the Exam
// group prints a bubble grid, and `components.md` reserves the registry for things
// that plausibly recur.
//
// Every bubble position comes from `buildSheetLayout` in `lib/exam`, never from this
// file. That is deliberate — the mark detector will sample from the same function, so
// the printed sheet and the grader cannot drift apart. This component only turns
// fractions into percentages and draws the header.
//
// ## One page
//
// A sheet is graded by photographing it, so it must be one page: a second page means
// a second photo and a way for half an exam to go missing. The header's height is
// measured in fractions here and passed to `buildSheetLayout` as `gridTop`, which
// then picks however many columns it takes to fit the questions in what is left.
//
// ## Printing
//
// One `.print-sheet` wraps ALL the sheets, not one per sheet. The rule in globals.css
// makes `.print-sheet` `position: absolute; top: 0`, so sibling sheets would stack on
// top of each other and print as a single page. Inside that one wrapper, each sheet
// ends with `break-after-page`, which is what actually produces N pages.
//
// **Every rule on this sheet is drawn with a `border`, never a `background`.** The
// same print block forces `background: #fff !important` on `.print-sheet *`, so a
// line drawn as a 1px-tall `bg-black` div is visible on screen and then **invisible
// on paper** — which is the whole sheet's grid silently vanishing at the printer. A
// border is a color rather than a background, so it survives. This caught out the
// first version of the grid: the markup was right and the lines still did not print.

import type { ChoiceSet, SheetLayout } from "@/lib/exam";
import { QR_SIZE, bubbleSizeFor, buildSheetLayout, qrHeightFraction } from "@/lib/exam";

/** Everything the printed sheet needs to know about the exam. */
export interface AnswerSheetExam {
  examIdentifier: string;
  name: string;
  className: string;
  questionCount: number;
  choiceSet: ChoiceSet;
  pointsPerQuestion: number;
  printStudentNames: boolean;
  includeSignature: boolean;
  includeProfessor: boolean;
  professorName: string;
  includeStudentId: boolean;
  includeDeclaration: boolean;
  declarationText: string;
}

/**
 * Header heights, as fractions of page height.
 *
 * These are what decide where the answer grid can start, so they live together rather
 * than being implied by the markup. Each is the measured height of the block it names
 * at the font sizes below; changing a block's type size means revisiting its number.
 *
 * THE GRID IS POSITIONED FROM THESE NUMBERS, NOT FROM THE HEADER'S REAL HEIGHT. The
 * header is ordinary flow inside an absolutely-placed box; the answer grid is placed
 * at `headerHeight()` independently. So an underestimate here does not push the grid
 * down -- it draws the grid UNDERNEATH the header text, which is what happened when
 * a declaration was switched on: rows #1 and #2 printed on top of the declaration box
 * and the instruction line. `fitsOnePage` cannot catch that; it only asks whether the
 * rows fit between `gridTop` and the page bottom, and a gridTop that is too SMALL
 * leaves more room, not less. Measure against a rendered sheet, and leave headroom.
 */
/** The header box's own offset from the page top (`top-[2.5%]` on its container). */
const HEADER_TOP_OFFSET = 0.025;
/**
 * Title, class/exam rule, and the name/date/score row -- measured to the baseline of
 * the instruction line, which always renders and was previously not counted at all.
 */
// Measured from a rendered PDF at 0.115; set to 0.15 to keep headroom. Over-
// estimating only wastes paper, while UNDER-estimating draws the answer grid on top
// of the header — and `fitsOnePage` cannot catch that, because a smaller gridTop
// leaves MORE room, not less. The old 0.225 wasted about an inch of page.
const HEADER_BASE = 0.15;
/**
 * What the header block actually measures, as opposed to what it is budgeted.
 *
 * `HEADER_BASE` is deliberately padded: an over-estimate only wastes paper. That
 * padding is correct for reserving space and **wrong for locating something**, which
 * is the distinction that broke QR decoding — `qrTop` derived the code's position from
 * the padded number and reported it 38px below where it renders, so the crop clipped
 * 16px off the top and took both upper finder patterns with it. jsQR needs three, so
 * every sheet silently fell back to matching on the file name.
 *
 * Reserve space with `HEADER_BASE`. Locate something with this.
 */
const HEADER_BASE_MEASURED = 0.115;
const SIGNATURE_HEIGHT = 0.035;
const PROFESSOR_HEIGHT = 0.025;
/**
 * The student-ID QR block: the square itself, plus its caption and a little air.
 *
 * This replaced a ten-row bubble grid that cost 0.155 of the page. The QR encodes the
 * same ID in 0.081 plus trim — roughly half — and unlike the grid it carries error
 * correction and its own finder patterns, so it self-locates instead of relying on the
 * detector finding a thin rectangle.
 */
const QR_CAPTION_HEIGHT = 0.022;
const QR_BLOCK_HEIGHT = qrHeightFraction() + QR_CAPTION_HEIGHT + 0.012;
/** The declaration's box, plus a line per ~90 characters of wrapped text. */
const DECLARATION_BASE = 0.03;
const DECLARATION_PER_LINE = 0.016;
const DECLARATION_CHARS_PER_LINE = 95;
/** The rule between the header and the answers. */
const DIVIDER_HEIGHT = 0.022;

/**
 * How far the instruction line is pulled in from each edge.
 *
 * Clears the anchor bars, which start `ANCHOR_OVERHANG` (0.02) above the grid and so
 * reach into this line's band. `GRID_LEFT` (0.04) plus the bar's own width (0.012)
 * puts its inner edge at 0.052; 0.07 leaves visible air rather than touching.
 */
const INSTRUCTION_INSET = 0.07;

/** Where the answer grid may start, given which header blocks are switched on. */
export function headerHeight(exam: AnswerSheetExam): number {
  // The offset is part of the distance from the page top to the grid, so it is added
  // here rather than being silently absorbed into HEADER_BASE.
  let height = HEADER_TOP_OFFSET + HEADER_BASE;
  // Only costs height when there is actually a QR to print. A blank sheet has no
  // student, so it gets no code — and must not reserve room for one either.
  if (exam.includeStudentId && exam.printStudentNames) height += QR_BLOCK_HEIGHT;
  if (exam.includeSignature) height += SIGNATURE_HEIGHT;
  if (exam.includeProfessor) height += PROFESSOR_HEIGHT;
  if (exam.includeDeclaration) {
    const lines = Math.max(
      1,
      Math.ceil(exam.declarationText.length / DECLARATION_CHARS_PER_LINE),
    );
    height += DECLARATION_BASE + lines * DECLARATION_PER_LINE;
  }
  return height + DIVIDER_HEIGHT;
}

/**
 * Where the student-ID QR's top edge sits, for the grader to crop against.
 *
 * The QR block renders in ordinary document flow, immediately after the name line, so
 * its top is the fixed part of the header and nothing optional precedes it. The
 * caption sits above the code itself.
 *
 * Exported for the same reason `headerHeight` is: the printer and the detector have
 * to agree on where something was drawn, and the only way to guarantee that is for
 * both to call one function. A sheet printed against one number and read against
 * another produces a confident wrong answer, which is the failure mode this whole
 * file is arranged to avoid.
 *
 * Returns undefined when this sheet carries no code, which is the signal not to look.
 */
export function qrTop(exam: AnswerSheetExam): number | undefined {
  if (!exam.includeStudentId || !exam.printStudentNames) return undefined;
  // MEASURED, not budgeted — see `HEADER_BASE_MEASURED`. Using the padded
  // `HEADER_BASE` here put the crop 38px low and clipped the code's finder patterns.
  return HEADER_TOP_OFFSET + HEADER_BASE_MEASURED + QR_CAPTION_HEIGHT;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(3)}%`;
}

/**
 * One printed sheet.
 *
 * `aspect-[1/1.294]` is US Letter's ratio inside the 16mm `@page` margin, so what is
 * on screen is what lands on paper. Everything positioned against this box uses the
 * layout's fractions directly, with no unit conversion.
 */
function SheetPageView({
  exam,
  layout,
  studentName,
  studentIdentifier,
  qrSvg,
  copyNumber,
  totalCopies,
  isLast,
}: {
  exam: AnswerSheetExam;
  layout: SheetLayout;
  /** The student this sheet is for, or undefined for a blank name line. */
  studentName?: string;
  /** That student's ID. Labels the QR for screen readers. */
  studentIdentifier?: string;
  /** This student's ID as a QR, pre-rendered. Absent means print no code. */
  qrSvg?: string;
  copyNumber: number;
  totalCopies: number;
  isLast: boolean;
}) {
  const { grid } = layout;
  // Bubble size, as fractions of each axis. The height is the width converted through
  // the page ratio (2.01 × 1.294 = 2.6) so the bubble is a true circle, not an oval.
  // The bubble's printed size, scaled to this layout's density — see `bubbleSizeFor`.
  // Shared with the detector so the printed shape and the sampled window cannot drift.
  const { width: bubbleWidth, height: bubbleHeight } = bubbleSizeFor(layout);

  return (
    <div
      className={[
        "relative mx-auto w-full max-w-[52rem] aspect-[1/1.294] bg-white text-black",
        // On screen each sheet reads as paper; on paper the border and rounding are
        // pointless ink.
        "rounded-lg border border-line print:rounded-none print:border-0",
        // What makes N sheets print as N pages. The last carries no break, so one
        // copy does not emit a trailing blank.
        isLast ? "" : "break-after-page",
      ].join(" ")}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="absolute inset-x-[4%] top-[2.5%]">
        <p className="text-center text-[1.05rem] font-bold uppercase tracking-[0.16em]">
          Answer Sheet
        </p>

        <div className="mt-1 flex items-baseline justify-between gap-3 border-y-[1.5px] border-black py-1 text-[0.8rem]">
          <span className="font-semibold">{exam.className || "—"}</span>
          <span className="font-semibold">
            {exam.examIdentifier ? `${exam.examIdentifier} — ` : ""}
            {exam.name}
          </span>
        </div>

        {/* Student name. With (a) on, it is already filled in.

            No Date and no Score field. Both were asked for and then removed: the date
            is on the exam paper the student is working from, and the score is the
            grader's output, not something anyone writes on the sheet — this app
            computes it from the marks below. A blank for it invites a hand-written
            total that disagrees with the graded one. */}
        <div className="mt-2 text-[0.72rem]">
          Student Name:{" "}
          {studentName ? (
            <span className="inline-block w-full border-b border-black font-semibold">
              {studentName}
            </span>
          ) : (
            <span className="inline-block w-full border-b border-black" />
          )}
        </div>

        {/* (e) Student-ID QR. Sits directly under the name line because that is what
            it encodes — the two read as one identity block.

            Printed only when this sheet belongs to someone. A blank sheet has no ID to
            encode, and a QR holding an empty payload is just a landmark the decoder
            then has to explain away.

            Rendered in ordinary flow rather than absolutely positioned like the answer
            bubbles: it belongs to the header, and `QR_BLOCK_HEIGHT` is what reserves
            room for it. The SVG arrives pre-rendered from the caller because the
            generator is async and this render is not.

            `dangerouslySetInnerHTML` is safe here: the SVG is produced by the `qrcode`
            library from a payload this app built, never from user markup. */}
        {exam.includeStudentId && qrSvg && (
          <div className="mt-2">
            <p
              className="text-[0.6rem] uppercase tracking-wider"
              style={{ height: percent(QR_CAPTION_HEIGHT) }}
            >
              Student ID
            </p>
            {/* `[&>svg]:w-full` is load-bearing, not decoration.

                Sizing only this wrapper is not enough: an SVG carries its own
                intrinsic width, and `qrcode` emits one. The adapter strips those
                attributes and this makes the element fill the box, so the two halves
                have to stay in step — if a future change restores a width on the SVG,
                this rule is what keeps the printed size correct. `aspect-square`
                holds it square without depending on the page ratio. */}
            <div
              className="mt-0.5 aspect-square border border-black p-[0.1rem] [&>svg]:h-full [&>svg]:w-full"
              style={{ width: percent(QR_SIZE) }}
              aria-label={`Student ID ${studentIdentifier ?? ""}`}
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
          </div>
        )}

        {/* (c) Professor. */}
        {exam.includeProfessor && (
          <p className="mt-1.5 text-[0.72rem]">
            Professor: <span className="font-semibold">{exam.professorName || "—"}</span>
          </p>
        )}

        {/* (b) Signature. */}
        {exam.includeSignature && (
          <div className="mt-2 flex items-end gap-3 text-[0.72rem]">
            <span className="flex-1">
              Signature: <span className="inline-block w-full border-b border-black" />
            </span>
          </div>
        )}

        {/* (d) Declaration — a bordered block, immediately above the answers. */}
        {exam.includeDeclaration && exam.declarationText.trim() !== "" && (
          <div className="mt-2 border border-black px-2 py-1 text-[0.64rem] leading-snug">
            {exam.declarationText}
          </div>
        )}

        {/* Inset to clear the anchor bars.

            The bars start at `gridTop - ANCHOR_OVERHANG` (0.02) while the divider sits
            only `DIVIDER_HEIGHT / 2` (0.011) above the grid — so the bars reach into
            this line's band, and a full-width instruction printed with the left bar
            struck through its first character. The overhang is what makes the bars the
            tallest vertical runs on the sheet, which is how the detector finds them at
            an angle, so the text is what moves. */}
        <p
          className="mt-1.5 text-[0.64rem] italic"
          style={{
            marginLeft: percent(INSTRUCTION_INSET),
            marginRight: percent(INSTRUCTION_INSET),
          }}
        >
          Fill the oval for your answer completely. One oval per question.
        </p>
      </div>

      {/* ── Divider between the header and the answer section ───────────────── */}
      <div
        aria-hidden
        className="absolute border-t-2 border-black"
        style={{
          left: percent(0.04),
          right: percent(0.04),
          top: percent(grid.top - DIVIDER_HEIGHT / 2),
        }}
      />

      {/* ── Registration corners ───────────────────────────────────────────── */}

      {/* Three L-shaped marks at FIXED page positions — the sheet's coordinate
          reference. The anchor bars beside the answer grid are not one: where they sit
          depends on how tall the header turned out, and the header's height is
          estimated rather than measured, which on a real sheet put the scale 23% out
          and drifted every row further off the further down the page it was.

          Drawn with borders, never backgrounds: `.print-sheet *` is forced to
          `background: #fff !important`, so a background-filled mark prints blank. */}
      {layout.corners.map((corner) => (
        <div
          key={corner.id}
          aria-hidden
          // A solid black SQUARE in each corner of the margin — four of them, which is
          // what a full perspective correction needs (four point correspondences) and
          // what survives one corner being smudged or cropped.
          //
          // Drawn as a thick border rather than a background: `.print-sheet *` is
          // forced to `background: #fff`, so a background-filled square prints blank.
          // A border box of zero size with all four sides coloured renders solid.
          // A thick LEFT border spanning the box's full height, which paints a solid
          // filled rectangle — the same construction the anchor bars and timing ticks
          // use, and those are the two things on this sheet that have always printed.
          //
          // The border width is a fixed `pt`, never a percentage: `border-width` does
          // not accept percentages, so a percentage resolves to zero and the mark
          // renders as nothing. That is exactly why the fiducials were missing from
          // the first printed preview, and it is the second time the same mistake has
          // been made here.
          //
          // `border` rather than `background` because `.print-sheet *` is forced to
          // `background: #fff`, so a background-filled square prints blank.
          className="absolute border-l-[22pt] border-black"
          style={{
            left: percent(corner.dirX === 1 ? corner.x : corner.x - corner.legX),
            top: percent(corner.dirY === 1 ? corner.y : corner.y - corner.legY),
            height: percent(corner.legY),
          }}
        />
      ))}

      {/* ── Answer section ─────────────────────────────────────────────────── */}

      {/* Alternating bands of five rows, so a reader filling in #14 cannot easily
          land on #13's line. Banded BY ROW rather than by choice column: mis-rowing is
          the error a dense sheet actually produces, and a row band reads cleanly
          across however many columns the layout chose.

          A tint, not a fill — `print-color-adjust` is not set, so this is drawn as a
          very light border wash that survives the print rule. The detector is
          unaffected either way: it scores a bubble against the MEDIAN of its own row,
          so a band that lifts every bubble in the row equally cancels out. */}
      {layout.rows
        .filter((row) => Math.floor((row.questionNumber - 1) / 5) % 2 === 1)
        .map((row) => (
          <div
            key={`band-${row.questionNumber}`}
            aria-hidden
            className="absolute bg-black/[0.055] print:bg-transparent print:border-y print:border-black/20"
            style={{
              left: percent(row.cellLeft),
              top: percent(row.y - layout.rowPitch / 2),
              width: percent(row.cellRight - row.cellLeft),
              height: percent(layout.rowPitch),
            }}
          />
        ))}

      {/* The two anchor bars, left and right of the grid. Solid, so the detector can
          find the answer area's vertical extent and skew from the sheet itself rather
          than trusting where the page landed in a photograph. */}
      {layout.anchors.map((anchor, index) => (
        <div
          key={index}
          aria-hidden
          // Drawn as a thick LEFT BORDER, not a `bg-black` block: the print rule in
          // globals.css forces `background: #fff !important` on everything inside a
          // `.print-sheet`, so a background-filled bar is invisible on paper. A
          // border is a color rather than a background, so it survives.
          //
          // **This is the bug that printed sheets with no anchors at all**, which the
          // detector then could not locate the grid from — it fell back to mapping the
          // layout onto the whole image and sampled nowhere near the bubbles. If a
          // scan reads as gibberish, check the printed sheet for these two bars first.
          //
          // The width is given both as a `pt` border AND as an inline `width`, rather
          // than relying on the border alone. `border-left-width` does not accept a
          // percentage, so the bar's thickness cannot come from the layout fraction;
          // and a zero-width element carrying only a border is exactly the kind of
          // thing a print engine is entitled to collapse. Belt and braces on an
          // element the whole grading step depends on.
          className="absolute border-l-[6pt] border-black"
          style={{
            left: percent(anchor.x - anchor.width / 2),
            top: percent(anchor.top),
            height: percent(anchor.bottom - anchor.top),
            width: percent(anchor.width),
          }}
        />
      ))}

      {/* The grid's outer border. */}
      <div
        aria-hidden
        className="absolute border-[1.5px] border-black"
        style={{
          left: percent(layout.columns[0].left),
          top: percent(grid.top),
          width: percent(
            layout.columns[layout.columns.length - 1].right - layout.columns[0].left,
          ),
          height: percent(grid.bottom - grid.top),
        }}
      />

      {/* Vertical rules: between columns, and between each column's number cell and
          its bubbles — the "full grid lines" of a ruled answer table. */}
      {layout.columns.map((column) => {
        const labelRight = column.left + (column.right - column.left) * 0.22;
        return (
          <div key={column.index}>
            {column.index > 0 && (
              <div
                aria-hidden
                className="absolute border-l-[1.5px] border-black"
                style={{
                  left: percent(column.left),
                  top: percent(grid.top),
                  height: percent(grid.bottom - grid.top),
                }}
              />
            )}
            <div
              aria-hidden
              className="absolute border-l border-black"
              style={{
                left: percent(labelRight),
                top: percent(grid.top),
                height: percent(
                  Math.min(grid.bottom, grid.top + layout.rowPitch * column.rowCount) -
                    grid.top,
                ),
              }}
            />
          </div>
        );
      })}

      {/* Vertical dividers BETWEEN the choices, so A | B | C | D | E read as separate
          cells rather than a row of circles someone can slip across. Drawn at the
          midpoint between neighbouring bubbles, which `buildSheetLayout` already
          spaces evenly, so they cannot drift out of step with the circles. */}
      {layout.rows
        .filter((row) => row.row === 0)
        .flatMap((row) => {
          const column = layout.columns[row.column];
          const height =
            Math.min(grid.bottom, grid.top + layout.rowPitch * column.rowCount) - grid.top;

          // The midpoint rules between neighbouring choices, plus one at the left edge
          // of the choice area.
          //
          // That first rule closes the question-number cell. Without it the leftmost
          // divider was the one between A and B, so the number and A shared a single
          // segment 2.4x the width of every other choice — the bubbles were evenly
          // spaced, but the row did not read that way, and a mark placed in the empty
          // space beside the number had no cell boundary telling a student it was not
          // an answer.
          const positions = [
            row.bubblesLeft,
            ...row.bubbles.slice(1).map((bubble, index) => (row.bubbles[index].x + bubble.x) / 2),
          ];

          return positions.map((left, index) => (
            <div
              key={`divider-${row.column}-${index}`}
              aria-hidden
              className="absolute border-l border-black/25"
              style={{
                left: percent(left),
                top: percent(grid.top),
                height: percent(height),
              }}
            />
          ));
        })}

      {/* Per-row timing ticks: one short solid mark in the gutter, level with each
          row. These let the grader FIND a row rather than compute where it should be.

          Row positions otherwise come from a pitch fitted to the table's own rules,
          which works but is fragile — the table's heavier top border reads as two
          rules, and a rule lost to a crease shifts the fit. A tick is an isolated mark
          in empty margin with nothing nearby to confuse it.

          Solid ink, drawn as a thick left border so it survives the print rule that
          forces `background: #fff` inside a print sheet. */}
      {layout.rows.map((row) => (
        <div
          key={`tick-${row.questionNumber}`}
          aria-hidden
          className="absolute border-l-[4pt] border-black"
          style={{
            left: percent(row.tick.x),
            top: percent(row.tick.y - row.tick.height / 2),
            height: percent(row.tick.height),
          }}
        />
      ))}

      {/* Horizontal rules under every row. */}
      {layout.rows.map((row) => (
        <div
          key={`rule-${row.questionNumber}`}
          aria-hidden
          className="absolute border-t border-black"
          style={{
            left: percent(row.cellLeft),
            top: percent(row.y + layout.rowPitch / 2),
            width: percent(row.cellRight - row.cellLeft),
          }}
        />
      ))}

      {/* Question numbers and their bubbles. */}
      {layout.rows.map((row) => (
        <div key={row.questionNumber}>
          <div
            className="absolute -translate-y-1/2 font-bold tabular-nums"
            style={{
              left: percent(row.cellLeft + 0.008),
              top: percent(row.y),
              fontSize: `${Math.min(0.72, layout.rowPitch * 26)}rem`,
            }}
          >
            #{row.questionNumber}
          </div>

          {row.bubbles.map((bubble) => (
            <div
              key={bubble.choice}
              // A PALE border and a PALE letter, deliberately.
              //
              // The detector scores a bubble against the median of its row, so every
              // bit of ink the printing itself puts inside the sampling window raises
              // the floor a real mark has to clear. Measured on a black-outlined
              // circle, the printed ring and letter contributed about 0.16 of the 0.20
              // an EMPTY bubble read — most of the baseline was the bubble's own ink.
              //
              // At #CCCCCC the border sits at darkness 0.20, under the 0.5 threshold
              // that counts as ink, so it is invisible to the detector while staying
              // perfectly clear to a reader. The empty baseline drops toward
              // paper-white and a filled mark stands further out.
              //
              // The same grey must NOT be used for anything the detector has to FIND —
              // the row rules, timing ticks, anchor bars and fiducials all stay black.
              className="absolute flex items-center justify-center border leading-none"
              style={{
                left: percent(bubble.x),
                top: percent(bubble.y),
                width: percent(bubbleWidth),
                height: percent(bubbleHeight),
                transform: "translate(-50%, -50%)",
                fontSize: `${Math.min(0.5, layout.rowPitch * 18)}rem`,
                // A pill: fully rounded ends on a wider-than-tall box.
                borderRadius: "9999px",
                borderColor: "#CCCCCC",
                color: "#CCCCCC",
              }}
            >
              {bubble.choice}
            </div>
          ))}
        </div>
      ))}

      {/* Footer: which sheet this is, so a scattered stack can be reassembled, and
          the exam id on every sheet for the grader. */}
      {/* No footer. It carried the exam id and "Sheet N of M", but it sat in the same
          band as the bottom fiducials and printed underneath them — and the squares are
          the detector's coordinate reference, so they are not the thing that moves.
          Each sheet already names its student, which is what a scattered stack is
          actually sorted by. */}
    </div>
  );
}

/**
 * The blank sheets, ready to print.
 *
 * With option (a) on, `studentNames` drives the run: one sheet per enrolled student,
 * each already named. Otherwise `copies` blank sheets are emitted.
 *
 * All of them inside ONE `.print-sheet` — see the note at the top of this file.
 */
export function ExamAnswerSheet({
  exam,
  copies,
  students,
  qrSvgByIdentifier,
}: {
  exam: AnswerSheetExam;
  copies: number;
  /**
   * Used when `exam.printStudentNames` is set. One sheet per student.
   *
   * Carries the identifier as well as the name so the sheet can carry a QR — names
   * alone would print an identified sheet the grader cannot match back to a roster.
   */
  students?: { name: string; studentIdentifier: string }[];
  /**
   * Each student's ID rendered as a QR, keyed by identifier.
   *
   * Pre-rendered by the caller because generating one is async and this render is
   * not. A missing entry simply prints no code, which is what an unidentified sheet
   * should look like.
   */
  qrSvgByIdentifier?: Record<string, string>;
}) {
  const grid = headerHeight(exam);
  const layout = buildSheetLayout(exam.questionCount, exam.choiceSet, grid);

  const named =
    exam.printStudentNames && students && students.length > 0 ? students : undefined;
  const total = named ? named.length : Math.max(1, Math.floor(copies));

  return (
    <div className="print-sheet flex flex-col gap-6 print:gap-0">
      {Array.from({ length: total }, (_, index) => (
        <SheetPageView
          key={index}
          exam={exam}
          layout={layout}
          studentName={named?.[index]?.name}
          studentIdentifier={named?.[index]?.studentIdentifier}
          qrSvg={
            named?.[index]
              ? qrSvgByIdentifier?.[named[index].studentIdentifier]
              : undefined
          }
          copyNumber={index + 1}
          totalCopies={total}
          isLast={index === total - 1}
        />
      ))}
    </div>
  );
}
