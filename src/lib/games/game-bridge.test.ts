import { describe, expect, it } from "vitest";
import {
  allCards,
  arePartners,
  availableCalls,
  beats,
  bidRank,
  botCall,
  botPlay,
  canBid,
  canDouble,
  canPlay,
  canRedouble,
  cardsOfSuit,
  contractPoints,
  declarerFor,
  dummyOf,
  evaluateHand,
  handOf,
  highCardPoints,
  isHandOver,
  isWaitingForHuman,
  lastBid,
  ledSuit,
  legalPlays,
  longestSuit,
  makeBid,
  makeDouble,
  makePass,
  makeRedouble,
  nextSeat,
  openingLeader,
  partnerOf,
  playCard,
  rankOrder,
  scoreContract,
  scoreGame,
  scoreHand,
  sideOf,
  sortHand,
  startGame,
  stepBots,
  suitLengths,
  trickWinner,
  tricksWonBy,
  trumpOf,
  undertrickPenalty,
} from "./game-bridge";
import {
  BRIDGE_BOOK,
  BRIDGE_GAME_BONUS,
  BRIDGE_GRAND_SLAM_BONUS,
  BRIDGE_HAND_SIZE,
  BRIDGE_PARTSCORE_BONUS,
  BRIDGE_SMALL_SLAM_BONUS,
  BRIDGE_TRICKS,
  HUMAN_SEAT,
  type BridgeState,
  type Contract,
  type Denomination,
  type Seat,
  type TrickCard,
} from "./types";
import { CARDS_IN_DECK, type Card, type Rank, type Suit } from "./playing-cards";

/**
 * A deterministic RNG — a linear congruential generator, as in `game-blackjack.test.ts`.
 *
 * A replayed list of numbers does not work here: a shuffle consumes one random number
 * per card, so a fixed list either runs dry or has to be 52 entries of noise. A seeded
 * generator gives a repeatable deal from one number.
 */
function seededRandom(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 1103515245 + 12345) % 2147483648;
    return value / 2147483648;
  };
}

/** A card built by hand, for stacking a specific hand or trick. */
function card(rank: Rank, suit: Suit, id = 0): Card {
  return { id, rank, suit };
}

/**
 * Cards from a compact spec like `"AKQ"` in one suit, ids offset so they stay distinct.
 *
 * Hand-stacking is how every interesting case here is set up — a real deal almost never
 * produces the auction or the trick you want to assert on.
 */
function suitCards(spec: string, suit: Suit, startId: number): Card[] {
  const ranks: Record<string, Rank> = {
    A: "A",
    K: "K",
    Q: "Q",
    J: "J",
    T: "10",
    "9": "9",
    "8": "8",
    "7": "7",
    "6": "6",
    "5": "5",
    "4": "4",
    "3": "3",
    "2": "2",
  };
  return [...spec].map((letter, index) => card(ranks[letter], suit, startId + index));
}

/** A state in the play phase with a known contract, for trick and scoring tests. */
function playState(overrides: Partial<BridgeState> = {}): BridgeState {
  const contract: Contract = {
    level: 4,
    denomination: "spades",
    declarer: 1,
    doubling: "none",
  };
  return {
    hands: [[], [], [], []],
    phase: "play",
    turn: 2,
    dealer: 0,
    auction: [],
    contract,
    currentTrick: [],
    tricks: [],
    dummyExposed: true,
    outcome: "playing",
    ...overrides,
  };
}

describe("seats and partnerships", () => {
  it("passes the turn up through the seat indices and wraps", () => {
    expect(nextSeat(0)).toBe(1);
    expect(nextSeat(3)).toBe(0);
  });

  it("seats partners opposite each other", () => {
    expect(partnerOf(0)).toBe(2);
    expect(partnerOf(1)).toBe(3);
    expect(partnerOf(3)).toBe(1);
  });

  it("splits the table into two sides", () => {
    expect(sideOf(0)).toBe("ns");
    expect(sideOf(2)).toBe("ns");
    expect(sideOf(1)).toBe("ew");
    expect(sideOf(3)).toBe("ew");
  });

  it("does not make a seat its own partner", () => {
    expect(arePartners(1, 3)).toBe(true);
    expect(arePartners(1, 1)).toBe(false);
    expect(arePartners(0, 1)).toBe(false);
  });
});

describe("card ranking", () => {
  it("ranks the ace high, not low", () => {
    // The failure this pins down: `RANKS` lists the ace first because that is how a deck
    // is built, so an index into it would make the ace the *lowest* card in the suit.
    expect(rankOrder("A")).toBeGreaterThan(rankOrder("K"));
    expect(rankOrder("A")).toBeGreaterThan(rankOrder("2"));
    expect(rankOrder("2")).toBeLessThan(rankOrder("3"));
  });

  it("compares two cards of a suit", () => {
    expect(beats(card("A", "spades"), card("K", "spades"))).toBe(true);
    expect(beats(card("2", "spades"), card("A", "spades"))).toBe(false);
  });

  it("sorts a hand by bidding-order suit then descending rank", () => {
    const hand = [
      card("2", "clubs", 1),
      card("A", "spades", 2),
      card("K", "clubs", 3),
      card("5", "hearts", 4),
    ];
    const sorted = sortHand(hand);
    expect(sorted.map((c) => `${c.rank}${c.suit[0]}`)).toEqual(["Kc", "2c", "5h", "As"]);
  });

  it("pulls one suit out of a hand in descending rank", () => {
    const hand = [card("2", "clubs", 1), card("A", "clubs", 2), card("K", "hearts", 3)];
    expect(cardsOfSuit(hand, "clubs").map((c) => c.rank)).toEqual(["A", "2"]);
  });
});

describe("the deal", () => {
  it("deals thirteen cards to each of four seats", () => {
    const state = startGame(seededRandom(7));
    for (const seat of [0, 1, 2, 3] as Seat[]) {
      expect(handOf(state, seat)).toHaveLength(BRIDGE_HAND_SIZE);
    }
  });

  it("deals the whole deck with no card duplicated or lost", () => {
    const state = startGame(seededRandom(11));
    const ids = allCards(state).map((c) => c.id);
    expect(ids).toHaveLength(CARDS_IN_DECK);
    expect(new Set(ids).size).toBe(CARDS_IN_DECK);
  });

  it("opens the auction with the dealer to call", () => {
    const state = startGame(seededRandom(3));
    expect(state.phase).toBe("auction");
    expect(state.turn).toBe(state.dealer);
    expect(state.auction).toEqual([]);
    expect(state.contract).toBeUndefined();
  });

  it("deals the same hand for the same seed and a different one otherwise", () => {
    const a = startGame(seededRandom(42));
    const b = startGame(seededRandom(42));
    const c = startGame(seededRandom(43));
    expect(handOf(a, 0)).toEqual(handOf(b, 0));
    expect(handOf(a, 0)).not.toEqual(handOf(c, 0));
  });
});

describe("the auction: legality", () => {
  it("ranks bids by level first and denomination second", () => {
    expect(bidRank(1, "nt")).toBeGreaterThan(bidRank(1, "spades"));
    expect(bidRank(2, "clubs")).toBeGreaterThan(bidRank(1, "nt"));
    expect(bidRank(1, "diamonds")).toBeGreaterThan(bidRank(1, "clubs"));
  });

  it("accepts any opening bid and then only higher ones", () => {
    const state = startGame(seededRandom(5));
    expect(canBid(state, 1, "clubs")).toBe(true);

    const opened = makeBid(state, 1, "hearts");
    expect(canBid(opened, 1, "clubs")).toBe(false);
    expect(canBid(opened, 1, "spades")).toBe(true);
    expect(canBid(opened, 2, "clubs")).toBe(true);
  });

  it("rejects a bid outside one to seven", () => {
    const state = startGame(seededRandom(5));
    expect(canBid(state, 0, "clubs")).toBe(false);
    expect(canBid(state, 8, "clubs")).toBe(false);
    expect(canBid(state, 1.5, "clubs")).toBe(false);
  });

  it("leaves the state untouched on an illegal bid rather than throwing", () => {
    const state = makeBid(startGame(seededRandom(5)), 2, "hearts");
    const after = makeBid(state, 1, "clubs");
    expect(after).toBe(state);
  });

  it("never lets a player double their own side", () => {
    // The rule a player tries anyway: doubling partner's bid. Seat 0 opens, seat 1
    // passes, seat 2 is seat 0's partner and must not be able to double.
    let state = startGame(seededRandom(9));
    state = makeBid(state, 1, "spades");
    expect(canDouble(state)).toBe(true); // seat 1, an opponent
    state = makePass(state);
    expect(state.turn).toBe(2);
    expect(canDouble(state)).toBe(false); // seat 2 is the bidder's partner
    expect(makeDouble(state)).toBe(state);
  });

  it("only lets the doubled side redouble, and only once", () => {
    let state = startGame(seededRandom(9));
    state = makeBid(state, 1, "spades"); // seat 0
    state = makeDouble(state); // seat 1
    expect(state.turn).toBe(2);
    expect(canRedouble(state)).toBe(true); // seat 2, the bidder's partner
    state = makeRedouble(state);
    expect(canRedouble(state)).toBe(false);
    expect(canDouble(state)).toBe(false);
  });

  it("clears a double when a new bid is made", () => {
    let state = startGame(seededRandom(9));
    state = makeBid(state, 1, "spades");
    state = makeDouble(state);
    state = makeBid(state, 2, "spades");
    // The new bid resets the stake, so the next seat may double afresh.
    expect(canDouble(state)).toBe(true);
    expect(canRedouble(state)).toBe(false);
  });

  it("offers no double or redouble before anyone has bid", () => {
    const state = startGame(seededRandom(9));
    expect(canDouble(state)).toBe(false);
    expect(canRedouble(state)).toBe(false);
    expect(availableCalls(state)).toEqual(["pass", "bid"]);
  });

  it("stops offering a bid once 7NT is on the table", () => {
    const state = makeBid(startGame(seededRandom(9)), 7, "nt");
    expect(availableCalls(state)).not.toContain("bid");
    expect(availableCalls(state)).toContain("pass");
  });
});

describe("the auction: closing", () => {
  it("ends the hand as a pass-out on four opening passes", () => {
    let state = startGame(seededRandom(13));
    for (let i = 0; i < 4; i += 1) state = makePass(state);
    expect(state.phase).toBe("ended");
    expect(state.outcome).toBe("passed-out");
    expect(state.contract).toBeUndefined();
    expect(isHandOver(state)).toBe(true);
  });

  it("does not close on three passes when nobody has bid", () => {
    let state = startGame(seededRandom(13));
    for (let i = 0; i < 3; i += 1) state = makePass(state);
    expect(state.phase).toBe("auction");
  });

  it("closes on three passes after a bid and sets the contract", () => {
    let state = startGame(seededRandom(17));
    state = makeBid(state, 3, "nt"); // seat 0
    state = makePass(state);
    state = makePass(state);
    expect(state.phase).toBe("auction");
    state = makePass(state);

    expect(state.phase).toBe("play");
    expect(state.contract).toEqual({
      level: 3,
      denomination: "nt",
      declarer: 0,
      doubling: "none",
    });
  });

  it("carries a double through to the contract", () => {
    let state = startGame(seededRandom(19));
    state = makeBid(state, 4, "hearts");
    state = makeDouble(state);
    state = makePass(state);
    state = makePass(state);
    state = makePass(state);
    expect(state.contract?.doubling).toBe("doubled");
  });

  it("makes the first of the side to name the suit declarer, not the last bidder", () => {
    // The rule most often got wrong. Seat 0 opens 1S; seat 2 (partner) raises to 4S.
    // Seat 0 declares, because seat 0 named spades first.
    let state = startGame(seededRandom(23));
    state = makeBid(state, 1, "spades"); // seat 0
    state = makePass(state); // seat 1
    state = makeBid(state, 4, "spades"); // seat 2 — the last bid, but not declarer
    state = makePass(state); // seat 3
    state = makePass(state); // seat 0
    state = makePass(state); // seat 1

    expect(state.contract?.level).toBe(4);
    expect(state.contract?.declarer).toBe(0);
    expect(dummyOf(state.contract as Contract)).toBe(2);
  });

  it("resolves declarer directly from an auction", () => {
    const auction = [
      { seat: 3 as Seat, kind: "bid" as const, level: 1, denomination: "hearts" as Denomination },
      { seat: 1 as Seat, kind: "bid" as const, level: 2, denomination: "hearts" as Denomination },
    ];
    // Seats 1 and 3 are partners, so the side is `ew` and seat 3 named hearts first.
    expect(declarerFor(auction, "hearts", "ew")).toBe(3);
  });

  it("leads the trick to declarer's left", () => {
    expect(openingLeader(0)).toBe(1);
    expect(openingLeader(3)).toBe(0);
  });

  it("gives the opening lead to the seat left of declarer when play starts", () => {
    let state = startGame(seededRandom(29));
    state = makeBid(state, 1, "nt"); // seat 0 declares
    state = makePass(state);
    state = makePass(state);
    state = makePass(state);
    expect(state.turn).toBe(1);
  });

  it("reports the highest bid regardless of later passes", () => {
    let state = startGame(seededRandom(31));
    state = makeBid(state, 1, "clubs");
    state = makePass(state);
    expect(lastBid(state.auction)?.level).toBe(1);
    expect(lastBid(state.auction)?.denomination).toBe("clubs");
  });
});

describe("following suit", () => {
  it("lets the leader play anything", () => {
    const hand = [card("A", "spades", 1), card("2", "hearts", 2)];
    const state = playState({ hands: [[], [], hand, []], turn: 2 });
    expect(legalPlays(state, 2)).toHaveLength(2);
    expect(ledSuit(state)).toBeUndefined();
  });

  it("requires following the led suit when able", () => {
    const hand = [card("3", "clubs", 1), card("A", "spades", 2)];
    const state = playState({
      hands: [[], [], hand, []],
      turn: 2,
      currentTrick: [{ seat: 1, card: card("5", "clubs", 3) }],
    });
    expect(legalPlays(state, 2).map((c) => c.suit)).toEqual(["clubs"]);
    expect(canPlay(state, 2, card("A", "spades", 2))).toBe(false);
    expect(canPlay(state, 2, card("3", "clubs", 1))).toBe(true);
  });

  it("allows anything when void in the led suit", () => {
    const hand = [card("A", "spades", 1), card("2", "hearts", 2)];
    const state = playState({
      hands: [[], [], hand, []],
      turn: 2,
      currentTrick: [{ seat: 1, card: card("5", "clubs", 3) }],
    });
    expect(legalPlays(state, 2)).toHaveLength(2);
  });

  it("refuses a play from a seat that is not to act", () => {
    const hand = [card("3", "clubs", 1)];
    const state = playState({ hands: [[], [], hand, []], turn: 2 });
    expect(canPlay(state, 3, card("3", "clubs", 1))).toBe(false);
  });

  it("returns the state unchanged on an illegal play rather than throwing", () => {
    const hand = [card("3", "clubs", 1), card("A", "spades", 2)];
    const state = playState({
      hands: [[], [], hand, []],
      turn: 2,
      currentTrick: [{ seat: 1, card: card("5", "clubs", 3) }],
    });
    expect(playCard(state, card("A", "spades", 2))).toBe(state);
  });

  it("plays no cards once the hand has ended", () => {
    const state = playState({ phase: "ended", hands: [[], [], [card("3", "clubs", 1)], []] });
    expect(legalPlays(state, 2)).toEqual([]);
    expect(playCard(state, card("3", "clubs", 1))).toBe(state);
  });
});

describe("winning a trick", () => {
  const trick = (...cards: [Seat, Rank, Suit][]): TrickCard[] =>
    cards.map(([seat, rank, suit], index) => ({ seat, card: card(rank, suit, index) }));

  it("gives it to the highest card of the led suit", () => {
    const cards = trick([0, "5", "clubs"], [1, "K", "clubs"], [2, "3", "clubs"], [3, "9", "clubs"]);
    expect(trickWinner(cards, undefined)).toBe(1);
  });

  it("does not let an off-suit card win at no-trumps however high", () => {
    // The rule a beginner gets wrong: an ace of another suit is worthless here.
    const cards = trick([0, "5", "clubs"], [1, "A", "spades"], [2, "3", "clubs"], [3, "9", "clubs"]);
    expect(trickWinner(cards, undefined)).toBe(3);
  });

  it("lets any trump beat the highest card of the led suit", () => {
    const cards = trick([0, "A", "clubs"], [1, "2", "spades"], [2, "3", "clubs"], [3, "K", "clubs"]);
    expect(trickWinner(cards, "spades")).toBe(1);
  });

  it("gives a trumped trick to the highest trump", () => {
    const cards = trick([0, "A", "clubs"], [1, "2", "spades"], [2, "5", "spades"], [3, "K", "clubs"]);
    expect(trickWinner(cards, "spades")).toBe(2);
  });

  it("ranks the ace of trumps above the king", () => {
    const cards = trick([0, "K", "spades"], [1, "A", "spades"], [2, "2", "spades"], [3, "3", "spades"]);
    expect(trickWinner(cards, "spades")).toBe(1);
  });

  it("reads the trump suit off the contract and nothing at no-trumps", () => {
    expect(trumpOf({ level: 4, denomination: "spades", declarer: 0, doubling: "none" })).toBe(
      "spades",
    );
    expect(trumpOf({ level: 3, denomination: "nt", declarer: 0, doubling: "none" })).toBeUndefined();
    expect(trumpOf(undefined)).toBeUndefined();
  });
});

describe("playing out a trick", () => {
  it("passes the turn round the table until the trick is full", () => {
    const hands = [
      [card("2", "clubs", 1)],
      [card("3", "clubs", 2)],
      [card("4", "clubs", 3)],
      [card("5", "clubs", 4)],
    ];
    let state = playState({ hands, turn: 0 });

    state = playCard(state, card("2", "clubs", 1));
    expect(state.turn).toBe(1);
    expect(state.currentTrick).toHaveLength(1);
    expect(state.tricks).toHaveLength(0);

    state = playCard(state, card("3", "clubs", 2));
    state = playCard(state, card("4", "clubs", 3));
    expect(state.currentTrick).toHaveLength(3);
  });

  it("awards a full trick and gives the winner the next lead", () => {
    const hands = [
      [card("2", "clubs", 1), card("2", "hearts", 5)],
      [card("3", "clubs", 2), card("3", "hearts", 6)],
      [card("K", "clubs", 3), card("4", "hearts", 7)],
      [card("5", "clubs", 4), card("5", "hearts", 8)],
    ];
    let state = playState({ hands, turn: 0 });
    state = playCard(state, card("2", "clubs", 1));
    state = playCard(state, card("3", "clubs", 2));
    state = playCard(state, card("K", "clubs", 3));
    state = playCard(state, card("5", "clubs", 4));

    expect(state.tricks).toHaveLength(1);
    expect(state.tricks[0].winner).toBe(2);
    expect(state.currentTrick).toEqual([]);
    // The winner leads next — this is what makes the turn order non-cyclic.
    expect(state.turn).toBe(2);
  });

  it("removes a played card from the hand and keeps all 52 accounted for", () => {
    const hands = [
      [card("2", "clubs", 1)],
      [card("3", "clubs", 2)],
      [card("4", "clubs", 3)],
      [card("5", "clubs", 4)],
    ];
    let state = playState({ hands, turn: 0 });
    const before = allCards(state).length;
    state = playCard(state, card("2", "clubs", 1));

    expect(handOf(state, 0)).toEqual([]);
    // Conservation: the card moved from a hand to the trick, it did not vanish.
    expect(allCards(state)).toHaveLength(before);
  });

  it("exposes dummy from the opening lead", () => {
    const hands = [[], [card("2", "clubs", 1)], [], []];
    const state = playState({ hands, turn: 1, dummyExposed: false });
    expect(playCard(state, card("2", "clubs", 1)).dummyExposed).toBe(true);
  });

  it("counts tricks by side, not by seat", () => {
    const state = playState({
      tricks: [
        { cards: [], winner: 0 },
        { cards: [], winner: 2 },
        { cards: [], winner: 1 },
      ],
    });
    expect(tricksWonBy(state, "ns")).toBe(2);
    expect(tricksWonBy(state, "ew")).toBe(1);
  });
});

describe("scoring a contract", () => {
  const contract = (
    level: number,
    denomination: Denomination,
    doubling: Contract["doubling"] = "none",
  ): Contract => ({ level, denomination, declarer: 0, doubling });

  it("prices the minor suits at 20 a trick and the majors at 30", () => {
    expect(contractPoints(1, "clubs", "none")).toBe(20);
    expect(contractPoints(2, "diamonds", "none")).toBe(40);
    expect(contractPoints(1, "hearts", "none")).toBe(30);
    expect(contractPoints(4, "spades", "none")).toBe(120);
  });

  it("prices no-trumps at 40 for the first trick and 30 after", () => {
    expect(contractPoints(1, "nt", "none")).toBe(40);
    expect(contractPoints(2, "nt", "none")).toBe(70);
    expect(contractPoints(3, "nt", "none")).toBe(100);
  });

  it("doubles and redoubles the contract points", () => {
    expect(contractPoints(4, "spades", "doubled")).toBe(240);
    expect(contractPoints(4, "spades", "redoubled")).toBe(480);
  });

  it("pays a part-score bonus below game and a game bonus at or above it", () => {
    const partscore = scoreContract(contract(2, "clubs"), 8);
    expect(partscore.made).toBe(true);
    expect(partscore.declarerScore).toBe(40 + BRIDGE_PARTSCORE_BONUS);

    const game = scoreContract(contract(4, "spades"), 10);
    expect(game.declarerScore).toBe(120 + BRIDGE_GAME_BONUS);
  });

  it("does not let overtricks turn a part-score into a game", () => {
    // The rule that makes bidding game worth the risk: 2S making four scores the
    // part-score bonus, not the game bonus, even though it took ten tricks.
    const score = scoreContract(contract(2, "spades"), 10);
    expect(score.overtricks).toBe(2);
    expect(score.declarerScore).toBe(60 + 60 + BRIDGE_PARTSCORE_BONUS);
    expect(score.lines.some((line) => line.label === "Game")).toBe(false);
  });

  it("pays the slam bonuses at six and seven", () => {
    const small = scoreContract(contract(6, "spades"), 12);
    expect(small.declarerScore).toBe(180 + BRIDGE_GAME_BONUS + BRIDGE_SMALL_SLAM_BONUS);

    const grand = scoreContract(contract(7, "nt"), 13);
    expect(grand.declarerScore).toBe(220 + BRIDGE_GAME_BONUS + BRIDGE_GRAND_SLAM_BONUS);
  });

  it("adds the insult bonus for making a doubled contract", () => {
    const score = scoreContract(contract(4, "spades", "doubled"), 10);
    expect(score.lines.some((line) => line.label === "For the insult")).toBe(true);
    expect(score.declarerScore).toBe(240 + BRIDGE_GAME_BONUS + 50);
  });

  it("prices doubled overtricks flat rather than by the trick value", () => {
    const score = scoreContract(contract(4, "spades", "doubled"), 11);
    // 240 contract + 300 game + 50 insult + one overtrick at 100.
    expect(score.declarerScore).toBe(240 + BRIDGE_GAME_BONUS + 50 + 100);
  });

  it("reports a defeated contract as a negative score and no points", () => {
    const score = scoreContract(contract(4, "spades"), 9);
    expect(score.made).toBe(false);
    expect(score.undertricks).toBe(1);
    expect(score.overtricks).toBe(0);
    expect(score.declarerScore).toBe(-50);
    expect(score.points).toBe(0);
  });

  it("charges 50 an undertrick undoubled", () => {
    expect(undertrickPenalty(1, "none")).toBe(50);
    expect(undertrickPenalty(3, "none")).toBe(150);
    expect(undertrickPenalty(0, "none")).toBe(0);
  });

  it("charges a rising scale for doubled undertricks", () => {
    // 100, then 200 for the second and third, then 300 — not a flat multiple.
    expect(undertrickPenalty(1, "doubled")).toBe(100);
    expect(undertrickPenalty(2, "doubled")).toBe(300);
    expect(undertrickPenalty(3, "doubled")).toBe(500);
    expect(undertrickPenalty(4, "doubled")).toBe(800);
  });

  it("doubles the doubled penalties again when redoubled", () => {
    expect(undertrickPenalty(1, "redoubled")).toBe(200);
    expect(undertrickPenalty(2, "redoubled")).toBe(600);
  });

  it("counts the tricks needed as the level plus the book of six", () => {
    const score = scoreContract(contract(3, "nt"), 9);
    expect(score.tricksNeeded).toBe(3 + BRIDGE_BOOK);
    expect(score.made).toBe(true);
  });
});

describe("scoring a finished hand", () => {
  it("scores nothing for a hand still in play or a pass-out", () => {
    expect(scoreHand(playState())).toBeUndefined();
    expect(scoreHand(playState({ phase: "ended", contract: undefined }))).toBeUndefined();
    expect(scoreGame(playState({ phase: "ended", outcome: "passed-out" }))).toBe(0);
  });

  it("credits the human for making a contract their side declared", () => {
    // HUMAN_SEAT is 1, so a contract declared by seat 1 is the human's to make.
    const tricks = Array.from({ length: BRIDGE_TRICKS }, (_, index) => ({
      cards: [],
      winner: (index < 10 ? 1 : 0) as Seat,
    }));
    const state = playState({
      phase: "ended",
      outcome: "won",
      contract: { level: 4, denomination: "spades", declarer: 1, doubling: "none" },
      tricks,
    });
    expect(scoreGame(state)).toBe(120 + BRIDGE_GAME_BONUS);
  });

  it("credits the human for defeating a contract they defended", () => {
    // Seat 0 declares 4S and takes only nine tricks; the human (seat 1) defended, so
    // the penalty is what the human's side earned.
    const tricks = Array.from({ length: BRIDGE_TRICKS }, (_, index) => ({
      cards: [],
      winner: (index < 9 ? 0 : 1) as Seat,
    }));
    const state = playState({
      phase: "ended",
      outcome: "won",
      contract: { level: 4, denomination: "spades", declarer: 0, doubling: "none" },
      tricks,
    });
    expect(scoreGame(state)).toBe(50);
  });

  it("scores zero when the human lost, never a negative", () => {
    // The shared scoreboard ranks `score DESC` and cannot represent a debt.
    const state = playState({ phase: "ended", outcome: "lost" });
    expect(scoreGame(state)).toBe(0);
  });

  it("sets the outcome from the human's point of view when a hand plays out", () => {
    // Seat 0 declares 1NT and takes seven tricks: made. The human (seat 1) defended and
    // therefore lost, even though nothing the human did changed.
    const hands = [
      [card("A", "clubs", 1)],
      [card("2", "clubs", 2)],
      [card("3", "clubs", 3)],
      [card("4", "clubs", 4)],
    ];
    const tricks = Array.from({ length: BRIDGE_TRICKS - 1 }, (_, index) => ({
      cards: [],
      winner: (index < 6 ? 0 : 1) as Seat,
    }));
    let state = playState({
      hands,
      turn: 0,
      contract: { level: 1, denomination: "nt", declarer: 0, doubling: "none" },
      tricks,
    });
    state = playCard(state, card("A", "clubs", 1));
    state = playCard(state, card("2", "clubs", 2));
    state = playCard(state, card("3", "clubs", 3));
    state = playCard(state, card("4", "clubs", 4));

    expect(state.phase).toBe("ended");
    expect(state.tricks).toHaveLength(BRIDGE_TRICKS);
    // Seat 0's side took seven, making 1NT; the human defended and lost.
    expect(state.outcome).toBe("lost");
    expect(scoreGame(state)).toBe(0);
  });
});

describe("hand evaluation", () => {
  it("counts high cards 4/3/2/1 and ignores the spot cards", () => {
    expect(highCardPoints([card("A", "spades")])).toBe(4);
    expect(highCardPoints([card("K", "spades")])).toBe(3);
    expect(highCardPoints([card("Q", "spades")])).toBe(2);
    expect(highCardPoints([card("J", "spades")])).toBe(1);
    expect(highCardPoints([card("10", "spades"), card("2", "hearts")])).toBe(0);
  });

  it("counts the length of each suit", () => {
    const hand = [card("A", "spades", 1), card("K", "spades", 2), card("2", "hearts", 3)];
    expect(suitLengths(hand)).toEqual({ spades: 2, hearts: 1, diamonds: 0, clubs: 0 });
  });

  it("adds a point per card beyond the fourth in a suit", () => {
    const sixCardSuit = suitCards("AKQJT9", "spades", 1);
    // 10 high-card points, plus two for the fifth and sixth spades.
    expect(highCardPoints(sixCardSuit)).toBe(10);
    expect(evaluateHand(sixCardSuit)).toBe(12);
  });

  it("picks the longest suit and breaks a tie by the higher suit", () => {
    expect(longestSuit(suitCards("AKQJT", "hearts", 1))).toBe("hearts");
    const tied = [...suitCards("AKQ", "clubs", 1), ...suitCards("AKQ", "spades", 10)];
    expect(longestSuit(tied)).toBe("spades");
  });
});

describe("the bots", () => {
  it("passes a weak hand rather than opening", () => {
    const weak = [
      ...suitCards("32", "spades", 1),
      ...suitCards("543", "hearts", 10),
      ...suitCards("6432", "diamonds", 20),
      ...suitCards("7532", "clubs", 30),
    ];
    const state = startGame(seededRandom(2));
    const after = botCall(weak, state);
    expect(after.auction).toHaveLength(1);
    expect(after.auction[0].kind).toBe("pass");
  });

  it("opens a strong hand above the no-trump band by naming a suit", () => {
    // 21 points is too strong for the 15-17 no-trump band, so it bids a suit rather
    // than understating the hand as 1NT.
    const strong = [
      ...suitCards("AKQ", "spades", 1),
      ...suitCards("KQ3", "hearts", 10),
      ...suitCards("A432", "diamonds", 20),
      ...suitCards("K432", "clubs", 30),
    ];
    expect(evaluateHand(strong)).toBe(21);
    const state = botCall(strong, startGame(seededRandom(2)));
    expect(state.auction[0].kind).toBe("bid");
    expect(state.auction[0].denomination).not.toBe("nt");
  });

  it("opens its longest suit with a shapely opening hand", () => {
    // A six-card suit and 12 points: too shapely for the balanced 1NT branch, so it
    // names its suit. Keeping this hand outside the 15-17 no-trump band is the point —
    // an earlier version of this test used a 15-point 5-3-3-2 and was really asserting
    // the 1NT rule by accident.
    const oneSuited = [
      ...suitCards("AKQJT9", "hearts", 1),
      ...suitCards("A32", "spades", 10),
      ...suitCards("432", "diamonds", 20),
      ...suitCards("2", "clubs", 30),
    ];
    expect(evaluateHand(oneSuited)).toBeGreaterThanOrEqual(12);
    const state = botCall(oneSuited, startGame(seededRandom(2)));
    expect(state.auction[0]).toMatchObject({ kind: "bid", level: 1, denomination: "hearts" });
  });

  it("prefers 1NT on a balanced fifteen to seventeen over naming a suit", () => {
    // 5-3-3-2 with 15 points: balanced and in the band, so no-trumps wins even though
    // there is a five-card suit to bid.
    const balanced = [
      ...suitCards("AKQJT", "hearts", 1),
      ...suitCards("A32", "spades", 10),
      ...suitCards("432", "diamonds", 20),
      ...suitCards("32", "clubs", 30),
    ];
    expect(evaluateHand(balanced)).toBe(15);
    const state = botCall(balanced, startGame(seededRandom(2)));
    expect(state.auction[0]).toMatchObject({ kind: "bid", level: 1, denomination: "nt" });
  });

  it("raises its partner with a fit and passes without one", () => {
    let state = startGame(seededRandom(37));
    state = makeBid(state, 1, "spades"); // seat 0 opens
    state = makePass(state); // seat 1
    expect(state.turn).toBe(2); // seat 0's partner

    // Four spades and 11 points — a fit, and enough to raise on.
    const withFit = [
      ...suitCards("K432", "spades", 1),
      ...suitCards("AQ2", "hearts", 10),
      ...suitCards("Q432", "diamonds", 20),
      ...suitCards("32", "clubs", 30),
    ];
    expect(evaluateHand(withFit)).toBeGreaterThanOrEqual(10);
    const raised = botCall(withFit, state);
    expect(raised.auction[2]).toMatchObject({ kind: "bid", level: 2, denomination: "spades" });

    const noFit = [
      ...suitCards("2", "spades", 1),
      ...suitCards("A32", "hearts", 10),
      ...suitCards("Q4322", "diamonds", 20),
      ...suitCards("5432", "clubs", 30),
    ];
    expect(botCall(noFit, state).auction[2].kind).toBe("pass");
  });

  it("never bids illegally, whatever it holds", () => {
    // The safety net: every bot call must land on a legal auction. A bid below the
    // standing one would be silently dropped by `makeBid` and the bot would appear to
    // pass, so this asserts the auction actually grew.
    let state = startGame(seededRandom(53));
    state = makeBid(state, 3, "nt");
    const strong = [
      ...suitCards("AKQJT", "spades", 1),
      ...suitCards("AKQ", "hearts", 10),
      ...suitCards("AK", "diamonds", 20),
      ...suitCards("AK3", "clubs", 30),
    ];
    const after = botCall(strong, state);
    expect(after.auction.length).toBe(2);
  });

  it("leads the fourth-highest of its longest suit", () => {
    const hand = [
      ...suitCards("AKQ72", "hearts", 1),
      ...suitCards("A32", "spades", 10),
      ...suitCards("432", "diamonds", 20),
      ...suitCards("32", "clubs", 30),
    ];
    const state = playState({ hands: [[], [], hand, []], turn: 2, currentTrick: [] });
    const led = botPlay(hand, state, seededRandom(1));
    expect(led.suit).toBe("hearts");
    expect(led.rank).toBe("7");
  });

  it("plays low when its partner is already winning the trick", () => {
    // Seat 3's partner is seat 1, who has played the ace — no need to spend a high card.
    const hand = [card("K", "clubs", 1), card("2", "clubs", 2)];
    const state = playState({
      hands: [[], [], [], hand],
      turn: 3,
      currentTrick: [
        { seat: 1, card: card("A", "clubs", 10) },
        { seat: 2, card: card("5", "clubs", 11) },
      ],
    });
    expect(botPlay(hand, state, seededRandom(1)).rank).toBe("2");
  });

  it("wins a trick as cheaply as it can", () => {
    // Seat 2 is to play, and the seat currently winning is seat 1 — an opponent, since
    // seat 2's partner is seat 0. The eight is the cheapest card that takes it, so the
    // ace is not spent.
    const hand = [card("A", "clubs", 1), card("8", "clubs", 2), card("2", "clubs", 3)];
    const state = playState({
      hands: [[], [], hand, []],
      turn: 2,
      currentTrick: [
        { seat: 0, card: card("4", "clubs", 10) },
        { seat: 1, card: card("7", "clubs", 11) },
      ],
    });
    expect(botPlay(hand, state, seededRandom(1)).rank).toBe("8");
  });

  it("does not overtake its own partner", () => {
    // Seat 3's partner is seat 1, who is winning the trick with the ace. Playing the
    // king on it would be throwing away a trick-taking card to beat your own side —
    // so the bot plays low even though it holds a card that would "win".
    const hand = [card("K", "clubs", 1), card("2", "clubs", 2)];
    const state = playState({
      hands: [[], [], [], hand],
      turn: 3,
      currentTrick: [
        { seat: 0, card: card("5", "clubs", 10) },
        { seat: 1, card: card("A", "clubs", 11) },
        { seat: 2, card: card("3", "clubs", 12) },
      ],
    });
    expect(botPlay(hand, state, seededRandom(1)).rank).toBe("2");
  });

  it("throws its lowest card when it cannot win", () => {
    const hand = [card("Q", "clubs", 1), card("2", "clubs", 2)];
    const state = playState({
      hands: [[], [], [], hand],
      turn: 3,
      currentTrick: [
        { seat: 0, card: card("A", "clubs", 10) },
        { seat: 1, card: card("5", "clubs", 11) },
        { seat: 2, card: card("3", "clubs", 12) },
      ],
    });
    expect(botPlay(hand, state, seededRandom(1)).rank).toBe("2");
  });
});

describe("stepping the table", () => {
  it("does nothing once the hand has ended", () => {
    const state = playState({ phase: "ended", outcome: "won" });
    expect(stepBots(state, seededRandom(1))).toBe(state);
  });

  it("does nothing while the human is to call", () => {
    const state = startGame(seededRandom(61));
    const humanTurn = { ...state, turn: HUMAN_SEAT };
    expect(stepBots(humanTurn, seededRandom(1))).toBe(humanTurn);
  });

  it("waits for the human to play dummy when the human declares", () => {
    // Declarer plays dummy's cards, so a state on dummy's turn is still the human's move
    // — this is why `isWaitingForHuman` is a function and not a turn comparison.
    const state = playState({
      contract: { level: 4, denomination: "spades", declarer: HUMAN_SEAT, doubling: "none" },
      turn: partnerOf(HUMAN_SEAT),
      hands: [[], [], [], [card("2", "clubs", 1)]],
    });
    expect(isWaitingForHuman(state)).toBe(true);
    expect(stepBots(state, seededRandom(1))).toBe(state);
  });

  it("does not wait on dummy when a bot declares", () => {
    const state = playState({
      contract: { level: 4, denomination: "spades", declarer: 0, doubling: "none" },
      turn: 2,
    });
    expect(isWaitingForHuman(state)).toBe(false);
  });

  it("advances exactly one call per invocation", () => {
    const state = startGame(seededRandom(67));
    const once = stepBots(state, seededRandom(1));
    // Seat 0 is a bot and the dealer, so one step produces exactly one call.
    expect(once.auction).toHaveLength(1);
    expect(once.turn).toBe(1);
  });

  it("drives an auction to a contract or a pass-out without the human", () => {
    // The integration check: stepping repeatedly must terminate, never hang, and leave
    // the table in a legal state. The human passes whenever asked.
    let state = startGame(seededRandom(71));
    for (let step = 0; step < 60 && state.phase === "auction"; step += 1) {
      state = isWaitingForHuman(state) ? makePass(state) : stepBots(state, seededRandom(step + 1));
    }
    expect(state.phase === "play" || state.outcome === "passed-out").toBe(true);
  });

  it("plays a whole hand out to thirteen tricks with every card accounted for", () => {
    let state = startGame(seededRandom(73));

    // Bid it out, the human always passing.
    for (let step = 0; step < 60 && state.phase === "auction"; step += 1) {
      state = isWaitingForHuman(state) ? makePass(state) : stepBots(state, seededRandom(step + 1));
    }

    if (state.outcome === "passed-out") {
      expect(state.phase).toBe("ended");
      return;
    }

    // Play it out, the human playing its first legal card.
    for (let step = 0; step < 200 && state.phase === "play"; step += 1) {
      if (isWaitingForHuman(state)) {
        const legal = legalPlays(state, state.turn);
        state = playCard(state, legal[0]);
      } else {
        state = stepBots(state, seededRandom(step + 100));
      }
    }

    expect(state.phase).toBe("ended");
    expect(state.tricks).toHaveLength(BRIDGE_TRICKS);
    // Conservation across a full hand: all 52 cards are still in play, now all in tricks.
    expect(allCards(state)).toHaveLength(CARDS_IN_DECK);
    expect(state.hands.flat()).toHaveLength(0);
    // Every trick was won by exactly one seat, and the sides' tricks sum to thirteen.
    expect(tricksWonBy(state, "ns") + tricksWonBy(state, "ew")).toBe(BRIDGE_TRICKS);
    expect(["won", "lost"]).toContain(state.outcome);
  });
});
