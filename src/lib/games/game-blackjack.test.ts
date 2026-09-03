import { describe, expect, it } from "vitest";
import {
  activeHandOf,
  canDouble,
  canSplit,
  cashOut,
  clampBet,
  deal,
  dealerPlay,
  dealerUpcard,
  doubleDown,
  handValue,
  hit,
  isBlackjack,
  isBust,
  newShoe,
  nextRound,
  scoreGame,
  setBet,
  settle,
  split,
  stand,
  startGame,
  totalOf,
  valueOf,
} from "./game-blackjack";
import {
  BLACKJACK_MAX_BET,
  BLACKJACK_MIN_BET,
  BLACKJACK_STARTING_CHIPS,
  DECKS_IN_SHOE,
  SHOE_RESHUFFLE_AT,
  type BlackjackState,
  type Hand,
} from "./types";
// The deck itself is game-agnostic and lives here; only the Blackjack rules come from
// the module above. `CARDS_IN_DECK` replaces the old `SUITS.length * RANKS.length`.
import { CARDS_IN_DECK, type Card, type Rank } from "./playing-cards";

/**
 * A deterministic RNG.
 *
 * A linear congruential generator rather than a replayed list, for the same reason as
 * `game-sudoku.test.ts`: building a shoe consumes one random number per card, so a
 * fixed list would run out and degenerate into a constant.
 */
function rng(seed = 1) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

/** A fixed RNG, for the cases where the exact shoe does not matter. */
const fixed = () => 0.5;

/**
 * A card of a given rank.
 *
 * Suit is irrelevant to every rule in this game — nothing scores by suit — so the
 * tests name ranks only and let this fill in the rest. `id` is unique per call so two
 * cards of the same rank are still distinguishable, as they are in a real shoe.
 */
let nextId = 0;
function card(rank: Rank): Card {
  nextId += 1;
  return { id: nextId, rank, suit: "spades" };
}

/** Cards from a list of ranks. */
function cards(...ranks: Rank[]): Card[] {
  return ranks.map(card);
}

/**
 * A state with a known shoe, so a test can force the exact hand it is about.
 *
 * The alternative — deal from a seeded RNG until the wanted case turns up — makes the
 * test's subject invisible and re-rolls the moment a constant changes. Stacking the
 * shoe states the case in the test itself.
 *
 * Deal order is player, dealer, player, dealer, so `stack("A", "5", "K", "9")` gives
 * the player A-K and the dealer 5-9.
 */
function stacked(ranks: Rank[], overrides: Partial<BlackjackState> = {}): BlackjackState {
  return { ...startGame(fixed), shoe: cards(...ranks), ...overrides };
}

/** A hand, for the helpers that take one rather than a whole state. */
function hand(ranks: Rank[], overrides: Partial<Hand> = {}): Hand {
  return {
    cards: cards(...ranks),
    bet: BLACKJACK_MIN_BET,
    doubled: false,
    fromSplit: false,
    result: undefined,
    ...overrides,
  };
}

describe("valueOf", () => {
  it("counts an ace high, before any demotion", () => {
    expect(valueOf("A")).toBe(11);
  });

  it("counts every court card as ten", () => {
    expect(valueOf("K")).toBe(10);
    expect(valueOf("Q")).toBe(10);
    expect(valueOf("J")).toBe(10);
    expect(valueOf("10")).toBe(10);
  });

  it("counts a number card as its number", () => {
    expect(valueOf("2")).toBe(2);
    expect(valueOf("9")).toBe(9);
  });
});

describe("handValue", () => {
  it("adds a hand with no ace", () => {
    expect(handValue(cards("K", "7"))).toEqual({ total: 17, soft: false });
  });

  it("counts a single ace as eleven when the hand fits", () => {
    expect(handValue(cards("A", "6"))).toEqual({ total: 17, soft: true });
  });

  it("demotes an ace rather than busting", () => {
    expect(handValue(cards("A", "6", "K"))).toEqual({ total: 17, soft: false });
  });

  it("demotes only as many aces as it must", () => {
    // A+A+9 is 21, not 31: the first ace drops to 1 and the second stays at 11.
    expect(handValue(cards("A", "A", "9"))).toEqual({ total: 21, soft: true });
  });

  it("demotes every ace when the hand demands it", () => {
    expect(handValue(cards("A", "A", "A", "8"))).toEqual({ total: 21, soft: false });
  });

  it("reports a genuine bust", () => {
    expect(handValue(cards("K", "Q", "5"))).toEqual({ total: 25, soft: false });
    expect(isBust(cards("K", "Q", "5"))).toBe(true);
  });

  it("does not call twenty-one a bust", () => {
    expect(isBust(cards("K", "A"))).toBe(false);
  });

  it("values an empty hand at zero", () => {
    expect(totalOf([])).toBe(0);
  });
});

describe("isBlackjack", () => {
  it("accepts twenty-one on the first two cards", () => {
    expect(isBlackjack(hand(["A", "K"]))).toBe(true);
  });

  it("refuses twenty-one reached on three cards", () => {
    expect(isBlackjack(hand(["7", "7", "7"]))).toBe(false);
  });

  it("refuses a split hand, even at ace-ten", () => {
    // Otherwise splitting aces would be the only bet worth making — see Hand.fromSplit.
    expect(isBlackjack(hand(["A", "K"], { fromSplit: true }))).toBe(false);
  });

  it("refuses a two-card hand short of twenty-one", () => {
    expect(isBlackjack(hand(["A", "9"]))).toBe(false);
  });
});

// The deck's own behaviour — size, distinct ids, the shuffle — is covered in
// `playing-cards.test.ts`. All that is Blackjack's business is that it deals from the
// right number of decks.
describe("newShoe", () => {
  it("deals from a six-deck shoe", () => {
    expect(newShoe(rng())).toHaveLength(DECKS_IN_SHOE * CARDS_IN_DECK);
  });
});

describe("startGame", () => {
  it("opens with a full bankroll and nothing on the table", () => {
    const state = startGame(rng());
    expect(state.chips).toBe(BLACKJACK_STARTING_CHIPS);
    expect(state.hands).toEqual([]);
    expect(state.dealer).toEqual([]);
    expect(state.phase).toBe("betting");
    expect(state.outcome).toBeUndefined();
  });
});

describe("setBet and clampBet", () => {
  it("holds a bet inside the table limits", () => {
    expect(clampBet(10, 1000)).toBe(BLACKJACK_MIN_BET);
    expect(clampBet(999, 1000)).toBe(BLACKJACK_MAX_BET);
  });

  it("will not bet more than the bankroll holds", () => {
    expect(clampBet(BLACKJACK_MAX_BET, 50)).toBe(50);
  });

  it("reports what is left when even the minimum is out of reach", () => {
    expect(clampBet(BLACKJACK_MIN_BET, 10)).toBe(10);
  });

  it("refuses to change the stake once the cards are out", () => {
    const state = deal(stacked(["9", "5", "7", "9"]), fixed);
    expect(setBet(state, 100).bet).toBe(state.bet);
  });
});

describe("deal", () => {
  it("gives the player and the dealer two cards each, in table order", () => {
    const state = deal(stacked(["9", "5", "7", "9"]), fixed);

    expect(state.hands[0].cards.map((entry) => entry.rank)).toEqual(["9", "7"]);
    expect(state.dealer.map((entry) => entry.rank)).toEqual(["5", "9"]);
    expect(state.phase).toBe("playing");
  });

  it("takes the stake out of the bankroll at the deal, not at settlement", () => {
    const state = deal(stacked(["9", "5", "7", "9"]), fixed);
    expect(state.chips).toBe(BLACKJACK_STARTING_CHIPS - BLACKJACK_MIN_BET);
  });

  it("shows only the dealer's first card", () => {
    const state = deal(stacked(["9", "5", "7", "9"]), fixed);
    expect(dealerUpcard(state)?.rank).toBe("5");
  });

  it("settles a natural immediately rather than offering a decision", () => {
    const state = deal(stacked(["A", "5", "K", "9"]), fixed);

    expect(state.phase).toBe("settled");
    expect(state.hands[0].result).toBe("blackjack");
  });

  it("settles at once when the dealer has the natural", () => {
    const state = deal(stacked(["9", "A", "7", "K"]), fixed);

    expect(state.phase).toBe("settled");
    expect(state.hands[0].result).toBe("lose");
  });

  it("rebuilds a shoe that has run low, and never mid-round", () => {
    const short = stacked(["9", "5", "7", "9"]);
    const state = deal({ ...short, shoe: short.shoe.slice(0, SHOE_RESHUFFLE_AT) }, rng());

    // A fresh shoe minus the four cards just dealt.
    expect(state.shoe.length).toBe(DECKS_IN_SHOE * CARDS_IN_DECK - 4);
  });

  it("refuses a deal the bankroll cannot cover", () => {
    const broke = stacked(["9", "5", "7", "9"], { chips: 10 });
    expect(deal(broke, fixed)).toBe(broke);
  });

  it("refuses a second deal while a round is in play", () => {
    const state = deal(stacked(["9", "5", "7", "9"]), fixed);
    expect(deal(state, fixed)).toBe(state);
  });
});

describe("hit", () => {
  it("adds a card to the active hand", () => {
    const state = hit(deal(stacked(["9", "5", "7", "9", "3"]), fixed));
    expect(state.hands[0].cards.map((entry) => entry.rank)).toEqual(["9", "7", "3"]);
    expect(state.phase).toBe("playing");
  });

  it("ends the hand on a bust and does not pay it", () => {
    // Player 9-7-K = 26. The dealer never draws, because nothing is left to beat.
    const state = hit(deal(stacked(["9", "5", "7", "9", "K"]), fixed));

    expect(state.hands[0].result).toBe("bust");
    expect(state.dealer).toHaveLength(2);
    expect(state.chips).toBe(BLACKJACK_STARTING_CHIPS - BLACKJACK_MIN_BET);
  });

  it("stands automatically on twenty-one", () => {
    // Player 9-7-5 = 21. There is no card that improves it.
    const state = hit(deal(stacked(["9", "5", "7", "9", "5"]), fixed));
    expect(state.phase).toBe("settled");
  });

  it("does nothing once the round is settled", () => {
    const state = deal(stacked(["A", "5", "K", "9"]), fixed);
    expect(hit(state)).toBe(state);
  });
});

describe("stand", () => {
  it("hands over to the dealer, who draws to seventeen", () => {
    // Dealer 5-9 = 14, then draws the 3 for 17 and stops.
    const state = stand(deal(stacked(["K", "5", "9", "9", "3"]), fixed));

    expect(totalOf(state.dealer)).toBe(17);
    expect(state.phase).toBe("settled");
  });

  it("does nothing outside a live hand", () => {
    const state = startGame(fixed);
    expect(stand(state)).toBe(state);
  });
});

describe("dealerPlay", () => {
  it("stands on a hard seventeen", () => {
    const state = dealerPlay(stacked(["5"], { dealer: cards("K", "7"), hands: [hand(["K", "9"])] }));
    expect(state.dealer).toHaveLength(2);
  });

  it("stands on a soft seventeen too", () => {
    // A-6 is 17. The other common house rule hits this; DEALER_STANDS_ON says not here.
    const state = dealerPlay(stacked(["5"], { dealer: cards("A", "6"), hands: [hand(["K", "9"])] }));
    expect(state.dealer).toHaveLength(2);
    expect(totalOf(state.dealer)).toBe(17);
  });

  it("keeps drawing below seventeen", () => {
    const state = dealerPlay(
      stacked(["2", "4"], { dealer: cards("5", "6"), hands: [hand(["K", "9"])] }),
    );
    expect(totalOf(state.dealer)).toBeGreaterThanOrEqual(17);
  });

  it("can bust itself, and pays every standing hand", () => {
    const state = dealerPlay(
      stacked(["K"], { dealer: cards("K", "6"), hands: [hand(["K", "9"])] }),
    );

    expect(totalOf(state.dealer)).toBe(26);
    expect(state.hands[0].result).toBe("win");
  });
});

describe("settle", () => {
  /** Chips after settling one hand of `player` against `dealer`, from a zero balance. */
  function payoutFor(player: Rank[], dealerCards: Rank[], overrides: Partial<Hand> = {}): number {
    const state = settle(
      stacked([], { chips: 0, dealer: cards(...dealerCards), hands: [hand(player, overrides)] }),
    );
    return state.chips;
  }

  it("pays a win at even money, stake included", () => {
    expect(payoutFor(["K", "9"], ["K", "8"])).toBe(BLACKJACK_MIN_BET * 2);
  });

  it("pays a natural at three to two", () => {
    expect(payoutFor(["A", "K"], ["K", "8"])).toBe(BLACKJACK_MIN_BET + BLACKJACK_MIN_BET * 1.5);
  });

  it("returns the stake on a push and nets nothing", () => {
    expect(payoutFor(["K", "9"], ["K", "9"])).toBe(BLACKJACK_MIN_BET);
  });

  it("pushes a natural against the dealer's natural", () => {
    expect(payoutFor(["A", "K"], ["A", "Q"])).toBe(BLACKJACK_MIN_BET);
  });

  it("beats a drawn twenty-one with a natural", () => {
    // Player A-K, dealer 7-7-7: both 21, but only one is a natural.
    const state = settle(
      stacked([], { chips: 0, dealer: cards("7", "7", "7"), hands: [hand(["A", "K"])] }),
    );
    expect(state.hands[0].result).toBe("blackjack");
  });

  it("pays nothing on a loss", () => {
    expect(payoutFor(["K", "8"], ["K", "9"])).toBe(0);
  });

  it("pays nothing on a bust, even when the dealer busts too", () => {
    // The house edge in one assertion: a bust loses before the dealer is looked at.
    expect(payoutFor(["K", "Q", "5"], ["K", "Q", "5"])).toBe(0);
  });

  it("counts every hand of a split round as played", () => {
    const state = settle(
      stacked([], { dealer: cards("K", "9"), hands: [hand(["K", "8"]), hand(["K", "9"])] }),
    );
    expect(state.handsPlayed).toBe(2);
  });

  it("remembers the bankroll's peak, even after it falls back", () => {
    const won = settle(stacked([], { chips: 0, dealer: cards("K", "8"), hands: [hand(["K", "9"])] }));
    const lost = settle({ ...won, dealer: cards("K", "9"), hands: [hand(["K", "8"])] });

    expect(lost.chips).toBeLessThan(lost.peakChips);
    expect(lost.peakChips).toBe(BLACKJACK_STARTING_CHIPS);
  });

  it("ends the run when the minimum bet is no longer coverable", () => {
    const state = settle(
      stacked([], { chips: 0, dealer: cards("K", "9"), hands: [hand(["K", "8"])] }),
    );
    expect(state.outcome).toBe("broke");
  });

  it("does not end a run that can still cover a bet", () => {
    const state = settle(
      stacked([], {
        chips: BLACKJACK_MIN_BET,
        dealer: cards("K", "9"),
        hands: [hand(["K", "8"])],
      }),
    );
    expect(state.outcome).toBeUndefined();
  });
});

describe("doubleDown", () => {
  it("doubles the stake, takes one card, and stands", () => {
    // Player 5-6 = 11, doubles into the K for 21; dealer 9-9 stands on 18.
    const state = doubleDown(deal(stacked(["5", "9", "6", "9", "K"]), fixed));

    expect(state.hands[0].cards).toHaveLength(3);
    expect(state.hands[0].bet).toBe(BLACKJACK_MIN_BET * 2);
    expect(state.hands[0].doubled).toBe(true);
    expect(state.phase).toBe("settled");
  });

  it("pays the doubled stake on a win", () => {
    const state = doubleDown(deal(stacked(["5", "9", "6", "9", "K"]), fixed));
    // Two stakes out, four back.
    expect(state.chips).toBe(BLACKJACK_STARTING_CHIPS + BLACKJACK_MIN_BET * 2);
  });

  it("refuses once the hand has drawn a third card", () => {
    const drawn = hit(deal(stacked(["5", "9", "2", "9", "3", "K"]), fixed));

    expect(canDouble(drawn)).toBe(false);
    expect(doubleDown(drawn)).toBe(drawn);
  });

  it("refuses when the extra stake is unaffordable", () => {
    const poor = stacked(["5", "9", "6", "9", "K"], { chips: BLACKJACK_MIN_BET });
    const state = deal(poor, fixed);

    expect(canDouble(state)).toBe(false);
    expect(doubleDown(state)).toBe(state);
  });
});

describe("split", () => {
  it("turns a pair into two hands, each with its own stake and second card", () => {
    const state = split(deal(stacked(["8", "9", "8", "9", "3", "K"]), fixed));

    expect(state.hands).toHaveLength(2);
    expect(state.hands[0].cards.map((entry) => entry.rank)).toEqual(["8", "3"]);
    expect(state.hands[1].cards.map((entry) => entry.rank)).toEqual(["8", "K"]);
    expect(state.hands[1].bet).toBe(BLACKJACK_MIN_BET);
    expect(state.activeHand).toBe(0);
  });

  it("takes a second stake out of the bankroll", () => {
    const state = split(deal(stacked(["8", "9", "8", "9", "3", "K"]), fixed));
    expect(state.chips).toBe(BLACKJACK_STARTING_CHIPS - BLACKJACK_MIN_BET * 2);
  });

  it("plays the hands in turn, then the dealer", () => {
    const state = split(deal(stacked(["8", "9", "8", "9", "3", "K", "2", "2"]), fixed));

    const first = stand(state);
    expect(first.activeHand).toBe(1);
    expect(first.phase).toBe("playing");

    const second = stand(first);
    expect(second.phase).toBe("settled");
    expect(second.hands.every((entry) => entry.result !== undefined)).toBe(true);
  });

  it("refuses two cards of the same value but different rank", () => {
    // A king and a queen are both ten, and are not a pair.
    const state = deal(stacked(["K", "9", "Q", "9"]), fixed);
    expect(canSplit(state)).toBe(false);
    expect(split(state)).toBe(state);
  });

  it("refuses a second split in the same round", () => {
    const state = split(deal(stacked(["8", "9", "8", "9", "8", "8"]), fixed));
    expect(canSplit(state)).toBe(false);
  });

  it("refuses when the second stake is unaffordable", () => {
    const poor = stacked(["8", "9", "8", "9", "3", "K"], { chips: BLACKJACK_MIN_BET });
    const state = deal(poor, fixed);

    expect(canSplit(state)).toBe(false);
    expect(split(state)).toBe(state);
  });

  it("never pays a split twenty-one as a natural", () => {
    const state = split(deal(stacked(["A", "9", "A", "9", "K", "K"]), fixed));
    const settled = stand(stand(state));

    expect(settled.hands[0].result).toBe("win");
    expect(settled.hands[0].result).not.toBe("blackjack");
  });
});

describe("nextRound", () => {
  it("clears the table and keeps the bankroll and the stake", () => {
    const settled = stand(deal(stacked(["K", "5", "9", "9", "3"]), fixed));
    const next = nextRound(settled);

    expect(next.hands).toEqual([]);
    expect(next.dealer).toEqual([]);
    expect(next.phase).toBe("betting");
    expect(next.chips).toBe(settled.chips);
    expect(next.bet).toBe(settled.bet);
  });

  it("trims a stake the bankroll can no longer cover", () => {
    const settled = stacked([], { chips: 40, bet: BLACKJACK_MAX_BET, phase: "settled" });
    expect(nextRound(settled).bet).toBe(40);
  });

  it("does nothing mid-round", () => {
    const state = deal(stacked(["9", "5", "7", "9"]), fixed);
    expect(nextRound(state)).toBe(state);
  });
});

describe("cashOut and scoreGame", () => {
  it("banks the chips and ends the run", () => {
    const state = cashOut(startGame(fixed));

    expect(state.outcome).toBe("cashed-out");
    expect(scoreGame(state)).toBe(BLACKJACK_STARTING_CHIPS);
  });

  it("refuses to walk away from a live hand", () => {
    const state = deal(stacked(["9", "5", "7", "9"]), fixed);
    expect(cashOut(state)).toBe(state);
  });

  it("scores an unfinished run at nothing", () => {
    expect(scoreGame(startGame(fixed))).toBe(0);
  });

  it("scores a bankrupt run at nothing, whatever is left", () => {
    const broke = settle(
      stacked([], { chips: 0, dealer: cards("K", "9"), hands: [hand(["K", "8"])] }),
    );

    expect(broke.outcome).toBe("broke");
    expect(scoreGame(broke)).toBe(0);
  });
});

describe("immutability", () => {
  it("never mutates the state it is given", () => {
    const before = deal(stacked(["9", "5", "7", "9", "3"]), fixed);
    const snapshot = JSON.stringify(before);

    hit(before);
    stand(before);
    settle(before);

    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("leaves the active hand reachable only while one is in play", () => {
    expect(activeHandOf(startGame(fixed))).toBeUndefined();
    expect(activeHandOf(deal(stacked(["9", "5", "7", "9"]), fixed))).toBeDefined();
  });
});
