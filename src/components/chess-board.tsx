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

import { type CSSProperties, type ReactElement } from "react";
import { squareName, type ChessColor, type ChessPieceType } from "@/lib/games";

/** One piece, as the board draws it. */
export interface ChessBoardPiece {
  type: ChessPieceType;
  color: ChessColor;
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
  /** Raised with the square's **board** index, whatever the orientation. */
  onSquare?: (square: number) => void;
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
  onSquare,
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

  return (
    <div
      className={`chess-board grid aspect-square w-full grid-cols-8 ${className}`}
      // A labelled group of 64 buttons rather than `role="grid"`. A real grid wants
      // `gridcell` wrappers around the buttons, and `gridcell` does not take
      // `aria-pressed` — which is what says a piece has been picked up, and the one
      // piece of state a screen reader most needs here.
      role="group"
      aria-label="Chessboard"
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
            // Disabled rather than hidden, so the board stays readable while the
            // computer thinks and the layout never shifts.
            disabled={disabled}
            onClick={() => onSquare?.(square)}
            aria-label={describeSquare(square, piece)}
            aria-pressed={square === selected}
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

            {/* The move dot sits under the piece, so a capture shows as a ring around
                what is being taken rather than a dot on top of it. */}
            {isTarget && (
              <span
                className={piece ? "chess-capture-ring" : "chess-move-dot"}
                aria-hidden="true"
              />
            )}

            {piece && <ChessPieceGlyph piece={piece} />}
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
