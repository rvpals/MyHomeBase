import { describe, expect, it } from "vitest";
import {
  canPlace,
  cellsOf,
  clearLines,
  dropIntervalMs,
  emptyField,
  ghostPiece,
  hardDrop,
  holdPiece,
  isLanded,
  levelFor,
  lockPiece,
  moveHorizontal,
  rotate,
  softDrop,
  spawnPiece,
  startGame,
  tick,
} from "./game-tetris";
import {
  BUFFER_ROWS,
  LOCK_DELAY_TICKS,
  PLAYFIELD_WIDTH,
  TOTAL_HEIGHT,
  type ActivePiece,
  type PieceKind,
  type Playfield,
  type TetrisState,
} from "./types";

/** A deterministic RNG: replays the given values, then repeats the last one. */
function rng(...values: number[]) {
  let call = 0;
  return () => values[Math.min(call++, values.length - 1)] ?? 0;
}

/** A fixed RNG for cases where the pieces dealt do not matter. */
const fixed = () => 0;

/** A field with the given cells filled, for building specific stack shapes. */
function fieldWith(cells: readonly { row: number; col: number }[]): Playfield {
  const field = [...emptyField()];
  for (const cell of cells) field[cell.row * PLAYFIELD_WIDTH + cell.col] = "T";
  return field;
}

/** Every column of `row` filled except those in `gaps`. */
function fullRow(row: number, gaps: readonly number[] = []) {
  const cells: { row: number; col: number }[] = [];
  for (let col = 0; col < PLAYFIELD_WIDTH; col += 1) {
    if (!gaps.includes(col)) cells.push({ row, col });
  }
  return cells;
}

/** A state built around a specific field and piece, with sane defaults elsewhere. */
function stateWith(field: Playfield, active: ActivePiece, over: Partial<TetrisState> = {}): TetrisState {
  return {
    field,
    active,
    queue: ["T", "T", "T", "T", "T"],
    hold: undefined,
    holdUsed: false,
    score: 0,
    lines: 0,
    level: 1,
    pieces: 0,
    lastClear: undefined,
    restingTicks: 0,
    outcome: undefined,
    ...over,
  };
}

describe("cellsOf", () => {
  it("places the spawn shape relative to the piece origin", () => {
    const cells = cellsOf({ kind: "O", rotation: 0, row: 5, col: 4 });
    expect(cells).toEqual([
      { row: 5, col: 4 },
      { row: 5, col: 5 },
      { row: 6, col: 4 },
      { row: 6, col: 5 },
    ]);
  });

  it("rotates a T clockwise within its box", () => {
    // Spawn T points up: the nub is above the middle of the bar. One turn clockwise
    // must point it RIGHT — asserted explicitly, because a transposed rotation is the
    // orientation trap that silently does the wrong thing in one axis only.
    const turned = cellsOf({ kind: "T", rotation: 1, row: 0, col: 0 });
    expect(turned).toEqual([
      { row: 1, col: 2 },
      { row: 0, col: 1 },
      { row: 1, col: 1 },
      { row: 2, col: 1 },
    ]);
  });

  it("returns an O piece unchanged in every rotation", () => {
    const base = cellsOf({ kind: "O", rotation: 0, row: 3, col: 3 });
    for (const rotation of [1, 2, 3] as const) {
      expect(cellsOf({ kind: "O", rotation, row: 3, col: 3 })).toEqual(base);
    }
  });

  it("returns a piece to its start after four turns", () => {
    const start = cellsOf({ kind: "J", rotation: 0, row: 2, col: 2 });
    expect(cellsOf({ kind: "J", rotation: 0, row: 2, col: 2 })).toEqual(start);
    // Four quarter-turns is the identity; rotation is modular so 4 wraps to 0.
    expect(cellsOf({ kind: "J", rotation: (4 % 4) as 0, row: 2, col: 2 })).toEqual(start);
  });
});

describe("canPlace", () => {
  const field = emptyField();

  it("accepts a piece inside the playfield", () => {
    expect(canPlace(field, { kind: "T", rotation: 0, row: 5, col: 4 })).toBe(true);
  });

  it("rejects a piece past the left wall", () => {
    expect(canPlace(field, { kind: "T", rotation: 0, row: 5, col: -1 })).toBe(false);
  });

  it("rejects a piece past the right wall", () => {
    expect(canPlace(field, { kind: "T", rotation: 0, row: 5, col: PLAYFIELD_WIDTH - 1 })).toBe(false);
  });

  it("rejects a piece through the floor", () => {
    expect(canPlace(field, { kind: "T", rotation: 0, row: TOTAL_HEIGHT - 1, col: 4 })).toBe(false);
  });

  it("rejects a piece overlapping the stack", () => {
    const stacked = fieldWith([{ row: 6, col: 4 }]);
    expect(canPlace(stacked, { kind: "O", rotation: 0, row: 5, col: 4 })).toBe(false);
  });

  it("allows a piece sitting above the top of the grid", () => {
    // A spawning piece is partly in the buffer and a kick can lift it further; that
    // is not off the board, and treating it as such would refuse legal spawns.
    expect(canPlace(field, { kind: "I", rotation: 0, row: -1, col: 3 })).toBe(true);
  });
});

describe("moveHorizontal", () => {
  it("moves a piece into clear space", () => {
    const state = stateWith(emptyField(), { kind: "T", rotation: 0, row: 5, col: 4 });
    expect(moveHorizontal(state, 1).active.col).toBe(5);
    expect(moveHorizontal(state, -1).active.col).toBe(3);
  });

  it("refuses a move into the wall and leaves the state alone", () => {
    const state = stateWith(emptyField(), { kind: "O", rotation: 0, row: 5, col: 0 });
    expect(moveHorizontal(state, -1)).toBe(state);
  });

  it("refuses a move into the stack", () => {
    const state = stateWith(fieldWith([{ row: 5, col: 5 }]), {
      kind: "O",
      rotation: 0,
      row: 5,
      col: 3,
    });
    expect(moveHorizontal(state, 1)).toBe(state);
  });

  it("resets lock delay, so a landed piece can still be slid", () => {
    const state = stateWith(
      emptyField(),
      { kind: "O", rotation: 0, row: TOTAL_HEIGHT - 2, col: 4 },
      { restingTicks: LOCK_DELAY_TICKS },
    );
    expect(moveHorizontal(state, 1).restingTicks).toBe(0);
  });
});

describe("rotate", () => {
  it("turns a piece in open space", () => {
    const state = stateWith(emptyField(), { kind: "T", rotation: 0, row: 5, col: 4 });
    expect(rotate(state, 1).active.rotation).toBe(1);
    expect(rotate(state, -1).active.rotation).toBe(3);
  });

  it("kicks a piece off the wall rather than refusing the turn", () => {
    // An I flat against the left wall cannot turn in place — its vertical form needs a
    // column the box does not reach. Without kicks this silently does nothing, which
    // is the single most common way rotation feels broken.
    const state = stateWith(emptyField(), { kind: "I", rotation: 1, row: 5, col: -2 });
    const turned = rotate(state, 1);
    expect(turned).not.toBe(state);
    expect(canPlace(turned.field, turned.active)).toBe(true);
  });

  it("leaves an O piece completely untouched", () => {
    const state = stateWith(emptyField(), { kind: "O", rotation: 0, row: 5, col: 4 });
    // Not merely "same cells" — the same object, so a square cannot use the kick
    // table to shuffle sideways for free.
    expect(rotate(state, 1)).toBe(state);
  });

  it("refuses a rotation with no legal kick", () => {
    // Box an I in on all sides: every kick offset collides, so the turn is refused.
    const walls: { row: number; col: number }[] = [];
    for (let row = 0; row < TOTAL_HEIGHT; row += 1) {
      for (let col = 0; col < PLAYFIELD_WIDTH; col += 1) {
        if (col < 3 || col > 6) walls.push({ row, col });
      }
    }
    for (let col = 3; col <= 6; col += 1) {
      walls.push({ row: 4, col });
      walls.push({ row: 6, col });
    }
    const state = stateWith(fieldWith(walls), { kind: "I", rotation: 0, row: 4, col: 3 });
    expect(rotate(state, 1)).toBe(state);
  });
});

describe("clearLines", () => {
  it("clears a full row and reports it", () => {
    const field = fieldWith(fullRow(TOTAL_HEIGHT - 1));
    const result = clearLines(field);
    expect(result.cleared).toBe(1);
    expect(result.field.every((cell) => cell === undefined)).toBe(true);
  });

  it("leaves a row with a gap alone", () => {
    const field = fieldWith(fullRow(TOTAL_HEIGHT - 1, [4]));
    const result = clearLines(field);
    expect(result.cleared).toBe(0);
    expect(result.field).toEqual(field);
  });

  it("shifts everything above a cleared row DOWN, not up", () => {
    // The orientation trap. A lone block two rows above a cleared line must end up
    // one row lower than it started; getting the shift backwards moves it upward and
    // no other assertion in this file would catch it.
    const field = fieldWith([
      ...fullRow(TOTAL_HEIGHT - 1),
      { row: TOTAL_HEIGHT - 3, col: 2 },
    ]);
    const result = clearLines(field);

    expect(result.cleared).toBe(1);
    expect(result.field[(TOTAL_HEIGHT - 2) * PLAYFIELD_WIDTH + 2]).toBe("T");
    expect(result.field[(TOTAL_HEIGHT - 3) * PLAYFIELD_WIDTH + 2]).toBeUndefined();
  });

  it("clears four rows at once", () => {
    const field = fieldWith([
      ...fullRow(TOTAL_HEIGHT - 1),
      ...fullRow(TOTAL_HEIGHT - 2),
      ...fullRow(TOTAL_HEIGHT - 3),
      ...fullRow(TOTAL_HEIGHT - 4),
    ]);
    expect(clearLines(field).cleared).toBe(4);
  });

  it("returns an empty field untouched", () => {
    const result = clearLines(emptyField());
    expect(result.cleared).toBe(0);
    expect(result.field.every((cell) => cell === undefined)).toBe(true);
    expect(result.rows).toEqual([]);
  });

  it("reports WHICH rows went, not just how many", () => {
    // The view animates the cleared rows before they vanish, and cannot re-derive
    // them afterwards — by then they are gone from the field.
    const field = fieldWith([...fullRow(TOTAL_HEIGHT - 1), ...fullRow(TOTAL_HEIGHT - 3)]);
    expect(clearLines(field).rows).toEqual([TOTAL_HEIGHT - 3, TOTAL_HEIGHT - 1]);
  });
});

describe("lockPiece", () => {
  it("writes the piece into the stack and spawns the next", () => {
    const state = stateWith(emptyField(), { kind: "O", rotation: 0, row: TOTAL_HEIGHT - 2, col: 4 });
    const locked = lockPiece(state, fixed);

    expect(locked.field[(TOTAL_HEIGHT - 1) * PLAYFIELD_WIDTH + 4]).toBe("O");
    expect(locked.pieces).toBe(1);
    expect(locked.outcome).toBeUndefined();
  });

  it("scores a single line at the current level", () => {
    // Nine columns filled, the O completing two of them — one line, 100 x level 1.
    const state = stateWith(
      fieldWith([...fullRow(TOTAL_HEIGHT - 1, [4, 5])]),
      { kind: "O", rotation: 0, row: TOTAL_HEIGHT - 2, col: 4 },
    );
    const locked = lockPiece(state, fixed);

    expect(locked.lines).toBe(1);
    expect(locked.score).toBe(100);
  });

  it("multiplies the line score by the level the lines were cleared at", () => {
    const state = stateWith(
      fieldWith([...fullRow(TOTAL_HEIGHT - 1, [4, 5])]),
      { kind: "O", rotation: 0, row: TOTAL_HEIGHT - 2, col: 4 },
      { level: 3 },
    );
    expect(lockPiece(state, fixed).score).toBe(300);
  });

  it("scores a four-line clear far above four singles", () => {
    const state = stateWith(
      fieldWith([
        ...fullRow(TOTAL_HEIGHT - 1, [0]),
        ...fullRow(TOTAL_HEIGHT - 2, [0]),
        ...fullRow(TOTAL_HEIGHT - 3, [0]),
        ...fullRow(TOTAL_HEIGHT - 4, [0]),
      ]),
      { kind: "I", rotation: 1, row: TOTAL_HEIGHT - 4, col: -2 },
    );
    const locked = lockPiece(state, fixed);

    expect(locked.lines).toBe(4);
    expect(locked.score).toBe(800);
  });

  it("reports the clear it produced, with the board still showing the full rows", () => {
    // What the view animates. The pre-clear field must still contain the completed
    // row — the point of carrying it is that the settled `field` no longer does.
    const state = stateWith(
      fieldWith([...fullRow(TOTAL_HEIGHT - 1, [4, 5])]),
      { kind: "O", rotation: 0, row: TOTAL_HEIGHT - 2, col: 4 },
    );
    const locked = lockPiece(state, fixed);

    expect(locked.lastClear?.rows).toEqual([TOTAL_HEIGHT - 1]);
    expect(
      locked.lastClear?.field
        .slice((TOTAL_HEIGHT - 1) * PLAYFIELD_WIDTH, TOTAL_HEIGHT * PLAYFIELD_WIDTH)
        .every((cell) => cell !== undefined),
    ).toBe(true);
  });

  it("reports no clear when the lock completed nothing", () => {
    // Must be undefined rather than an empty clear, so a re-render cannot replay the
    // previous lock's animation.
    const state = stateWith(emptyField(), { kind: "O", rotation: 0, row: TOTAL_HEIGHT - 2, col: 4 });
    expect(lockPiece(state, fixed).lastClear).toBeUndefined();
  });

  it("gives consecutive clears distinct ids", () => {
    // Two clears of the same rows are otherwise identical values, and React would see
    // no change — so the animation would not restart on the second one.
    const build = (pieces: number) =>
      lockPiece(
        stateWith(
          fieldWith([...fullRow(TOTAL_HEIGHT - 1, [4, 5])]),
          { kind: "O", rotation: 0, row: TOTAL_HEIGHT - 2, col: 4 },
          { pieces },
        ),
        fixed,
      );

    expect(build(0).lastClear?.id).not.toBe(build(1).lastClear?.id);
  });

  it("re-arms hold when the next piece spawns", () => {
    const state = stateWith(
      emptyField(),
      { kind: "O", rotation: 0, row: TOTAL_HEIGHT - 2, col: 4 },
      { holdUsed: true },
    );
    expect(lockPiece(state, fixed).holdUsed).toBe(false);
  });

  it("tops out when the new piece cannot be placed", () => {
    // Fill the spawn area so the next piece has nowhere to go.
    const blocked: { row: number; col: number }[] = [];
    for (let row = 0; row < BUFFER_ROWS + 2; row += 1) {
      for (let col = 0; col < PLAYFIELD_WIDTH; col += 1) blocked.push({ row, col });
    }
    const state = stateWith(fieldWith(blocked), {
      kind: "O",
      rotation: 0,
      row: TOTAL_HEIGHT - 2,
      col: 4,
    });

    expect(lockPiece(state, fixed).outcome).toBe("topped-out");
  });
});

describe("tick", () => {
  it("drops the piece one row when there is room", () => {
    const state = stateWith(emptyField(), { kind: "T", rotation: 0, row: 5, col: 4 });
    expect(tick(state, fixed).active.row).toBe(6);
  });

  it("does not lock a landed piece immediately", () => {
    // The grace period is what lets a piece be slid under an overhang after touching
    // down. Locking on contact would make that move impossible.
    const state = stateWith(emptyField(), { kind: "O", rotation: 0, row: TOTAL_HEIGHT - 2, col: 4 });
    const after = tick(state, fixed);

    expect(after.pieces).toBe(0);
    expect(after.restingTicks).toBe(1);
  });

  it("locks once the lock delay is exhausted", () => {
    let state = stateWith(emptyField(), { kind: "O", rotation: 0, row: TOTAL_HEIGHT - 2, col: 4 });
    for (let step = 0; step <= LOCK_DELAY_TICKS; step += 1) state = tick(state, fixed);

    expect(state.pieces).toBe(1);
    expect(state.field[(TOTAL_HEIGHT - 1) * PLAYFIELD_WIDTH + 4]).toBe("O");
  });

  it("does nothing once the game is over", () => {
    const state = stateWith(
      emptyField(),
      { kind: "T", rotation: 0, row: 5, col: 4 },
      { outcome: "topped-out" },
    );
    expect(tick(state, fixed)).toBe(state);
  });
});

describe("softDrop", () => {
  it("drops a row and scores a point", () => {
    const state = stateWith(emptyField(), { kind: "T", rotation: 0, row: 5, col: 4 });
    const after = softDrop(state, fixed);

    expect(after.active.row).toBe(6);
    expect(after.score).toBe(1);
  });

  it("does not score when the piece has nowhere to fall", () => {
    const state = stateWith(emptyField(), { kind: "O", rotation: 0, row: TOTAL_HEIGHT - 2, col: 4 });
    expect(softDrop(state, fixed).score).toBe(0);
  });
});

describe("hardDrop", () => {
  it("slams the piece to the floor and locks it in one call", () => {
    const state = stateWith(emptyField(), { kind: "O", rotation: 0, row: 2, col: 4 });
    const after = hardDrop(state, fixed);

    expect(after.pieces).toBe(1);
    expect(after.field[(TOTAL_HEIGHT - 1) * PLAYFIELD_WIDTH + 4]).toBe("O");
  });

  it("scores two points per cell fallen", () => {
    const state = stateWith(emptyField(), { kind: "O", rotation: 0, row: 2, col: 4 });
    const distance = TOTAL_HEIGHT - 2 - 2;
    expect(hardDrop(state, fixed).score).toBe(distance * 2);
  });

  it("lands on the stack rather than through it", () => {
    const state = stateWith(fieldWith([{ row: 15, col: 4 }]), {
      kind: "O",
      rotation: 0,
      row: 2,
      col: 4,
    });
    expect(hardDrop(state, fixed).field[13 * PLAYFIELD_WIDTH + 4]).toBe("O");
  });
});

describe("ghostPiece", () => {
  it("reports where the piece would land", () => {
    const ghost = ghostPiece(emptyField(), { kind: "O", rotation: 0, row: 2, col: 4 });
    expect(ghost.row).toBe(TOTAL_HEIGHT - 2);
  });

  it("stops on top of the stack", () => {
    const ghost = ghostPiece(fieldWith([{ row: 15, col: 4 }]), {
      kind: "O",
      rotation: 0,
      row: 2,
      col: 4,
    });
    expect(ghost.row).toBe(13);
  });
});

describe("holdPiece", () => {
  it("stows the active piece when the slot is empty", () => {
    const state = stateWith(emptyField(), { kind: "L", rotation: 0, row: 5, col: 4 });
    const after = holdPiece(state, fixed);

    expect(after.hold).toBe("L");
    expect(after.active.kind).not.toBe("L");
    expect(after.holdUsed).toBe(true);
  });

  it("swaps with the held piece when the slot is full", () => {
    const state = stateWith(
      emptyField(),
      { kind: "L", rotation: 0, row: 5, col: 4 },
      { hold: "I" },
    );
    const after = holdPiece(state, fixed);

    expect(after.hold).toBe("L");
    expect(after.active.kind).toBe("I");
  });

  it("refuses a second hold for the same piece", () => {
    // Without this rule, holding swaps the same two pieces forever and gravity never
    // advances — a player could park a game indefinitely.
    const state = stateWith(
      emptyField(),
      { kind: "L", rotation: 0, row: 5, col: 4 },
      { hold: "I", holdUsed: true },
    );
    expect(holdPiece(state, fixed)).toBe(state);
  });

  it("resets the piece to spawn orientation rather than keeping its rotation", () => {
    const state = stateWith(
      emptyField(),
      { kind: "L", rotation: 2, row: 12, col: 4 },
      { hold: "J" },
    );
    const after = holdPiece(state, fixed);
    expect(after.active).toEqual(spawnPiece("J"));
  });
});

describe("levelFor and dropIntervalMs", () => {
  it("starts at level 1 and rises every ten lines", () => {
    expect(levelFor(0)).toBe(1);
    expect(levelFor(9)).toBe(1);
    expect(levelFor(10)).toBe(2);
    expect(levelFor(25)).toBe(3);
  });

  it("speeds up as the level rises", () => {
    expect(dropIntervalMs(2)).toBeLessThan(dropIntervalMs(1));
    expect(dropIntervalMs(10)).toBeLessThan(dropIntervalMs(5));
  });

  it("never reaches a zero interval, however long the run", () => {
    // A zero-length interval would spin the view's timer rather than end the game.
    expect(dropIntervalMs(100)).toBeGreaterThan(0);
    expect(dropIntervalMs(1000)).toBeGreaterThanOrEqual(60);
  });
});

describe("startGame", () => {
  it("deals a playable opening position", () => {
    const state = startGame(rng(0.1, 0.5, 0.9));

    expect(state.field.every((cell) => cell === undefined)).toBe(true);
    expect(canPlace(state.field, state.active)).toBe(true);
    expect(state.outcome).toBeUndefined();
    expect(state.score).toBe(0);
    expect(state.level).toBe(1);
  });

  it("keeps enough pieces queued to fill the preview", () => {
    const state = startGame(fixed);
    expect(state.queue.length).toBeGreaterThanOrEqual(3);
  });

  it("deals all seven pieces before repeating any", () => {
    // The bag guarantee: without it, raw per-piece randomness can deal five S pieces
    // in a row, which reads as the game cheating rather than as bad luck.
    let state = startGame(Math.random);
    const dealt: PieceKind[] = [state.active.kind];
    while (dealt.length < 7) {
      state = { ...state, active: spawnPiece(state.queue[0]), queue: state.queue.slice(1) };
      dealt.push(state.active.kind);
    }
    expect(new Set(dealt).size).toBe(7);
  });
});

describe("isLanded", () => {
  it("is false in open air and true on the floor", () => {
    expect(isLanded(emptyField(), { kind: "O", rotation: 0, row: 5, col: 4 })).toBe(false);
    expect(
      isLanded(emptyField(), { kind: "O", rotation: 0, row: TOTAL_HEIGHT - 2, col: 4 }),
    ).toBe(true);
  });

  it("is true when resting on the stack", () => {
    expect(isLanded(fieldWith([{ row: 8, col: 4 }]), { kind: "O", rotation: 0, row: 6, col: 4 })).toBe(
      true,
    );
  });
});
