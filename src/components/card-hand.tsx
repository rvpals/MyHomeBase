// A row of playing cards with an optional title, total and badge — one player's hand,
// a dealer's hand, or a community row.
//
// Pure presentation: it lays cards out and reports clicks. It does not know what the
// total means, so `total` arrives as a formatted string — Blackjack shows "7/17" for a
// soft hand, a poker game might show nothing at all, and neither belongs in here.
//
// See components.md before adding another hand treatment.

import { type ReactNode } from "react";
import { PlayingCard, type CardDeal, type PlayingCardSize } from "@/components/playing-card";
import { type Card } from "@/lib/games";

/**
 * How the cards are arranged.
 *
 * `spread` lays them out in full, wrapping when the row runs out of width — right for
 * a hand of two to five that the player must read.
 *
 * `fan` overlaps them so only each card's left edge shows behind the one in front,
 * which is how a real hand is held and the only way a hand of ten stays on a phone.
 */
export type CardHandLayout = "spread" | "fan";

export interface CardHandProps {
  /** The cards, left to right. An empty array draws the placeholder slots. */
  cards: readonly Card[];
  /** Small heading above the row — "Dealer", "You", "Board". */
  title?: string;
  /**
   * The hand's value, already formatted. A string, not a number: what a total *means*
   * is the game's business, and Blackjack's soft hands read "7/17".
   */
  total?: string;
  /** A note beside the total, in muted type — Blackjack's "showing" for a hidden hole card. */
  totalNote?: string;
  /** Anything on the right of the title row: a stake, a result chip, a turn marker. */
  badge?: ReactNode;
  /** Card size, passed through. Default `"md"`. */
  size?: PlayingCardSize;
  /** Default `"spread"`. */
  layout?: CardHandLayout;
  /**
   * Index from which cards are drawn face down.
   *
   * `hideFrom={1}` shows the first card and hides the rest — a Blackjack dealer's hole
   * card. Omit it to show everything.
   */
  hideFrom?: number;
  /** Draws this many empty slots when `cards` is empty, so the table holds its shape. */
  placeholders?: number;
  /** Marks the hand as the one in play. Draws a ring and a left accent. */
  active?: boolean;
  /** Dims the whole hand — one that is folded, busted, or out of play. */
  dimmed?: boolean;
  /** Index of a selected card, for a game where a player picks from their hand. */
  selectedIndex?: number;
  /** Makes each card clickable. Receives the card and its index. */
  onCardClick?: (card: Card, index: number) => void;
  /**
   * Flies the cards named here in from the deck; everything else is drawn in place.
   *
   * Card ids, not indices, because a card's index shifts as a hand grows and a split
   * moves a card between hands — an index-based set would re-fly a settled card the
   * moment another arrived beside it. The caller works out which ids are new; this
   * component has no memory of the previous render.
   *
   * Returns `undefined` per card to skip it, so one call site can animate an arrival
   * and leave its neighbours alone.
   */
  dealing?: (card: Card, index: number) => CardDeal | undefined;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

/** How far a fanned card is pulled over the one before it, per size. */
const FAN_OVERLAP: Record<PlayingCardSize, string> = {
  sm: "-ml-6 max-lg:-ml-7",
  md: "-ml-8 max-lg:-ml-9",
  lg: "-ml-10 max-lg:-ml-12",
};

export function CardHand({
  cards,
  title,
  total,
  totalNote,
  badge,
  size = "md",
  layout = "spread",
  hideFrom,
  placeholders = 2,
  active = false,
  dimmed = false,
  selectedIndex,
  onCardClick,
  dealing,
  className = "",
}: CardHandProps) {
  const showHeader = Boolean(title || total || badge);

  return (
    <div
      className={[
        "flex flex-col gap-2 rounded-lg border p-2 transition-colors",
        active ? "border-brass bg-brass/10" : "border-transparent",
        className,
      ].join(" ")}
    >
      {showHeader && (
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="flex items-baseline gap-2">
            {title && (
              <span className="text-[0.65rem] uppercase tracking-wide text-muted">{title}</span>
            )}
            {total && (
              <span className="font-display text-lg tabular-nums text-ink">
                {total}
                {totalNote && <span className="ml-1 text-xs text-muted">{totalNote}</span>}
              </span>
            )}
          </div>
          {badge}
        </div>
      )}

      <div className={`flex flex-wrap items-end ${layout === "fan" ? "" : "gap-1.5"}`}>
        {cards.length === 0
          ? Array.from({ length: placeholders }, (_, index) => (
              <PlayingCard
                key={`slot-${index}`}
                size={size}
                empty
                className={index > 0 && layout === "fan" ? FAN_OVERLAP[size] : ""}
              />
            ))
          : cards.map((card, index) => (
              <PlayingCard
                key={card.id}
                // A hidden card is drawn as a back: the component is handed no card at
                // all rather than a card plus a "hidden" flag, so a face-down card's
                // value is never in the DOM for a curious player to read.
                card={hideFrom !== undefined && index >= hideFrom ? undefined : card}
                size={size}
                dimmed={dimmed}
                selected={selectedIndex === index}
                // The whole hand rises when it is the one in play, reinforcing the ring
                // below with a physical cue. Per-card rather than on the row, so each
                // card keeps its own cast shadow.
                lifted={active}
                onClick={onCardClick ? () => onCardClick(card, index) : undefined}
                dealing={dealing?.(card, index)}
                className={index > 0 && layout === "fan" ? FAN_OVERLAP[size] : ""}
              />
            ))}
      </div>
    </div>
  );
}
