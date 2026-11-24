// A chessboard: eight by eight squares, the pieces on them, and the marks that say
// what is going on.
//
// Pure presentation, and the board twin of `PlayingCard` and `MahjongTile`. It takes a
// row of squares and draws them — it knows nothing about whose turn it is, which moves
// are legal or what a piece is worth. Every one of those is decided in
// `src/lib/games/game-chess.ts` and handed in as props, which is what lets the same
// component draw a live game, a replayed position or a puzzle.
//
// The pieces are drawn as SVG rather than set in the Unicode chess block
// (U+2654-U+265F), the same call `PlayingCard` and `MahjongTile` both make. Those code
// points exist everywhere, but the white pieces are outlines and the black ones are
// solid, so which is which depends on the font — and on several platforms they render
// as emoji, at a size and colour the page does not control. Drawing them costs more
// code once and then renders identically everywhere, scales to any square size, and
// lets both colours be tinted so a white piece still reads on a light square.
//
// The board's own colours are literal values in `globals.css`, not theme tokens. That
// is the licence design.md grants the mahjong tile — "it's an object, not a surface" —
// and it is taken for the same reason: a chessboard rendered in Daybreak's white and
// Copper Vault's near-black is not a light-mode and a dark-mode board, it is two
// different boards, and only one of them is the game people know. Everything *around*
// the board stays on theme tokens.

import { useRef, useState, type CSSProperties, type ReactElement } from "react";
import { squareName, type ChessColor, type ChessPieceType } from "@/lib/games";

/** One piece, as the board draws it. */
export interface ChessBoardPiece {
  type: ChessPieceType;
  color: ChessColor;
}

/**
 * Which side attacks or defends each square, for the sphere-of-influence aid. Two
 * arrays of 64, in board order.
 */
export interface ChessBoardInfluence {
  mine: readonly boolean[];
  theirs: readonly boolean[];
}

/** A move the board marks, as a pair of squares. */
export interface ChessBoardMove {
  from: number;
  to: number;
}

export interface ChessBoardProps {
  /**
   * The 64 squares in **board order** — index 0 is a8, index 63 is h1 — never in
   * display order. Flipping for Black is this component's job, so a caller cannot get
   * the board mirrored on one screen and not another.
   */
  squares: readonly (ChessBoardPiece | null)[];
  /** Which side sits at the bottom. Defaults to White. */
  orientation?: ChessColor;
  /** The square the player has picked up, if any. */
  selected?: number;
  /** Squares that piece may move to — drawn as a dot, or a ring over a capture. */
  targets?: readonly number[];
  /** The move just played, marked on both of its squares. */
  lastMove?: ChessBoardMove;
  /** A king in check. Drawn in the danger colour. */
  checkSquare?: number;
  /** A suggested move, from the Hint button. */
  hint?: ChessBoardMove;
  /**
   * Every square the player could move some piece to this turn — the **Show valid
   * moves** aid, drawn as a soft wash under everything else.
   */
  reachable?: readonly number[];
  /** The player's pieces that have a legal move. Outlined, so they read as pickable. */
  movable?: readonly number[];
  /**
   * Who controls each square — the **sphere of influence** aid. Drawn as a small corner
   * wedge per side rather than a wash, so a contested square can show both and so it
   * layers under the selection, last-move, check and hint marks instead of fighting them.
   */
  influence?: ChessBoardInfluence;
  /** Raised with the square's **board** index, whatever the orientation. */
  onSquare?: (square: number) => void;
  /**
   * Raised when a piece is dragged onto another square — the same intent as tapping
   * the piece and then the target, and the parent should treat it that way.
   */
  onDragMove?: (from: number, to: number) => void;
  /**
   * The move to slide in, played once when it changes.
   *
   * Separate from `lastMove`, which marks two squares and stays marked: this is a
   * one-shot animation, and conflating them would replay the slide on every unrelated
   * re-render.
   */
  animate?: ChessBoardMove;
  /** Stops every square being pressed — while the computer is thinking, or once over. */
  disabled?: boolean;
  /** File letters and rank digits in the margins of the squares. On by default. */
  showCoordinates?: boolean;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

const FILES = "abcdefgh";

export function ChessBoard({
  squares,
  orientation = "w",
  selected,
  targets,
  lastMove,
  checkSquare,
  hint,
  reachable,
  movable,
  influence,
  onSquare,
  onDragMove,
  animate,
  disabled = false,
  showCoordinates = true,
  className = "",
}: ChessBoardProps) {
  // Display order. Reading the array backwards is the whole of "flip the board": the
  // 64 squares are the same squares, met from the other end.
  const order = Array.from({ length: 64 }, (_, index) =>
    orientation === "w" ? index : 63 - index,
  );
  const targetSet = new Set(targets ?? []);
  const reachableSet = new Set(reachable ?? []);
  const movableSet = new Set(movable ?? []);

  /** The square a drag started from, while one is in progress. */
  const [dragging, setDragging] = useState<number | undefined>(undefined);

  /*
    Which square holds keyboard focus.

    Sixty-four buttons in a row is sixty-four tab stops, which makes reaching the board
    with a keyboard an exercise in patience. One stop plus arrow keys is how a grid of
    controls is meant to behave: the board takes focus once and the arrows walk it.
  */
  const [focused, setFocused] = useState(() => (orientation === "w" ? 60 : 4));
  const boardRef = useRef<HTMLDivElement>(null);

  /** Moves keyboard focus by one square, in the direction the board is drawn. */
  function moveFocus(rowStep: number, fileStep: number) {
    const flip = orientation === "w" ? 1 : -1;
    const row = Math.floor(focused / 8) + rowStep * flip;
    const file = (focused % 8) + fileStep * flip;
    if (row < 0 || row > 7 || file < 0 || file > 7) return;

    const next = row * 8 + file;
    setFocused(next);
    // The button has to be told to take focus; React only re-renders the attribute.
    boardRef.current?.querySelector<HTMLButtonElement>(`[data-square="${next}"]`)?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const steps: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const step = steps[event.key];
    if (!step) return;
    event.preventDefault();
    moveFocus(step[0], step[1]);
  }

  return (
    <div
      className={`chess-board grid aspect-square w-full grid-cols-8 ${className}`}
      // A labelled group of 64 buttons rather than `role="grid"`. A real grid wants
      // `gridcell` wrappers around the buttons, and `gridcell` does not take
      // `aria-pressed` — which is what says a piece has been picked up, and the one
      // piece of state a screen reader most needs here.
      role="group"
      aria-label="Chessboard"
      ref={boardRef}
      onKeyDown={onKeyDown}
    >
      {order.map((square) => {
        const piece = squares[square] ?? null;
        const file = square % 8;
        const row = Math.floor(square / 8);
        const isTarget = targetSet.has(square);

        // The bottom and left edges of the board *as drawn*, which swap when it flips.
        const onBottomEdge = orientation === "w" ? row === 7 : row === 0;
        const onLeftEdge = orientation === "w" ? file === 0 : file === 7;

        const marks = [
          (row + file) % 2 === 0 ? "chess-square-light" : "chess-square-dark",
          square === dragging ? "chess-square-dragging" : "",
          square === selected ? "chess-square-selected" : "",
          square === checkSquare ? "chess-square-check" : "",
          lastMove && (square === lastMove.from || square === lastMove.to)
            ? "chess-square-last"
            : "",
          hint && (square === hint.from || square === hint.to) ? "chess-square-hint" : "",
        ]
          .filter(Boolean)
          .join(" ");

        return (
          <button
            key={square}
            type="button"
            // A plain button rather than `Button`: these are 64 cells in a grid, not
            // discrete page actions, so they follow `.sudoku-cell` and `.calc-key`
            // rather than taking the hard offset shadow sixty-four times over. See
            // design.md, "A dense grid of keys is not a row of buttons".
            className={`chess-square ${marks}`}
            data-square={square}
            // Disabled rather than hidden, so the board stays readable while the
            // computer thinks and the layout never shifts.
            disabled={disabled}
            onClick={() => onSquare?.(square)}
            aria-label={describeSquare(square, piece)}
            aria-pressed={square === selected}
            // One tab stop for the whole board; the arrows walk it from there.
            tabIndex={square === focused ? 0 : -1}
            onFocus={() => setFocused(square)}
            /*
              Dragging a piece is the other way to say "this one, to there" — the same
              intent as the two taps, so it is reported as one move rather than as two
              separate square presses. Tapping still works unchanged, which matters: a
              drag is awkward on a phone and impossible with a keyboard.
            */
            draggable={!disabled && piece !== null}
            onDragStart={(event) => {
              if (disabled || !piece) return;
              setDragging(square);
              event.dataTransfer.effectAllowed = "move";
              // Firefox ignores a drag that carries no payload.
              event.dataTransfer.setData("text/plain", String(square));
            }}
            onDragEnd={() => setDragging(undefined)}
            onDragOver={(event) => {
              if (disabled || dragging === undefined) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }}
            onDrop={(event) => {
              event.preventDefault();
              const from = dragging;
              setDragging(undefined);
              if (disabled || from === undefined || from === square) return;
              onDragMove?.(from, square);
            }}
          >
            {showCoordinates && onBottomEdge && (
              <span className="chess-coord chess-coord-file" aria-hidden="true">
                {FILES[file]}
              </span>
            )}
            {showCoordinates && onLeftEdge && (
              <span className="chess-coord chess-coord-rank" aria-hidden="true">
                {8 - row}
              </span>
            )}

            {/*
              The two learning aids, furthest back of all the marks: a wash for a square
              the player can reach, an outline for a piece that can move, and a corner
              wedge per side for who controls the square. All `pointer-events: none`, so
              none of them changes what a tap does.
            */}
            {reachableSet.has(square) && (
              <span className="chess-reachable" aria-hidden="true" />
            )}
            {movableSet.has(square) && <span className="chess-movable" aria-hidden="true" />}
            {influence?.mine[square] && (
              <span className="chess-influence chess-influence-mine" aria-hidden="true" />
            )}
            {influence?.theirs[square] && (
              <span className="chess-influence chess-influence-theirs" aria-hidden="true" />
            )}

            {/* The move dot sits under the piece, so a capture shows as a ring around
                what is being taken rather than a dot on top of it. */}
            {isTarget && (
              <span
                className={piece ? "chess-capture-ring" : "chess-move-dot"}
                aria-hidden="true"
              />
            )}

            {piece && (
              <ChessPieceGlyph
                piece={piece}
                className={animate && animate.to === square ? "chess-piece-arriving" : ""}
                /*
                  The slide: the piece starts drawn at the square it came from and
                  travels to where it now is. One CSS animation with the distance passed
                  in, rather than an overlay of floating pieces — the squares are a
                  uniform grid, so the offset is just the difference in rows and files.
                */
                style={
                  animate && animate.to === square
                    ? ({
                        "--chess-slide-x": `${((animate.from % 8) - file) * (orientation === "w" ? 100 : -100)}%`,
                        "--chess-slide-y": `${(Math.floor(animate.from / 8) - row) * (orientation === "w" ? 100 : -100)}%`,
                      } as CSSProperties)
                    : undefined
                }
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

/** A square's accessible name: where it is and what is on it. */
function describeSquare(square: number, piece: ChessBoardPiece | null): string {
  const name = squareName(square);
  if (!piece) return `${name}, empty`;
  return `${name}, ${piece.color === "w" ? "white" : "black"} ${PIECE_NAMES[piece.type]}`;
}

const PIECE_NAMES: Record<ChessPieceType, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};

/**
 * One piece.
 *
 * Both colours are drawn from the same paths and told apart by fill and stroke, rather
 * than by two sets of artwork. A white piece is a light body with a dark outline and a
 * black piece is the reverse, so **both read on both square colours** — which an
 * untinted glyph does not: solid black on a dark square is a silhouette of nothing.
 */
export function ChessPieceGlyph({
  piece,
  className = "",
  style,
}: {
  piece: ChessBoardPiece;
  className?: string;
  style?: CSSProperties;
}): ReactElement {
  return (
    <svg
      viewBox="0 0 45 45"
      className={`chess-piece ${piece.color === "w" ? "chess-piece-white" : "chess-piece-black"} ${className}`}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      {PIECE_SHAPES[piece.type]}
    </svg>
  );
}

/**
 * The six pieces, each as filled shapes on a 45x45 field.
 *
 * Deliberately simple silhouettes rather than engraved Staunton artwork: the board is
 * drawn at anything from a 34px square on a phone to 90px on a monitor, and detail that
 * only exists at the large end turns into noise at the small one. The shapes are the
 * ones the eye actually uses to tell the pieces apart — the pawn's ball, the rook's
 * battlements, the knight's muzzle, the bishop's mitre and slit, the queen's points,
 * the king's cross.
 */
const PIECE_SHAPES: Record<ChessPieceType, ReactElement> = {
  p: (
    <g>
      <circle cx="22.5" cy="12" r="4.6" />
      <path d="M22.5 16.8c-3.3 0-5.5 2.4-4.4 5-2.9 1.9-4.7 5.1-4.7 8.7h18.2c0-3.6-1.8-6.8-4.7-8.7 1.1-2.6-1.1-5-4.4-5z" />
      <path d="M12.5 31.5h20l2.5 6.5H10z" />
    </g>
  ),
  r: (
    <g>
      <path d="M12 9h5v3.5h4V9h3v3.5h4V9h5v8.5l-3 2.5v9l3 2.5V31H12v-5.5l3-2.5v-9l-3-2.5z" />
      <path d="M11 31h23l2 7H9z" />
    </g>
  ),
  n: (
    <g>
      {/* Muzzle out to the left, mane sweeping down to the right. */}
      <path d="M21 7l-4.5 6.5-3.5 2.3A8 8 0 0 0 9 22.4V27l5.5-3.3L18 27l4-3v8h11v-7.5C33 15.5 28 9.5 21 7z" />
      <path d="M11 32h22l2.5 6H8.5z" />
      <circle cx="20.5" cy="15.5" r="1.3" className="chess-piece-eye" />
    </g>
  ),
  b: (
    <g>
      <circle cx="22.5" cy="8.5" r="2.7" />
      <path d="M22.5 11.5c-5 2.3-8.3 6.8-8.3 11.7 0 3.2 1.4 5.9 3.6 7.6h9.4c2.2-1.7 3.6-4.4 3.6-7.6 0-4.9-3.3-9.4-8.3-11.7z" />
      {/* The mitre's slit — the one detail that separates a bishop from a pawn. */}
      <path d="M22.5 15.5l4.5 5.5" className="chess-piece-cut" />
      <path d="M13.5 31h18l2.5 7H11z" />
    </g>
  ),
  q: (
    <g>
      <circle cx="8.5" cy="13" r="2.3" />
      <circle cx="15.5" cy="9.5" r="2.3" />
      <circle cx="22.5" cy="8" r="2.5" />
      <circle cx="29.5" cy="9.5" r="2.3" />
      <circle cx="36.5" cy="13" r="2.3" />
      <path d="M8.5 15.5 12.5 31h20l4-15.5-5.5 7.5-3.5-11-5 11-5-11-3.5 11z" />
      <path d="M11.5 31h22l2.5 7H9z" />
    </g>
  ),
  k: (
    <g>
      <path d="M22.5 5.5v8M18.5 9h8" className="chess-piece-cut" />
      <path d="M22.5 14c-5.4 0-9.5 3.8-9.5 8.6 0 3.6 2.4 6.3 5 8.2l4.5 3.3 4.5-3.3c2.6-1.9 5-4.6 5-8.2 0-4.8-4.1-8.6-9.5-8.6z" />
      <path d="M11.5 33h22l2.5 6H9z" />
    </g>
  ),
};
