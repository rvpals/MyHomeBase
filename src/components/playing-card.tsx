// A single playing card: a face, a back, or an empty slot.
//
// Pure presentation. It takes a `Card` from @/lib/games and draws it — no game knows
// how its cards look, and this component knows nothing about what a card is worth.
// See components.md before adding another card treatment.
//
// The face is drawn rather than illustrated: corner indices, a pip layout per rank,
// and a lettered panel for the courts. That keeps it an asset-free component that
// scales cleanly and re-themes with the app, where card art would be a fixed image
// that suits exactly one palette.

import { isCourt, isRedSuit, type Card, type Rank, type Suit } from "@/lib/games";

/**
 * Card sizes, all at the standard 2.5:3.5 poker ratio.
 *
 * Named rather than free-form so every table in the app deals the same-sized cards.
 * `sm` is for a crowded row (a split hand on a phone), `md` the default, `lg` for the
 * card a player is being asked to look at.
 */
export type PlayingCardSize = "sm" | "md" | "lg";

export interface PlayingCardProps {
  /**
   * The card to draw. Omit it for a face-down card — a hole card or a stock pile,
   * where the point is that the value is not known to the viewer.
   */
  card?: Card;
  /** Size preset. Default `"md"`. */
  size?: PlayingCardSize;
  /**
   * Draws an empty outline instead of a card. For a table position that exists but
   * holds nothing yet, which reads better than a gap that collapses.
   */
  empty?: boolean;
  /** Dims the card, for one that is out of play but still shown. */
  dimmed?: boolean;
  /** Draws the selected/active ring. For a card the player has picked up or chosen. */
  selected?: boolean;
  /** Makes the card a button. Omit for a card that is only being displayed. */
  onClick?: () => void;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

/**
 * Geometry per size: the card box, the corner index, and the pip.
 *
 * Explicit Tailwind classes rather than computed strings — Tailwind only ships classes
 * it can see in the source, so a template literal would produce styles that work in dev
 * and vanish from a production build.
 *
 * Each steps down one level below 1024px via `max-lg:`, so a hand that fits a desktop
 * also fits a phone without the caller choosing a different size per breakpoint.
 */
const SIZES: Record<PlayingCardSize, { box: string; index: string; pip: string; court: string }> = {
  sm: {
    box: "h-[68px] w-[48px] max-lg:h-[58px] max-lg:w-[41px]",
    index: "text-[0.6rem] max-lg:text-[0.55rem]",
    pip: "text-[0.6rem] max-lg:text-[0.5rem]",
    court: "text-lg max-lg:text-base",
  },
  md: {
    box: "h-[90px] w-[64px] max-lg:h-[75px] max-lg:w-[54px]",
    index: "text-xs max-lg:text-[0.65rem]",
    pip: "text-sm max-lg:text-xs",
    court: "text-2xl max-lg:text-xl",
  },
  lg: {
    box: "h-[118px] w-[84px] max-lg:h-[96px] max-lg:w-[69px]",
    index: "text-sm max-lg:text-xs",
    pip: "text-base max-lg:text-sm",
    court: "text-3xl max-lg:text-2xl",
  },
};

/** The glyph for each suit. */
const SUIT_GLYPHS: Record<Suit, string> = {
  spades: "♠",
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
};

/** Spelled out for a screen reader, which cannot read "♠". */
const SUIT_NAMES: Record<Suit, string> = {
  spades: "spades",
  hearts: "hearts",
  diamonds: "diamonds",
  clubs: "clubs",
};

const RANK_NAMES: Partial<Record<Rank, string>> = {
  A: "Ace",
  J: "Jack",
  Q: "Queen",
  K: "King",
};

/**
 * Where the pips go on each number card, as `[column, row]` on a 3x7 lattice.
 *
 * The traditional layouts, which are not evenly spaced grids — a 7 is a 6 with one pip
 * offset between the top pair, and an 8 adds its mirror. Hardcoding the real
 * arrangements is what makes these read as playing cards rather than as dot counts.
 *
 * Rows run 0 (top) to 6 (bottom); column 0 is left, 1 centre, 2 right. A pip on an odd
 * row sits between two even-row pips, which is how the 7, 8, 9 and 10 offsets work.
 *
 * A pip in the bottom half of the card is drawn upside down on a real deck, so the
 * card reads the same from either end; `flipped` below applies that to rows 4-6.
 */
const PIP_LAYOUTS: Partial<Record<Rank, readonly (readonly [number, number])[]>> = {
  "2": [
    [1, 0],
    [1, 6],
  ],
  "3": [
    [1, 0],
    [1, 3],
    [1, 6],
  ],
  "4": [
    [0, 0],
    [2, 0],
    [0, 6],
    [2, 6],
  ],
  "5": [
    [0, 0],
    [2, 0],
    [1, 3],
    [0, 6],
    [2, 6],
  ],
  "6": [
    [0, 0],
    [2, 0],
    [0, 3],
    [2, 3],
    [0, 6],
    [2, 6],
  ],
  "7": [
    [0, 0],
    [2, 0],
    [1, 1],
    [0, 3],
    [2, 3],
    [0, 6],
    [2, 6],
  ],
  "8": [
    [0, 0],
    [2, 0],
    [1, 1],
    [0, 3],
    [2, 3],
    [1, 5],
    [0, 6],
    [2, 6],
  ],
  "9": [
    [0, 0],
    [2, 0],
    [0, 2],
    [2, 2],
    [1, 3],
    [0, 4],
    [2, 4],
    [0, 6],
    [2, 6],
  ],
  "10": [
    [0, 0],
    [2, 0],
    [1, 1],
    [0, 2],
    [2, 2],
    [0, 4],
    [2, 4],
    [1, 5],
    [0, 6],
    [2, 6],
  ],
};

/** The rows a pip is drawn inverted on, as a real card does below the midline. */
const FLIPPED_FROM_ROW = 4;

export function PlayingCard({
  card,
  size = "md",
  empty = false,
  dimmed = false,
  selected = false,
  onClick,
  className = "",
}: PlayingCardProps) {
  const geometry = SIZES[size];
  const base = `relative shrink-0 select-none rounded-lg border ${geometry.box}`;
  const ring = selected ? "ring-2 ring-brass ring-offset-1 ring-offset-paper" : "";
  const fade = dimmed ? "opacity-45" : "";

  // An empty slot: the position exists, nothing is in it. A dashed outline rather than
  // a gap, so a table does not reflow as cards arrive.
  if (empty) {
    return (
      <div
        aria-hidden
        className={`${base} border-dashed border-line bg-transparent ${fade} ${className}`}
      />
    );
  }

  const content = card ? <CardFace card={card} size={size} /> : <CardBack size={size} />;
  const label = card
    ? `${RANK_NAMES[card.rank] ?? card.rank} of ${SUIT_NAMES[card.suit]}`
    : "Face-down card";

  const shell = [
    base,
    card ? "border-line bg-paper" : "border-brass-dark/40",
    // A soft lift, so a card reads as an object on the table rather than a printed
    // rectangle. Lighter than Button's hard offset — a row of cards with that much
    // shadow each becomes noisy.
    "shadow-[0_1px_2px_0_rgba(0,0,0,0.25)]",
    ring,
    fade,
    className,
  ].join(" ");

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-pressed={selected}
        className={`${shell} transition-transform duration-150 hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass motion-reduce:transition-none motion-reduce:hover:translate-y-0`}
      >
        {content}
      </button>
    );
  }

  return (
    <div role="img" aria-label={label} className={shell}>
      {content}
    </div>
  );
}

/** The printed side: corner indices plus pips, a court panel, or the ace's single pip. */
function CardFace({ card, size }: { card: Card; size: PlayingCardSize }) {
  const geometry = SIZES[size];
  const glyph = SUIT_GLYPHS[card.suit];
  // Red suits stay red across every theme — the same fixed-semantic exception the
  // `danger` Button variant makes. A red suit is a property of the deck, not of the
  // palette, and a heart rendered in brass is not a heart.
  const colour = isRedSuit(card.suit) ? "text-red-500" : "text-ink";

  return (
    <div className={`h-full w-full ${colour}`}>
      {/* The two corner indices, the second rotated so the card reads either way up —
          the detail that most makes a drawn rectangle read as a playing card. */}
      <Index rank={card.rank} glyph={glyph} className={`left-1 top-0.5 ${geometry.index}`} />
      <Index
        rank={card.rank}
        glyph={glyph}
        className={`bottom-0.5 right-1 rotate-180 ${geometry.index}`}
      />

      <div className="absolute inset-0 flex items-center justify-center px-[22%] py-[8%]">
        {isCourt(card.rank) ? (
          <CourtPanel rank={card.rank} glyph={glyph} size={size} />
        ) : card.rank === "A" ? (
          // The ace's single oversized centre pip, as a real deck draws it.
          <span aria-hidden className={geometry.court}>
            {glyph}
          </span>
        ) : (
          <PipField rank={card.rank} glyph={glyph} size={size} />
        )}
      </div>
    </div>
  );
}

/** One corner index: the rank over its suit glyph. */
function Index({
  rank,
  glyph,
  className,
}: {
  rank: Rank;
  glyph: string;
  className: string;
}) {
  return (
    <span
      aria-hidden
      className={`absolute flex flex-col items-center font-display leading-none ${className}`}
    >
      <span className="tabular-nums">{rank}</span>
      <span>{glyph}</span>
    </span>
  );
}

/**
 * A court card's centre: the letter over its suit, in a bordered panel.
 *
 * A letter rather than figure art. Hand-drawn jacks and queens are a large asset job
 * and turn to mud at 84px wide, where a bold letter stays legible at every size and
 * re-themes with the app.
 */
function CourtPanel({ rank, glyph, size }: { rank: Rank; glyph: string; size: PlayingCardSize }) {
  const geometry = SIZES[size];

  return (
    <span
      aria-hidden
      className="flex h-full w-full flex-col items-center justify-center rounded border border-current/30 bg-current/5 leading-none"
    >
      <span className={`font-display ${geometry.court}`}>{rank}</span>
      <span className={geometry.pip}>{glyph}</span>
    </span>
  );
}

/** The pips of a number card, positioned on the traditional lattice. */
function PipField({ rank, glyph, size }: { rank: Rank; glyph: string; size: PlayingCardSize }) {
  const layout = PIP_LAYOUTS[rank];
  const geometry = SIZES[size];
  if (!layout) return null;

  return (
    <span aria-hidden className="relative h-full w-full">
      {layout.map(([column, row]) => (
        <span
          key={`${column}-${row}`}
          className={`absolute leading-none ${geometry.pip}`}
          style={{
            // Percentage positions on a 3-column, 7-row lattice, each pip centred on
            // its cell. Inline because these are computed from the layout table —
            // Tailwind cannot ship a class for every one of the 21 positions.
            //
            // The rotation rides in this same `transform` rather than a `rotate-180`
            // class: both compile to `transform`, and the inline one would silently
            // win, leaving the flip off. One declaration, so there is nothing to lose.
            left: `${(column / 2) * 100}%`,
            top: `${(row / 6) * 100}%`,
            transform: `translate(-50%, -50%) ${row >= FLIPPED_FROM_ROW ? "rotate(180deg)" : ""}`,
          }}
        >
          {glyph}
        </span>
      ))}
    </span>
  );
}

/**
 * The face-down side: a brass lattice.
 *
 * A repeating CSS gradient rather than an image, so it costs no asset and re-themes
 * with the palette. The pattern is deliberately busy — a card back has to be obviously
 * not a face at a glance, even at `sm`.
 */
function CardBack({ size }: { size: PlayingCardSize }) {
  const geometry = SIZES[size];

  return (
    <span
      aria-hidden
      className="flex h-full w-full items-center justify-center rounded-[7px] bg-brass/20 p-1"
    >
      <span
        className="flex h-full w-full items-center justify-center rounded border border-brass-dark/30"
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, var(--brass) 0 2px, transparent 2px 6px), repeating-linear-gradient(-45deg, var(--brass) 0 2px, transparent 2px 6px)",
          opacity: 0.55,
        }}
      >
        <span className={`font-display text-brass-dark ${geometry.pip}`}>♦</span>
      </span>
    </span>
  );
}
