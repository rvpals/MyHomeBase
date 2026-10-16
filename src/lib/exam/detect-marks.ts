import {
  buildIdGridLayout,
  buildQrLayout,
  bubbleSizeFor,
  buildSheetLayout,
  type CornerMark,
  type SheetLayout,
} from "./sheet-layout";
import type { ChoiceSet } from "./types";

/**
 * Reading shaded bubbles off a scanned answer sheet.
 *
 * Pure arithmetic over a plain RGBA pixel array — no `sharp`, no image decoding. That
 * split is deliberate and is the same one `lib/icons` makes: decoding crosses a port
 * (`SheetImageProcessor`), while every *decision* lives here, so the interesting logic
 * is tested with a hand-built bitmap instead of a real photograph and a native module.
 *
 * ## What this can and cannot do
 *
 * It reads a **flat scan or a square-on photograph** of a sheet this app printed. It
 * finds the two anchor bars, uses them to locate the answer grid, and samples the
 * darkness inside each bubble the shared `buildSheetLayout` predicts.
 *
 * It does **not** correct perspective. A sheet photographed at an angle, badly
 * creased, or lit unevenly enough to shade one side of the page will mis-read, and
 * the confidence score is the only warning. That is why nothing here decides to save
 * a grade — the caller shows every mark for confirmation first.
 */

/** A decoded image as straight RGBA, 4 bytes per pixel. */
export interface RawBitmap {
  data: Uint8Array | Buffer;
  width: number;
  height: number;
}

/** Why a question's answer is not a plain single letter. */
export type MarkIssue = "none" | "blank" | "multiple" | "faint";

/** One question, as read off the sheet. */
export interface DetectedAnswer {
  questionNumber: number;
  /** The chosen letter, or "" when blank or unreadable. */
  choice: string;
  /**
   * 0..1. How clearly one bubble beat the others: the gap between the darkest and
   * the runner-up, scaled. A confident single mark approaches 1; two equally filled
   * bubbles approach 0.
   */
  confidence: number;
  issue: MarkIssue;
  /** Per-choice darkness, 0 (white) to 1 (black), in choice order. For the review UI. */
  darkness: number[];
}

/** What one sheet produced. */
export interface DetectionResult {
  answers: DetectedAnswer[];
  /**
   * How far the scan was turned before reading, in degrees.
   *
   * Non-zero means the sheet was fed in rotated and has been uprighted. Worth
   * surfacing: a stack that all comes back 180 says the feeder is loading upside down.
   */
  orientation: PageOrientation;
  /**
   * Where the row positions came from, strongest first.
   *
   * This is the best single predictor of whether a read is trustworthy. On a real
   * scan, switching from `projected` to `rules` took the result from 6/15 to 15/15 —
   * so a sheet that falls back to `projected` is carrying a row pitch that was 23%
   * wrong in practice, and should be reviewed rather than scored.
   */
  rowSource: "ticks" | "rules" | "projected";
  /**
   * How many of the three corner marks were located.
   *
   * 3 means the sheet was read against its own printed coordinate frame, which is the
   * accurate path. Fewer means it fell back to the anchor bars (an older sheet, or a
   * scan that cropped a corner), which works but inherits the header-estimate error.
   */
  cornersFound: number;
  /** False when the anchor bars could not be found — the read is untrustworthy. */
  anchorsFound: boolean;
  /** The grid box actually used, in pixels. Useful for drawing an overlay. */
  region: { left: number; top: number; right: number; bottom: number };
}

/**
 * How dark a bubble must be to count as shaded.
 *
 * A printed empty bubble is not white — it has a drawn outline crossing the sampling
 * window — so the floor sits well above zero. 0.35 is comfortably above a bare
 * outline's contribution and below a pencil fill.
 */
export const FILL_THRESHOLD = 0.35;

/**
 * How much darker than the row's unmarked bubbles a mark must be.
 *
 * Sits in the gap between noise and ink, and that gap is wide. Measured on a real
 * scan: a genuinely blank row's five bubbles differ by at most 0.04 (uneven paper, the
 * printed circles' own ink, JPEG grain), while a filled bubble clears its row's median
 * by 0.57 to 0.76. Anywhere from 0.06 to 0.4 would separate them.
 *
 * It was 0.04, which is exactly where blank-row noise peaks — so a deliberately empty
 * row read as `multiple`, the detector finding a winner in grain. 0.10 is clear of the
 * noise and still an order of magnitude below a real mark.
 *
 * This is an excess over the row's OWN median, so paper tone, scanner exposure and the
 * printed circle's ink are already subtracted out before the comparison.
 */
export const MARK_EXCESS = 0.1;

/**
 * Below this excess, a mark is reported `faint` even when it clearly won.
 *
 * Well above `MARK_EXCESS`, so there is a real band between "definitely a mark" and
 * "dark enough not to worry about". A solid fill on a real scan clears 0.57-0.76, so
 * anything under 0.3 is a light or partial fill worth a second look.
 */
export const FAINT_EXCESS = 0.3;

/** Below this, a mark is reported `faint` even when it is the clear winner. */
export const FAINT_THRESHOLD = 0.45;

/**
 * How close the runner-up may be before the answer is called `multiple`.
 *
 * Relative, not absolute: a heavy pencil darkens every sampled bubble a little, so the
 * question is whether one *stands out*, not whether the others are pure white.
 */
export const AMBIGUITY_RATIO = 0.75;

/** Fraction of a bubble's radius actually sampled, to stay clear of its printed ring. */
const SAMPLE_INSET = 0.6;

/** Luminance of one pixel, 0 (black) to 1 (white). */
function luminance(data: RawBitmap["data"], offset: number): number {
  // Rec. 601 weights: the eye's response, and what a scanner's grey conversion uses.
  const r = data[offset];
  const g = data[offset + 1];
  const b = data[offset + 2];
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/**
 * Mean darkness (1 - luminance) inside a circle, in pixel coordinates.
 *
 * Sampled over the inscribed box rather than a true circle: the difference is a few
 * corner pixels of white, which shifts every bubble equally and so cannot change which
 * one wins. Much cheaper, and this runs per bubble per sheet.
 */
export function sampleDarkness(
  bitmap: RawBitmap,
  centerX: number,
  centerY: number,
  radius: number,
): number {
  const r = Math.max(1, Math.floor(radius * SAMPLE_INSET));
  const left = Math.max(0, Math.floor(centerX) - r);
  const right = Math.min(bitmap.width - 1, Math.floor(centerX) + r);
  const top = Math.max(0, Math.floor(centerY) - r);
  const bottom = Math.min(bitmap.height - 1, Math.floor(centerY) + r);

  if (right < left || bottom < top) return 0;

  let total = 0;
  let count = 0;
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      total += 1 - luminance(bitmap.data, (y * bitmap.width + x) * 4);
      count += 1;
    }
  }

  return count === 0 ? 0 : total / count;
}

/**
 * Finds the two anchor bars by looking for the darkest columns near each edge.
 *
 * The bars are solid black and span the answer grid, so the column of pixels through
 * one is far darker than any column of ruled table. Searching only the outer third of
 * each side keeps a dense block of answers from being mistaken for an anchor.
 *
 * Returns undefined when neither side has a column dark enough to be a bar, which is
 * what `anchorsFound: false` reports — a page photographed so badly that the grid
 * cannot be located is better refused than guessed at.
 */
export interface AnchorBars {
  leftX: number;
  rightX: number;
  /** The LEFT bar's vertical extent. */
  leftTop: number;
  leftBottom: number;
  /** The RIGHT bar's vertical extent — different from the left when the page is tilted. */
  rightTop: number;
  rightBottom: number;
  /** Mean of the two, for callers that only need one number. */
  top: number;
  bottom: number;
}

export function findAnchors(bitmap: RawBitmap, layout: SheetLayout): AnchorBars | undefined {
  const { width, height } = bitmap;
  if (width < 8 || height < 8) return undefined;

  /**
   * Finds one anchor bar by tracking its CENTRE across rows, not by looking for an
   * unbroken dark column.
   *
   * The column approach fails on a tilted page for a geometric reason, not a
   * threshold one: a bar is only a couple of millimetres wide, so as the page rotates
   * the bar steps sideways between pixel columns and no single column holds it end to
   * end any more. Its longest run collapses — measured on a 770px bar, 770px at 1
   * degree but 573px at 1.5 and 430px at 2 — and the detector either loses the bar or
   * locks onto a fragment, which is what made every row sample wildly off past about
   * 1.1 degrees. (That figure is not a coincidence: a 1.2%-wide bar 770px tall stays
   * inside one column for exactly atan(15/770) = 1.11 degrees.)
   *
   * Scanning each row for the darkest span in the search band, then keeping the rows
   * that found one, tracks the bar wherever it has drifted to. The bar's tilt then
   * falls out of comparing its centre at the top with its centre at the bottom.
   */
  const traceBar = (from: number, to: number) => {
    const centres: { y: number; x: number }[] = [];

    for (let y = 0; y < height; y += 1) {
      let darkFrom = -1;
      let best = { from: -1, to: -1, length: 0 };
      for (let x = from; x < to; x += 1) {
        const dark = 1 - luminance(bitmap.data, (y * width + x) * 4) > 0.5;
        if (dark) {
          if (darkFrom === -1) darkFrom = x;
        } else if (darkFrom !== -1) {
          const length = x - darkFrom;
          if (length > best.length) best = { from: darkFrom, to: x, length };
          darkFrom = -1;
        }
      }
      if (darkFrom !== -1) {
        const length = to - darkFrom;
        if (length > best.length) best = { from: darkFrom, to, length };
      }

      // A bar is a solid run several pixels across — and NO WIDER. Both bounds matter:
      //
      //  - the floor (3px) keeps out ruled lines crossing the band edge-on and the
      //    antialiased rim of a bubble;
      //  - the ceiling keeps out the table's own rules, which run horizontally and so
      //    present a span far wider than a bar. On a real scan the bar measured 13-14px
      //    while the question-number cell's rule measured 52px on the rows where it
      //    fell inside the band; taking "the longest span" there followed the rule and
      //    put the anchor at x=426 instead of x=152, which read almost every answer as
      //    blank because the sampling landed off the printed area entirely.
      const maxBarWidth = Math.max(6, Math.round(width * 0.035));
      if (best.length >= 3 && best.length <= maxBarWidth) {
        centres.push({ y, x: (best.from + best.to) / 2 });
      }
    }

    if (centres.length < Math.max(8, Math.round(height * 0.05))) return undefined;

    // The stretch of rows the bar occupies, tolerating SMALL gaps.
    //
    // Strict contiguity was too brittle on a real scan: a row where the table's own
    // rule happened to be the widest thing in the band contributes no centre, and on
    // one real sheet 58 such rows out of 560 punched the bar's 480 good rows into
    // fragments too short to qualify — so the anchors were reported missing even
    // though the bar had been tracked correctly. A bar is continuous ink; a few
    // skipped rows are measurement noise, not the end of it.
    const maxGap = Math.max(4, Math.round(height * 0.01));
    let bestRun = { start: 0, end: 0 };
    let runStart = 0;
    for (let index = 1; index <= centres.length; index += 1) {
      const broken =
        index === centres.length || centres[index].y - centres[index - 1].y > maxGap;
      if (broken) {
        if (index - runStart > bestRun.end - bestRun.start) bestRun = { start: runStart, end: index };
        runStart = index;
      }
    }

    const run = centres.slice(bestRun.start, bestRun.end);
    if (run.length < Math.max(8, Math.round(height * 0.05))) return undefined;

    // Fit a line through the tracked centres rather than trusting the endpoints.
    //
    // The run inevitably contains a few strays — rows where something else in the band
    // was the widest thing of bar-like width. Reading `topX` off the FIRST row put the
    // anchor at x=426 when the bar was at x=152, because that one row was a stray; the
    // whole sheet then graded against a grid located half a page away.
    //
    // A least-squares fit over hundreds of rows is barely moved by a handful of
    // outliers, and it gives the bar's x at any y — which is exactly the rotation the
    // caller needs, read from the ink rather than inferred from two points.
    const n = run.length;
    const meanY = run.reduce((sum, point) => sum + point.y, 0) / n;
    const meanX = run.reduce((sum, point) => sum + point.x, 0) / n;
    let covariance = 0;
    let variance = 0;
    for (const point of run) {
      const dy = point.y - meanY;
      covariance += dy * (point.x - meanX);
      variance += dy * dy;
    }
    const slope = variance > 1e-6 ? covariance / variance : 0;
    const xAt = (y: number) => meanX + slope * (y - meanY);

    const top = run[0].y;
    const bottom = run[n - 1].y;
    return { top, bottom, topX: xAt(top), bottomX: xAt(bottom) };
  };

  // The search band is a SIXTH of the width, not a third.
  //
  // A third reaches well inside the answer grid, where the choice dividers run the
  // full grid height. They print at 25% ink so they sit under the dark threshold
  // today, but that is a thin margin: a heavier printer or a contrast-boosting
  // scanner would push a divider over it, and `traceBar` would follow it instead of
  // the anchor. That is the same class of failure that once put the left anchor at
  // x=426 when the bar was at x=152 and made the whole sheet read as blank.
  //
  // The bars print just inside the page edge, so a sixth is ample to contain them
  // while stopping short of the first divider on every layout the sheet produces.
  // A generous band — a QUARTER of the image from each edge.
  //
  // It cannot be derived from where the layout puts the bars, which was an earlier
  // attempt and is circular: a scan carries margins, so a page fraction does not map
  // to a pixel until the anchors have been found, and the anchors are what this
  // function exists to find. That version looked for the bar at x<=112 when the scan
  // had it at x=140, found nothing at all, and the sheet fell through to reading the
  // whole image — which happened to still grade correctly, which is worse than
  // failing, because it hides the fault.
  //
  // The timing ticks also fall inside a band this wide. They are excluded by WIDTH
  // instead: `traceBar` already rejects spans outside bar width, and a tick is thinner
  // than a bar. Where that margin is uncomfortably thin, the tick's isolation is what
  // keeps them apart — a tick has blank gutter above and below, so it never forms the
  // long contiguous run a bar does.
  const band = Math.max(1, Math.floor(width / 4));
  const left = traceBar(0, band);
  const right = traceBar(width - band, width);
  if (!left || !right) return undefined;

  // Use each bar's centre at its own top, so the two tops are directly comparable and
  // their difference is the page's tilt.
  if (right.topX <= left.topX) return undefined;

  return {
    leftX: left.topX,
    rightX: right.topX,
    leftTop: left.top,
    leftBottom: left.bottom,
    rightTop: right.top,
    rightBottom: right.bottom,
    top: (left.top + right.top) / 2,
    bottom: (left.bottom + right.bottom) / 2,
  };
}

/**
 * Finds the answer grid's printed border — the rectangle ruled around the questions.
 *
 * Used when the anchor bars are missing. Works by finding the longest dark horizontal
 * run (the grid's top or bottom rule) and the longest dark vertical run (a side), then
 * taking the bounding box of the rows and columns that are substantially dark.
 *
 * Deliberately conservative: it returns a box only when it finds one wide and tall
 * enough to plausibly BE the grid, because a wrong box silently samples the wrong
 * pixels, which reads as a sheet of blanks rather than as an error.
 */
export function findGridBox(
  bitmap: RawBitmap,
): { left: number; top: number; right: number; bottom: number } | undefined {
  const { width, height } = bitmap;
  if (width < 32 || height < 32) return undefined;

  const darkRunInRow = (y: number): number => {
    let longest = 0;
    let current = 0;
    for (let x = 0; x < width; x += 1) {
      if (1 - luminance(bitmap.data, (y * width + x) * 4) > 0.5) {
        current += 1;
        if (current > longest) longest = current;
      } else current = 0;
    }
    return longest;
  };

  const darkRunInColumn = (x: number): number => {
    let longest = 0;
    let current = 0;
    for (let y = 0; y < height; y += 1) {
      if (1 - luminance(bitmap.data, (y * width + x) * 4) > 0.5) {
        current += 1;
        if (current > longest) longest = current;
      } else current = 0;
    }
    return longest;
  };

  // A grid rule spans most of the grid's width/height. Half the image is a safe floor:
  // nothing else on an answer sheet is a continuous line that long.
  const minHorizontal = Math.floor(width * 0.5);
  const minVertical = Math.floor(height * 0.25);

  let top = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    if (darkRunInRow(y) >= minHorizontal) {
      if (top === -1) top = y;
      bottom = y;
    }
  }

  let left = -1;
  let right = -1;
  for (let x = 0; x < width; x += 1) {
    if (darkRunInColumn(x) >= minVertical) {
      if (left === -1) left = x;
      right = x;
    }
  }

  if (top === -1 || left === -1) return undefined;
  if (bottom - top < height * 0.1 || right - left < width * 0.3) return undefined;

  return { left, top, right, bottom };
}

/**
 * Finds the answer table's printed horizontal rules between the two anchor bars.
 *
 * This is how the detector stops GUESSING where the rows are.
 *
 * Every other approach here derives row positions from `gridTop`, which the caller
 * computes by adding up estimated header-block heights. That estimate cannot be right:
 * it depends on how tall a declaration wrapped, how much room the ID grid took, what
 * the fonts did. On a real sheet it put the row pitch at 41.6px where the page
 * actually printed 33.9px — a 23% error that accumulates down the page, reaching half
 * a row by question 8, so every answer below that read from the wrong line.
 *
 * The rules are already on the paper, one per row boundary. Measuring them replaces
 * the whole estimate with an observation.
 */
/**
 * Finds the per-row timing ticks — the most reliable way to locate rows.
 *
 * A tick is an isolated solid mark in the gutter beside each row, with empty paper
 * around it. That isolation is the whole point: every other way of finding rows reads
 * a feature that has neighbours to be confused with. The table's horizontal rules work
 * but need a fitted pitch, because the heavier top border reads as two rules and a
 * crease can swallow one — and a fitted pitch is an inference, which is what this
 * module keeps getting wrong.
 *
 * Searched in a narrow band around where the layout puts the ticks, mapped through the
 * anchors so a shifted or scaled scan still looks in the right place.
 *
 * Returns one y per row, or undefined if the count does not match — a partial read is
 * worse than falling back, because a missing tick silently shifts every row after it.
 */
export function findRowTicks(
  bitmap: RawBitmap,
  layout: SheetLayout,
  project: (xFraction: number, yFraction: number) => { x: number; y: number },
  column = 0,
): number[] | undefined {
  const { width, height } = bitmap;
  // Each column has its own tick gutter, so each is found independently. A
  // multi-column sheet is not a special case — it is the same search, run per column.
  const firstColumnRows = layout.rows.filter((row) => row.column === column);
  if (firstColumnRows.length === 0) return undefined;

  // The band to search, from the tick's own geometry projected onto this scan.
  //
  // Widened to cover the tick column over the WHOLE grid, not just at one y. On a
  // tilted page a vertical line of ticks leans, so a band computed at a single height
  // misses the ticks at the other end — which is the same stepping problem that
  // defeated column-scanning for the anchor bars.
  const sample = firstColumnRows[0].tick;
  const corners = [
    project(sample.x, layout.grid.top),
    project(sample.x + sample.width, layout.grid.top),
    project(sample.x, layout.grid.bottom),
    project(sample.x + sample.width, layout.grid.bottom),
  ];
  // Padded by a tick's own width on each side, not a fixed few pixels.
  //
  // The band is positioned by the same projection the ticks exist to correct, so it
  // inherits that projection's error — on a 45-question sheet it landed at x=158..185
  // when the ticks were at x=150, and found nothing. The padding has to be large
  // enough to absorb that error while staying far narrower than the gap to the first
  // bubble, which it is: a tick is ~16px wide and the nearest bubble is ~100px away.
  const tickWidthPx = Math.max(6, Math.round(sample.width * width));
  const bandFrom = Math.max(0, Math.round(Math.min(...corners.map((c) => c.x))) - tickWidthPx);
  const bandTo = Math.min(
    width - 1,
    Math.round(Math.max(...corners.map((c) => c.x))) + tickWidthPx,
  );
  if (bandTo - bandFrom < 2) return undefined;

  // Rows where the band is substantially inked. A tick fills most of the band; the
  // surrounding gutter is blank, so this is a clean signal.
  // A row counts as inked when it contains a RUN of dark pixels about as wide as a
  // tick — not when some fraction of the whole band is dark.
  //
  // The fraction test fails both ways. The band has to be wide enough to cover a
  // leaning tick column on a tilted page, and over that width one tick no longer
  // fills half of it, so almost no row registers (4 of 225 at one degree). Widen the
  // test instead and the anchor bar's ends creep in, giving 17 centres where there
  // are 15 ticks. A run of the right width is what a tick actually is.
  const expectedRun = Math.max(2, Math.round(sample.width * width * 0.6));
  const inked: number[] = [];
  for (let y = 0; y < height; y += 1) {
    let longest = 0;
    let current = 0;
    for (let x = bandFrom; x <= bandTo; x += 1) {
      if (1 - luminance(bitmap.data, (y * width + x) * 4) > 0.5) {
        current += 1;
        if (current > longest) longest = current;
      } else current = 0;
    }
    if (longest >= expectedRun) inked.push(y);
  }
  if (inked.length === 0) return undefined;

  // Collapse each run of inked rows to its centre: one centre per tick.
  const centres: number[] = [];
  let run: number[] = [inked[0]];
  for (let index = 1; index < inked.length; index += 1) {
    if (inked[index] - inked[index - 1] <= 2) run.push(inked[index]);
    else {
      centres.push(run.reduce((sum, y) => sum + y, 0) / run.length);

      run = [inked[index]];
    }
  }
  centres.push(run.reduce((sum, y) => sum + y, 0) / run.length);

  // Exactly one tick per row, or this is not a tick column at all.

  const needed = firstColumnRows.length;
  if (centres.length === needed) return centres;

  // A couple of extras are expected and recoverable. The band is wide enough to cover
  // a leaning tick column, which also lets the anchor bar's top and bottom ends in —
  // consistently two extra marks on a 15-row sheet.
  //
  // The ticks are the EVENLY SPACED run; an intruder is not. Slide a window of the
  // required length over the centres and keep the one whose gaps vary least, which
  // picks the real run without needing the band to be perfectly clean.
  if (centres.length > needed && centres.length <= needed + 4) {
    let best: { start: number; score: number } | undefined;
    for (let start = 0; start + needed <= centres.length; start += 1) {
      const window = centres.slice(start, start + needed);
      const gaps = window.slice(1).map((value, index) => value - window[index]);
      const mean = gaps.reduce((sum, gap) => sum + gap, 0) / Math.max(1, gaps.length);
      const score = gaps.reduce((sum, gap) => sum + (gap - mean) ** 2, 0);
      if (!best || score < best.score) best = { start, score };
    }
    if (best) {
      const window = centres.slice(best.start, best.start + needed);
      const gaps = window.slice(1).map((value, index) => value - window[index]);
      const mean = gaps.reduce((sum, gap) => sum + gap, 0) / Math.max(1, gaps.length);
      // Only trust it if the spacing really is even — otherwise the window is just the
      // least-bad slice of something that is not a tick column at all.
      const worst = Math.max(...gaps.map((gap) => Math.abs(gap - mean)));
      if (mean > 0 && worst < mean * 0.25) return window;
    }
  }

  return undefined;
}

export function findRowRules(
  bitmap: RawBitmap,
  anchors: AnchorBars,
): number[] {
  const { width } = bitmap;
  // Well inside the bars, so their own ink cannot register as a rule.
  const from = Math.round(anchors.leftX) + Math.round(width * 0.05);
  const to = Math.round(anchors.rightX) - Math.round(width * 0.05);
  if (to - from < 20) return [];

  const darkFraction = (y: number): number => {
    let dark = 0;
    let total = 0;
    for (let x = from; x < to; x += 2) {
      total += 1;
      if (1 - luminance(bitmap.data, (y * width + x) * 4) > 0.5) dark += 1;
    }
    return total === 0 ? 0 : dark / total;
  };

  // A rule spans the table; a row of bubbles never darkens more than a fraction of it.
  const hits: number[] = [];
  for (let y = Math.max(0, anchors.top); y <= Math.min(bitmap.height - 1, anchors.bottom); y += 1) {
    if (darkFraction(y) > 0.6) hits.push(y);
  }
  if (hits.length === 0) return [];

  // A printed rule is 1-3px thick and lands on several adjacent scan rows; collapse
  // each cluster to its centre.
  const rules: number[] = [];
  let group: number[] = [hits[0]];
  for (let index = 1; index < hits.length; index += 1) {
    if (hits[index] - hits[index - 1] <= 3) group.push(hits[index]);
    else {
      rules.push(group.reduce((sum, y) => sum + y, 0) / group.length);
      group = [hits[index]];
    }
  }
  rules.push(group.reduce((sum, y) => sum + y, 0) / group.length);

  // Drop rules too close together to be separate row boundaries.
  //
  // The table's top edge is drawn as a heavier border AND picks up the heading row's
  // own rule a few pixels below, which arrive as two "rules" 15px apart where the real
  // pitch is 34px. Keeping both shifts every row up by one — the reads then come from
  // the line above, which is exactly what the top of a real sheet showed.
  //
  // The median gap is the row pitch, and anything under half of it is a double edge
  // rather than a row.
  if (rules.length < 3) return rules;
  const gaps = rules.slice(1).map((value, index) => value - rules[index]);
  const sortedGaps = [...gaps].sort((a, b) => a - b);
  const medianGap = sortedGaps[Math.floor(sortedGaps.length / 2)];
  const minGap = medianGap * 0.5;

  const merged = [rules[0]];
  for (let index = 1; index < rules.length; index += 1) {
    if (rules[index] - merged[merged.length - 1] >= minGap) merged.push(rules[index]);
  }

  return merged;
}

/** How a scan is turned relative to the printed sheet. */
export type PageOrientation = 0 | 90 | 180 | 270;

/**
 * Works out how far the scan is rotated, in whole quarter turns.
 *
 * This is what the three-fiducial arrangement is FOR. The marks sit at top-left,
 * top-right and bottom-left — never bottom-right — so the empty corner names the
 * orientation unambiguously. Four marks would be symmetric and could not.
 *
 * Found by mass alone, not by the corner solver: a sheet fed in upside down has its
 * marks in corners the solver is not looking in, so it has to be answered before any
 * geometry is attempted. Each page corner is checked for a concentration of ink, and
 * the one that is EMPTY says which way is up.
 *
 * Returns undefined when the pattern is not three-of-four — a sheet with no fiducials
 * (printed before they existed), or a scan too poor to see them. The caller then
 * proceeds unrotated rather than guessing, since a wrong quarter turn reads every
 * answer off a different question.
 */
export function detectOrientation(bitmap: RawBitmap): PageOrientation | undefined {
  const { width, height } = bitmap;
  if (width < 32 || height < 32) return undefined;

  // A SMALL box at each page corner — just big enough to hold a fiducial.
  //
  // A generous box does not work: at a sixth of the page it reaches into the answer
  // grid and the anchor bars, whose ink swamps the fiducial's. Measured on a full
  // sheet, the four corners read 350, 350, 843, 1193 — the two bottom boxes dominated
  // by grid, so the genuinely empty corner was no longer the emptiest and the test
  // picked the wrong one. With only the fiducials' own area in view the same sheet
  // reads 350, 350, 0, 350.
  const boxW = Math.max(8, Math.floor(width * 0.11));
  const boxH = Math.max(8, Math.floor(height * 0.07));

  const inkIn = (left: number, top: number): number => {
    let dark = 0;
    for (let y = top; y < top + boxH; y += 2) {
      for (let x = left; x < left + boxW; x += 2) {
        if (1 - luminance(bitmap.data, (y * width + x) * 4) > 0.5) dark += 1;
      }
    }
    return dark;
  };

  // Clockwise from the top left, which is the order the quarter turns follow.
  const corners = [
    inkIn(0, 0),
    inkIn(width - boxW, 0),
    inkIn(width - boxW, height - boxH),
    inkIn(0, height - boxH),
  ];

  // The empty corner is the one well below the others. Comparing against the MEDIAN
  // rather than the mean keeps one unusually heavy corner — a dense header, a
  // signature — from dragging the threshold up and hiding the real gap.
  const sorted = [...corners].sort((a, b) => a - b);
  const median = sorted[2];
  const emptiest = corners.indexOf(sorted[0]);
  if (median <= 0) return undefined;
  // The gap has to be decisive, in both directions:
  //
  //   - the emptiest corner must be well BELOW the others, or there is no empty
  //     corner and this is not a three-fiducial sheet;
  //   - the second-emptiest must be well ABOVE it, or all four are similar and the
  //     "emptiest" is just noise.
  //
  // A measured good sheet reads 350, 350, 0, 350 — decisive on both counts.
  if (sorted[0] > median * 0.35) return undefined;
  if (sorted[1] < median * 0.5) return undefined;

  // Printed upright, the EMPTY corner is bottom-right (index 2). Whatever index it
  // actually landed in says how far the page has turned.
  const turns = (emptiest - 2 + 4) % 4;
  return ([0, 90, 180, 270] as const)[turns];
}

/**
 * Rotates a bitmap by whole quarter turns, so the rest of the pipeline only ever
 * sees an upright page.
 *
 * Whole turns are exact — every pixel maps to exactly one pixel, with no interpolation
 * and nothing lost. That is why orientation is handled separately from the fractional
 * skew the anchors correct: this part is free, and doing it first means the anchor
 * search is not hunting for vertical bars that are currently horizontal.
 */
export function rotateBitmap(bitmap: RawBitmap, orientation: PageOrientation): RawBitmap {
  if (orientation === 0) return bitmap;

  const { width, height, data } = bitmap;
  const turned = orientation === 180;
  const outWidth = turned ? width : height;
  const outHeight = turned ? height : width;
  const out = new Uint8Array(outWidth * outHeight * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let nx: number;
      let ny: number;
      // The page is rotated BACK by `orientation`, so a scan turned 90 degrees
      // clockwise is turned 90 anticlockwise here.
      if (orientation === 90) {
        nx = y;
        ny = width - 1 - x;
      } else if (orientation === 180) {
        nx = width - 1 - x;
        ny = height - 1 - y;
      } else {
        nx = height - 1 - y;
        ny = x;
      }
      const from = (y * width + x) * 4;
      const to = (ny * outWidth + nx) * 4;
      out[to] = data[from];
      out[to + 1] = data[from + 1];
      out[to + 2] = data[from + 2];
      out[to + 3] = data[from + 3];
    }
  }

  return { data: out, width: outWidth, height: outHeight };
}

/** One corner mark located on the scan, in pixels. */
export interface FoundCorner {
  id: CornerMark["id"];
  x: number;
  y: number;
}

/**
 * Finds the three L-shaped corner marks.
 *
 * Searched for in the quadrant each one is printed in, which is what makes this
 * robust: the top-left mark is the only L-shaped cluster of ink in the top-left
 * corner of any sheet, so there is nothing to confuse it with. A bar flanking the
 * answer grid has the grid's own rules for company; a corner mark has an empty margin.
 *
 * Each mark is located by its CENTRE OF MASS rather than by hunting for the corner
 * point. The two are a fixed offset apart for an L of known leg lengths, so the offset
 * is subtracted afterwards — and a centre of mass over a few hundred dark pixels is
 * far steadier under noise, tilt and a soft scan than trying to find where two
 * one-pixel strokes meet.
 */
export function findCorners(bitmap: RawBitmap, layout: SheetLayout): FoundCorner[] {
  const { width, height } = bitmap;
  const found: FoundCorner[] = [];

  for (const mark of layout.corners) {
    // The box around this mark: big enough that a shifted or cropped scan still
    // contains it, SMALL enough to exclude the answer grid.
    //
    // Sized from the mark's own legs rather than as a fixed fraction of the page. A
    // generous page-fraction box reached 200px past the bottom-left mark, which
    // swallowed the grid's bottom rule and the anchor bars' lower ends — far more ink
    // than an L carries, so the sanity check rejected the mark and the sheet silently
    // fell back to the anchor bars it was meant to replace.
    const padX = Math.round(mark.legX * width * 2.2);
    const padY = Math.round(mark.legY * height * 2.2);
    const cx = Math.round(mark.x * width);
    const cy = Math.round(mark.y * height);
    const left = Math.max(0, cx - padX);
    const right = Math.min(width - 1, cx + padX);
    const top = Math.max(0, cy - padY);
    const bottom = Math.min(height - 1, cy + padY);

    let sumX = 0;
    let sumY = 0;
    let count = 0;
    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        if (1 - luminance(bitmap.data, (y * width + x) * 4) > 0.5) {
          sumX += x;
          sumY += y;
          count += 1;
        }
      }
    }

    // An L of these legs has a known pixel area; far less means the mark is missing
    // (an older sheet), far more means the search box caught something else.
    // A filled square covers its whole bounding box.
    const expected = mark.legX * width * (mark.legY * height);
    if (count < expected * 0.25 || count > expected * 4) continue;

    // Centre of mass of a solid SQUARE, relative to the corner point: half of each
    // side. (It was a third when these were right triangles, and an ink-weighted
    // average of two strokes when they were L-shapes — the offset follows the shape.)
    const offsetX = ((mark.legX * width) / 2) * mark.dirX;
    const offsetY = ((mark.legY * height) / 2) * mark.dirY;

    found.push({ id: mark.id, x: sumX / count - offsetX, y: sumY / count - offsetY });
  }

  return found;
}

/**
 * Reads one sheet.
 *
 * `layout` must be built from the SAME question count and choice set the sheet was
 * printed with — that is the whole reason `buildSheetLayout` is shared rather than
 * duplicated. `gridTop` therefore has to match the printed header height too, which
 * the caller passes through from the exam's options.
 *
 * When the anchors are found, bubble positions are mapped through them, so a scan
 * that is cropped, scaled or slightly offset still lands on the right circles. When
 * they are not, the layout's fractions are applied to the whole image as a fallback —
 * a square-on scan of the full page will usually still read, and `anchorsFound: false`
 * tells the caller to treat the result with suspicion.
 */
export function detectMarks(
  bitmap: RawBitmap,
  questionCount: number,
  choiceSet: ChoiceSet,
  gridTop: number,
): DetectionResult {
  const layout = buildSheetLayout(questionCount, choiceSet, gridTop);

  // Upright the page FIRST, before anything looks for geometry.
  //
  // A sheet fed in sideways has its anchor bars running horizontally, so the bar
  // search finds nothing and the sheet falls back to reading the whole image — which
  // produces a confident, entirely wrong result rather than an error. Quarter turns
  // are lossless, so this costs nothing when the page is already upright.
  const orientation = detectOrientation(bitmap) ?? 0;
  const upright = rotateBitmap(bitmap, orientation);

  const anchors = findAnchors(upright, layout);

  // Map a layout fraction to a pixel. With anchors, x is interpolated between the two
  // bars (whose own fractions the layout knows) and y between their ends; without,
  // the page itself is the frame.
  let toPixelX: (fraction: number) => number;
  let toPixelY: (fraction: number) => number;
  /**
   * The real mapping: a 2-D point in, a 2-D point out.
   *
   * `toPixelX`/`toPixelY` remain for callers that genuinely have one axis (the
   * bubble radius, the ID grid), but a bubble's position needs both — on a tilted
   * page its x depends on its y and vice versa, which two independent functions
   * cannot express. Defaults to the axis-independent behaviour so the fallbacks,
   * which have no rotation to recover, keep working unchanged.
   */
  let projectPoint: (xFraction: number, yFraction: number) => { x: number; y: number };

  const corners = findCorners(upright, layout);
  const byId = new Map(corners.map((corner) => [corner.id, corner]));
  const topLeft = byId.get("top-left");
  const topRight = byId.get("top-right");
  const bottomLeft = byId.get("bottom-left");

  if (topLeft && topRight && bottomLeft) {
    // THE PREFERRED PATH: solve the page's own coordinate frame from three fixed
    // points, rather than inferring it from bars whose position depends on the header.
    //
    // The three marks are printed at known fractions, so the vector from top-left to
    // top-right IS the page's x axis at its true scale and rotation, and top-left to
    // bottom-left is the y axis. Mapping any fraction is then two steps along those
    // two vectors — which handles rotation, uniform scale, a cropped margin and a
    // non-square aspect ratio all at once, because none of them was assumed.
    const spec = new Map(layout.corners.map((corner) => [corner.id, corner]));
    const tl = spec.get("top-left")!;
    const tr = spec.get("top-right")!;
    const bl = spec.get("bottom-left")!;

    const spanX = Math.max(1e-6, tr.x - tl.x);
    const spanY = Math.max(1e-6, bl.y - tl.y);
    // Pixel vectors for one unit of each axis.
    const axisX = { x: (topRight.x - topLeft.x) / spanX, y: (topRight.y - topLeft.y) / spanX };
    const axisY = { x: (bottomLeft.x - topLeft.x) / spanY, y: (bottomLeft.y - topLeft.y) / spanY };

    const project = (xFraction: number, yFraction: number) => {
      const u = xFraction - tl.x;
      const v = yFraction - tl.y;
      return {
        x: topLeft.x + u * axisX.x + v * axisY.x,
        y: topLeft.y + u * axisX.y + v * axisY.y,
      };
    };

    projectPoint = project;
    toPixelX = (fraction) => project(fraction, tl.y).x;
    toPixelY = (fraction) => project(tl.x, fraction).y;
  } else if (anchors) {
    // A ROTATING map, not two independent axes.
    //
    // The two anchor bars are printed at the same height, so any difference between
    // where they start on the scan is the page's tilt. Scanning a sheet by hand puts
    // a degree or two in almost every page, and the old axis-independent mapping
    // carried that straight into the sampling: a point's y was computed as if the
    // page were square, so the error grew the further right and further down it was.
    // Measured on a synthetic sheet, 1 degree cost 2 of 15 answers and 2 degrees cost
    // 11 of 15, with early columns reading correctly and later ones drifting — which
    // is exactly the pattern real scans showed.
    const [leftAnchor, rightAnchor] = layout.anchors;
    const spanFraction = Math.max(1e-6, rightAnchor.x - leftAnchor.x);
    const heightFraction = Math.max(1e-6, leftAnchor.bottom - leftAnchor.top);

    // The bars' own geometry on the scan. `dx`/`dy` is the vector from the left bar's
    // top to the right bar's top: on a square page `dy` is 0, and on a tilted one it
    // is the rise that gives the angle.
    const dx = anchors.rightX - anchors.leftX;
    const dy = anchors.rightTop - anchors.leftTop;
    const skew = Math.atan2(dy, dx);

    // Down-the-page direction, perpendicular to the bar-to-bar vector, scaled by how
    // tall the bars actually are on this scan.
    const barHeight = (anchors.leftBottom - anchors.leftTop + anchors.rightBottom - anchors.rightTop) / 2;
    const cos = Math.cos(skew);
    const sin = Math.sin(skew);

    // Both axes now need both inputs, so the two closures share one computation.
    const project = (xFraction: number, yFraction: number) => {
      // Position within the grid, 0..1 on each axis.
      const u = (xFraction - leftAnchor.x) / spanFraction;
      const v = (yFraction - leftAnchor.top) / heightFraction;
      // Walk along the bar-to-bar vector, then down the perpendicular.
      const alongX = u * dx;
      const alongY = u * dy;
      const downX = -v * barHeight * sin;
      const downY = v * barHeight * cos;
      return { x: anchors.leftX + alongX + downX, y: anchors.leftTop + alongY + downY };
    };

    projectPoint = project;
    toPixelX = (fraction) => project(fraction, leftAnchor.top).x;
    toPixelY = (fraction) => project(leftAnchor.x, fraction).y;
  } else {
    // No anchor bars. Before giving up on locating anything, look for the answer
    // grid's own printed BORDER, which is a rectangle of ruled lines and is present on
    // every sheet whether or not the anchors printed.
    //
    // This matters because a sheet printed before the anchors were drawn correctly is
    // still a perfectly good sheet — the bubbles are where the layout says, just
    // without the bars. Mapping fractions onto the whole image instead would sample
    // nowhere near them, because a scan carries margins and the page is never exactly
    // the printable box.
    const box = findGridBox(upright);
    if (box) {
      const leftFraction = layout.grid.left;
      const rightFraction = layout.grid.right;
      const spanFraction = Math.max(1e-6, rightFraction - leftFraction);
      toPixelX = (fraction) =>
        box.left + ((fraction - leftFraction) / spanFraction) * (box.right - box.left);

      const topFraction = layout.grid.top;
      const bottomFraction = layout.grid.bottom;
      const heightFraction = Math.max(1e-6, bottomFraction - topFraction);
      toPixelY = (fraction) =>
        box.top + ((fraction - topFraction) / heightFraction) * (box.bottom - box.top);
    } else {
      // Nothing locatable at all. The layout's fractions against the whole image is
      // the last resort, and `anchorsFound: false` warns the caller either way.
      toPixelX = (fraction) => fraction * upright.width;
      toPixelY = (fraction) => fraction * upright.height;
    }
  }

  // Every path that did not set a rotating map falls back to the separable one.
  projectPoint ??= (xFraction, yFraction) => ({
    x: toPixelX(xFraction),
    y: toPixelY(yFraction),
  });

  // The sampling radius, from the bubble's PRINTED size — shared with the renderer
  // via `BUBBLE_WIDTH`, so the two cannot drift apart.
  //
  // The bubble is an oval, wider than tall, so the smaller half-axis is what bounds a
  // square sample box that must stay inside it. Taking the width alone would push the
  // box above and below the ink and read white paper as a pale mark.
  const printed = bubbleSizeFor(layout);
  const bubbleHalfWidth = (toPixelX(printed.width) - toPixelX(0)) / 2;
  const bubbleHalfHeight = (toPixelY(printed.height) - toPixelY(0)) / 2;
  const bubbleRadius = Math.max(2, Math.min(bubbleHalfWidth, bubbleHalfHeight));

  /**
   * Row centres taken from the sheet's OWN printed rules, when they can be read.
   *
   * This overrides the projected y entirely, and it is the single most valuable thing
   * the detector does. Every projected position depends on `gridTop`, which the caller
   * computes by summing estimated header-block heights — an estimate that cannot be
   * right, because it depends on how a declaration wrapped and how tall the fonts
   * rendered. On a real sheet it predicted a 41.6px row pitch where the page printed
   * 33.9px: a 23% error that accumulates down the page, passing half a row by question
   * 8, so every answer below that was read off the wrong line.
   *
   * N rules bound N-1 rows, and a row's centre is the midpoint of its pair. Only used
   * when the count matches what the layout expects for a single column — a partial
   * read (a rule lost to a crease, a scan that clipped the table) would be worse than
   * the projection, so it falls through instead.
   */
  // Row positions, best source first:
  //
  //   1. timing ticks  — isolated marks, one per row, nothing nearby to confuse
  //   2. table rules   — reliable but need a fitted pitch, which can be skewed
  //   3. the projection — derived from an ESTIMATED header height, 23% out in practice
  //
  // Each is a fallback for the one above, and each is validated before use: a wrong
  // row position is far worse than an approximate one, because it reads a real answer
  // off the wrong line and looks like a confident result.
  // Ticks, per column. Every column carries its own gutter of ticks, so a
  // multi-column sheet is just the same search repeated — the single-column guard
  // that used to be here disabled the strongest row reference on exactly the sheets
  // that need it most, since a 30-question exam lays out in two or three columns.
  //
  // All or nothing: if any column's ticks cannot be read, the whole measurement is
  // discarded rather than mixing measured rows with projected ones, which would put
  // part of the sheet on a reference the rest is not using.
  const tickRowCentres = (() => {
    if (!anchors) return undefined;
    const byRow = new Map<number, number>();
    for (let column = 0; column < layout.columnCount; column += 1) {
      const centres = findRowTicks(upright, layout, projectPoint, column);
      if (!centres) return undefined;
      const columnRows = layout.rows.filter((row) => row.column === column);
      columnRows.forEach((row, index) => {
        byRow.set(row.questionNumber, centres[index]);
      });
    }
    const ordered = layout.rows.map((row) => byRow.get(row.questionNumber));
    return ordered.every((value) => value !== undefined)
      ? (ordered as number[])
      : undefined;
  })();

  const ruleRowCentres =
    !tickRowCentres && anchors && layout.columnCount === 1
      ? (() => {
          const rules = findRowRules(upright, anchors);
          // Needs enough rules to be worth trusting, but NOT the exact count.
          //
          // Demanding exactly N+1 was too brittle on a real sheet: one rule fell under
          // the detection threshold (a 71px gap where the pitch was 35px) and another
          // arrived doubled at the table's heavier top edge. Requiring perfection meant
          // one missing line silently discarded the whole measurement and fell back to
          // the estimate that is wrong by 23%.
          if (rules.length < Math.max(4, Math.round(layout.rows.length * 0.6))) {
            return undefined;
          }

          // Fit a uniform pitch instead of using the rules pairwise. The row grid IS
          // uniform — the layout draws it that way — so a least-squares line through
          // whichever rules were found recovers it, and a missing or doubled rule
          // barely moves it. Each rule is first snapped to the row index it is nearest.
          // The pitch estimate used for snapping comes from the MEDIAN gap, not from
          // the endpoints divided by the count. A real sheet's rule list contains a
          // doubled top border (a 51px gap where the pitch is 35px) and a rule that
          // fell under threshold (a 71px gap, two rows wide). Averaging across the
          // whole span folds both into the estimate and inflated it to 38.7px, which
          // snapped two different rules onto the same row index and skewed the fit —
          // the reads then drifted a full row by the bottom of the page. A median is
          // untouched by a handful of wrong gaps.
          const gaps = rules.slice(1).map((value, index) => value - rules[index]);
          const sortedGaps = [...gaps].sort((a, b) => a - b);
          const medianGap = sortedGaps[Math.floor(sortedGaps.length / 2)] || 1;

          const first = rules[0];
          const indexed = rules.map((y) => ({ i: Math.round((y - first) / medianGap), y }));

          const n = indexed.length;
          const meanI = indexed.reduce((sum, p) => sum + p.i, 0) / n;
          const meanY = indexed.reduce((sum, p) => sum + p.y, 0) / n;
          let cov = 0;
          let varI = 0;
          for (const p of indexed) {
            cov += (p.i - meanI) * (p.y - meanY);
            varI += (p.i - meanI) ** 2;
          }
          const pitch = varI > 1e-6 ? cov / varI : medianGap;
          const originY = meanY - pitch * meanI;

          // Only trust the fit if it actually EXPLAINS the rules it was built from.
          //
          // A least-squares line always produces an answer, including from a rule list
          // that is nothing like a row grid — a sheet whose table is drawn differently,
          // or a scan where the rules were missed and bubble edges got picked up
          // instead. Overriding the projected rows with a bad fit is far worse than
          // leaving them alone, so the residual is checked and the whole measurement
          // discarded unless every rule sits close to where the fit says it should.
          // The MEDIAN residual, not the worst one. The table's heavier top border
          // reliably contributes one rule that sits ~35% of a pitch off the grid,
          // while every other rule lands within 15% — judging by the worst case threw
          // away a perfectly good fit because of that one known outlier.
          const residuals = indexed
            .map((point) => Math.abs(point.y - (originY + pitch * point.i)))
            .sort((a, b) => a - b);
          const medianResidual = residuals[Math.floor(residuals.length / 2)];
          if (medianResidual > pitch * 0.2) return undefined;

          // The measured pitch must be in the same ballpark as the layout's own.
          //
          // A sheet that draws no row rules at all — the synthetic fixtures do not —
          // still yields a rule list, assembled from bubble edges, and a line fits it
          // happily. The result is a plausible-looking grid bearing no relation to the
          // rows, which silently replaced correct projected positions with wrong ones.
          //
          // The layout's predicted pitch is wrong in SCALE (that is the whole reason
          // for measuring), but not by an order of magnitude, so requiring the two to
          // agree within half-to-double rejects a fit built from the wrong features
          // while still admitting the 23% correction this exists to make.
          const probeX = layout.rows[0].cellLeft;
          const projectedPitch = Math.abs(
            projectPoint(probeX, layout.grid.top + layout.rowPitch).y -
              projectPoint(probeX, layout.grid.top).y,
          );
          if (projectedPitch > 1 && (pitch < projectedPitch * 0.5 || pitch > projectedPitch * 2)) {
            return undefined;
          }

          // Row k sits between rule k and rule k+1.
          return layout.rows.map((_, index) => originY + pitch * (index + 0.5));
        })()
      : undefined;

  const measuredRowCentres = tickRowCentres ?? ruleRowCentres;

  const answers: DetectedAnswer[] = layout.rows.map((row, rowIndex) => {
    // A measured row centre corrects the row's POSITION, not just its y.
    //
    // Substituting the measured y while keeping the projected x is wrong on a tilted
    // page: x and y are coupled there, so pairing one row's x with another row's y
    // walks the sample sideways, and the error grows with the angle. (Measured on a
    // tilted synthetic sheet: ticks found at every angle, yet accuracy fell to 1/15 at
    // five degrees.) Shifting the whole row by the difference keeps them consistent.
    const measuredY = measuredRowCentres?.[rowIndex];
    const rowAnchor = projectPoint(row.cellLeft, row.y);
    const yShift = measuredY === undefined ? 0 : measuredY - rowAnchor.y;

    const darkness = row.bubbles.map((bubble) => {
      const point = projectPoint(bubble.x, bubble.y);
      return sampleDarkness(upright, point.x, point.y + yShift, bubbleRadius);
    });

    return scoreAnswer(row.questionNumber, layout.choices, darkness);
  });

  return {
    answers,
    rowSource: tickRowCentres ? "ticks" : ruleRowCentres ? "rules" : "projected",
    orientation,
    cornersFound: corners.length,
    anchorsFound: anchors !== undefined,
    region: anchors
      ? { left: anchors.leftX, top: anchors.top, right: anchors.rightX, bottom: anchors.bottom }
      : { left: 0, top: 0, right: upright.width, bottom: upright.height },
  };
}

/**
 * Turns one question's per-choice darkness into an answer.
 *
 * Exported for its own tests: this is where "which circle did they mean" is actually
 * decided, and it is worth exercising directly rather than only through a bitmap.
 */
export function scoreAnswer(
  questionNumber: number,
  choices: string[],
  darkness: number[],
): DetectedAnswer {
  // A mark is whatever is darker than the OTHER bubbles on the same row, not whatever
  // crosses a fixed darkness. That distinction is the whole of this function.
  //
  // Real sheets taught it. A student who *traces* the printed circle rather than
  // filling it leaves a ring of ink around a white centre, which averages ~0.02 over
  // the sampled box — and ~0.20 with the letter glyph included. A solid fill averages
  // ~1.0. An absolute threshold set anywhere between those two rejects every traced
  // mark as blank, which is exactly what happened: 19 and 29 "unclear" on two real
  // scans. Lowering the threshold instead would make every *empty* printed circle,
  // which also carries its own ring and letter, read as marked.
  //
  // Colour makes it worse. A cyan pen reads as darkness 0.51 at full strength, against
  // a black pen's 1.0, so any fixed cutoff is really a cutoff on ink colour.
  //
  // The baseline is the MEDIAN of the row, which is robust to one or two marks: with
  // four choices and one marked, the median sits among the three unmarked ones, which
  // is precisely the "blank bubble on this scan, in this ink, at this exposure" value
  // that the absolute threshold could never know.
  const sorted = [...darkness].sort((a, b) => a - b);
  const baseline =
    sorted.length === 0
      ? 0
      : sorted.length % 2 === 1
        ? sorted[(sorted.length - 1) / 2]
        : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;

  const excess = darkness.map((value) => value - baseline);
  const ranked = excess
    .map((value, index) => ({ value, index }))
    .sort((a, b) => b.value - a.value);

  const best = ranked[0];
  const runnerUp = ranked[1];

  // Nothing stands out from the row's own baseline.
  if (!best || best.value < MARK_EXCESS) {
    return { questionNumber, choice: "", confidence: 0, issue: "blank", darkness };
  }

  // Two bubbles both standing out, close enough that picking one would be a guess.
  if (runnerUp && runnerUp.value >= best.value * AMBIGUITY_RATIO) {
    return {
      questionNumber,
      choice: "",
      confidence: Math.max(0, (best.value - runnerUp.value) / Math.max(best.value, 1e-6)),
      issue: "multiple",
      darkness,
    };
  }

  const margin = runnerUp ? (best.value - runnerUp.value) / Math.max(best.value, 1e-6) : 1;

  return {
    questionNumber,
    choice: choices[best.index] ?? "",
    confidence: Math.min(1, margin),
    // "Faint" now means "barely stood out", which is the honest reading: a traced ring
    // is a legitimate mark, just one with less ink than a fill.
    issue: best.value < FAINT_EXCESS ? "faint" : "none",
    darkness,
  };
}

/** Convenience for a caller that already has a layout. */
export function layoutFor(
  questionCount: number,
  choiceSet: ChoiceSet,
  gridTop: number,
): SheetLayout {
  return buildSheetLayout(questionCount, choiceSet, gridTop);
}

/**
 * How far the QR crop extends beyond the predicted box, as a fraction of its size.
 *
 * Exported so the tests assert against the value the code uses rather than a copy of
 * it -- three tests hardcoded 0.25 and broke the moment it changed, which is noise
 * that hides real regressions.
 */
export const QR_CROP_PADDING = 0.75;

/**
 * Builds the fraction-to-pixel mapping for a scan, from the anchor bars.
 *
 * **A scan is not the page.** A scanner leaves margins, a phone photo leaves more,
 * and the paper lands somewhere inside the image at some scale. Mapping a layout
 * fraction with `fraction * bitmap.width` assumes the page fills the image edge to
 * edge, which no real scan does.
 *
 * Measured on a real 1308x1700 scan: the page occupied 87% of the width with a 93px
 * left margin, so the naive mapping put the QR crop 83px -- 60% of the code width --
 * left of the actual code. The answers read 15/15 on that same scan because answer
 * detection goes through the anchors; the QR crop did not, and failed on every sheet.
 *
 * Falls back to the naive mapping when the anchors were not found, which is no worse
 * than before and keeps a cropped-anchor scan from throwing.
 */
export function scanMapping(
  bitmap: RawBitmap,
  layout: SheetLayout,
  anchors: AnchorBars | undefined,
): { toPixelX: (f: number) => number; toPixelY: (f: number) => number } {
  if (!anchors || layout.anchors.length < 2) {
    return {
      toPixelX: (f) => f * bitmap.width,
      toPixelY: (f) => f * bitmap.height,
    };
  }

  const leftFraction = layout.anchors[0].x;
  const rightFraction = layout.anchors[1].x;
  const span = rightFraction - leftFraction;
  if (span <= 0) {
    return {
      toPixelX: (f) => f * bitmap.width,
      toPixelY: (f) => f * bitmap.height,
    };
  }

  // Horizontal scale and offset come straight from the two bars, whose fractions the
  // layout knows and whose pixels the detector measured.
  const scaleX = (anchors.rightX - anchors.leftX) / (span * bitmap.width);
  const offsetX = anchors.leftX - leftFraction * bitmap.width * scaleX;

  // Vertically the bars give a span too: their own top and bottom, which the layout
  // also knows. Uses the mean of the two bars, so a slight tilt averages out.
  const topFraction = layout.anchors[0].top;
  const bottomFraction = layout.anchors[0].bottom;
  const vSpan = bottomFraction - topFraction;
  const scaleY =
    vSpan > 0 ? (anchors.bottom - anchors.top) / (vSpan * bitmap.height) : scaleX;
  const offsetY = anchors.top - topFraction * bitmap.height * scaleY;

  return {
    toPixelX: (f) => f * bitmap.width * scaleX + offsetX,
    toPixelY: (f) => f * bitmap.height * scaleY + offsetY,
  };
}

/**
 * Crops the QR block out of a scan, ready to hand to the decoder.
 *
 * Cropping rather than scanning the whole page is deliberate. jsQR looks for three
 * finder patterns -- nested black squares -- and the answer grid has FOUR solid black
 * corner fiducials that match that description closely enough to send it hunting. The
 * crop also cuts the work by about 99%, since the QR is roughly 1% of the page.
 *
 * The box is padded generously because the geometry it comes from is an ESTIMATE of
 * where the header ended, and a QR clipped on one edge loses a finder pattern and
 * fails completely -- there is no partial decode.
 *
 * 0.75 of the code size on each side, not 0.25. At 0.25 a 38px error in the estimated
 * header height (the gap between the budgeted `HEADER_BASE` and its measured value)
 * clipped 16px off an 89px code and killed every decode. Padding is nearly free: the
 * crop is ~1% of the page either way, jsQR ignores surrounding white, and the answer
 * grid is still far enough below to stay out of frame.
 *
 * Returns undefined when the box falls outside the image, which is what a sheet
 * printed WITHOUT a QR looks like from here.
 */
export function cropQrRegion(
  bitmap: RawBitmap,
  qrTop: number,
  toPixelX: (fraction: number) => number,
  toPixelY: (fraction: number) => number,
  padding = QR_CROP_PADDING,
): { data: Uint8ClampedArray; width: number; height: number } | undefined {
  const { box } = buildQrLayout(qrTop);

  const padX = (box.right - box.left) * padding;
  const padY = (box.bottom - box.top) * padding;

  const left = Math.max(0, Math.floor(toPixelX(box.left - padX)));
  const top = Math.max(0, Math.floor(toPixelY(box.top - padY)));
  const right = Math.min(bitmap.width, Math.ceil(toPixelX(box.right + padX)));
  const bottom = Math.min(bitmap.height, Math.ceil(toPixelY(box.bottom + padY)));

  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0) return undefined;

  // jsQR wants RGBA in a Uint8ClampedArray. The source is already RGBA; this copies
  // the window row by row rather than passing the full buffer with a stride, because
  // jsQR has no stride parameter.
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceStart = ((top + y) * bitmap.width + left) * 4;
    const target = y * width * 4;
    for (let i = 0; i < width * 4; i += 1) {
      out[target + i] = bitmap.data[sourceStart + i];
    }
  }

  return { data: out, width, height };
}

/**
 * Reads the pre-printed student-ID grid off a sheet.
 *
 * The same sampling as the answers, against `buildIdGridLayout` — one shaded bubble
 * per column, read as a digit. Because the grid is **printed** shaded rather than
 * filled in by hand, a column that reads ambiguously means the scan is bad, not that
 * someone was careless, so this is stricter than `scoreAnswer`: any column that is not
 * a clean single mark makes the whole read fail rather than produce a wrong ID.
 *
 * Returns the digits as a string, or undefined if any column is unreadable. A wrong
 * student ID silently attaches a grade to the wrong person, so "I could not read it"
 * is the only acceptable failure.
 */
export function detectStudentId(
  bitmap: RawBitmap,
  idGridTop: number,
  toPixelX: (fraction: number) => number,
  toPixelY: (fraction: number) => number,
): string | undefined {
  const grid = buildIdGridLayout(idGridTop);
  const radius = Math.max(2, (toPixelX(0.02) - toPixelX(0)) / 2);

  let digits = "";
  for (let column = 0; column < grid.columns; column += 1) {
    const inColumn = grid.bubbles.filter((bubble) => bubble.column === column);
    const darkness = inColumn.map((bubble) =>
      sampleDarkness(bitmap, toPixelX(bubble.x), toPixelY(bubble.y), radius),
    );

    const ranked = darkness
      .map((value, index) => ({ value, index }))
      .sort((a, b) => b.value - a.value);
    const best = ranked[0];
    const runnerUp = ranked[1];

    // A blank column is legitimate: an ID shorter than the grid is right-aligned, so
    // the leading columns carry nothing. Stop reading rather than guessing a zero.
    if (!best || best.value < FILL_THRESHOLD) continue;

    // Printed marks are solid. Two dark bubbles in one column means a bad scan.
    if (runnerUp && runnerUp.value >= best.value * AMBIGUITY_RATIO) return undefined;

    digits += String(inColumn[best.index].digit);
  }

  return digits === "" ? undefined : digits;
}
