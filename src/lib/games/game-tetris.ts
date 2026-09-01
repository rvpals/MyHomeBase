import {
  BUFFER_ROWS,
  HARD_DROP_POINTS,
  LINES_PER_LEVEL,
  LINE_SCORES,
  LOCK_DELAY_TICKS,
  PIECE_KINDS,
  PLAYFIELD_WIDTH,
  SOFT_DROP_POINTS,
  TOTAL_HEIGHT,
  type ActivePiece,
  type PieceCell,
  type PieceKind,
  type Playfield,
  type Rotation,
  type TetrisState,
} from "./types";

/**
 * The rules of Tetris, as pure functions over an immutable `TetrisState`.
 *
 * Nothing here touches React, the DOM, a timer or `Math.random` directly. Gravity is
 * `tick(state, random)` — a function the view calls on an interval, not a loop this
 * module owns. That is what makes drop speed, lock delay and line clears testable
 * without waiting on a real clock, and it is the same trade `game-2048.ts` makes by
 * taking its RNG as an argument.
 *
 * Every exported function returns a NEW state and never mutates its argument, so the
 * view can hold one in `useState` and React sees each move as a change.
 */

/** A source of randomness in [0, 1). `Math.random` in the app; a stub in tests. */
export type Random = () => number;

/**
 * The shapes, as filled cells within a square rotation box at spawn orientation.
 *
 * Written as coordinate pairs in a box of `size` rather than as ASCII art, because
 * rotation is arithmetic on those coordinates (see `rotateCell`) and a picture would
 * have to be parsed before it could be turned. The boxes are the standard SRS ones:
 * I is 4 wide, O is 2, and the other five are 3 — which is what makes the O piece
 * famously immune to rotation and the I piece kick the furthest.
 */
const SHAPES: Record<PieceKind, { size: number; cells: readonly PieceCell[] }> = {
  I: { size: 4, cells: [{ row: 1, col: 0 }, { row: 1, col: 1 }, { row: 1, col: 2 }, { row: 1, col: 3 }] },
  O: { size: 2, cells: [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 1, col: 0 }, { row: 1, col: 1 }] },
  T: { size: 3, cells: [{ row: 0, col: 1 }, { row: 1, col: 0 }, { row: 1, col: 1 }, { row: 1, col: 2 }] },
  S: { size: 3, cells: [{ row: 0, col: 1 }, { row: 0, col: 2 }, { row: 1, col: 0 }, { row: 1, col: 1 }] },
  Z: { size: 3, cells: [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 1, col: 1 }, { row: 1, col: 2 }] },
  J: { size: 3, cells: [{ row: 0, col: 0 }, { row: 1, col: 0 }, { row: 1, col: 1 }, { row: 1, col: 2 }] },
  L: { size: 3, cells: [{ row: 0, col: 2 }, { row: 1, col: 0 }, { row: 1, col: 1 }, { row: 1, col: 2 }] },
};

/**
 * Wall-kick offsets, tried in order when a rotation collides.
 *
 * A rotation that would overlap the wall or the stack is not simply refused — the
 * piece is nudged and retried, which is what lets you spin a piece flush against the
 * wall or tuck one into a notch. Without kicks, rotation next to a wall silently does
 * nothing and the game feels broken.
 *
 * `[0, 0]` is first, so an unobstructed rotation never moves. The rest are the SRS
 * offsets collapsed to one table per piece class rather than one per rotation pair:
 * the full table is indexed by the *pair* of states and is largely symmetric, and this
 * arcade does not need T-spin scoring — the only thing the exact per-pair table buys
 * over this is which of two equally valid kicks wins in a rare cramped position.
 *
 * I kicks two cells because it is four long and its rotation box overhangs further.
 * O has no entry: it is rotationally symmetric and `rotate` returns it untouched.
 */
const KICKS: Record<"I" | "default", readonly (readonly [number, number])[]> = {
  // [colOffset, rowOffset]. Row grows downward, so a negative row is upward.
  I: [
    [0, 0],
    [-2, 0],
    [1, 0],
    [-2, -1],
    [1, 2],
  ],
  default: [
    [0, 0],
    [-1, 0],
    [1, 0],
    [0, -1],
    [-1, -1],
    [1, -1],
    [0, 1],
  ],
};

/** An all-empty playfield, buffer rows included. */
export function emptyField(): Playfield {
  return new Array<PieceKind | undefined>(TOTAL_HEIGHT * PLAYFIELD_WIDTH).fill(undefined);
}

/** The flat-array index of a cell. Callers must range-check first. */
function indexOf(row: number, col: number): number {
  return row * PLAYFIELD_WIDTH + col;
}

/**
 * One cell of a shape, turned `rotation` quarter-turns clockwise within its box.
 *
 * The whole rotation system is this one line of arithmetic: turning a point clockwise
 * in a square of side `n` sends `(row, col)` to `(col, n - 1 - row)`. Applying it
 * `rotation` times is cheaper to verify than four hand-written copies of each shape,
 * and it cannot drift out of sync the way four transcribed tables can.
 */
function rotateCell(cell: PieceCell, size: number, rotation: Rotation): PieceCell {
  let { row, col } = cell;
  for (let turn = 0; turn < rotation; turn += 1) {
    const nextRow = col;
    const nextCol = size - 1 - row;
    row = nextRow;
    col = nextCol;
  }
  return { row, col };
}

/**
 * The board cells a piece currently occupies.
 *
 * The single place a piece's kind, rotation and origin become concrete cells. Every
 * collision test, the lock, the ghost and the view all go through here, so there is
 * one definition of where a piece *is*.
 */
export function cellsOf(piece: ActivePiece): PieceCell[] {
  const shape = SHAPES[piece.kind];
  return shape.cells.map((cell) => {
    const turned = rotateCell(cell, shape.size, piece.rotation);
    return { row: piece.row + turned.row, col: piece.col + turned.col };
  });
}

/**
 * Whether a piece can sit where it is: on the board, and not overlapping the stack.
 *
 * Above the top of the grid is deliberately allowed — a piece spawns partly in the
 * buffer and rises out of it during a kick — so only `row >= TOTAL_HEIGHT` is off the
 * board vertically. The walls and the floor are hard limits.
 */
export function canPlace(field: Playfield, piece: ActivePiece): boolean {
  return cellsOf(piece).every((cell) => {
    if (cell.col < 0 || cell.col >= PLAYFIELD_WIDTH) return false;
    if (cell.row >= TOTAL_HEIGHT) return false;
    if (cell.row < 0) return true;
    return field[indexOf(cell.row, cell.col)] === undefined;
  });
}

/**
 * A piece at its spawn position: horizontally centred, resting in the buffer rows.
 *
 * Centring uses the shape's box width so an I spawns across the middle four columns
 * rather than off to one side. The row places the box's filled rows inside the buffer,
 * which is what keeps a fresh piece from being drawn clipped at the top of the board.
 */
export function spawnPiece(kind: PieceKind): ActivePiece {
  const shape = SHAPES[kind];
  return {
    kind,
    rotation: 0,
    row: kind === "I" ? BUFFER_ROWS - 2 : BUFFER_ROWS - 1,
    col: Math.floor((PLAYFIELD_WIDTH - shape.size) / 2),
  };
}

/**
 * One shuffled bag of all seven pieces.
 *
 * Not `random()` per piece, which is the obvious implementation and the wrong one: it
 * can deal five S-pieces in a row and can starve you of an I for thirty turns, both of
 * which read as the game cheating rather than as bad luck. Dealing a shuffled bag of
 * all seven bounds the worst-case gap between two I pieces at twelve, which is the
 * standard guarantee players expect.
 *
 * Fisher-Yates, so every ordering is equally likely.
 */
function shuffledBag(random: Random): PieceKind[] {
  const bag = [...PIECE_KINDS];
  for (let index = bag.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [bag[index], bag[swap]] = [bag[swap], bag[index]];
  }
  return bag;
}

/**
 * Ensures the queue holds at least `PREVIEW_COUNT + 1` pieces, refilling by the bag.
 *
 * Refilling is a pure function of the queue rather than a generator object so the
 * whole game state stays a plain value — one that can be snapshotted, compared in a
 * test, and held in `useState` without a mutable instance travelling alongside it.
 */
function refill(queue: readonly PieceKind[], random: Random): PieceKind[] {
  const next = [...queue];
  while (next.length <= PREVIEW_COUNT) next.push(...shuffledBag(random));
  return next;
}

/** How many upcoming pieces the view shows. */
export const PREVIEW_COUNT = 3;

/** A fresh game: an empty field, a first piece, and a stocked queue. */
export function startGame(random: Random): TetrisState {
  const queue = refill([], random);
  const [first, ...rest] = queue;

  return {
    field: emptyField(),
    active: spawnPiece(first),
    queue: refill(rest, random),
    hold: undefined,
    holdUsed: false,
    score: 0,
    lines: 0,
    level: 1,
    pieces: 0,
    lastClear: undefined,
    restingTicks: 0,
    outcome: undefined,
  };
}

/**
 * How long a piece rests before gravity pulls it down one row, in milliseconds.
 *
 * Exported because the view's interval is driven by it: the timer's *period* is the
 * game's only real-time quantity, and keeping the curve here means the view holds no
 * opinion about difficulty.
 *
 * Roughly the classic curve — comfortably slow at level 1, unplayable in the high
 * teens — floored at 60ms so a very long run cannot reach a zero-length interval and
 * spin the timer.
 */
export function dropIntervalMs(level: number): number {
  return Math.max(60, Math.round(800 * Math.pow(0.85, level - 1)));
}

/** Moves the piece sideways if the destination is clear; otherwise returns the state. */
export function moveHorizontal(state: TetrisState, offset: -1 | 1): TetrisState {
  if (state.outcome) return state;

  const moved = { ...state.active, col: state.active.col + offset };
  if (!canPlace(state.field, moved)) return state;

  // Resetting the rest counter is what lets a piece be slid along the floor into a
  // gap: without it, lock delay would expire mid-slide and strand the piece.
  return { ...state, active: moved, restingTicks: 0 };
}

/**
 * Rotates the piece, nudging it out of the way if the turn would collide.
 *
 * Each kick offset is tried in order and the first that fits wins; if none do, the
 * rotation is refused and the state comes back untouched. O returns immediately —
 * a square is the same square in every orientation, and running it through the kick
 * table would let it shuffle sideways for free.
 */
export function rotate(state: TetrisState, turns: 1 | -1): TetrisState {
  if (state.outcome || state.active.kind === "O") return state;

  const rotation = (((state.active.rotation + turns) % 4) + 4) % 4;
  const kicks = state.active.kind === "I" ? KICKS.I : KICKS.default;

  for (const [colOffset, rowOffset] of kicks) {
    const candidate: ActivePiece = {
      ...state.active,
      rotation: rotation as Rotation,
      row: state.active.row + rowOffset,
      col: state.active.col + colOffset,
    };
    if (canPlace(state.field, candidate)) {
      return { ...state, active: candidate, restingTicks: 0 };
    }
  }

  return state;
}

/** Whether the piece is sitting on the stack or the floor. */
export function isLanded(field: Playfield, piece: ActivePiece): boolean {
  return !canPlace(field, { ...piece, row: piece.row + 1 });
}

/**
 * Clears every full row, returning the new field and **which** rows went.
 *
 * Kept apart from `lockPiece` because it is the rule most worth testing on its own:
 * rows above a cleared one must shift **down**, and getting that backwards is the
 * orientation trap the 2048 tests warn about. Rebuilding the field from its surviving
 * rows — rather than splicing in place — makes the shift direction explicit.
 *
 * `rows` carries the indexes the clear consumed, in the coordinates of the field that
 * was passed *in*. The count alone would be enough to score the move, but not enough
 * to animate it: the view has to know which lines to flash before they vanish, and
 * re-deriving them afterwards is impossible because the rows are gone by then.
 */
export function clearLines(field: Playfield): {
  field: Playfield;
  cleared: number;
  rows: number[];
} {
  const kept: (PieceKind | undefined)[][] = [];
  const rows: number[] = [];

  for (let row = 0; row < TOTAL_HEIGHT; row += 1) {
    const cells = field.slice(indexOf(row, 0), indexOf(row, 0) + PLAYFIELD_WIDTH);
    if (cells.some((cell) => cell === undefined)) kept.push([...cells]);
    else rows.push(row);
  }

  const cleared = TOTAL_HEIGHT - kept.length;
  const blanks: (PieceKind | undefined)[][] = Array.from({ length: cleared }, () =>
    new Array<PieceKind | undefined>(PLAYFIELD_WIDTH).fill(undefined),
  );

  // New empty rows go on TOP, so everything that survived falls to the bottom.
  return { field: [...blanks, ...kept].flat(), cleared, rows };
}

/** The level a given number of cleared lines earns. Level 1 is the start. */
export function levelFor(lines: number): number {
  return Math.floor(lines / LINES_PER_LEVEL) + 1;
}

/**
 * Locks the active piece into the stack, scores any lines, and spawns the next piece.
 *
 * The one place a game can end: if the freshly spawned piece cannot be placed, the
 * stack has reached the spawn area and the run tops out. Checked on *spawn* rather
 * than by looking for blocks in the buffer rows, because a piece may legitimately rest
 * partly in the buffer without the game being over.
 */
export function lockPiece(state: TetrisState, random: Random): TetrisState {
  const field = [...state.field];
  for (const cell of cellsOf(state.active)) {
    if (cell.row >= 0) field[indexOf(cell.row, cell.col)] = state.active.kind;
  }

  const { field: cleared, cleared: count, rows } = clearLines(field);
  const lines = state.lines + count;
  const level = levelFor(lines);
  // Scored at the level the lines were cleared AT, before any level-up they caused.
  const gained = count > 0 ? LINE_SCORES[count] * state.level : 0;

  const queue = refill(state.queue, random);
  const [next, ...rest] = queue;
  const active = spawnPiece(next);

  return {
    ...state,
    field: cleared,
    active,
    queue: refill(rest, random),
    holdUsed: false,
    score: state.score + gained,
    lines,
    level,
    pieces: state.pieces + 1,
    restingTicks: 0,
    // What the view needs to play the clear out. `undefined` on a lock that cleared
    // nothing, so the view can test the field itself rather than an empty array — and
    // so a re-render cannot replay the previous lock's animation.
    lastClear:
      count > 0
        ? {
            rows,
            // The board as it looked WITH the completed rows still on it. The animation
            // needs to show what is being destroyed, and `cleared` no longer contains
            // it — by the time this state exists the rows are already gone.
            field,
            // Distinguishes two clears of the same rows in a row, which are otherwise
            // identical values and would not restart a CSS animation.
            id: state.pieces + 1,
          }
        : undefined,
    outcome: canPlace(cleared, active) ? undefined : "topped-out",
  };
}

/**
 * One step of gravity.
 *
 * The function the view's interval calls, and the only one that advances lock delay.
 * A piece with somewhere to fall falls; a landed piece accrues rest until
 * `LOCK_DELAY_TICKS` is exceeded, then locks. That grace is what makes it possible to
 * slide a piece under an overhang after it has touched down.
 */
export function tick(state: TetrisState, random: Random): TetrisState {
  if (state.outcome) return state;

  const dropped = { ...state.active, row: state.active.row + 1 };
  if (canPlace(state.field, dropped)) {
    return { ...state, active: dropped, restingTicks: 0 };
  }

  if (state.restingTicks >= LOCK_DELAY_TICKS) return lockPiece(state, random);
  return { ...state, restingTicks: state.restingTicks + 1 };
}

/**
 * A player-driven drop of one row, scoring a point for it.
 *
 * Distinct from `tick` because it pays: pressing down is a decision to give up
 * placement time for points, and a soft drop onto the stack does not lock instantly —
 * it leaves the lock delay running, so the piece can still be nudged.
 */
export function softDrop(state: TetrisState, random: Random): TetrisState {
  if (state.outcome) return state;

  const dropped = { ...state.active, row: state.active.row + 1 };
  if (!canPlace(state.field, dropped)) return tick(state, random);

  return {
    ...state,
    active: dropped,
    score: state.score + SOFT_DROP_POINTS,
    restingTicks: 0,
  };
}

/** Where the active piece would land if dropped — the ghost outline. */
export function ghostPiece(field: Playfield, piece: ActivePiece): ActivePiece {
  let ghost = piece;
  while (canPlace(field, { ...ghost, row: ghost.row + 1 })) {
    ghost = { ...ghost, row: ghost.row + 1 };
  }
  return ghost;
}

/**
 * Slams the piece to the bottom and locks it immediately.
 *
 * No lock delay here, deliberately: a hard drop is a commitment, and leaving the piece
 * nudgeable afterwards would make it indistinguishable from a fast soft drop.
 */
export function hardDrop(state: TetrisState, random: Random): TetrisState {
  if (state.outcome) return state;

  const landed = ghostPiece(state.field, state.active);
  const distance = landed.row - state.active.row;

  return lockPiece(
    {
      ...state,
      active: landed,
      score: state.score + distance * HARD_DROP_POINTS,
    },
    random,
  );
}

/**
 * Swaps the active piece with the hold slot, at most once per piece.
 *
 * The once-per-piece rule is load-bearing rather than traditional: without it, holding
 * repeatedly swaps the same two pieces forever and gravity never advances, so a player
 * could park a game indefinitely. `holdUsed` re-arms in `lockPiece`.
 *
 * A swap that cannot be placed — the stack has reached the spawn area — is refused
 * rather than ending the run, since the player still has their original piece and a
 * legal move to make with it.
 */
export function holdPiece(state: TetrisState, random: Random): TetrisState {
  if (state.outcome || state.holdUsed) return state;

  const incoming = state.hold;
  if (incoming === undefined) {
    const queue = refill(state.queue, random);
    const [next, ...rest] = queue;
    const active = spawnPiece(next);
    if (!canPlace(state.field, active)) return state;

    return {
      ...state,
      hold: state.active.kind,
      active,
      queue: refill(rest, random),
      holdUsed: true,
      restingTicks: 0,
    };
  }

  const active = spawnPiece(incoming);
  if (!canPlace(state.field, active)) return state;

  return {
    ...state,
    hold: state.active.kind,
    active,
    holdUsed: true,
    restingTicks: 0,
  };
}

/**
 * The visible board with the active piece drawn onto it.
 *
 * Buffer rows are dropped here rather than in the view, so "what the player sees" is
 * decided in the library alongside everything else. Returned as rows because that is
 * how it is drawn; every rule above still works on the flat field.
 */
export function renderRows(state: TetrisState): (PieceKind | undefined)[][] {
  const merged = [...state.field];
  for (const cell of cellsOf(state.active)) {
    if (cell.row >= 0) merged[indexOf(cell.row, cell.col)] = state.active.kind;
  }

  const rows: (PieceKind | undefined)[][] = [];
  for (let row = BUFFER_ROWS; row < TOTAL_HEIGHT; row += 1) {
    rows.push(merged.slice(indexOf(row, 0), indexOf(row, 0) + PLAYFIELD_WIDTH));
  }
  return rows;
}
