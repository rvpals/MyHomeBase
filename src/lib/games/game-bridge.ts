// The deck, game-agnostic and shared with Blackjack. `RANKS` comes from here rather
// than from `./types`, which re-exports the card *types* but not the rank array itself.
import {
  RANKS,
  draw,
  newDeck,
  shuffle,
  type Card,
  type Random,
  type Rank,
  type Suit,
} from "./playing-cards";
import {
  BRIDGE_BOOK,
  BRIDGE_DENOMINATIONS,
  BRIDGE_GAME_BONUS,
  BRIDGE_GAME_THRESHOLD,
  BRIDGE_GRAND_SLAM_BONUS,
  BRIDGE_HAND_SIZE,
  BRIDGE_HCP,
  BRIDGE_INSULT_BONUS,
  BRIDGE_MAX_LEVEL,
  BRIDGE_NT_FIRST_TRICK_BONUS,
  BRIDGE_PARTSCORE_BONUS,
  BRIDGE_SMALL_SLAM_BONUS,
  BRIDGE_TRICKS,
  BRIDGE_TRICK_VALUES,
  BRIDGE_UNDERTRICK_VALUE,
  HUMAN_SEAT,
  PARTNER_OF,
  SEATS,
  type BridgeCall,
  type BridgeScore,
  type BridgeSide,
  type BridgeState,
  type CallKind,
  type Contract,
  type Denomination,
  type Doubling,
  type Seat,
  type Trick,
  type TrickCard,
} from "./types";

/**
 * The rules of contract bridge, as pure functions over an immutable `BridgeState`.
 *
 * Nothing here touches React, the DOM or `Math.random` directly — the RNG arrives as an
 * argument, exactly as in `game-blackjack.ts` and `game-mahjong.ts`. That is what lets a
 * test deal a known hand and assert on a specific auction instead of playing until the
 * case it wants turns up.
 *
 * Every exported function returns a NEW state and never mutates its argument, so the view
 * can hold one in `useState` and React sees each action as a change. **An illegal action
 * returns the state unchanged rather than throwing** — the same call every other game
 * here makes, and it means a view that offers a button a beat too early cannot crash.
 *
 * One hand, played not vulnerable, scored on its own. See the Bridge section of `types.ts`
 * for why a rubber was not the unit.
 *
 * The phase machine:
 *
 *   deal
 *     |
 *     v
 *   auction  --(4 opening passes)-->  ended (passed-out)
 *     |
 *     | 3 passes after a bid
 *     v
 *   play  --(13 tricks)-->  ended (won | lost)
 *
 * There is no clock in this game, which is why the score is the contract's value rather
 * than time — see `scoreGame`.
 */

/**
 * Re-exported so a caller that already imports the rules does not need a second import
 * for the RNG type they must supply. Structurally identical to every other game's.
 */
export type { Random };

/* ---------------------------------------------------------------------------------
   Seats, sides and the deal.
--------------------------------------------------------------------------------- */

/** The seat after `seat` in turn order. Play passes up through the seat indices. */
export function nextSeat(seat: Seat): Seat {
  return ((seat + 1) % SEATS.length) as Seat;
}

/** The partner sitting opposite `seat`. */
export function partnerOf(seat: Seat): Seat {
  return PARTNER_OF[seat];
}

/** Which partnership a seat belongs to. Seats 0 and 2 are `ns`; 1 and 3 are `ew`. */
export function sideOf(seat: Seat): BridgeSide {
  return seat % 2 === 0 ? "ns" : "ew";
}

/** Whether two seats are partners. False for a seat and itself — you are not your own partner. */
export function arePartners(a: Seat, b: Seat): boolean {
  return a !== b && sideOf(a) === sideOf(b);
}

/**
 * How high a rank plays, ace high.
 *
 * The deck lists ranks ace-first because that is how a deck is built, so a plain index
 * into `RANKS` would make the ace the *lowest* card. This maps ace to the top instead,
 * which is the only ranking bridge uses — there is no low-ace here, unlike the ace that
 * counts 1 in Blackjack. This function is precisely the "what is a card worth" opinion
 * that `playing-cards.ts` deliberately refuses to hold.
 */
export function rankOrder(rank: Rank): number {
  const index = RANKS.indexOf(rank);
  // Ace sits at index 0 in deck order; every other rank shifts down one so the two is
  // lowest at 1 and the king is 12, leaving 13 for the ace.
  return index === 0 ? RANKS.length : index;
}

/** Whether `a` beats `b` within the same suit. Suit is the caller's business. */
export function beats(a: Card, b: Card): boolean {
  return rankOrder(a.rank) > rankOrder(b.rank);
}

/**
 * A hand sorted for display: by suit in bidding order, and by rank within a suit.
 *
 * Descending rank inside each suit, because that is how a player fans a hand — the ace
 * at the left of its suit. Bidding order rather than deck order for the suits, so the
 * hand reads in the same sequence as the bidding box below it.
 */
export function sortHand(cards: readonly Card[]): readonly Card[] {
  return [...cards].sort((a, b) => {
    const suitDiff =
      BRIDGE_DENOMINATIONS.indexOf(a.suit as Denomination) -
      BRIDGE_DENOMINATIONS.indexOf(b.suit as Denomination);
    if (suitDiff !== 0) return suitDiff;
    return rankOrder(b.rank) - rankOrder(a.rank);
  });
}

/** The cards of one suit within a hand, already in descending rank. */
export function cardsOfSuit(cards: readonly Card[], suit: Suit): readonly Card[] {
  return sortHand(cards.filter((card) => card.suit === suit));
}

/**
 * A fresh hand: a shuffled deck dealt thirteen cards each, the auction open.
 *
 * Seat 0 deals and therefore calls first. A fixed dealer rather than a rotating one
 * because only one hand is played — there is no second deal for the rotation to matter
 * to, and a random dealer would only make the opening seat unpredictable for no gain.
 */
export function startGame(random: Random): BridgeState {
  const deck = shuffle(newDeck(), random);
  const hands: (readonly Card[])[] = [];

  let rest: readonly Card[] = deck;
  for (let seat = 0; seat < SEATS.length; seat += 1) {
    const dealt = draw(rest, BRIDGE_HAND_SIZE);
    hands.push(sortHand(dealt.drawn));
    rest = dealt.rest;
  }

  const dealer: Seat = 0;
  return {
    hands,
    phase: "auction",
    turn: dealer,
    dealer,
    auction: [],
    contract: undefined,
    currentTrick: [],
    tricks: [],
    dummyExposed: false,
    outcome: "playing",
  };
}

/** The cards `seat` still holds. */
export function handOf(state: BridgeState, seat: Seat): readonly Card[] {
  return state.hands[seat];
}

/**
 * Every card in the hand, wherever it currently sits.
 *
 * Exists for the tests: all fifty-two cards must be accounted for across the four hands,
 * the trick in progress and the tricks already won, at every point in a hand. Mahjong
 * exports `allTiles` for the same reason — a conservation invariant catches a card
 * duplicated or dropped by a bug in the play, which is otherwise invisible until a hand
 * ends with the wrong number of tricks.
 */
export function allCards(state: BridgeState): readonly Card[] {
  return [
    ...state.hands.flat(),
    ...state.currentTrick.map((played) => played.card),
    ...state.tricks.flatMap((trick) => trick.cards.map((played) => played.card)),
  ];
}

/* ---------------------------------------------------------------------------------
   The auction.
--------------------------------------------------------------------------------- */

/** The calls made so far that were actual bids, most recent last. */
export function bidsOf(auction: readonly BridgeCall[]): readonly BridgeCall[] {
  return auction.filter((call) => call.kind === "bid");
}

/** The highest bid so far, or undefined when nobody has bid. */
export function lastBid(auction: readonly BridgeCall[]): BridgeCall | undefined {
  const bids = bidsOf(auction);
  return bids[bids.length - 1];
}

/**
 * How high a bid ranks, as one comparable number.
 *
 * Five denominations per level, so `level * 5 + denomination index` orders every legal
 * bid — 1♣ lowest at 5, 7NT highest. One number rather than comparing level then
 * denomination at each call site, which is the comparison that gets written backwards.
 */
export function bidRank(level: number, denomination: Denomination): number {
  return level * BRIDGE_DENOMINATIONS.length + BRIDGE_DENOMINATIONS.indexOf(denomination);
}

/** Whether a bid is legal here: in range, and higher than anything already bid. */
export function canBid(state: BridgeState, level: number, denomination: Denomination): boolean {
  if (state.phase !== "auction") return false;
  if (!Number.isInteger(level) || level < 1 || level > BRIDGE_MAX_LEVEL) return false;
  const highest = lastBid(state.auction);
  if (!highest) return true;
  return (
    bidRank(level, denomination) >
    bidRank(highest.level as number, highest.denomination as Denomination)
  );
}

/**
 * The doubling state the auction currently stands at, and who set it.
 *
 * Read off the calls since the last bid rather than tracked on the state: a new bid
 * clears any double, so a stored flag would need clearing in exactly the place it is
 * easiest to forget. Walking backwards to the last bid cannot drift out of step.
 */
function doublingOf(auction: readonly BridgeCall[]): Doubling {
  for (let i = auction.length - 1; i >= 0; i -= 1) {
    const call = auction[i];
    if (call.kind === "bid") return "none";
    if (call.kind === "double") return "doubled";
    if (call.kind === "redouble") return "redoubled";
  }
  return "none";
}

/**
 * Whether the seat to call may double.
 *
 * You may double a bid made by an opponent, and only when it is not already doubled.
 * Doubling your partner's bid is the rule this guards that a player would otherwise try:
 * it is never legal, however tempting the contract looks.
 */
export function canDouble(state: BridgeState): boolean {
  if (state.phase !== "auction") return false;
  const highest = lastBid(state.auction);
  if (!highest) return false;
  if (doublingOf(state.auction) !== "none") return false;
  return !arePartners(state.turn, highest.seat) && state.turn !== highest.seat;
}

/**
 * Whether the seat to call may redouble.
 *
 * Only the side whose bid was doubled may redouble it — so the seat to call must be the
 * bidder or their partner, and the auction must stand doubled.
 */
export function canRedouble(state: BridgeState): boolean {
  if (state.phase !== "auction") return false;
  if (doublingOf(state.auction) !== "doubled") return false;
  const highest = lastBid(state.auction);
  if (!highest) return false;
  return state.turn === highest.seat || arePartners(state.turn, highest.seat);
}

/**
 * Who declares a contract in `denomination` for the side that won the auction.
 *
 * **The first player of that side to have named the denomination**, not the last one to
 * bid it. This is the rule most often got wrong, and it decides who plays the hand and
 * who puts their cards down: if the human's partner opened 1♠ and the human later bid
 * 4♠, the partner declares and the human is dummy.
 */
export function declarerFor(
  auction: readonly BridgeCall[],
  denomination: Denomination,
  side: BridgeSide,
): Seat {
  const first = bidsOf(auction).find(
    (call) => call.denomination === denomination && sideOf(call.seat) === side,
  );
  // An auction that settled on a denomination always contains a bid in it by the winning
  // side, so this is a narrowing rather than a real fallback.
  return first ? first.seat : (0 as Seat);
}

/**
 * Whether three passes have closed the auction.
 *
 * Three, not four: after a bid, three passes end it. Four passes with no bid at all is
 * the separate pass-out case — see `isPassedOut`.
 */
function isAuctionClosed(auction: readonly BridgeCall[]): boolean {
  if (!lastBid(auction)) return false;
  const tail = auction.slice(-3);
  return tail.length === 3 && tail.every((call) => call.kind === "pass");
}

/** Whether all four players passed the opening round, ending the hand with no contract. */
function isPassedOut(auction: readonly BridgeCall[]): boolean {
  return auction.length === 4 && auction.every((call) => call.kind === "pass");
}

/**
 * The lead to the first trick: the player to declarer's left.
 *
 * Declarer's partner then becomes dummy, and dummy's cards go face-up after this card is
 * played — which is why `dummyExposed` turns on at the first card rather than at the end
 * of the auction.
 */
export function openingLeader(declarer: Seat): Seat {
  return nextSeat(declarer);
}

/** Declarer's partner, whose hand is played face-up by declarer. */
export function dummyOf(contract: Contract): Seat {
  return partnerOf(contract.declarer);
}

/**
 * Adds a call to the auction and advances the turn, closing the auction when it is over.
 *
 * One function for all four call kinds rather than four, because every call shares the
 * same tail: append, check for a close, advance. An illegal call returns the state
 * unchanged.
 */
function addCall(state: BridgeState, call: BridgeCall): BridgeState {
  const auction = [...state.auction, call];

  if (isPassedOut(auction)) {
    return { ...state, auction, phase: "ended", outcome: "passed-out", turn: state.turn };
  }

  if (isAuctionClosed(auction)) {
    const highest = lastBid(auction) as BridgeCall;
    const denomination = highest.denomination as Denomination;
    const declarer = declarerFor(auction, denomination, sideOf(highest.seat));
    const contract: Contract = {
      level: highest.level as number,
      denomination,
      declarer,
      doubling: doublingOf(auction),
    };
    return {
      ...state,
      auction,
      contract,
      phase: "play",
      turn: openingLeader(declarer),
    };
  }

  return { ...state, auction, turn: nextSeat(state.turn) };
}

/** The named bid, if it is legal. */
export function makeBid(
  state: BridgeState,
  level: number,
  denomination: Denomination,
): BridgeState {
  if (!canBid(state, level, denomination)) return state;
  return addCall(state, { seat: state.turn, kind: "bid", level, denomination });
}

/** A pass. Legal whenever the auction is open. */
export function makePass(state: BridgeState): BridgeState {
  if (state.phase !== "auction") return state;
  return addCall(state, { seat: state.turn, kind: "pass" });
}

/** A double, if it is legal. */
export function makeDouble(state: BridgeState): BridgeState {
  if (!canDouble(state)) return state;
  return addCall(state, { seat: state.turn, kind: "double" });
}

/** A redouble, if it is legal. */
export function makeRedouble(state: BridgeState): BridgeState {
  if (!canRedouble(state)) return state;
  return addCall(state, { seat: state.turn, kind: "redouble" });
}

/** Every call the seat to act could legally make, for the view to enable its buttons. */
export function availableCalls(state: BridgeState): readonly CallKind[] {
  if (state.phase !== "auction") return [];
  const calls: CallKind[] = ["pass"];
  // A bid is available if any bid at all is still legal; 7NT is the ceiling, so the
  // auction can only be closed to bidding when 7NT itself has been bid.
  const highest = lastBid(state.auction);
  const ceiling = bidRank(BRIDGE_MAX_LEVEL, "nt");
  if (
    !highest ||
    bidRank(highest.level as number, highest.denomination as Denomination) < ceiling
  ) {
    calls.push("bid");
  }
  if (canDouble(state)) calls.push("double");
  if (canRedouble(state)) calls.push("redouble");
  return calls;
}

/* ---------------------------------------------------------------------------------
   The play.
--------------------------------------------------------------------------------- */

/** The trump suit, or undefined at no-trumps. */
export function trumpOf(contract: Contract | undefined): Suit | undefined {
  if (!contract || contract.denomination === "nt") return undefined;
  return contract.denomination as Suit;
}

/** The suit led to the trick in progress, or undefined when nobody has led yet. */
export function ledSuit(state: BridgeState): Suit | undefined {
  return state.currentTrick[0]?.card.suit;
}

/**
 * The cards `seat` may legally play right now.
 *
 * The one rule of the play: follow suit if you can. A player out of the led suit may
 * play anything, and the leader to a trick may lead anything. Returned as a list rather
 * than a predicate so the view can dim the cards that are not playable, which is how a
 * beginner learns the rule instead of being told off by it.
 */
export function legalPlays(state: BridgeState, seat: Seat): readonly Card[] {
  if (state.phase !== "play") return [];
  const hand = state.hands[seat];
  const led = ledSuit(state);
  if (!led) return hand;
  const following = hand.filter((card) => card.suit === led);
  return following.length > 0 ? following : hand;
}

/** Whether `seat` may play `card` at this moment. */
export function canPlay(state: BridgeState, seat: Seat, card: Card): boolean {
  if (state.turn !== seat) return false;
  return legalPlays(state, seat).some((legal) => legal.id === card.id);
}

/**
 * Which seat won a completed trick.
 *
 * The highest trump if any trump was played, otherwise the highest card of the suit led.
 * A card of neither the led suit nor trumps cannot win however high it is, which is the
 * part of the rule a discard makes obvious and a beginner still gets wrong.
 */
export function trickWinner(
  cards: readonly TrickCard[],
  trump: Suit | undefined,
): Seat {
  const led = cards[0].card.suit;
  const trumped = trump ? cards.filter((played) => played.card.suit === trump) : [];
  const contenders = trumped.length > 0 ? trumped : cards.filter((p) => p.card.suit === led);

  let best = contenders[0];
  for (const played of contenders) {
    if (beats(played.card, best.card)) best = played;
  }
  return best.seat;
}

/** How many tricks a side has won so far. */
export function tricksWonBy(state: BridgeState, side: BridgeSide): number {
  return state.tricks.filter((trick) => sideOf(trick.winner) === side).length;
}

/**
 * Plays one card for the seat to act, completing and awarding the trick as needed.
 *
 * The whole of the play is this one function: remove the card, add it to the trick, and
 * if the trick is full award it and set the next leader. The winner of a trick leads the
 * next one, which is the only thing that makes the turn order non-cyclic.
 */
export function playCard(state: BridgeState, card: Card): BridgeState {
  if (state.phase !== "play") return state;
  if (!canPlay(state, state.turn, card)) return state;

  const seat = state.turn;
  const hands = state.hands.map((hand, index) =>
    index === seat ? hand.filter((held) => held.id !== card.id) : hand,
  );
  const currentTrick = [...state.currentTrick, { seat, card }];
  // Dummy goes face-up as soon as the opening lead is made, not when the auction ends.
  const dummyExposed = true;

  if (currentTrick.length < SEATS.length) {
    return { ...state, hands, currentTrick, dummyExposed, turn: nextSeat(seat) };
  }

  const winner = trickWinner(currentTrick, trumpOf(state.contract));
  const tricks: Trick[] = [...state.tricks, { cards: currentTrick, winner }];

  if (tricks.length === BRIDGE_TRICKS) {
    return finish({ ...state, hands, currentTrick: [], tricks, dummyExposed });
  }

  // The winner leads the next trick.
  return { ...state, hands, currentTrick: [], tricks, dummyExposed, turn: winner };
}

/**
 * Ends a played-out hand, setting the outcome from the human's point of view.
 *
 * A `won` means the human's side got what it was playing for — making the contract when
 * declaring or dummy, defeating it when defending. That is the convention
 * `MahjongOutcome` uses and the reason it is right here too: the human defends half the
 * hands, and a scoreboard that only credited declaring would ignore half the game.
 */
function finish(state: BridgeState): BridgeState {
  const contract = state.contract;
  if (!contract) return { ...state, phase: "ended", outcome: "passed-out" };

  const declaringSide = sideOf(contract.declarer);
  const taken = tricksWonBy(state, declaringSide);
  const made = taken >= contract.level + BRIDGE_BOOK;
  const humanDeclares = sideOf(HUMAN_SEAT) === declaringSide;

  return {
    ...state,
    phase: "ended",
    outcome: made === humanDeclares ? "won" : "lost",
  };
}

/** Whether the hand is over, for the view's save-once effect. */
export function isHandOver(state: BridgeState): boolean {
  return state.phase === "ended";
}

/**
 * Whether the table is waiting on the human.
 *
 * True in the auction when it is the human's call, and in the play when the human must
 * play — **including when the human is declarer and it is dummy's turn**, because
 * declarer plays dummy's cards. That last clause is the reason this is a function rather
 * than `state.turn === HUMAN_SEAT` at the call sites.
 */
export function isWaitingForHuman(state: BridgeState): boolean {
  if (state.phase === "ended") return false;
  if (state.turn === HUMAN_SEAT) return true;
  if (state.phase === "play" && state.contract?.declarer === HUMAN_SEAT) {
    return state.turn === dummyOf(state.contract);
  }
  return false;
}

/* ---------------------------------------------------------------------------------
   Scoring.
--------------------------------------------------------------------------------- */

/** The doubling multiplier for trick and overtrick values. */
function doublingFactor(doubling: Doubling): number {
  if (doubling === "doubled") return 2;
  if (doubling === "redoubled") return 4;
  return 1;
}

/** The contract points for bidding and making `level` in `denomination`, before bonuses. */
export function contractPoints(
  level: number,
  denomination: Denomination,
  doubling: Doubling,
): number {
  const base =
    level * BRIDGE_TRICK_VALUES[denomination] +
    (denomination === "nt" ? BRIDGE_NT_FIRST_TRICK_BONUS : 0);
  return base * doublingFactor(doubling);
}

/** What each overtrick is worth. Doubled overtricks are priced per trick, not scaled. */
function overtrickValue(denomination: Denomination, doubling: Doubling): number {
  // Not vulnerable, a doubled overtrick is 100 and a redoubled one 200 — a flat price
  // that replaces the trick value rather than multiplying it.
  if (doubling === "doubled") return 100;
  if (doubling === "redoubled") return 200;
  return BRIDGE_TRICK_VALUES[denomination];
}

/**
 * The penalty for going down `undertricks`, not vulnerable.
 *
 * Undoubled it is a flat 50 a trick. Doubled it is 100 for the first, then 200 for the
 * second and third, then 300 — a rising scale rather than a multiple, which is why this
 * is a loop and not an expression. Redoubled is the doubled figure twice over.
 */
export function undertrickPenalty(undertricks: number, doubling: Doubling): number {
  if (undertricks <= 0) return 0;
  if (doubling === "none") return undertricks * BRIDGE_UNDERTRICK_VALUE;

  let total = 0;
  for (let trick = 1; trick <= undertricks; trick += 1) {
    if (trick === 1) total += 100;
    else if (trick <= 3) total += 200;
    else total += 300;
  }
  return doubling === "redoubled" ? total * 2 : total;
}

/**
 * The full score for a finished hand, itemised.
 *
 * Takes the contract and the tricks taken as arguments rather than reading them off a
 * state, so a test can score a contract without playing thirteen tricks to reach it —
 * and so the result panel can show a what-if. The same reasoning as Mahjong's
 * `scoreHand` taking an options object: the facts scoring needs are not all visible in
 * the cards.
 */
export function scoreContract(contract: Contract, tricksTaken: number): BridgeScore {
  const tricksNeeded = contract.level + BRIDGE_BOOK;
  const made = tricksTaken >= tricksNeeded;
  const overtricks = made ? tricksTaken - tricksNeeded : 0;
  const undertricks = made ? 0 : tricksNeeded - tricksTaken;
  const lines: { label: string; value: number }[] = [];

  if (!made) {
    const penalty = undertrickPenalty(undertricks, contract.doubling);
    lines.push({ label: `${undertricks} down`, value: -penalty });
    return {
      tricksTaken,
      tricksNeeded,
      made: false,
      overtricks: 0,
      undertricks,
      declarerScore: -penalty,
      points: 0,
      lines,
    };
  }

  const trickScore = contractPoints(contract.level, contract.denomination, contract.doubling);
  lines.push({ label: "Contract", value: trickScore });

  let total = trickScore;

  if (overtricks > 0) {
    const extra = overtricks * overtrickValue(contract.denomination, contract.doubling);
    lines.push({ label: `${overtricks} overtrick${overtricks > 1 ? "s" : ""}`, value: extra });
    total += extra;
  }

  // The game bonus is decided by the *contract* points alone — overtricks never turn a
  // part-score into a game, which is the rule that makes bidding game worth the risk.
  if (trickScore >= BRIDGE_GAME_THRESHOLD) {
    lines.push({ label: "Game", value: BRIDGE_GAME_BONUS });
    total += BRIDGE_GAME_BONUS;
  } else {
    lines.push({ label: "Part-score", value: BRIDGE_PARTSCORE_BONUS });
    total += BRIDGE_PARTSCORE_BONUS;
  }

  if (contract.level === 6) {
    lines.push({ label: "Small slam", value: BRIDGE_SMALL_SLAM_BONUS });
    total += BRIDGE_SMALL_SLAM_BONUS;
  } else if (contract.level === BRIDGE_MAX_LEVEL) {
    lines.push({ label: "Grand slam", value: BRIDGE_GRAND_SLAM_BONUS });
    total += BRIDGE_GRAND_SLAM_BONUS;
  }

  if (contract.doubling !== "none") {
    const insult = contract.doubling === "redoubled" ? BRIDGE_INSULT_BONUS * 2 : BRIDGE_INSULT_BONUS;
    lines.push({ label: "For the insult", value: insult });
    total += insult;
  }

  return {
    tricksTaken,
    tricksNeeded,
    made: true,
    overtricks,
    undertricks: 0,
    declarerScore: total,
    points: total,
    lines,
  };
}

/**
 * The score for the hand as it finished, or undefined when there is nothing to score.
 *
 * Undefined rather than a zeroed score for a pass-out or a hand still in play, so the
 * view can tell "nothing was played" from "played and scored nothing".
 */
export function scoreHand(state: BridgeState): BridgeScore | undefined {
  if (state.phase !== "ended" || !state.contract) return undefined;
  return scoreContract(state.contract, tricksWonBy(state, sideOf(state.contract.declarer)));
}

/**
 * The scoreboard points for a finished hand — what `saveScoreAction` records.
 *
 * Zero unless the human's side got what it played for, the same guard
 * `game-mahjong.ts` and `game-blackjack.ts` open with. Two cases score:
 *
 * - The human declared (or was dummy) and made it — the contract's full value.
 * - The human defended and beat it — the penalty the defenders extracted.
 *
 * A defeated contract the human declared scores nothing rather than a negative, because
 * the shared board ranks `score DESC` and cannot represent a debt.
 */
export function scoreGame(state: BridgeState): number {
  if (state.outcome !== "won" || !state.contract) return 0;
  const score = scoreHand(state);
  if (!score) return 0;
  // `declarerScore` is negative on a defeat, and a defeat is a human win only when the
  // human was defending — so the magnitude is what the defenders earned.
  return Math.abs(score.declarerScore);
}

/* ---------------------------------------------------------------------------------
   The bots.

   Rule-based, not a search. They follow the heuristics a beginner is taught — count
   your points, open at the one level, raise your partner, lead the fourth-highest of
   your longest suit, third hand high — which produces plausible bridge without a double
   dummy solver. They are deliberately not expert: the point is a table that plays a
   reasonable hand, and a bot that always found the winning line would make defending
   pointless. Mahjong's bots are built the same way and for the same reason.
--------------------------------------------------------------------------------- */

/** The Milton Work high-card count for a hand — 4/3/2/1 for ace through jack. */
export function highCardPoints(cards: readonly Card[]): number {
  return cards.reduce((total, card) => total + (BRIDGE_HCP[card.rank] ?? 0), 0);
}

/** How many cards of each suit a hand holds, keyed by suit. */
export function suitLengths(cards: readonly Card[]): Readonly<Record<Suit, number>> {
  const lengths = { spades: 0, hearts: 0, diamonds: 0, clubs: 0 };
  for (const card of cards) lengths[card.suit] += 1;
  return lengths;
}

/**
 * A hand's playing strength: high cards plus a little for shape.
 *
 * One point per card beyond the fourth in a suit, the usual length adjustment. Shape
 * genuinely matters — a six-card suit takes tricks a flat hand of the same high cards
 * does not — and without it the bots pass out hands that should be bid.
 */
export function evaluateHand(cards: readonly Card[]): number {
  const lengths = suitLengths(cards);
  const shape = Object.values(lengths).reduce(
    (extra, length) => extra + Math.max(0, length - 4),
    0,
  );
  return highCardPoints(cards) + shape;
}

/** The longest suit, ties broken by the higher-ranking suit. The bots' bidding anchor. */
export function longestSuit(cards: readonly Card[]): Suit {
  const lengths = suitLengths(cards);
  let best: Suit = "spades";
  for (const suit of ["spades", "hearts", "diamonds", "clubs"] as const) {
    if (
      lengths[suit] > lengths[best] ||
      (lengths[suit] === lengths[best] &&
        BRIDGE_DENOMINATIONS.indexOf(suit as Denomination) >
          BRIDGE_DENOMINATIONS.indexOf(best as Denomination))
    ) {
      best = suit;
    }
  }
  return best;
}

/**
 * The call a bot makes.
 *
 * A deliberately small system, in the order a player checks: is my partner's bid worth
 * raising, is my hand worth an opening bid, otherwise pass. It bids its longest suit and
 * raises partner with a fit — enough to reach sensible contracts and to leave the human
 * room to compete.
 *
 * Takes the hand rather than the state's `hands` array, so a bot is never handed cards
 * it is not entitled to see. That is the real fairness mechanism here, exactly as
 * `botDiscard` in `game-mahjong.ts` takes one hand.
 */
export function botCall(hand: readonly Card[], state: BridgeState): BridgeState {
  const strength = evaluateHand(hand);
  const highest = lastBid(state.auction);
  const seat = state.turn;

  // Nothing bid yet: open at the one level with a real hand, otherwise pass.
  if (!highest) {
    if (strength < 12) return makePass(state);
    const suit = longestSuit(hand);
    const lengths = suitLengths(hand);
    // A balanced 15-17 opens 1NT, the one bid every beginner system includes.
    const balanced = Object.values(lengths).every((length) => length <= 5);
    if (balanced && strength >= 15 && strength <= 17) return makeBid(state, 1, "nt");
    return makeBid(state, 1, suit as Denomination);
  }

  const partnerBid = arePartners(seat, highest.seat);
  const lengths = suitLengths(hand);

  // Partner bid: raise with a fit and something to raise with, else pass.
  if (partnerBid) {
    const denomination = highest.denomination as Denomination;
    const level = highest.level as number;
    const fit = denomination !== "nt" && lengths[denomination as Suit] >= 3;
    if (fit && strength >= 10 && level < 4 && canBid(state, level + 1, denomination)) {
      return makeBid(state, level + 1, denomination);
    }
    return makePass(state);
  }

  // An opponent bid. Double a high contract with a strong hand; overcall with a good
  // suit; otherwise pass rather than push the auction up on a weak hand.
  if (strength >= 16 && canDouble(state)) return makeDouble(state);

  const suit = longestSuit(hand);
  if (strength >= 11 && lengths[suit] >= 5) {
    // Overcall at the cheapest legal level in that suit: the same level if the suit
    // outranks what was bid, one higher if it does not. `canBid` is the authority, so
    // this tries the cheaper bid and falls through rather than computing the level.
    const level = highest.level as number;
    if (canBid(state, level, suit as Denomination)) {
      return makeBid(state, level, suit as Denomination);
    }
    if (canBid(state, level + 1, suit as Denomination)) {
      return makeBid(state, level + 1, suit as Denomination);
    }
  }
  return makePass(state);
}

/**
 * The card a bot plays.
 *
 * The heuristics, in order: lead the fourth-highest of the longest suit; play low when
 * partner is already winning the trick; otherwise win the trick as cheaply as possible;
 * failing that, throw the lowest card. Nothing here looks at another seat's hand — only
 * at the trick on the table, which is what every player can see.
 */
export function botPlay(
  hand: readonly Card[],
  state: BridgeState,
  random: Random,
): Card {
  const legal = legalPlays(state, state.turn);
  const trump = trumpOf(state.contract);

  // Leading: fourth-highest of the longest suit is the standard opening lead, and a
  // reasonable lead at any trick.
  if (state.currentTrick.length === 0) {
    const suit = longestSuit(hand);
    const inSuit = cardsOfSuit(legal, suit);
    if (inSuit.length >= 4) return inSuit[3];
    if (inSuit.length > 0) return inSuit[inSuit.length - 1];
    // A hand with nothing in its own longest suit is out of that suit already; pick any
    // legal card, with the RNG breaking the tie so a bot is not perfectly predictable.
    return legal[Math.floor(random() * legal.length)];
  }

  const winningSoFar = trickWinner(state.currentTrick, trump);
  const partnerWinning = arePartners(state.turn, winningSoFar);
  const ascending = [...legal].sort((a, b) => rankOrder(a.rank) - rankOrder(b.rank));

  // Partner is winning: no need to spend a high card on it.
  if (partnerWinning) return ascending[0];

  // Try to win as cheaply as possible. A candidate must actually beat the trick, which
  // `trickWinner` decides — so the test is "would this card take it", not "is it high".
  for (const card of ascending) {
    const hypothetical = [...state.currentTrick, { seat: state.turn, card }];
    if (trickWinner(hypothetical, trump) === state.turn) return card;
  }

  // Cannot win it. Throw the lowest card.
  return ascending[0];
}

/**
 * Advances the table by one bot action.
 *
 * **One action per call, never a loop to the human's turn**, so a view can pace the
 * table at human speed with a timer. Mahjong's `stepBots` makes the same choice for the
 * same reason, and the view drives both identically: an effect keyed on the state chains
 * one `setTimeout` into the next.
 *
 * No-ops itself rather than making the caller work out whose move it is — it returns the
 * state unchanged when the hand is over or the table is waiting on the human.
 */
export function stepBots(state: BridgeState, random: Random): BridgeState {
  if (state.phase === "ended") return state;
  if (isWaitingForHuman(state)) return state;

  const hand = state.hands[state.turn];
  if (state.phase === "auction") return botCall(hand, state);
  return playCard(state, botPlay(hand, state, random));
}
