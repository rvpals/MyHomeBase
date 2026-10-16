import { choiceLetters, type ChoiceSet } from "./types";

/**
 * How a blank answer sheet is laid out.
 *
 * Pure arithmetic, and deliberately the **one** source of truth for where a bubble
 * sits: the printed sheet renders from this, and the mark detector will sample from
 * it. If the printer and the grader each computed positions, they would disagree the
 * first time either changed — and the failure would look like bad detection rather
 * than a layout bug.
 *
 * ## One page, always
 *
 * A sheet is graded by photographing it, so it must be **one page**: a second page
 * means a second photo, a second registration solve, and a way for half an exam to go
 * missing. Rather than paginating, the layout picks however many columns it takes to
 * fit the questions in the available height, and shrinks the row pitch within a fixed
 * floor. Past what even that can hold, `fitsOnePage` reports false so the caller can
 * say so instead of printing something unusable.
 *
 * Positions are in **sheet-relative fractions** (0..1 of the printable box), not
 * pixels or millimetres. The renderer multiplies by whatever it draws into, and the
 * detector multiplies by the photographed page's registration box. Neither has to
 * know the other's units.
 */

/** Columns the layout may use. More columns means narrower cells, so this is capped. */
export const MAX_COLUMNS = 2;

/**
 * The bubble's printed size, as fractions of each page axis.
 *
 * An OVAL, wider than it is tall, as Scantron uses: a wide oval is filled by one short
 * pen stroke across its middle, where a circle invites a scribble that leaves the
 * edges pale. Fewer partial fills means fewer answers flagged for a human to re-check.
 *
 * The two numbers are percentages of DIFFERENT axes, so they are not a ratio on their
 * own: on a 1:1.294 page, 0.0179 of the height is 0.0232 of the width, which makes the
 * oval 1.3x as wide as it is tall.
 *
 * Here rather than in the renderer because the DETECTOR needs the same figure to size
 * its sampling window. The two reading different constants is exactly how a printer
 * and a reader drift apart.
 */
export const BUBBLE_WIDTH = 0.032;
export const BUBBLE_HEIGHT = 0.0148;

/**
 * The bubble's printed size for a given layout.
 *
 * Shrinks on a crowded sheet. `BUBBLE_WIDTH` suits a single column, where there is
 * room for a generous oval; the same oval across two columns of five choices leaves
 * about 1px between neighbours, which both looks cramped and lets the sampler bleed
 * into the bubble next door.
 *
 * Scaled to keep a clear gap of at least the sampling window either side, so the
 * compact grouping stays safe at any density. The DETECTOR calls this too, which is
 * what keeps the printed size and the sampled size from drifting apart.
 */
export function bubbleSizeFor(layout: {
  rows: { bubbles: { x: number }[] }[];
}): { width: number; height: number } {
  const row = layout.rows[0];
  if (!row || row.bubbles.length < 2) {
    return { width: BUBBLE_WIDTH, height: BUBBLE_HEIGHT };
  }
  const gap = row.bubbles[1].x - row.bubbles[0].x;
  // The sampler reads a box 0.6x the bubble, so a bubble plus that much clear space
  // either side must fit the gap.
  // Bubble + 0.6x bubble of clear space either side must fit: w + 1.2w <= gap.
  const maxWidth = gap / 2.2;
  const width = Math.min(BUBBLE_WIDTH, maxWidth);
  return { width, height: (width / BUBBLE_WIDTH) * BUBBLE_HEIGHT };
}

/**
 * The most questions one printed sheet carries.
 *
 * A hard cap, not a consequence of the geometry. More than this fits on paper — five
 * columns at the tightest pitch would hold well over a hundred — but the DETECTOR
 * becomes unreliable past roughly forty: the timing-tick search picks up the anchor
 * bars' ends as well as the ticks, and the filter meant to tell them apart starts
 * choosing wrong. It then grades confidently off a misaligned row, which is the worst
 * failure this module has, because nothing about the result looks suspect.
 *
 * Measured: 30 questions across two columns read 30/30; 45 across two read 35/45 while
 * still reporting that it had found its ticks.
 *
 * So an exam longer than this is split across sheets (see `paginateQuestions`). Each
 * sheet is complete in itself — its own corner marks, anchor bars, ticks and full
 * rows — rather than a continuation that trails off mid-table.
 */
export const MAX_QUESTIONS_PER_SHEET = 30;

/**
 * Splits an exam into per-sheet question ranges.
 *
 * Returns one entry per sheet, each `{ firstQuestion, lastQuestion }`. A 75-question
 * exam becomes three sheets of 30, 30 and 15 — never a part-row or a clipped table,
 * because each sheet is laid out from scratch for the questions it carries.
 */
export function paginateQuestions(
  questionCount: number,
): { firstQuestion: number; lastQuestion: number }[] {
  const total = Math.max(1, Math.floor(questionCount));
  const sheets: { firstQuestion: number; lastQuestion: number }[] = [];
  for (let first = 1; first <= total; first += MAX_QUESTIONS_PER_SHEET) {
    sheets.push({
      firstQuestion: first,
      lastQuestion: Math.min(total, first + MAX_QUESTIONS_PER_SHEET - 1),
    });
  }
  return sheets;
}

/**
 * The tightest row pitch, as a fraction of page height.
 *
 * Below this a printed row is too cramped to shade reliably, and the detector's
 * sampling window starts catching the neighbouring row. 2.2% of a Letter page is
 * about 6mm, which comfortably holds a 2.6%-of-width bubble.
 */
export const MIN_ROW_PITCH = 0.022;

/** The roomiest row pitch. Anything looser just wastes paper on a short exam. */
export const MAX_ROW_PITCH = 0.034;

/** One bubble: which question, which choice, and where its centre is. */
export interface BubblePosition {
  questionNumber: number;
  /** The choice letter this bubble stands for. */
  choice: string;
  /** Centre, as a fraction of the printable width (0..1). */
  x: number;
  /** Centre, as a fraction of the printable height (0..1). */
  y: number;
}

/** One question's row on the sheet. */
export interface QuestionRow {
  questionNumber: number;
  /** Which column it sits in, 0-based. */
  column: number;
  /** Which row within that column, 0-based. */
  row: number;
  /** The row's vertical centre, as a fraction of page height. */
  y: number;
  /** Left and right edges of this row's cell, for the table's grid lines. */
  cellLeft: number;
  cellRight: number;
  /**
   * Where the choice cells begin: the right edge of the question-number cell.
   *
   * Exposed so the sheet can rule a line here. Without it the leftmost divider was
   * the one between A and B, which fused the number cell and A into one segment 2.4x
   * the width of every other choice -- the five choices were evenly spaced, but the
   * row did not read that way.
   */
  bubblesLeft: number;
  /**
   * The row's timing tick: a short solid mark in the margin, level with the row.
   *
   * This is what lets a reader FIND each row instead of computing it. Row positions
   * otherwise come from a pitch fitted to the table's own rules, which is accurate
   * but fragile — a rule doubled at the table's heavy top border, or one lost to a
   * crease, and the fit shifts. A tick is an isolated mark in empty margin with
   * nothing nearby to confuse it.
   */
  tick: { x: number; y: number; width: number; height: number };
  bubbles: BubblePosition[];
}

/** One column of questions, for drawing the table's vertical rules. */
export interface SheetColumn {
  index: number;
  left: number;
  right: number;
  firstQuestion: number;
  lastQuestion: number;
  rowCount: number;
}

/** A blank answer sheet for one exam — always a single page. */
/**
 * One L-shaped registration mark: a corner, with a horizontal and a vertical leg.
 *
 * `x`/`y` is the corner POINT itself — the thing the detector solves for. The mark is
 * a SOLID RIGHT TRIANGLE with its right angle at that point, the shape commercial OMR
 * forms use.
 *
 * Solid rather than the two thin strokes of an L: a triangle of the same footprint
 * carries about twice the ink (820px against 400px at the size printed here), and a
 * centroid computed over twice the pixels is correspondingly steadier against scan
 * noise, a faint print or a dim phone photograph. The detector finds these by centre
 * of mass, so ink is signal.
 *
 * `legX`/`legY` are the triangle's two perpendicular sides, and `dirX`/`dirY` say
 * which way they run from the right angle.
 */
export interface CornerMark {
  id: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  x: number;
  y: number;
  /** Leg length along each axis, as a fraction of the respective page dimension. */
  legX: number;
  legY: number;
  /** +1 means the leg runs right/down from the corner; -1 means left/up. */
  dirX: 1 | -1;
  dirY: 1 | -1;
}

export interface SheetLayout {
  questionCount: number;
  choiceSet: ChoiceSet;
  choices: string[];
  /** How many columns the questions were split across. */
  columnCount: number;
  /** Questions in each column. The last column may hold fewer. */
  rowsPerColumn: number;
  /** The chosen vertical pitch, as a fraction of page height. */
  rowPitch: number;
  rows: QuestionRow[];
  columns: SheetColumn[];
  /** The answer grid's box, so the renderer can rule its outer border. */
  grid: { top: number; bottom: number; left: number; right: number };
  /**
   * False when the questions cannot fit one page even at the tightest pitch and the
   * most columns. The caller should refuse to print rather than emit a cut-off sheet.
   */
  fitsOnePage: boolean;
  /**
   * The two anchor bars, left and right of the answer grid.
   *
   * Printed solid so the detector can find the grid's vertical extent and its skew
   * from the page itself rather than trusting where it landed in a photograph. These
   * flank the answers specifically — unlike page-corner marks, they move with the
   * grid when the header grows.
   */
  anchors: { x: number; top: number; bottom: number; width: number }[];
  /**
   * The three L-shaped corner marks.
   *
   * These are the sheet's real coordinate reference, and they exist because the
   * anchor bars are not one. A bar flanks the ANSWER GRID, so where it sits depends
   * on how tall the header turned out — and the header's height is estimated from
   * which options are switched on, never measured. On a real sheet that estimate was
   * off by enough that the bars measured 535px where the layout predicted 692px, a
   * 23% scale error, and every row drifted further out the further down the page it
   * was.
   *
   * A corner mark sits at a FIXED page position. Nothing about it depends on the
   * header, the declaration's length, the ID grid or the question count, so the
   * distance between two of them is the page's true scale — measured, not inferred.
   *
   * Three rather than four: that is the minimum that gives scale and rotation on both
   * axes, and the asymmetry (no bottom-right) tells the detector which way up the page
   * is, so a sheet fed in rotated is detectable rather than silently misread. A fourth
   * would allow full perspective correction for a phone photograph, which is the
   * natural next step rather than something needed now.
   */
  corners: CornerMark[];
}

/**
 * How many digit columns the student-ID grid holds.
 *
 * Five covers every school ID I have seen without eating the header. An ID longer
 * than this is truncated to its **last** five digits rather than its first: the tail
 * is the part that distinguishes students within one institution, where a shared
 * prefix (a year, a campus code) usually is not.
 */
export const ID_DIGIT_COLUMNS = 5;

/** Digits 0-9, one row each. */
export const ID_DIGIT_ROWS = 10;

/** One bubble in the student-ID grid. */
export interface IdBubblePosition {
  /** 0-based column, left to right — the digit's place in the ID. */
  column: number;
  /** The digit this bubble stands for, 0-9. */
  digit: number;
  x: number;
  y: number;
}

/** The student-ID grid's geometry, when the exam prints one. */
export interface IdGridLayout {
  columns: number;
  bubbles: IdBubblePosition[];
  /** The box, for ruling a border and labelling it. */
  box: { left: number; top: number; right: number; bottom: number };
}

/** Width-to-height ratio of US Letter, the only page this prints to. */
export const PAGE_ASPECT = 8.5 / 11;

/**
 * The QR code side, as a fraction of page WIDTH.
 *
 * 0.06 of an 8.5in page is about 0.5in, which at 300dpi is 153px. For a 21x21-module
 * code that is roughly 7px per module, comfortably above the 3-4 jsQR needs even after
 * a phone photo blurs it.
 *
 * Measured floor is 0.05: at 0.045 it fails under heavy blur plus 3 degrees of tilt,
 * on every ID length tested (all 21x21 modules, so length does not matter here). 0.06
 * is one clear step above that floor. The bubble grid this replaced cost 0.155.
 */
export const QR_SIZE = 0.06;

/** Left edge of the QR block, matching the ID grid it replaced. */
export const QR_LEFT = 0.06;

/**
 * The QR height as a fraction of page HEIGHT.
 *
 * A square drawn from a width fraction is NOT square unless converted: the page is
 * 8.5:11, so 0.105 of the width is 0.081 of the height -- MULTIPLY by the ratio to
 * convert. Dividing makes it TALLER, which is the same trap the corner fiducials fell
 * into, where 0.045 x 0.028 was read as a square and printed 23.5pt x 19.6pt.
 */
export function qrHeightFraction(aspectRatio = PAGE_ASPECT): number {
  return QR_SIZE * aspectRatio;
}

/** Where the QR sits, in page fractions. Square on paper. */
export interface QrLayout {
  box: { left: number; top: number; right: number; bottom: number };
}

/**
 * The QR block geometry -- the single source of truth for printer AND decoder,
 * exactly as `buildSheetLayout` is for the answer grid.
 *
 * The decoder crops to this box before handing pixels to jsQR rather than scanning the
 * whole page: a full-page scan also sees the answer grid corner fiducials, which are
 * solid black squares and read as candidate finder patterns.
 */
export function buildQrLayout(top: number, left = QR_LEFT): QrLayout {
  return {
    box: {
      left,
      top,
      right: left + QR_SIZE,
      bottom: top + qrHeightFraction(),
    },
  };
}

/** The answer grid's horizontal extent within the printable box. */
export const GRID_LEFT = 0.04;
export const GRID_RIGHT = 0.96;

/**
 * Where the question number's cell ends, within one column's width.
 *
 * A number like "#30" needs a fixed amount of room, not a share of the column — so on
 * a one-column sheet, 22% of the full page width left a gulf between the number and
 * the first bubble. Capped below so a wide column does not inflate it.
 */
const LABEL_FRACTION = 0.22;
const MAX_LABEL_WIDTH = 0.07;

/**
 * How much of the remaining cell width the bubbles actually occupy.
 *
 * Deliberately less than all of it. Spread across the full width, A and E sit far
 * apart and the eye has to travel — which is how a reader ends up marking the right
 * letter on the wrong row. Commercial sheets group the choices tightly next to their
 * question number and leave the slack as white space, and they are right: the whole
 * row reads as one unit, and the shorter the path from the number to the furthest
 * bubble, the less chance of a mis-row.
 *
 * It costs the detector nothing — the bubbles stay far wider apart than the sampling
 * window — and it buys a clearer sheet.
 */
/**
 * How much of the cell the bubbles occupy. 1 means the full width.
 *
 * A FIXED pitch was tried here and reverted. It made the A..E spacing identical on
 * every sheet, which is better for a reader — but the pitch has to be expressed as a
 * fraction of the page, and the bubbles then sit at different RELATIVE positions on
 * pages of different pixel widths. The detector maps by fraction, so a sheet rendered
 * at one size and sampled at another no longer agrees: column A read 0.00 (pure white)
 * while E read correctly.
 *
 * Making this work needs the pitch expressed relative to the COLUMN rather than the
 * page, so it is scale-free like everything else here. Worth doing; not a one-line
 * change.
 */
const BUBBLE_SPREAD = 1;

/**
 * How far each anchor bar extends beyond the answer grid, top and bottom.
 *
 * Non-zero so a bar is always taller than the grid border beside it — see the comment
 * on `anchors` below for what happened when they matched exactly.
 */
const ANCHOR_OVERHANG = 0.02;

/**
 * Where the corner marks' corners sit, as fractions of the page.
 *
 * Inset from the paper edge far enough to survive a scanner cropping a millimetre or
 * two, and clear of anything the header draws.
 */
const CORNER_INSET_X = 0.05;
const CORNER_TOP_Y = 0.022;
const CORNER_BOTTOM_Y = 0.993;

/**
 * The fiducial square's side, as a fraction of each axis.
 *
 * These two numbers differ ON PURPOSE: they are fractions of different axes, and the
 * printable box is 7.24in x 9.74in, so a true square needs a larger fraction of the
 * width than of the height. 0.0422 x 0.0314 is 22pt x 22pt — about 7.8mm, easily
 * found by the detector and unobtrusive on the page.
 *
 * Fixed in PHYSICAL terms rather than scaled with the layout: the detector measures
 * these marks, and a reference that changes size with the question count is not a
 * reference. The same reasoning applies to the anchor bars and the timing ticks.
 */
const CORNER_LEG_X = 0.0422;
const CORNER_LEG_Y = 0.0314;

/**
 * How far down the page an anchor bar may reach.
 *
 * Stops short of the bottom corner mark's search area — see the comment where the
 * anchors are built.
 */
const ANCHOR_BOTTOM_LIMIT = 0.945;

/**
 * The per-row timing ticks.
 *
 * Short and solid, so a tick is unmistakable against the hairline table rules around
 * it: a detector can threshold on ink density and find exactly one tick per row.
 * Narrow enough to sit in the gutter without crowding the question number.
 */
/**
 * How far inside the column's left edge a tick sits.
 *
 * Expressed as a fraction of the QUESTION-NUMBER CELL's width, not as a fixed page
 * distance. A fixed distance that clears the anchor band on a one-column sheet lands
 * on top of the first bubble once the layout goes to three columns, because the gutter
 * shrinks with the column.
 *
 * 0.55 puts the tick just right of the question number, inside the cell that already
 * exists for it -- clear of the anchor-bar search band (the outer sixth of the page)
 * on a single-column sheet, and clear of the bubbles on every layout. The band matters
 * because a tick is solid ink of roughly bar width, so one inside it is a second
 * candidate for `traceBar` on every row; two separate bugs this session came from the
 * anchor finder latching onto the wrong feature.
 *
 * Moving it rightward (0.68, 0.82) tightens the row and looks better, and it does NOT
 * collide with anything measurable -- but it was tried together with capping the label
 * width, and that pair broke column A on every synthetic sheet. Whether the tick alone
 * is safe is untested; it was reverted with the cap, not because it was proven guilty.
 */
const TICK_INSET_FRACTION = 0.55;
const TICK_WIDTH = 0.012;
const TICK_HEIGHT = 0.009;

/** Blank paper between the tick and the first bubble, so neither reads as the other. */
const TICK_CLEARANCE = 0.012;

/** The anchor bars' width, as a fraction of page width. */
const ANCHOR_WIDTH = 0.012;

/** How much of a column's width the anchors and their padding consume. */
const ANCHOR_GUTTER = 0.022;

/**
 * How many questions fit one column at a given pitch, in the height available.
 *
 * Floor, not round: a partial row is not a row.
 */
function rowsThatFit(availableHeight: number, pitch: number): number {
  return Math.max(1, Math.floor(availableHeight / pitch));
}

/**
 * Builds a one-page layout for an exam's blank answer sheet.
 *
 * `gridTop` is where the answer grid may start — the renderer passes whatever the
 * header actually consumed, which varies with the options (a declaration block is
 * several lines; a bare sheet is none). That is why it is a parameter rather than a
 * constant: the layout cannot know the header's height, and guessing it is what would
 * push the grid onto a second page.
 *
 * `gridBottom` defaults to just above the footer.
 */
export function buildSheetLayout(
  questionCount: number,
  choiceSet: ChoiceSet,
  gridTop = 0.2,
  gridBottom = 0.96,
  /**
   * The number the first row carries, for a sheet that continues an exam.
   *
   * Sheet 2 of a 60-question exam starts at 31, so its rows are numbered 31..60 while
   * its geometry is laid out from scratch for the 30 questions it holds. That is what
   * makes a continuation sheet a complete sheet rather than the tail of a table — it
   * gets its own columns, pitch, ticks and marks, with no part-rows anywhere.
   */
  firstQuestionNumber = 1,
): SheetLayout {
  const total = Math.max(1, Math.floor(questionCount));
  const choices = choiceLetters(choiceSet);
  const availableHeight = Math.max(0.05, gridBottom - gridTop);

  // Choose the fewest columns that fit, and the loosest pitch that fits in them.
  // Fewest columns first because a wide cell is easier to shade and to read; the
  // pitch then stretches to use the height a short exam leaves over.
  let columnCount = 1;
  let rowsPerColumn = rowsThatFit(availableHeight, MIN_ROW_PITCH);
  let fitsOnePage = false;

  for (let columns = 1; columns <= MAX_COLUMNS; columns += 1) {
    const needed = Math.ceil(total / columns);
    if (needed <= rowsThatFit(availableHeight, MIN_ROW_PITCH)) {
      columnCount = columns;
      rowsPerColumn = needed;
      fitsOnePage = true;
      break;
    }
  }

  if (!fitsOnePage) {
    // Past what one page can hold. Lay out as much as DOES fit, at the tightest pitch
    // and the most columns — the caller checks `fitsOnePage` and refuses to print, so
    // this only has to render something sane for a preview.
    //
    // `rowsPerColumn` is clamped to the height rather than set to
    // `ceil(total / MAX_COLUMNS)`: that figure is what *would* be needed, and using it
    // directly walks rows off the bottom of the page. The overflow questions are
    // simply not laid out, which is honest — they genuinely have nowhere to go.
    columnCount = MAX_COLUMNS;
    rowsPerColumn = rowsThatFit(availableHeight, MIN_ROW_PITCH);
  }

  // Spread the rows over the height available, within the pitch bounds. A 10-question
  // sheet gets roomy rows; a 90-question one gets the floor.
  const rowPitch = Math.min(
    MAX_ROW_PITCH,
    Math.max(MIN_ROW_PITCH, availableHeight / Math.max(1, rowsPerColumn)),
  );

  const gridWidth = GRID_RIGHT - GRID_LEFT;
  // The anchors flank the whole grid, so they eat into the width the columns share.
  const columnsLeft = GRID_LEFT + ANCHOR_GUTTER;
  const columnsRight = GRID_RIGHT - ANCHOR_GUTTER;
  const columnWidth = (columnsRight - columnsLeft) / columnCount;

  const rows: QuestionRow[] = [];
  const columns: SheetColumn[] = [];

  for (let column = 0; column < columnCount; column += 1) {
    const firstQuestion = column * rowsPerColumn + 1;
    const lastQuestion = Math.min(total, firstQuestion + rowsPerColumn - 1);
    const cellLeft = columnsLeft + column * columnWidth;
    const cellRight = cellLeft + columnWidth;

    columns.push({
      index: column,
      left: cellLeft,
      right: cellRight,
      // Offset like the rows, so a continuation sheet's column headings read 31..45
      // rather than 1..15.
      firstQuestion: firstQuestion + firstQuestionNumber - 1,
      lastQuestion: lastQuestion + firstQuestionNumber - 1,
      rowCount: Math.max(0, lastQuestion - firstQuestion + 1),
    });

    for (let questionNumber = firstQuestion; questionNumber <= lastQuestion; questionNumber += 1) {
      const row = questionNumber - firstQuestion;
      // The number PRINTED on the row, which differs from its index on a sheet that
      // continues an exam.
      const printedNumber = questionNumber + firstQuestionNumber - 1;
      const y = gridTop + rowPitch * (row + 0.5);

      // The bubbles start clear of the timing tick, which lives in the number cell.
      //
      // Tightening the choice spread pulled column A leftwards into the tick's space —
      // measured, the tick spanned 143..153px and the A bubble 144..169px, so the
      // tick's ink sat inside A's sampling window and every A read as blank. The
      // bubbles must begin after the tick ends, whatever the spread.
      // The number cell.
      //
      // NOT capped by MAX_LABEL_WIDTH, although that constant exists and its comment
      // promises a cap. Applying it narrows the cell from 164px to 60px on a
      // one-column sheet, which moves every bubble -- and the detector then reads
      // column A as pure white on the synthetic sheets (rowSource "projected"). The
      // projection path evidently carries its own assumption about where the bubble
      // band starts; until that is found and fixed, the cap cannot be applied.
      //
      // So the number cell stays wider than a choice cell on sparse layouts. That is
      // a cosmetic flaw guarding a correctness one.
      const bubblesLeft = cellLeft + columnWidth * LABEL_FRACTION;
      const bubblesWidth = columnWidth * (1 - LABEL_FRACTION) * BUBBLE_SPREAD;
      const choiceStep = bubblesWidth / choices.length;

      rows.push({
        questionNumber: printedNumber,
        column,
        row,
        y,
        cellLeft,
        cellRight,
        bubblesLeft,
        tick: {
          // Inside the question-number cell, to its right: past the number itself and
          // well short of the first bubble, on any column count.
          x: cellLeft + columnWidth * LABEL_FRACTION * TICK_INSET_FRACTION,
          y,
          width: TICK_WIDTH,
          height: Math.min(TICK_HEIGHT, rowPitch * 0.45),
        },
        bubbles: choices.map((choice, choiceIndex) => ({
          questionNumber: printedNumber,
          choice,
          x: bubblesLeft + choiceStep * (choiceIndex + 0.5),
          y,
        })),
      });
    }
  }

  // The grid's drawn height is whatever the fullest column actually uses, not the
  // space it was allowed — so a short exam's border hugs its rows.
  const usedRows = Math.min(rowsPerColumn, total);
  const gridDrawnBottom = gridTop + rowPitch * usedRows;

  return {
    questionCount: total,
    choiceSet,
    choices,
    columnCount,
    rowsPerColumn,
    rowPitch,
    rows,
    columns,
    grid: { top: gridTop, bottom: gridDrawnBottom, left: GRID_LEFT, right: GRID_RIGHT },
    fitsOnePage,
    corners: [
      {
        id: "top-left",
        x: CORNER_INSET_X,
        y: CORNER_TOP_Y,
        legX: CORNER_LEG_X,
        legY: CORNER_LEG_Y,
        dirX: 1,
        dirY: 1,
      },
      {
        id: "top-right",
        x: 1 - CORNER_INSET_X,
        y: CORNER_TOP_Y,
        legX: CORNER_LEG_X,
        legY: CORNER_LEG_Y,
        dirX: -1,
        dirY: 1,
      },
      {
        id: "bottom-left",
        x: CORNER_INSET_X,
        y: CORNER_BOTTOM_Y,
        legX: CORNER_LEG_X,
        legY: CORNER_LEG_Y,
        dirX: 1,
        dirY: -1,
      },
      {
        id: "bottom-right",
        x: 1 - CORNER_INSET_X,
        y: CORNER_BOTTOM_Y,
        legX: CORNER_LEG_X,
        legY: CORNER_LEG_Y,
        dirX: -1,
        dirY: -1,
      },
    ],
    // The bars deliberately OVERHANG the grid at both ends.
    //
    // They used to span it exactly — the same height as the grid's own left and right
    // border rules. The detector finds a bar by looking for the longest unbroken dark
    // column, so two objects of identical height meant the winner was decided by
    // antialiasing noise, and on a page tilted past about 1 degree the border won. The
    // detector then measured the "skew" between a bar and a border and got nonsense:
    // -4 degrees at a true 1.5, -17 at a true 3. Every row sampled wildly off.
    //
    // The overhang makes the bars unambiguously the tallest vertical runs on the
    // sheet, so the contest has a right answer at any realistic angle.
    anchors: [
      {
        x: GRID_LEFT + ANCHOR_WIDTH / 2,
        top: Math.max(0.01, gridTop - ANCHOR_OVERHANG),
        // Capped well clear of the bottom corner mark. The two must not share space:
        // the corner finder looks for an L's worth of ink in a small box, and an
        // anchor bar reaching into that box contributes several times as much, which
        // made the mark look wrong and silently dropped the sheet back to the
        // anchor-bar path the corners exist to replace.
        bottom: Math.min(ANCHOR_BOTTOM_LIMIT, gridDrawnBottom + ANCHOR_OVERHANG),
        width: ANCHOR_WIDTH,
      },
      {
        x: GRID_RIGHT - ANCHOR_WIDTH / 2,
        top: Math.max(0.01, gridTop - ANCHOR_OVERHANG),
        bottom: Math.min(ANCHOR_BOTTOM_LIMIT, gridDrawnBottom + ANCHOR_OVERHANG),
        width: ANCHOR_WIDTH,
      },
    ],
  };
}

/**
 * Lays out the student-ID bubble grid.
 *
 * Positioned from `top`, which the renderer passes as wherever the header has got to
 * — the same arrangement `buildSheetLayout` uses for `gridTop`, and for the same
 * reason: only the renderer knows how tall the blocks above it turned out.
 *
 * Shared by the printer and the detector, exactly as the answer grid is. A separate
 * function rather than part of `buildSheetLayout` because an exam may print one grid
 * without the other, and because the ID grid's shape does not depend on the exam's
 * question count or choice set at all.
 */
export function buildIdGridLayout(top: number, left = GRID_LEFT + 0.02): IdGridLayout {
  // Narrow enough to sit beside the name line rather than below it, which is what
  // keeps the ID grid from pushing the answers down a whole block.
  const columnStep = 0.032;
  const rowStep = 0.019;
  const width = columnStep * ID_DIGIT_COLUMNS;
  const height = rowStep * ID_DIGIT_ROWS;

  const bubbles: IdBubblePosition[] = [];
  for (let column = 0; column < ID_DIGIT_COLUMNS; column += 1) {
    for (let digit = 0; digit < ID_DIGIT_ROWS; digit += 1) {
      bubbles.push({
        column,
        digit,
        x: left + columnStep * (column + 0.5),
        y: top + rowStep * (digit + 0.5),
      });
    }
  }

  return {
    columns: ID_DIGIT_COLUMNS,
    bubbles,
    box: { left, top, right: left + width, bottom: top + height },
  };
}

/**
 * The digits an ID is printed as, right-aligned into the available columns.
 *
 * Non-digits are stripped first, so `"S-2019"` and `"2019"` encode identically — a
 * roster typed by hand will not be consistent about punctuation, and the grid can only
 * hold digits anyway.
 *
 * Returns one entry per column, `undefined` where the ID is shorter than the grid.
 * Right-aligned (and truncated from the left) because the tail of an ID is what
 * distinguishes students; a shared leading year or campus code usually does not.
 */
export function idDigitsFor(
  studentIdentifier: string,
  columns = ID_DIGIT_COLUMNS,
): (number | undefined)[] {
  const digits = studentIdentifier.replace(/\D/g, "");
  const tail = digits.slice(-columns);
  const padding = columns - tail.length;

  return Array.from({ length: columns }, (_, index) =>
    index < padding ? undefined : Number(tail[index - padding]),
  );
}

/**
 * The largest question count that fits one page for a given header height.
 *
 * The Exam Maker uses it to warn *before* a sheet is printed, rather than letting a
 * teacher discover the limit at the printer. Derived from the same constants the
 * layout uses, so the two cannot disagree.
 */
export function maxQuestionsOnOnePage(gridTop = 0.2, gridBottom = 0.96): number {
  const available = Math.max(0.05, gridBottom - gridTop);
  return rowsThatFit(available, MIN_ROW_PITCH) * MAX_COLUMNS;
}
