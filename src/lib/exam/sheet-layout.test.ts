import { describe, expect, it } from "vitest";
import {
  MAX_QUESTIONS_PER_SHEET,
  paginateQuestions,
  ID_DIGIT_COLUMNS,
  ID_DIGIT_ROWS,
  GRID_LEFT,
  GRID_RIGHT,
  MAX_COLUMNS,
  MAX_ROW_PITCH,
  MIN_ROW_PITCH,
  buildIdGridLayout,
  buildSheetLayout,
  idDigitsFor,
  maxQuestionsOnOnePage,
} from "./sheet-layout";
import type { ChoiceSet } from "./types";

describe("buildSheetLayout", () => {
  it("lays out every question exactly once, in order", () => {
    const layout = buildSheetLayout(20, "ABCD");

    expect(layout.rows.map((row) => row.questionNumber)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1),
    );
  });

  it("gives every question one bubble per choice", () => {
    const four = buildSheetLayout(3, "ABCD");
    const five = buildSheetLayout(3, "ABCDE");

    expect(four.rows[0].bubbles.map((bubble) => bubble.choice)).toEqual(["A", "B", "C", "D"]);
    expect(five.rows[0].bubbles).toHaveLength(5);
    expect(five.choices).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("uses one column for an exam that fits in one", () => {
    const layout = buildSheetLayout(10, "ABCD");

    expect(layout.columnCount).toBe(1);
    expect(layout.rows.every((row) => row.column === 0)).toBe(true);
  });

  it("adds columns rather than a second page as the exam grows", () => {
    // A realistic header height; with the grid starting at the very top of the page
    // even 30 questions fit one column, which is not what this is testing.
    const small = buildSheetLayout(10, "ABCD", 0.52);
    const big = buildSheetLayout(MAX_QUESTIONS_PER_SHEET, "ABCD", 0.52);

    expect(big.columnCount).toBeGreaterThan(small.columnCount);
    expect(big.fitsOnePage).toBe(true);
  });

  it("caps at two columns, because the detector is unreliable past that", () => {
    // Not a geometry limit — five columns fit on paper. Past roughly forty questions
    // the timing-tick search starts confusing the anchor bars' ends for ticks and
    // grades confidently off a misaligned row, so longer exams are SPLIT across
    // sheets instead. See MAX_QUESTIONS_PER_SHEET.
    expect(buildSheetLayout(MAX_QUESTIONS_PER_SHEET, "ABCD").columnCount).toBeLessThanOrEqual(2);
  });

  it("fills each column before starting the next", () => {
    const layout = buildSheetLayout(60, "ABCD");
    const firstColumn = layout.rows.filter((row) => row.column === 0);
    const secondColumn = layout.rows.filter((row) => row.column === 1);

    // Column 0 holds a contiguous run starting at 1, and column 1 continues it.
    expect(firstColumn[0].questionNumber).toBe(1);
    expect(secondColumn[0].questionNumber).toBe(
      firstColumn[firstColumn.length - 1].questionNumber + 1,
    );
  });

  it("keeps the row pitch within its bounds", () => {
    for (const count of [1, 10, 40, 80, 120]) {
      const layout = buildSheetLayout(count, "ABCD");
      expect(layout.rowPitch).toBeGreaterThanOrEqual(MIN_ROW_PITCH);
      expect(layout.rowPitch).toBeLessThanOrEqual(MAX_ROW_PITCH);
    }
  });

  it("gives a short exam roomier rows than a long one", () => {
    expect(buildSheetLayout(5, "ABCD").rowPitch).toBeGreaterThan(
      buildSheetLayout(120, "ABCD").rowPitch,
    );
  });

  it("keeps every bubble inside the grid box", () => {
    const layout = buildSheetLayout(100, "ABCDE");

    for (const row of layout.rows) {
      for (const bubble of row.bubbles) {
        expect(bubble.x).toBeGreaterThan(GRID_LEFT);
        expect(bubble.x).toBeLessThan(GRID_RIGHT);
        expect(bubble.y).toBeGreaterThanOrEqual(layout.grid.top);
        expect(bubble.y).toBeLessThanOrEqual(layout.grid.bottom);
      }
    }
  });

  it("never lets a row overflow the page bottom, even when the exam cannot fit", () => {
    const layout = buildSheetLayout(5000, "ABCD");

    expect(layout.fitsOnePage).toBe(false);
    // Lays out only what fits and drops the rest, rather than walking rows off the
    // bottom of the page. The caller refuses to print on `fitsOnePage`, so this just
    // has to stay on the sheet for the preview.
    expect(layout.rows.length).toBeLessThan(5000);
    for (const row of layout.rows) {
      expect(row.y).toBeLessThan(1);
    }
  });

  it("spaces a row's bubbles left to right, all on one line", () => {
    const [first] = buildSheetLayout(1, "ABCD").rows;
    const xs = first.bubbles.map((bubble) => bubble.x);

    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(new Set(first.bubbles.map((bubble) => bubble.y)).size).toBe(1);
  });

  it("keeps columns side by side and non-overlapping", () => {
    const layout = buildSheetLayout(80, "ABCD");

    for (let index = 1; index < layout.columns.length; index += 1) {
      expect(layout.columns[index].left).toBeGreaterThanOrEqual(
        layout.columns[index - 1].right - 1e-9,
      );
    }
  });

  it("reports each column's question range", () => {
    const layout = buildSheetLayout(50, "ABCD");
    const covered = layout.columns.flatMap((column) =>
      Array.from(
        { length: column.rowCount },
        (_, index) => column.firstQuestion + index,
      ),
    );

    expect(covered).toEqual(Array.from({ length: 50 }, (_, index) => index + 1));
  });

  it("shrinks the drawn grid to the rows a short exam actually uses", () => {
    const layout = buildSheetLayout(3, "ABCD");

    // Three rows at the chosen pitch, not the whole page.
    expect(layout.grid.bottom).toBeCloseTo(layout.grid.top + layout.rowPitch * 3);
  });

  it("puts one anchor bar either side of the answer grid", () => {
    const layout = buildSheetLayout(20, "ABCD");

    expect(layout.anchors).toHaveLength(2);
    const [left, right] = layout.anchors;
    expect(left.x).toBeLessThan(right.x);
    // They OVERHANG the grid at both ends, deliberately: a bar exactly as tall as the
    // grid's own border rule is indistinguishable from it, and the detector picked the
    // wrong one on a tilted page.
    for (const anchor of layout.anchors) {
      expect(anchor.top).toBeLessThan(layout.grid.top);
      expect(anchor.bottom).toBeGreaterThan(layout.grid.bottom);
      // Still clearly the answer area's bar, not a full-page rule.
      expect(layout.grid.top - anchor.top).toBeLessThan(0.05);
      expect(anchor.bottom - layout.grid.bottom).toBeLessThan(0.05);
    }
  });

  it("keeps the bubbles clear of the anchor bars", () => {
    const layout = buildSheetLayout(60, "ABCDE");
    const [left, right] = layout.anchors;

    for (const row of layout.rows) {
      for (const bubble of row.bubbles) {
        expect(bubble.x).toBeGreaterThan(left.x + left.width / 2);
        expect(bubble.x).toBeLessThan(right.x - right.width / 2);
      }
    }
  });

  it("reports when an exam cannot fit one page", () => {
    expect(buildSheetLayout(40, "ABCD").fitsOnePage).toBe(true);
    // Far past what the tightest pitch across the most columns can hold.
    expect(buildSheetLayout(5000, "ABCD").fitsOnePage).toBe(false);
  });

  it("takes less room for the grid when the header is taller", () => {
    const shortHeader = buildSheetLayout(100, "ABCD", 0.2);
    const tallHeader = buildSheetLayout(100, "ABCD", 0.45);

    // A declaration block pushes the grid down, so it needs more columns.
    expect(tallHeader.grid.top).toBeGreaterThan(shortHeader.grid.top);
    expect(tallHeader.columnCount).toBeGreaterThanOrEqual(shortHeader.columnCount);
  });

  it("treats a question count below one as a single question", () => {
    expect(buildSheetLayout(0, "ABCD").questionCount).toBe(1);
    expect(buildSheetLayout(0, "ABCD").rows).toHaveLength(1);
  });

  it("floors a fractional question count rather than drawing half a row", () => {
    expect(buildSheetLayout(4.7, "ABCD").rows).toHaveLength(4);
  });
});

describe("maxQuestionsOnOnePage", () => {
  it("is the tightest pitch across the most columns", () => {
    expect(maxQuestionsOnOnePage()).toBeGreaterThan(50);
    expect(maxQuestionsOnOnePage()).toBe(
      Math.floor((0.96 - 0.2) / MIN_ROW_PITCH) * MAX_COLUMNS,
    );
  });

  it("falls as the header grows", () => {
    expect(maxQuestionsOnOnePage(0.45)).toBeLessThan(maxQuestionsOnOnePage(0.2));
  });

  it("agrees with what buildSheetLayout accepts", () => {
    const limit = maxQuestionsOnOnePage();

    expect(buildSheetLayout(limit, "ABCD").fitsOnePage).toBe(true);
    expect(buildSheetLayout(limit + 1, "ABCD").fitsOnePage).toBe(false);
  });
});

describe("idDigitsFor", () => {
  it("right-aligns a short ID, leaving the leading columns empty", () => {
    expect(idDigitsFor("219")).toEqual([undefined, undefined, 2, 1, 9]);
  });

  it("fills every column for an ID the grid's width", () => {
    expect(idDigitsFor("20194")).toEqual([2, 0, 1, 9, 4]);
  });

  it("keeps the LAST digits of an over-long ID", () => {
    // The tail distinguishes students; a shared leading year or campus code does not.
    expect(idDigitsFor("2024000731")).toEqual([0, 0, 7, 3, 1]);
  });

  it("strips punctuation and letters so a hand-typed ID still encodes", () => {
    expect(idDigitsFor("S-2019")).toEqual(idDigitsFor("2019"));
    expect(idDigitsFor("ID 00 42")).toEqual([undefined, 0, 0, 4, 2]);
  });

  it("returns an empty grid for an ID with no digits at all", () => {
    expect(idDigitsFor("")).toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(idDigitsFor("none")).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("honours a narrower grid", () => {
    expect(idDigitsFor("12345", 3)).toEqual([3, 4, 5]);
  });
});

describe("buildIdGridLayout", () => {
  it("builds one bubble per digit per column", () => {
    const grid = buildIdGridLayout(0.1);

    expect(grid.columns).toBe(ID_DIGIT_COLUMNS);
    expect(grid.bubbles).toHaveLength(ID_DIGIT_COLUMNS * ID_DIGIT_ROWS);
  });

  it("orders digits 0-9 down each column", () => {
    const grid = buildIdGridLayout(0.1);
    const firstColumn = grid.bubbles.filter((bubble) => bubble.column === 0);

    expect(firstColumn.map((bubble) => bubble.digit)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    const ys = firstColumn.map((bubble) => bubble.y);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
  });

  it("places columns left to right without overlapping", () => {
    const grid = buildIdGridLayout(0.1);
    const xs = Array.from({ length: ID_DIGIT_COLUMNS }, (_, column) =>
      grid.bubbles.find((bubble) => bubble.column === column)!.x,
    );

    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(new Set(xs).size).toBe(ID_DIGIT_COLUMNS);
  });

  it("starts where it is told, so the renderer controls the header stack", () => {
    const high = buildIdGridLayout(0.1);
    const low = buildIdGridLayout(0.3);

    expect(low.box.top).toBeCloseTo(0.3);
    expect(low.box.top - high.box.top).toBeCloseTo(0.2);
  });

  it("keeps every bubble inside its own box", () => {
    const grid = buildIdGridLayout(0.12);

    for (const bubble of grid.bubbles) {
      expect(bubble.x).toBeGreaterThan(grid.box.left);
      expect(bubble.x).toBeLessThan(grid.box.right);
      expect(bubble.y).toBeGreaterThan(grid.box.top);
      expect(bubble.y).toBeLessThan(grid.box.bottom);
    }
  });
});

describe("paginateQuestions", () => {
  it("keeps a short exam on one sheet", () => {
    expect(paginateQuestions(15)).toEqual([{ firstQuestion: 1, lastQuestion: 15 }]);
    expect(paginateQuestions(MAX_QUESTIONS_PER_SHEET)).toHaveLength(1);
  });

  it("splits one question past the cap onto a second sheet", () => {
    const sheets = paginateQuestions(MAX_QUESTIONS_PER_SHEET + 1);

    expect(sheets).toHaveLength(2);
    expect(sheets[1]).toEqual({
      firstQuestion: MAX_QUESTIONS_PER_SHEET + 1,
      lastQuestion: MAX_QUESTIONS_PER_SHEET + 1,
    });
  });

  it("covers every question exactly once, with no gaps", () => {
    const covered = paginateQuestions(75).flatMap((sheet) =>
      Array.from(
        { length: sheet.lastQuestion - sheet.firstQuestion + 1 },
        (_, index) => sheet.firstQuestion + index,
      ),
    );

    expect(covered).toEqual(Array.from({ length: 75 }, (_, index) => index + 1));
  });

  it("gives a continuation sheet its own complete layout", () => {
    // The whole point: sheet 2 is a SHEET, not the tail of a table. It gets its own
    // corner marks, anchor bars and ticks, and no part-rows.
    const [, second] = paginateQuestions(45);
    const layout = buildSheetLayout(
      second.lastQuestion - second.firstQuestion + 1,
      "ABCD",
      0.3,
      0.96,
      second.firstQuestion,
    );

    expect(layout.rows[0].questionNumber).toBe(31);
    expect(layout.rows.at(-1)?.questionNumber).toBe(45);
    // Four fiducials, one per margin corner. This asserted 3 until the fourth was
    // added; a continuation sheet gets the full set, exactly like the first.
    expect(layout.corners).toHaveLength(4);
    expect(layout.anchors).toHaveLength(2);
    expect(layout.rows.every((row) => row.tick.width > 0)).toBe(true);
    expect(layout.fitsOnePage).toBe(true);
  });
});


describe("choice column widths", () => {
  /**
   * Every choice gets the same width, and the number cell is ruled off from them.
   *
   * The bubbles were always evenly stepped, but the sheet drew its leftmost divider
   * between A and B -- so the question number and choice A shared one segment 2.4x
   * the width of every other choice. It looked uneven on paper because it WAS,
   * and a mark beside the number sat in no cell at all.
   */
  function segments(questionCount: number, choiceSet: ChoiceSet) {
    const layout = buildSheetLayout(questionCount, choiceSet, 0.3);
    const row = layout.rows[0];
    const edges = [row.bubblesLeft];
    for (let i = 1; i < row.bubbles.length; i += 1) {
      edges.push((row.bubbles[i - 1].x + row.bubbles[i].x) / 2);
    }
    edges.push(row.cellRight);
    return edges.slice(1).map((edge, i) => edge - edges[i]);
  }

  it.each([
    [10, "ABCDE"],
    [30, "ABCDE"],
    [30, "ABCD"],
    [5, "ABC"],
  ])("gives every choice an equal cell (%i questions, %s)", (count, set) => {
    const widths = segments(count, set as ChoiceSet);

    expect(widths).toHaveLength((set as string).length);
    const spread = Math.max(...widths) - Math.min(...widths);
    expect(spread).toBeLessThan(1e-9);
  });

  it("rules the number cell off from choice A", () => {
    const row = buildSheetLayout(10, "ABCDE", 0.3).rows[0];

    // The rule sits left of A and right of the number cell, or it is not a boundary.
    expect(row.bubblesLeft).toBeGreaterThan(row.cellLeft);
    expect(row.bubblesLeft).toBeLessThan(row.bubbles[0].x);
  });

  it("leaves the number cell wider than a choice, but not by much", () => {
    // It holds "#30" and the timing tick, so it earns extra width -- but the 2.4x
    // fused segment was not a decision, it was a missing rule.
    const row = buildSheetLayout(30, "ABCDE", 0.3).rows[0];
    const numberCell = row.bubblesLeft - row.cellLeft;
    const choiceCell = segments(30, "ABCDE")[0];

    expect(numberCell).toBeGreaterThan(choiceCell);
    expect(numberCell / choiceCell).toBeLessThan(2);
  });

  it("keeps the tick inside the number cell, clear of choice A", () => {
    // Tightening the choice spread once pulled A leftwards over the tick and every
    // A read as blank. The rule now marks that boundary, so it must hold.
    const row = buildSheetLayout(30, "ABCDE", 0.3).rows[0];

    expect(row.tick.x + row.tick.width).toBeLessThan(row.bubblesLeft);
  });
});
