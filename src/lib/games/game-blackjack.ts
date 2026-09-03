import { draw, shuffledShoe, type Card, type Random, type Rank } from "./playing-cards";
import {
  BLACKJACK_MAX_BET,
  BLACKJACK_MIN_BET,
  BLACKJACK_PAYOUT,
  BLACKJACK_STARTING_CHIPS,
  BLACKJACK_TARGET,
  DEALER_STANDS_ON,
  DECKS_IN_SHOE,
  SHOE_RESHUFFLE_AT,
  type BlackjackState,
  type Hand,
  type HandResult,
} from "./types";

/**
 * The rules of Blackjack, as pure functions over an immutable `BlackjackState`.
 *
 * Nothing here touches React, the DOM or `Math.random` directly — the RNG arrives as
 * an argument, exactly as in `game-2048.ts`, `game-tetris.ts` and `game-sudoku.ts`.
 * That is what lets a test deal a known shoe and assert on a specific hand instead of
 * playing until the case it wants turns up.
 *
 * Every exported function returns a NEW state and never mutates its argument, so the
 * view can hold one in `useState` and React sees each action as a change.
 *
 * There is no clock in this game. A hand takes as long as it takes, which is why the
 * score is chips rather than time — see `BlackjackState`.
 */

/**
 * Re-exported so a caller that already imports the rules does not need a second
 * import for the RNG type they must supply. Structurally identical to every other
 * game's `Random`.
 */
export type { Random };

/**
 * What a rank is worth, counting every ace as 11.
 *
 * The soft/hard decision is not made here — it cannot be, because it depends on the
 * rest of the hand. `handValue` demotes aces afterwards; this function only reports a
 * card's face value.
 *
 * This is why `Rank` is a string in `playing-cards.ts` and not a number: the deck has
 * no opinion on what a card is worth, and every game answers this question its own way.
 */
export function valueOf(rank: Rank): number {
  if (rank === "A") return 11;
  if (rank === "K" || rank === "Q" || rank === "J") return 10;
  return Number(rank);
}

/** A fresh six-deck shoe, shuffled. The deck itself comes from `playing-cards.ts`. */
export function newShoe(random: Random): readonly Card[] {
  return shuffledShoe(DECKS_IN_SHOE, random);
}

/**
 * The best total a hand can make without busting, and whether it is soft.
 *
 * Counts every ace as 11, then demotes them to 1 one at a time while the total is
 * over 21. A hand is **soft** if an ace is still counted as 11 — soft 17 is A+6, which
 * can take a card without risk, where hard 17 cannot. The view shows both readings for
 * a soft hand, so this returns the flag rather than only the number.
 */
export function handValue(cards: readonly Card[]): { total: number; soft: boolean } {
  let total = 0;
  let aces = 0;

  for (const card of cards) {
    total += valueOf(card.rank);
    if (card.rank === "A") aces += 1;
  }

  // Demote one ace per iteration: each demotion costs 10, and a hand can hold several.
  while (total > BLACKJACK_TARGET && aces > 0) {
    total -= 10;
    aces -= 1;
  }

  return { total, soft: aces > 0 };
}

/** The total alone, for the many callers that do not care whether it is soft. */
export function totalOf(cards: readonly Card[]): number {
  return handValue(cards).total;
}

/** Whether a hand has gone over 21. */
export function isBust(cards: readonly Card[]): boolean {
  return totalOf(cards) > BLACKJACK_TARGET;
}

/**
 * Whether a hand is a natural blackjack: 21 on the first two cards.
 *
 * A hand from a split is never a blackjack however it lands, even at ace-ten. A
 * natural is what you are dealt, and paying 3:2 on a split ace-ten would make
 * splitting aces the only bet worth making — see `Hand.fromSplit`.
 */
export function isBlackjack(hand: Hand): boolean {
  return !hand.fromSplit && hand.cards.length === 2 && totalOf(hand.cards) === BLACKJACK_TARGET;
}

/** The dealer's face-up card — the only one the player may see before the dealer plays. */
export function dealerUpcard(state: BlackjackState): Card | undefined {
  return state.dealer[0];
}

/** A bet clamped to the table limits and to what the player can actually cover. */
export function clampBet(bet: number, chips: number): number {
  const ceiling = Math.min(BLACKJACK_MAX_BET, chips);
  // A bankroll below the minimum cannot make a legal bet at all; report what is left
  // rather than a stake the player cannot cover, and let `settle` end the run.
  if (ceiling < BLACKJACK_MIN_BET) return chips;
  return Math.max(BLACKJACK_MIN_BET, Math.min(ceiling, bet));
}

/** A fresh run: a full bankroll, a shuffled shoe, and nothing on the table. */
export function startGame(random: Random): BlackjackState {
  return {
    shoe: newShoe(random),
    hands: [],
    activeHand: 0,
    dealer: [],
    chips: BLACKJACK_STARTING_CHIPS,
    bet: BLACKJACK_MIN_BET,
    handsPlayed: 0,
    peakChips: BLACKJACK_STARTING_CHIPS,
    outcome: undefined,
    phase: "betting",
  };
}

/** Sets the stake for the next deal. Ignored once the cards are out. */
export function setBet(state: BlackjackState, bet: number): BlackjackState {
  if (state.phase !== "betting" || state.outcome) return state;
  return { ...state, bet: clampBet(bet, state.chips) };
}

/**
 * Deals a round: two cards to the player, two to the dealer.
 *
 * The stake leaves the bankroll here rather than at settlement, so `chips` always
 * reads as chips in hand and a player cannot bet money that is already on the table.
 * Every payout in `settle` therefore returns the stake along with the winnings.
 *
 * The shoe is topped up before the deal, never during a round — see
 * `SHOE_RESHUFFLE_AT` for why no hand may straddle a shuffle.
 *
 * A deal into a natural goes straight to settlement: with a blackjack showing there is
 * nothing for the player to decide, and offering Hit on a 21 is just a way to lose.
 */
export function deal(state: BlackjackState, random: Random): BlackjackState {
  if (state.phase !== "betting" && state.phase !== "settled") return state;
  if (state.outcome) return state;

  const bet = clampBet(state.bet, state.chips);
  if (bet > state.chips || bet < BLACKJACK_MIN_BET) return state;

  const shoe = state.shoe.length <= SHOE_RESHUFFLE_AT ? newShoe(random) : state.shoe;
  const { drawn, rest } = draw(shoe, 4);

  // Dealt in the real order — player, dealer, player, dealer — rather than two at a
  // time. It changes nothing about the odds, but a test that stacks a shoe expects the
  // order a table actually deals in.
  const hand: Hand = {
    cards: [drawn[0], drawn[2]],
    bet,
    doubled: false,
    fromSplit: false,
    result: undefined,
  };

  const dealt: BlackjackState = {
    ...state,
    shoe: rest,
    hands: [hand],
    activeHand: 0,
    dealer: [drawn[1], drawn[3]],
    chips: state.chips - bet,
    bet,
    phase: "playing",
  };

  // A natural on either side ends the round immediately: neither party has a decision
  // left to make, so going through `dealer` would only add a pause.
  if (isBlackjack(hand) || totalOf(dealt.dealer) === BLACKJACK_TARGET) {
    return settle(dealt);
  }
  return dealt;
}

/** The hand currently being acted on, or undefined outside the playing phase. */
export function activeHandOf(state: BlackjackState): Hand | undefined {
  return state.phase === "playing" ? state.hands[state.activeHand] : undefined;
}

/**
 * Takes one card on the active hand.
 *
 * A hand that busts, or reaches 21, is finished — 21 stands automatically, because
 * there is no card that improves it and a player who hits it has misclicked. Either
 * way play moves to the next hand, or to the dealer.
 */
export function hit(state: BlackjackState): BlackjackState {
  const hand = activeHandOf(state);
  if (!hand || state.outcome) return state;

  const { drawn, rest } = draw(state.shoe, 1);
  if (drawn.length === 0) return state;

  const cards = [...hand.cards, drawn[0]];
  const next: BlackjackState = {
    ...state,
    shoe: rest,
    hands: replaceHand(state.hands, state.activeHand, { ...hand, cards }),
  };

  if (isBust(cards) || totalOf(cards) === BLACKJACK_TARGET) return advance(next);
  return next;
}

/** Ends the active hand and moves on. */
export function stand(state: BlackjackState): BlackjackState {
  if (!activeHandOf(state) || state.outcome) return state;
  return advance(state);
}

/**
 * Whether the active hand may double: first two cards only, and the extra stake
 * affordable. Exported so the view can disable the button rather than have the press
 * silently do nothing.
 */
export function canDouble(state: BlackjackState): boolean {
  const hand = activeHandOf(state);
  return Boolean(hand && hand.cards.length === 2 && !hand.doubled && state.chips >= hand.bet);
}

/**
 * Doubles the stake, takes exactly one card, and stands.
 *
 * Only on the first two cards — the classic restriction, and the reason this is a
 * decision rather than a free upgrade on a hand that has already improved.
 */
export function doubleDown(state: BlackjackState): BlackjackState {
  if (!canDouble(state)) return state;
  const hand = state.hands[state.activeHand];

  const { drawn, rest } = draw(state.shoe, 1);
  if (drawn.length === 0) return state;

  const doubledHand: Hand = {
    ...hand,
    cards: [...hand.cards, drawn[0]],
    bet: hand.bet * 2,
    doubled: true,
  };

  return advance({
    ...state,
    shoe: rest,
    chips: state.chips - hand.bet,
    hands: replaceHand(state.hands, state.activeHand, doubledHand),
  });
}

/**
 * Whether the active hand may be split.
 *
 * Matched on rank, not value — a king and a queen are both worth ten but are not a
 * pair. Splitting mixed tens is legal at most tables and is also a bad move; requiring
 * a real pair keeps the button honest about what it is for.
 *
 * `hands.length === 1` allows one split per round, so two hands at most: re-splitting
 * multiplies the bankroll at risk on a single deal and turns a bad shoe into an
 * instant bust, which is a worse game for a household arcade than the simpler rule.
 */
export function canSplit(state: BlackjackState): boolean {
  const hand = activeHandOf(state);
  return Boolean(
    hand &&
      state.hands.length === 1 &&
      hand.cards.length === 2 &&
      hand.cards[0].rank === hand.cards[1].rank &&
      state.chips >= hand.bet,
  );
}

/** Splits a pair into two hands, each with its own stake and a second card. */
export function split(state: BlackjackState): BlackjackState {
  if (!canSplit(state)) return state;
  const hand = state.hands[state.activeHand];

  const { drawn, rest } = draw(state.shoe, 2);
  if (drawn.length < 2) return state;

  const first: Hand = {
    cards: [hand.cards[0], drawn[0]],
    bet: hand.bet,
    doubled: false,
    fromSplit: true,
    result: undefined,
  };
  const second: Hand = {
    cards: [hand.cards[1], drawn[1]],
    bet: hand.bet,
    doubled: false,
    fromSplit: true,
    result: undefined,
  };

  return {
    ...state,
    shoe: rest,
    chips: state.chips - hand.bet,
    hands: [first, second],
    activeHand: 0,
  };
}

/**
 * Moves to the next unfinished hand, or hands over to the dealer.
 *
 * The dealer is skipped entirely when every hand has busted: with nothing left to beat
 * the dealer would be drawing to an empty table, and revealing those cards implies a
 * contest that is already over.
 */
function advance(state: BlackjackState): BlackjackState {
  const next = state.activeHand + 1;
  if (next < state.hands.length) return { ...state, activeHand: next };

  if (state.hands.every((hand) => isBust(hand.cards))) return settle(state);
  return dealerPlay({ ...state, phase: "dealer" });
}

/**
 * Plays the dealer's hand out: draw until 17 or better, then stand.
 *
 * Stands on **all** 17s, soft included — see `DEALER_STANDS_ON`. The dealer has no
 * choices, which is the point: the whole game is the player deciding against a known
 * policy, so this is a loop rather than a strategy.
 */
export function dealerPlay(state: BlackjackState): BlackjackState {
  let dealer = state.dealer;
  let shoe = state.shoe;

  while (totalOf(dealer) < DEALER_STANDS_ON && shoe.length > 0) {
    const { drawn, rest } = draw(shoe, 1);
    dealer = [...dealer, drawn[0]];
    shoe = rest;
  }

  return settle({ ...state, dealer, shoe });
}

/**
 * Scores every hand against the dealer and moves the chips.
 *
 * Each payout returns the stake as well as the winnings, because the stake left the
 * bankroll at the deal — a push therefore pays `bet` back and nets nothing, which is
 * what a push means.
 *
 * The run ends here, not on the next deal: a player who cannot cover the minimum bet
 * has nothing left to decide, and leaving them at a betting screen with a Deal button
 * that refuses would be worse than saying so.
 */
export function settle(state: BlackjackState): BlackjackState {
  const dealerTotal = totalOf(state.dealer);
  const dealerBlackjack = state.dealer.length === 2 && dealerTotal === BLACKJACK_TARGET;
  const dealerBust = dealerTotal > BLACKJACK_TARGET;

  let chips = state.chips;
  const hands = state.hands.map((hand) => {
    const result = resultFor(hand, dealerTotal, dealerBust, dealerBlackjack);
    chips += payout(hand, result);
    return { ...hand, result };
  });

  const peakChips = Math.max(state.peakChips, chips);
  // Out of the game when the minimum bet is no longer coverable, not only at zero: a
  // bankroll of 10 against a 25 minimum cannot play another hand, so calling it broke
  // is the honest reading.
  const broke = chips < BLACKJACK_MIN_BET;

  return {
    ...state,
    hands,
    chips,
    peakChips,
    handsPlayed: state.handsPlayed + hands.length,
    phase: "settled",
    outcome: broke ? "broke" : state.outcome,
  };
}

/** How one hand finished against the dealer. */
function resultFor(
  hand: Hand,
  dealerTotal: number,
  dealerBust: boolean,
  dealerBlackjack: boolean,
): HandResult {
  // Checked first: a bust loses regardless of what the dealer went on to do, which is
  // the house's entire edge and the one rule that must not be reordered.
  if (isBust(hand.cards)) return "bust";

  const player = totalOf(hand.cards);

  if (isBlackjack(hand)) return dealerBlackjack ? "push" : "blackjack";
  if (dealerBlackjack) return "lose";
  if (dealerBust) return "win";
  if (player > dealerTotal) return "win";
  if (player < dealerTotal) return "lose";
  return "push";
}

/** Chips returned to the bankroll for a settled hand, stake included. */
function payout(hand: Hand, result: HandResult): number {
  if (result === "blackjack") return hand.bet + Math.round(hand.bet * BLACKJACK_PAYOUT);
  if (result === "win") return hand.bet * 2;
  if (result === "push") return hand.bet;
  return 0;
}

/** Clears the table for the next deal, keeping the bankroll and the stake. */
export function nextRound(state: BlackjackState): BlackjackState {
  if (state.phase !== "settled" || state.outcome) return state;
  return {
    ...state,
    hands: [],
    dealer: [],
    activeHand: 0,
    bet: clampBet(state.bet, state.chips),
    phase: "betting",
  };
}

/**
 * Ends the run and banks the chips.
 *
 * Refused mid-round: walking away with cards on the table would let a player abandon a
 * hand they were about to lose, so the stake has to be resolved first.
 */
export function cashOut(state: BlackjackState): BlackjackState {
  if (state.outcome) return state;
  if (state.phase !== "betting" && state.phase !== "settled") return state;
  return { ...state, outcome: "cashed-out" };
}

/**
 * What a run is worth: the chips banked, or zero for a bankrupt one.
 *
 * Zero rather than the handful of chips left when the run went broke — an unfinished
 * or lost run is not a result, the same rule Sudoku applies to an abandoned board.
 * Only a cash-out scores, which is what makes knowing when to stop part of the game.
 */
export function scoreGame(state: BlackjackState): number {
  return state.outcome === "cashed-out" ? state.chips : 0;
}

/** `hands` with one entry replaced. Kept here so no caller mutates the array. */
function replaceHand(hands: readonly Hand[], index: number, hand: Hand): readonly Hand[] {
  return hands.map((entry, at) => (at === index ? hand : entry));
}
