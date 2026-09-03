import { describe, expect, it } from "vitest";
import {
  CARDS_IN_DECK,
  RANKS,
  SUITS,
  buildShoe,
  draw,
  isCourt,
  isRedSuit,
  newDeck,
  shuffle,
  shuffledShoe,
} from "./playing-cards";

/**
 * A deterministic RNG — a linear congruential generator, for the same reason as
 * `game-sudoku.test.ts`: shuffling a shoe consumes one random number per card, so a
 * replayed list would run out and degenerate into a constant.
 */
function rng(seed = 1) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

describe("newDeck", () => {
  it("holds fifty-two cards", () => {
    expect(newDeck()).toHaveLength(CARDS_IN_DECK);
    expect(CARDS_IN_DECK).toBe(52);
  });

  it("holds every rank in every suit exactly once", () => {
    const deck = newDeck();

    for (const suit of SUITS) {
      for (const rank of RANKS) {
        const matches = deck.filter((card) => card.suit === suit && card.rank === rank);
        expect(matches).toHaveLength(1);
      }
    }
  });

  it("numbers the cards from zero by default", () => {
    const deck = newDeck();
    expect(deck.map((card) => card.id)).toEqual(deck.map((_, index) => index));
  });

  it("offsets the ids when asked, so a second deck does not collide", () => {
    const deck = newDeck(CARDS_IN_DECK);
    expect(deck[0].id).toBe(CARDS_IN_DECK);
  });
});

describe("buildShoe", () => {
  it("stacks the requested number of decks", () => {
    expect(buildShoe(6)).toHaveLength(CARDS_IN_DECK * 6);
  });

  it("keeps every id distinct across the whole shoe", () => {
    const shoe = buildShoe(6);
    expect(new Set(shoe.map((card) => card.id)).size).toBe(shoe.length);
  });

  it("repeats each card once per deck", () => {
    const shoe = buildShoe(6);
    const aces = shoe.filter((card) => card.rank === "A" && card.suit === "spades");
    expect(aces).toHaveLength(6);
  });

  it("builds nothing from no decks", () => {
    expect(buildShoe(0)).toEqual([]);
  });
});

describe("shuffle", () => {
  it("keeps every card, in a different order", () => {
    const deck = newDeck();
    const shuffled = shuffle(deck, rng());

    expect(shuffled).toHaveLength(deck.length);
    expect(new Set(shuffled.map((card) => card.id))).toEqual(new Set(deck.map((card) => card.id)));
    expect(shuffled.map((card) => card.id)).not.toEqual(deck.map((card) => card.id));
  });

  it("does not touch the array it was given", () => {
    const deck = newDeck();
    const before = deck.map((card) => card.id);

    shuffle(deck, rng());
    expect(deck.map((card) => card.id)).toEqual(before);
  });

  it("shuffles differently for different seeds", () => {
    const first = shuffle(newDeck(), rng(1)).map((card) => card.id);
    const second = shuffle(newDeck(), rng(99)).map((card) => card.id);
    expect(first).not.toEqual(second);
  });

  it("shuffles identically for the same seed, so a test can replay a deal", () => {
    const first = shuffle(newDeck(), rng(7)).map((card) => card.id);
    const second = shuffle(newDeck(), rng(7)).map((card) => card.id);
    expect(first).toEqual(second);
  });

  it("handles an empty pile and a single card", () => {
    expect(shuffle([], rng())).toEqual([]);
    expect(shuffle(["only"], rng())).toEqual(["only"]);
  });
});

describe("shuffledShoe", () => {
  it("is a shoe of the right size, shuffled", () => {
    const shoe = shuffledShoe(6, rng());

    expect(shoe).toHaveLength(CARDS_IN_DECK * 6);
    expect(shoe.map((card) => card.id)).not.toEqual(buildShoe(6).map((card) => card.id));
  });
});

describe("draw", () => {
  it("takes cards off the front and leaves the rest", () => {
    const deck = newDeck();
    const { drawn, rest } = draw(deck, 4);

    expect(drawn.map((card) => card.id)).toEqual([0, 1, 2, 3]);
    expect(rest).toHaveLength(CARDS_IN_DECK - 4);
    expect(rest[0].id).toBe(4);
  });

  it("does not touch the pile it was given", () => {
    const deck = newDeck();
    draw(deck, 4);
    expect(deck).toHaveLength(CARDS_IN_DECK);
  });

  it("draws nothing when asked for nothing", () => {
    const { drawn, rest } = draw(newDeck(), 0);
    expect(drawn).toEqual([]);
    expect(rest).toHaveLength(CARDS_IN_DECK);
  });

  it("returns what it has when the pile is short, rather than throwing", () => {
    const { drawn, rest } = draw(newDeck().slice(0, 2), 5);
    expect(drawn).toHaveLength(2);
    expect(rest).toEqual([]);
  });
});

describe("isCourt and isRedSuit", () => {
  it("knows the three court cards", () => {
    expect(isCourt("J")).toBe(true);
    expect(isCourt("Q")).toBe(true);
    expect(isCourt("K")).toBe(true);
  });

  it("does not count an ace or a number as a court card", () => {
    expect(isCourt("A")).toBe(false);
    expect(isCourt("10")).toBe(false);
    expect(isCourt("2")).toBe(false);
  });

  it("knows the two red suits", () => {
    expect(isRedSuit("hearts")).toBe(true);
    expect(isRedSuit("diamonds")).toBe(true);
    expect(isRedSuit("spades")).toBe(false);
    expect(isRedSuit("clubs")).toBe(false);
  });
});
