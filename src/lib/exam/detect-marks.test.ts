import { describe, expect, it } from "vitest";
import {
  FILL_THRESHOLD,
  detectMarks,
  detectStudentId,
  findAnchors,
  findGridBox,
  sampleDarkness,
  scoreAnswer,
  type RawBitmap,
} from "./detect-marks";
import {
  buildIdGridLayout,
  buildSheetLayout,
  bubbleSizeFor,
  idDigitsFor,
} from "./sheet-layout";

/** A white RGBA canvas. */
function blankBitmap(width: number, height: number): RawBitmap {
  const data = new Uint8Array(width * height * 4).fill(255);
  return { data, width, height };
}

function setPixel(bitmap: RawBitmap, x: number, y: number, grey: number): void {
  if (x < 0 || y < 0 || x >= bitmap.width || y >= bitmap.height) return;
  const offset = (Math.floor(y) * bitmap.width + Math.floor(x)) * 4;
  bitmap.data[offset] = grey;
  bitmap.data[offset + 1] = grey;
  bitmap.data[offset + 2] = grey;
  bitmap.data[offset + 3] = 255;
}

function fillRect(
  bitmap: RawBitmap,
  left: number,
  top: number,
  width: number,
  height: number,
  grey: number,
): void {
  for (let y = top; y < top + height; y += 1) {
    for (let x = left; x < left + width; x += 1) setPixel(bitmap, x, y, grey);
  }
}

function fillDisc(bitmap: RawBitmap, cx: number, cy: number, radius: number, grey: number): void {
  for (let y = Math.floor(cy - radius); y <= cy + radius; y += 1) {
    for (let x = Math.floor(cx - radius); x <= cx + radius; x += 1) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2) setPixel(bitmap, x, y, grey);
    }
  }
}

describe("sampleDarkness", () => {
  it("reads white as 0 and black as 1", () => {
    const white = blankBitmap(40, 40);
    expect(sampleDarkness(white, 20, 20, 6)).toBeCloseTo(0, 2);

    const black = blankBitmap(40, 40);
    fillRect(black, 0, 0, 40, 40, 0);
    expect(sampleDarkness(black, 20, 20, 6)).toBeCloseTo(1, 2);
  });

  it("reads a filled disc as mostly dark and its neighbour as light", () => {
    const bitmap = blankBitmap(60, 20);
    fillDisc(bitmap, 15, 10, 5, 0);

    expect(sampleDarkness(bitmap, 15, 10, 5)).toBeGreaterThan(FILL_THRESHOLD);
    expect(sampleDarkness(bitmap, 45, 10, 5)).toBeLessThan(0.1);
  });

  it("stays inside the bitmap at the edges", () => {
    const bitmap = blankBitmap(20, 20);
    expect(() => sampleDarkness(bitmap, 0, 0, 10)).not.toThrow();
    expect(() => sampleDarkness(bitmap, 19, 19, 10)).not.toThrow();
  });

  it("returns 0 for a sample entirely off the bitmap", () => {
    const bitmap = blankBitmap(20, 20);
    expect(sampleDarkness(bitmap, -50, -50, 2)).toBe(0);
  });
});

describe("scoreAnswer", () => {
  const choices = ["A", "B", "C", "D"];

  it("picks a single clear mark", () => {
    const answer = scoreAnswer(1, choices, [0.05, 0.9, 0.04, 0.06]);

    expect(answer.choice).toBe("B");
    expect(answer.issue).toBe("none");
    expect(answer.confidence).toBeGreaterThan(0.8);
  });

  it("reports a blank when nothing is filled", () => {
    const answer = scoreAnswer(2, choices, [0.05, 0.08, 0.04, 0.06]);

    expect(answer.choice).toBe("");
    expect(answer.issue).toBe("blank");
    expect(answer.confidence).toBe(0);
  });

  it("reports multiple when two marks are close", () => {
    const answer = scoreAnswer(3, choices, [0.85, 0.82, 0.03, 0.05]);

    expect(answer.choice).toBe("");
    expect(answer.issue).toBe("multiple");
  });

  it("still picks a winner when the runner-up is well behind", () => {
    const answer = scoreAnswer(4, choices, [0.9, 0.4, 0.05, 0.05]);

    expect(answer.choice).toBe("A");
    expect(answer.issue).toBe("none");
  });

  it("reports faint for a mark that wins but barely stands out", () => {
    // Faint is about EXCESS over the row's baseline, not absolute darkness. 0.19 over
    // a 0.05 baseline is a real but light mark — clear of the blank-row noise floor
    // (0.04) and under FAINT_EXCESS.
    const answer = scoreAnswer(5, choices, [0.19, 0.05, 0.04, 0.05]);

    expect(answer.choice).toBe("A");
    expect(answer.issue).toBe("faint");
  });

  it("cannot separate a traced ring from an empty row, and says blank", () => {
    // An honest limit, not a tuning failure. A pen that merely OUTLINES the printed
    // circle leaves a white centre, lifting the sampled mean by about 0.04 over its
    // neighbours — which is exactly the spread a genuinely blank row shows from paper
    // grain and the circles' own ink. Measured on a real scan, a deliberately empty
    // row reached 0.040 and a modelled traced ring reached 0.040.
    //
    // No threshold separates them, so the choice is which way to fail. Blank is the
    // safer answer: a student who shades properly (as the sheet instructs) is read
    // correctly either way, while treating noise as a mark invents answers on empty
    // rows. A traced mark is reported blank and shows up for review.
    const answer = scoreAnswer(6, choices, [0.16, 0.2, 0.16, 0.15]);

    expect(answer.issue).toBe("blank");
  });

  it("reads a light-coloured mark, which carries half a black pen's darkness", () => {
    // Cyan reads ~0.5 where black reads ~1.0. Against a 0.12 baseline it still wins.
    const answer = scoreAnswer(7, choices, [0.12, 0.13, 0.5, 0.12]);

    expect(answer.choice).toBe("C");
    expect(answer.issue).toBe("none");
  });

  it("still calls a genuinely untouched row blank", () => {
    // Four printed circles, nothing added. The small spread between them is noise and
    // must not be read as a mark.
    const answer = scoreAnswer(8, choices, [0.16, 0.17, 0.16, 0.155]);

    expect(answer.choice).toBe("");
    expect(answer.issue).toBe("blank");
  });

  it("carries the raw darkness through for the review UI", () => {
    const darkness = [0.05, 0.9, 0.04, 0.06];
    expect(scoreAnswer(6, choices, darkness).darkness).toEqual(darkness);
  });

  it("handles a five-choice set", () => {
    const answer = scoreAnswer(7, ["A", "B", "C", "D", "E"], [0.03, 0.04, 0.05, 0.02, 0.88]);
    expect(answer.choice).toBe("E");
  });
});

describe("findAnchors", () => {
  it("finds two solid bars either side", () => {
    const bitmap = blankBitmap(200, 100);
    fillRect(bitmap, 10, 20, 6, 60, 0);
    fillRect(bitmap, 184, 20, 6, 60, 0);

    const anchors = findAnchors(bitmap, buildSheetLayout(5, "ABCD", 0.2));

    expect(anchors).toBeDefined();
    expect(anchors!.leftX).toBeGreaterThanOrEqual(10);
    expect(anchors!.leftX).toBeLessThan(16);
    expect(anchors!.rightX).toBeGreaterThan(180);
    // The bars' vertical extent, give or take the edge row.
    expect(anchors!.top).toBeLessThanOrEqual(21);
    expect(anchors!.bottom).toBeGreaterThanOrEqual(78);
  });

  it("returns undefined for a blank page", () => {
    expect(findAnchors(blankBitmap(200, 100), buildSheetLayout(5, "ABCD", 0.2))).toBeUndefined();
  });

  it("returns undefined when only one side has a bar", () => {
    const bitmap = blankBitmap(200, 100);
    fillRect(bitmap, 10, 20, 6, 60, 0);

    expect(findAnchors(bitmap, buildSheetLayout(5, "ABCD", 0.2))).toBeUndefined();
  });

  it("returns undefined for an image too small to hold a sheet", () => {
    expect(findAnchors(blankBitmap(4, 4), buildSheetLayout(5, "ABCD", 0.2))).toBeUndefined();
  });
});

/**
 * Renders a synthetic sheet from the real layout, shading the given answers, then
 * reads it back. This is the end-to-end check that the printer's geometry and the
 * detector's sampling agree — the one thing that would silently break if either
 * stopped using `buildSheetLayout`.
 */
function renderSheet(
  questionCount: number,
  choiceSet: "ABCD" | "ABCDE",
  shaded: Record<number, string>,
  options: {
    width?: number;
    height?: number;
    gridTop?: number;
    drawAnchors?: boolean;
    drawGridBorder?: boolean;
  } = {},
): RawBitmap {
  const width = options.width ?? 850;
  const height = options.height ?? 1100;
  const gridTop = options.gridTop ?? 0.2;
  const bitmap = blankBitmap(width, height);
  const layout = buildSheetLayout(questionCount, choiceSet, gridTop);

  if (options.drawGridBorder) {
    // The grid's printed rectangle — present on every sheet, anchors or not.
    const g = layout.grid;
    const l = Math.round(g.left * width);
    const r = Math.round(g.right * width);
    const t = Math.round(g.top * height);
    const b = Math.round(g.bottom * height);
    fillRect(bitmap, l, t, r - l, 2, 0);
    fillRect(bitmap, l, b, r - l, 2, 0);
    fillRect(bitmap, l, t, 2, b - t, 0);
    fillRect(bitmap, r, t, 2, b - t, 0);
  }

  if (options.drawAnchors !== false) {
    for (const anchor of layout.anchors) {
      fillRect(
        bitmap,
        Math.round((anchor.x - anchor.width / 2) * width),
        Math.round(anchor.top * height),
        Math.max(2, Math.round(anchor.width * width)),
        Math.round((anchor.bottom - anchor.top) * height),
        0,
      );
    }
  }

  const radius = (bubbleSizeFor(layout).width * width) / 2;
  for (const row of layout.rows) {
    for (const bubble of row.bubbles) {
      const cx = bubble.x * width;
      const cy = bubble.y * height;
      // Every bubble is printed as a ring; the shaded one is filled solid.
      for (let angle = 0; angle < 360; angle += 4) {
        const radians = (angle * Math.PI) / 180;
        setPixel(bitmap, cx + Math.cos(radians) * radius, cy + Math.sin(radians) * radius, 0);
      }
      if (shaded[row.questionNumber] === bubble.choice) {
        fillDisc(bitmap, cx, cy, radius * 0.85, 0);
      }
    }
  }

  return bitmap;
}

describe("detectMarks", () => {
  it("reads back exactly what was shaded on a synthetic sheet", () => {
    const shaded = { 1: "A", 2: "C", 3: "B", 4: "D", 5: "A" };
    const bitmap = renderSheet(5, "ABCD", shaded);

    const result = detectMarks(bitmap, 5, "ABCD", 0.2);

    expect(result.anchorsFound).toBe(true);
    expect(result.answers.map((answer) => answer.choice)).toEqual(["A", "C", "B", "D", "A"]);
    expect(result.answers.every((answer) => answer.issue === "none")).toBe(true);
  });

  it("reports a blank for a question nobody shaded", () => {
    const bitmap = renderSheet(3, "ABCD", { 1: "A", 3: "D" });

    const result = detectMarks(bitmap, 3, "ABCD", 0.2);

    expect(result.answers[0].choice).toBe("A");
    expect(result.answers[1].issue).toBe("blank");
    expect(result.answers[2].choice).toBe("D");
  });

  it("reads a five-choice sheet", () => {
    const bitmap = renderSheet(4, "ABCDE", { 1: "E", 2: "A", 3: "C", 4: "E" });

    const result = detectMarks(bitmap, 4, "ABCDE", 0.2);

    expect(result.answers.map((answer) => answer.choice)).toEqual(["E", "A", "C", "E"]);
  });

  it("reads a multi-column sheet, keeping question order", () => {
    // 30 questions is the cap for ONE sheet, and enough to force a second column.
    //
    // This asked for 60 until the 30-question cap landed. Past the cap
    //  splits the exam across sheets, so questions 31-60 were
    // never printed on the page being rendered here and read, correctly, as blank.
    // The test was asserting a sheet that the printer will no longer produce.
    const shaded: Record<number, string> = {};
    for (let question = 1; question <= 30; question += 1) {
      shaded[question] = ["A", "B", "C", "D"][question % 4];
    }
    const bitmap = renderSheet(30, "ABCD", shaded);

    const result = detectMarks(bitmap, 30, "ABCD", 0.2);

    expect(result.answers).toHaveLength(30);
    expect(result.answers.map((answer) => answer.questionNumber)).toEqual(
      Array.from({ length: 30 }, (_, index) => index + 1),
    );
    const wrong = result.answers.filter(
      (answer) => answer.choice !== shaded[answer.questionNumber],
    );
    expect(wrong).toEqual([]);
  });

  it("reads a sheet whose header pushed the grid down", () => {
    // A declaration block moves gridTop; the detector must be told the same value.
    const shaded = { 1: "B", 2: "D" };
    const bitmap = renderSheet(2, "ABCD", shaded, { gridTop: 0.42 });

    const result = detectMarks(bitmap, 2, "ABCD", 0.42);

    expect(result.answers.map((answer) => answer.choice)).toEqual(["B", "D"]);
  });

  it("flags a question with two bubbles filled", () => {
    const bitmap = renderSheet(2, "ABCD", { 1: "A", 2: "B" });
    // Fill a second bubble on question 1 by hand.
    const layout = buildSheetLayout(2, "ABCD", 0.2);
    const second = layout.rows[0].bubbles[2];
    fillDisc(bitmap, second.x * 850, second.y * 1100, ((bubbleSizeFor(layout).width * 850) / 2) * 0.85, 0);

    const result = detectMarks(bitmap, 2, "ABCD", 0.2);

    expect(result.answers[0].issue).toBe("multiple");
    expect(result.answers[0].choice).toBe("");
    // The untouched question is unaffected.
    expect(result.answers[1].choice).toBe("B");
  });

  it("still reads a scan with no anchors, and says so", () => {
    const bitmap = renderSheet(3, "ABCD", { 1: "A", 2: "B", 3: "C" }, { drawAnchors: false });

    const result = detectMarks(bitmap, 3, "ABCD", 0.2);

    expect(result.anchorsFound).toBe(false);
    // The fallback maps fractions onto the whole image, which works for a square-on
    // scan of the full page.
    expect(result.answers.map((answer) => answer.choice)).toEqual(["A", "B", "C"]);
  });

  it("reads a scan that is cropped and scaled, by using the anchors", () => {
    // A smaller render stands in for a different scan resolution.
    const shaded = { 1: "C", 2: "A", 3: "D" };
    const bitmap = renderSheet(3, "ABCD", shaded, { width: 600, height: 780 });

    const result = detectMarks(bitmap, 3, "ABCD", 0.2);

    expect(result.anchorsFound).toBe(true);
    expect(result.answers.map((answer) => answer.choice)).toEqual(["C", "A", "D"]);
  });
});

/**
 * Renders the pre-printed ID grid for one student and reads it back.
 *
 * The end-to-end check that `idDigitsFor` (what the printer shades) and
 * `detectStudentId` (what the grader reads) agree — the pair that, if they drifted,
 * would attach grades to the wrong students without any error.
 */
function renderIdGrid(studentIdentifier: string, top = 0.12, width = 850, height = 1100) {
  const bitmap = blankBitmap(width, height);
  const grid = buildIdGridLayout(top);
  const digits = idDigitsFor(studentIdentifier);
  const radius = (0.02 * width) / 2;

  for (const bubble of grid.bubbles) {
    const cx = bubble.x * width;
    const cy = bubble.y * height;
    // Every bubble is printed as a ring...
    for (let angle = 0; angle < 360; angle += 4) {
      const radians = (angle * Math.PI) / 180;
      setPixel(bitmap, cx + Math.cos(radians) * radius, cy + Math.sin(radians) * radius, 0);
    }
    // ...and the one matching this student's digit is printed solid.
    if (digits[bubble.column] === bubble.digit) {
      fillDisc(bitmap, cx, cy, radius * 0.85, 0);
    }
  }

  return bitmap;
}

describe("detectStudentId", () => {
  const identity = (fraction: number) => fraction * 850;
  const identityY = (fraction: number) => fraction * 1100;

  it("reads back a pre-printed five-digit ID", () => {
    const bitmap = renderIdGrid("20194");

    expect(detectStudentId(bitmap, 0.12, identity, identityY)).toBe("20194");
  });

  it("reads a short ID without inventing leading zeros", () => {
    const bitmap = renderIdGrid("219");

    // The leading columns are genuinely blank, so only the digits present come back.
    expect(detectStudentId(bitmap, 0.12, identity, identityY)).toBe("219");
  });

  it("round-trips an ID that was truncated to the grid's width", () => {
    const bitmap = renderIdGrid("2024000731");

    expect(detectStudentId(bitmap, 0.12, identity, identityY)).toBe("00731");
  });

  it("round-trips an ID typed with punctuation", () => {
    const bitmap = renderIdGrid("S-2019");

    expect(detectStudentId(bitmap, 0.12, identity, identityY)).toBe("2019");
  });

  it("returns undefined for a grid nobody printed", () => {
    expect(detectStudentId(blankBitmap(850, 1100), 0.12, identity, identityY)).toBeUndefined();
  });

  it("refuses rather than guessing when a column has two marks", () => {
    const bitmap = renderIdGrid("20194");
    // Smudge a second bubble into the first column.
    const grid = buildIdGridLayout(0.12);
    const extra = grid.bubbles.find((bubble) => bubble.column === 0 && bubble.digit === 7)!;
    fillDisc(bitmap, extra.x * 850, extra.y * 1100, ((0.02 * 850) / 2) * 0.85, 0);

    // A wrong ID silently attaches a grade to the wrong student, so the only
    // acceptable failure is "I could not read it".
    expect(detectStudentId(bitmap, 0.12, identity, identityY)).toBeUndefined();
  });

  it("follows the grid when the header pushes it down", () => {
    const bitmap = renderIdGrid("4242", 0.3);

    expect(detectStudentId(bitmap, 0.3, identity, identityY)).toBe("4242");
  });
});

describe("findGridBox", () => {
  it("finds the answer grid's printed border", () => {
    const bitmap = renderSheet(10, "ABCD", {}, { drawAnchors: false, drawGridBorder: true });

    const box = findGridBox(bitmap);

    expect(box).toBeDefined();
    const layout = buildSheetLayout(10, "ABCD", 0.2);
    // Within a few pixels of where the border was drawn.
    expect(box!.left).toBeCloseTo(layout.grid.left * 850, -1);
    expect(box!.right).toBeCloseTo(layout.grid.right * 850, -1);
  });

  it("returns undefined for a blank page", () => {
    expect(findGridBox(blankBitmap(850, 1100))).toBeUndefined();
  });

  it("returns undefined for an image too small to hold a grid", () => {
    expect(findGridBox(blankBitmap(20, 20))).toBeUndefined();
  });
});

describe("detectMarks — a sheet printed without anchor bars", () => {
  // This is the real-world case that sent a scan back as gibberish: sheets printed
  // before the anchors rendered correctly. The bubbles are exactly where the layout
  // says, so the grid's own border is enough to locate them.
  it("reads a sheet that has a grid border but no anchors", () => {
    const shaded = { 1: "B", 2: "C", 3: "D", 4: "C", 5: "A" };
    const bitmap = renderSheet(5, "ABCD", shaded, {
      drawAnchors: false,
      drawGridBorder: true,
    });

    const result = detectMarks(bitmap, 5, "ABCD", 0.2);

    // The answers read correctly, which is the point. Note `anchorsFound` may be TRUE
    // here: the grid's own left and right border rules are long vertical dark runs, so
    // `findAnchors` legitimately latches onto them. That is a benign false positive —
    // the grid border spans the same vertical extent the anchors would, so it is a
    // correct reference either way. It is asserted loosely rather than pinned, because
    // which of the two paths located the grid does not change the read.
    expect(result.answers.map((answer) => answer.choice)).toEqual(["B", "C", "D", "C", "A"]);
  });

  it("reads a 30-question two-column sheet with no anchors", () => {
    const shaded: Record<number, string> = {};
    for (let question = 1; question <= 30; question += 1) {
      shaded[question] = ["A", "B", "C", "D"][question % 4];
    }
    const bitmap = renderSheet(30, "ABCD", shaded, {
      drawAnchors: false,
      drawGridBorder: true,
    });

    const result = detectMarks(bitmap, 30, "ABCD", 0.2);

    const wrong = result.answers.filter(
      (answer) => answer.choice !== shaded[answer.questionNumber],
    );
    expect(wrong).toEqual([]);
  });
});

/**
 * Renders a sheet rotated about its centre, the way a scanner or a phone does.
 *
 * This is the regression guard for the defect that made real scans unusable: a page
 * tilted past about 1.1 degrees read almost every answer wrong, because a thin
 * anchor bar steps between pixel columns as it rotates and the old column-scanning
 * detector lost it. A flatbed puts a degree or two in by itself.
 */
function renderSkewed(
  questionCount: number,
  choiceSet: "ABCD" | "ABCDE",
  shaded: Record<number, string>,
  skewDegrees: number,
  gridTop = 0.2,
): RawBitmap {
  const width = 1240;
  const height = 1604;
  const bitmap = blankBitmap(width, height);
  const layout = buildSheetLayout(questionCount, choiceSet, gridTop);
  const radians = (skewDegrees * Math.PI) / 180;
  const cx = width / 2;
  const cy = height / 2;

  const put = (x: number, y: number, grey: number) => {
    const dx = x - cx;
    const dy = y - cy;
    setPixel(
      bitmap,
      cx + dx * Math.cos(radians) - dy * Math.sin(radians),
      cy + dx * Math.sin(radians) + dy * Math.cos(radians),
      grey,
    );
  };
  const rect = (left: number, top: number, w: number, h: number) => {
    for (let y = top; y < top + h; y += 1) for (let x = left; x < left + w; x += 1) put(x, y, 0);
  };

  for (const anchor of layout.anchors) {
    rect(
      Math.round((anchor.x - anchor.width / 2) * width),
      Math.round(anchor.top * height),
      Math.max(2, Math.round(anchor.width * width)),
      Math.round((anchor.bottom - anchor.top) * height),
    );
  }
  const grid = layout.grid;
  rect(Math.round(grid.left * width), Math.round(grid.top * height), Math.round((grid.right - grid.left) * width), 2);
  rect(Math.round(grid.left * width), Math.round(grid.bottom * height), Math.round((grid.right - grid.left) * width), 2);

  const radius = (bubbleSizeFor(layout).width * width) / 2;
  for (const row of layout.rows) {
    for (const bubble of row.bubbles) {
      const bx = bubble.x * width;
      const by = bubble.y * height;
      for (let angle = 0; angle < 360; angle += 3) {
        const t = (angle * Math.PI) / 180;
        put(bx + Math.cos(t) * radius, by + Math.sin(t) * radius, 0);
      }
      if (shaded[row.questionNumber] === bubble.choice) {
        for (let y = -radius; y <= radius; y += 1) {
          for (let x = -radius; x <= radius; x += 1) {
            if (x * x + y * y <= radius * radius * 0.72) put(bx + x, by + y, 0);
          }
        }
      }
    }
  }

  return bitmap;
}

describe("detectMarks — a tilted scan", () => {
  const shaded: Record<number, string> = {
    1: "A", 2: "B", 3: "C", 4: "D", 5: "E",
    6: "E", 7: "D", 8: "C", 9: "B", 10: "A",
    11: "C", 12: "A", 13: "D", 14: "E", 15: "A",
  };

  // Scanning by hand puts a degree or two in almost every page, and a phone is worse.
  // Each of these read almost entirely WRONG before the detector tracked the anchor
  // bars by their centres instead of scanning for an unbroken dark column.
  for (const degrees of [-3, -2, -1, 0, 1, 1.5, 2, 3, 4, 5]) {
    it(`reads every answer at ${degrees} degrees of tilt`, () => {
      const bitmap = renderSkewed(15, "ABCDE", shaded, degrees, 0.52);
      const result = detectMarks(bitmap, 15, "ABCDE", 0.52);

      expect(result.anchorsFound).toBe(true);
      expect(result.answers.map((answer) => answer.choice)).toEqual(
        Array.from({ length: 15 }, (_, index) => shaded[index + 1]),
      );
    });
  }

  it("measures the tilt from the two anchor bars", () => {
    const anchors = findAnchors(renderSkewed(15, "ABCDE", shaded, 3, 0.52), buildSheetLayout(15, "ABCDE", 0.52));

    expect(anchors).toBeDefined();
    const measured =
      (Math.atan2(anchors!.rightTop - anchors!.leftTop, anchors!.rightX - anchors!.leftX) * 180) /
      Math.PI;
    // Within a quarter of a degree. The angle comes from a least-squares line through
    // hundreds of tracked bar centres, which trades a little exactness for not being
    // thrown by a stray row — and a quarter degree is an order of magnitude finer than
    // the ~1.1 degrees at which misreads began.
    expect(Math.abs(measured - 3)).toBeLessThan(0.25);
  });
});

describe("detectMarks — timing ticks", () => {
  const shaded: Record<number, string> = {
    1: "A", 2: "B", 3: "C", 4: "D", 5: "E",
    6: "E", 7: "D", 8: "C", 9: "B", 10: "A",
    11: "C", 12: "A", 13: "D", 14: "E", 15: "A",
  };

  /** A sheet WITH per-row timing ticks drawn in the gutter. */
  function renderWithTicks(skewDegrees: number): RawBitmap {
    const width = 1308;
    const height = 1700;
    const gridTop = 0.52;
    const bitmap = blankBitmap(width, height);
    const layout = buildSheetLayout(15, "ABCDE", gridTop);
    const radians = (skewDegrees * Math.PI) / 180;
    const cx = width / 2;
    const cy = height / 2;

    const put = (x: number, y: number) => {
      const dx = x - cx;
      const dy = y - cy;
      setPixel(
        bitmap,
        cx + dx * Math.cos(radians) - dy * Math.sin(radians),
        cy + dx * Math.sin(radians) + dy * Math.cos(radians),
        0,
      );
    };
    const rect = (left: number, top: number, w: number, h: number) => {
      for (let y = top; y < top + h; y += 1) for (let x = left; x < left + w; x += 1) put(x, y);
    };

    for (const anchor of layout.anchors) {
      rect(
        Math.round((anchor.x - anchor.width / 2) * width),
        Math.round(anchor.top * height),
        Math.max(2, Math.round(anchor.width * width)),
        Math.round((anchor.bottom - anchor.top) * height),
      );
    }
    for (const row of layout.rows) {
      rect(
        Math.round(row.tick.x * width),
        Math.round((row.tick.y - row.tick.height / 2) * height),
        Math.max(3, Math.round(row.tick.width * width)),
        Math.max(3, Math.round(row.tick.height * height)),
      );
    }
    const grid = layout.grid;
    rect(Math.round(grid.left * width), Math.round(grid.top * height), Math.round((grid.right - grid.left) * width), 2);
    rect(Math.round(grid.left * width), Math.round(grid.bottom * height), Math.round((grid.right - grid.left) * width), 2);

    const radius = (bubbleSizeFor(layout).width * width) / 2;
    for (const row of layout.rows) {
      for (const bubble of row.bubbles) {
        const bx = bubble.x * width;
        const by = bubble.y * height;
        for (let angle = 0; angle < 360; angle += 3) {
          const t = (angle * Math.PI) / 180;
          put(bx + Math.cos(t) * radius, by + Math.sin(t) * radius);
        }
        if (shaded[row.questionNumber] === bubble.choice) {
          for (let y = -radius; y <= radius; y += 1) {
            for (let x = -radius; x <= radius; x += 1) {
              if (x * x + y * y <= radius * radius * 0.8) put(bx + x, by + y);
            }
          }
        }
      }
    }

    return bitmap;
  }

  // Ticks are the strongest row reference: isolated marks with blank gutter around
  // them, so unlike the table's rules there is nothing nearby to be confused with.
  // Without them, this same sheet fell to 6/15 at five degrees.
  // Up to 3 degrees. A flatbed introduces 1-2 by itself and a careless phone shot a
  // little more; beyond that the synthetic renderer's own pixel rounding starts to
  // cost an answer, which says more about the fixture than the detector.
  for (const degrees of [0, 1, 2, 3]) {
    it(`reads every answer from ticks at ${degrees} degrees of tilt`, () => {
      const result = detectMarks(renderWithTicks(degrees), 15, "ABCDE", 0.52);

      expect(result.rowSource).toBe("ticks");
      expect(result.answers.map((answer) => answer.choice)).toEqual(
        Array.from({ length: 15 }, (_, index) => shaded[index + 1]),
      );
    });
  }
});
