/**
 * A deck of playing cards, and the operations every card game needs from one.
 *
 * **Game-agnostic on purpose.** Nothing here knows what a card is worth: an ace is 1
 * or 11 in Blackjack, high in poker, and either end of a run in rummy, so `valueOf`
 * lives in the game that has an opinion. This module owns only what a *deck* is —
 * the fifty-two cards, their order, and how to shuffle and deal them.
 *
 * That split is what makes a second card game cheap. It is also what lets
 * `PlayingCard` and `CardHand` in `src/components/` be genuinely reusable: a shared
 * component over a Blackjack-owned type would only look shared.
 *
 * These types were originally declared in the Blackjack section of `types.ts` and were
 * lifted out when the card components were built — nothing about them was ever
 * specific to that game.
 */

/** The four suits, in the conventional order a deck is built. */
export const SUITS = ["spades", "hearts", "diamonds", "clubs"] as const;

export type Suit = (typeof SUITS)[number];

/**
 * The thirteen ranks, ace first.
 *
 * Strings rather than numbers because a rank is not its value: "A" is 1 or 11 in
 * Blackjack, and the three court cards are all worth ten there but are not
 * interchangeable when drawn — a pair of kings can be split, a king and a queen
 * cannot. Each game converts a rank to a value its own way; nothing here assumes one.
 */
export const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;

export type Rank = (typeof RANKS)[number];

/** Cards in a single deck. Thirteen ranks in each of four suits. */
export const CARDS_IN_DECK = RANKS.length * SUITS.length;

/** The ranks with no pip layout of their own: a letter and a suit, not a count of pips. */
export const COURT_RANKS: readonly Rank[] = ["J", "Q", "K"];

/** Whether a rank is a court card — jack, queen or king. */
export function isCourt(rank: Rank): boolean {
  return COURT_RANKS.includes(rank);
}

/** Whether a suit is one of the red ones. The only thing a suit decides on its own. */
export function isRedSuit(suit: Suit): boolean {
  return suit === "hearts" || suit === "diamonds";
}

/**
 * One card.
 *
 * `id` distinguishes two otherwise identical cards — a six-deck shoe holds six aces of
 * spades, and React needs a stable key per rendered card. Assigned when the deck is
 * built and carried unchanged as the card moves from deck to hand to discard, so the
 * key survives the card being dealt. Same reasoning as `LineClear.id` in Tetris: a
 * value that exists only so the view can tell two identical things apart.
 */
export interface Card {
  id: number;
  rank: Rank;
  suit: Suit;
}

/** A source of randomness in [0, 1). `Math.random` in the app; a stub in tests. */
export type Random = () => number;

/**
 * One deck of 52 cards in standard order, unshuffled.
 *
 * `startId` offsets the ids, so `buildShoe` can stack several decks and keep every id
 * distinct across the whole shoe. A caller building a single deck can ignore it.
 */
export function newDeck(startId = 0): readonly Card[] {
  const cards: Card[] = [];
  let id = startId;

  for (const suit of SUITS) {
    for (const rank of RANKS) {
      cards.push({ id, rank, suit });
      id += 1;
    }
  }
  return cards;
}

/**
 * `decks` decks as one unshuffled block, with ids unique across the whole thing.
 *
 * Unshuffled, so a caller decides whether it wants a shuffle — a test that stacks a
 * known shoe wants this without one, and `shuffle` is a separate call rather than a
 * flag for exactly that reason.
 */
export function buildShoe(decks: number): readonly Card[] {
  const cards: Card[] = [];
  for (let deck = 0; deck < decks; deck += 1) {
    cards.push(...newDeck(deck * CARDS_IN_DECK));
  }
  return cards;
}

/**
 * A copy of `cards` in a shuffled order. Fisher-Yates, driven by the supplied RNG.
 *
 * Returns a new array rather than shuffling in place: a deck is part of an immutable
 * game state, and a caller that still holds the old one must keep seeing it unchanged.
 */
export function shuffle<T>(cards: readonly T[], random: Random): T[] {
  const out = [...cards];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** A shuffled shoe of `decks` decks. The common case, as one call. */
export function shuffledShoe(decks: number, random: Random): readonly Card[] {
  return shuffle(buildShoe(decks), random);
}

/**
 * Takes `count` cards off the front of a pile.
 *
 * Returns the drawn cards and what is left, rather than mutating — a `pop` here would
 * quietly change a state a caller still holds. A pile with fewer than `count` cards
 * returns everything it has; it is the game's job to keep that from happening
 * mid-round, since only the game knows how many cards a round can need.
 */
export function draw(
  pile: readonly Card[],
  count: number,
): { drawn: readonly Card[]; rest: readonly Card[] } {
  return { drawn: pile.slice(0, count), rest: pile.slice(count) };
}
