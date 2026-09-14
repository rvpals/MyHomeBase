"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/button";
import { CardHand } from "@/components/card-hand";
import { PlayingCard } from "@/components/playing-card";
import { useGameSounds } from "@/components/use-game-sounds";
import {
  BRIDGE_DENOMINATIONS,
  BRIDGE_MAX_LEVEL,
  HUMAN_SEAT,
  arePartners,
  availableCalls,
  bridgeHandOf,
  canBid,
  canDoubleContract,
  canPlayCard,
  canRedouble,
  dummyOf,
  highCardPoints,
  isBridgeHandOver,
  isBridgeWaitingForHuman,
  legalPlays,
  makeBid,
  makeDouble,
  makePass,
  makeRedouble,
  playCard,
  scoreBridge,
  scoreBridgeHand,
  sideOf,
  sortHand,
  startBridge,
  stepBridgeBots,
  tricksWonBy,
  type BridgeState,
  type Card,
  type Denomination,
  type Seat,
} from "@/lib/games";
import { saveScoreAction } from "./games-actions";

// The Bridge table. A client component that owns only presentation state — which card
// is hovered, the bidding box's chosen level, the sound toggle. Every rule comes from
// @/lib/games (src/lib/games/game-bridge.ts), so nothing here decides what may be bid,
// which cards are legal, who wins a trick, or what a contract scores.
//
// The bot turns run on a `setTimeout` rather than a loop, exactly as the Mahjong table
// does: pacing is a browser concern, but *what* a bot does is not. `stepBridgeBots`
// advances the table by one action and no-ops when the human is to act, so this file
// never works out whose turn it is.
//
// No `Modal` is rendered in here. The Arcade already plays the game inside one, and a
// nested dialog fights the outer one for Escape and the focus trap — so the result
// panel is a plain bordered div, the same call Arrow Clearing's win panel makes.

const GAME_KEY = "bridge";

/**
 * How long the table pauses between bot actions.
 *
 * Matches the Mahjong table. Slow enough to read what happened — which card was played,
 * who took the trick — and fast enough that three bot turns between yours do not feel
 * like a wait.
 */
const BOT_TURN_MS = 700;

/**
 * How long a completed trick stays on the table before it is swept.
 *
 * The trick is already gone from the state by the time this matters — the rules award it
 * on the fourth card — so this is purely the view holding the *previous* trick visible
 * so a player can see what they lost to. Without it the fourth card and the sweep happen
 * on the same frame and the trick is unreadable.
 */
const TRICK_HOLD_MS = 900;

/**
 * What each seat is called at the table. The human's partner sits across from them.
 *
 * Seat positions are not a lookup table here the way they are on the Mahjong table:
 * the trick area places its four cards by grid position directly, and the seat panels
 * are laid out in the JSX, so a `SEAT_POSITION` map would have to agree with both and
 * could silently drift from either.
 */
const SEAT_LABEL: Record<Seat, string> = {
  0: "West",
  1: "You",
  2: "East",
  3: "Partner",
};

/** The suit symbols, and no-trumps as letters. */
const DENOMINATION_SYMBOL: Record<Denomination, string> = {
  clubs: "♣",
  diamonds: "♦",
  hearts: "♥",
  spades: "♠",
  nt: "NT",
};

/** Whether a denomination draws in the red ink. */
function isRedDenomination(denomination: Denomination): boolean {
  return denomination === "hearts" || denomination === "diamonds";
}

/** A contract as a player would write it: `4♠`, `3NT`, `2♥x`. */
function contractLabel(state: BridgeState): string {
  const contract = state.contract;
  if (!contract) return "—";
  const doubling =
    contract.doubling === "doubled" ? "x" : contract.doubling === "redoubled" ? "xx" : "";
  return `${contract.level}${DENOMINATION_SYMBOL[contract.denomination]}${doubling}`;
}

/** One call as it appears in the auction grid. */
function callLabel(call: { kind: string; level?: number; denomination?: Denomination }): string {
  if (call.kind === "pass") return "Pass";
  if (call.kind === "double") return "X";
  if (call.kind === "redouble") return "XX";
  return `${call.level}${DENOMINATION_SYMBOL[call.denomination as Denomination]}`;
}

export function GameBridgeView({ bestScore }: { bestScore: number }) {
  // `undefined` until the first client render, so the server and client agree on the
  // markup — the same guard every other RNG-seeded game here uses.
  const [state, setState] = useState<BridgeState | undefined>(undefined);
  const [level, setLevel] = useState(1);
  const [soundOn, setSoundOn] = useState(true);
  const [saved, setSaved] = useState<{ best: boolean } | undefined>(undefined);
  // The last completed trick, held on screen briefly so it can be read before the sweep.
  const [lastTrick, setLastTrick] = useState<BridgeState["tricks"][number] | undefined>(undefined);
  const sounds = useGameSounds(soundOn);

  const deal = useCallback(() => {
    setState(startBridge(Math.random));
    setLevel(1);
    setSaved(undefined);
    setLastTrick(undefined);
  }, []);

  useEffect(() => {
    // The deal needs an RNG, which must not run during render or the server and the
    // client would produce different markup — the same guard every RNG-seeded game here
    // uses. It runs once on mount, so there is no cascade to worry about.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    deal();
  }, [deal]);

  // One bot action per timeout, re-armed by this effect when the state changes. Because
  // `stepBridgeBots` no-ops while the human is to act, the chain stops itself.
  useEffect(() => {
    if (!state || isBridgeHandOver(state) || isBridgeWaitingForHuman(state)) return;
    const timer = window.setTimeout(() => {
      setState((current) => (current ? stepBridgeBots(current, Math.random) : current));
    }, BOT_TURN_MS);
    return () => window.clearTimeout(timer);
  }, [state]);

  // Hold each completed trick on screen for a moment after it is awarded. Keyed on the
  // trick count, so it fires once per trick rather than on every card played.
  const trickCount = state?.tricks.length ?? 0;
  const lastAwarded = trickCount > 0 ? state?.tricks[trickCount - 1] : undefined;
  useEffect(() => {
    if (trickCount === 0) return;
    // Purely a display latch: the rules have already swept the trick, and this keeps the
    // last one visible so a player can see what they lost to. One set per trick, cleared
    // by the timer below, so it cannot cascade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLastTrick(lastAwarded);
    const timer = window.setTimeout(() => setLastTrick(undefined), TRICK_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [trickCount, lastAwarded]);

  // Sound cues, derived from the state rather than fired in the handlers — a bot's card
  // is played by a timer, so a handler-based cue would be silent for three seats in four.
  const lastCue = useRef<string>("");
  useEffect(() => {
    if (!state) return;
    const cue = `${state.phase}:${state.auction.length}:${state.tricks.length}:${state.currentTrick.length}:${state.outcome}`;
    if (cue === lastCue.current) return;
    lastCue.current = cue;

    if (state.outcome === "won") {
      sounds.playSequence([
        { startHz: 520, endHz: 660, durationMs: 120, type: "sine", peak: 0.045 },
        { startHz: 660, endHz: 880, durationMs: 160, type: "sine", peak: 0.045 },
      ]);
    } else if (state.outcome === "lost") {
      sounds.play({ startHz: 240, endHz: 170, durationMs: 300, type: "sawtooth", peak: 0.04 });
    } else if (state.currentTrick.length > 0) {
      sounds.play({ startHz: 400, endHz: 360, durationMs: 45, type: "square", peak: 0.025 });
    }
  }, [state, sounds]);

  // Save the finished hand exactly once. `over` alone re-fires on every later render and
  // would post the same score repeatedly, so the ref is the guard.
  const savedRef = useRef(false);
  useEffect(() => {
    if (!state || !isBridgeHandOver(state) || savedRef.current) return;
    savedRef.current = true;
    const points = scoreBridge(state);
    // A pass-out or a hand the human lost scores nothing, and unlike Blackjack this game
    // does not record a row for it — there is no bankroll here that makes "somebody sat
    // down" worth a zero, and a passed-out hand was never played at all.
    if (points <= 0) return;
    void saveScoreAction(GAME_KEY, points, state.tricks.length).then((result) => {
      if (result.ok) setSaved({ best: result.best });
    });
  }, [state]);

  const restart = useCallback(() => {
    savedRef.current = false;
    deal();
  }, [deal]);

  const humanHand = useMemo(
    () => (state ? sortHand(bridgeHandOf(state, HUMAN_SEAT)) : []),
    [state],
  );

  if (!state) return <div className="min-h-[24rem]" />;

  const over = isBridgeHandOver(state);
  const waiting = isBridgeWaitingForHuman(state);
  const calls = availableCalls(state);
  const contract = state.contract;
  const declarer = contract?.declarer;
  const dummy = contract ? dummyOf(contract) : undefined;
  // Declarer plays dummy's cards, so when the human declares and it is dummy's turn the
  // human is picking from dummy's hand — not their own.
  const playingSeat: Seat =
    state.phase === "play" && declarer === HUMAN_SEAT && dummy !== undefined && state.turn === dummy
      ? dummy
      : HUMAN_SEAT;
  const playable = state.phase === "play" ? legalPlays(state, playingSeat) : [];
  const playableIds = new Set(playable.map((card) => card.id));
  const score = scoreBridgeHand(state);
  // Dummy's hand is face-up once the opening lead is made — the one hand the view must
  // reveal rather than hide.
  const showDummy =
    state.dummyExposed && dummy !== undefined && dummy !== HUMAN_SEAT;

  const onPlay = (card: Card) => {
    if (!waiting || state.phase !== "play") return;
    if (!canPlayCard(state, playingSeat, card)) return;
    setState((current) => (current ? playCard(current, card) : current));
  };

  const bid = (denomination: Denomination) => {
    if (!waiting) return;
    setState((current) => (current ? makeBid(current, level, denomination) : current));
  };

  return (
    <div className="flex flex-col gap-4">
      {/* The table: three opponents' card counts, the trick in the middle, your hand. */}
      <div className="flex flex-col gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 max-lg:p-3">
        <div className="flex items-start justify-between gap-3">
          <SeatSummary
            state={state}
            seat={3}
            showCards={showDummy && dummy === 3}
            label={SEAT_LABEL[3]}
          />
          <div className="flex flex-col items-end gap-1 text-right">
            <span className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
              {state.phase === "auction" ? "Auction" : "Contract"}
            </span>
            <span className="font-mono text-lg text-[var(--color-text)]">
              {state.phase === "auction" ? "—" : contractLabel(state)}
            </span>
            {contract && (
              <span className="text-xs text-[var(--color-text-muted)]">
                {SEAT_LABEL[contract.declarer]} declares
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <SeatSummary
            state={state}
            seat={0}
            showCards={showDummy && dummy === 0}
            label={SEAT_LABEL[0]}
          />
          <TrickArea state={state} lastTrick={lastTrick} />
          <SeatSummary
            state={state}
            seat={2}
            showCards={showDummy && dummy === 2}
            label={SEAT_LABEL[2]}
          />
        </div>

        {/* Your hand, and dummy's when you are declarer playing it. */}
        <div className="flex flex-col gap-2">
          {state.phase === "play" && declarer === HUMAN_SEAT && dummy !== undefined && (
            <CardHand
              title={`Dummy (${SEAT_LABEL[dummy]})`}
              cards={sortHand(bridgeHandOf(state, dummy))}
              size="sm"
              layout="fan"
              active={waiting && state.turn === dummy}
              onCardClick={waiting && state.turn === dummy ? (card) => onPlay(card) : undefined}
            />
          )}
          <CardHand
            title={`You — ${highCardPoints(humanHand)} HCP`}
            cards={humanHand}
            size="md"
            layout="fan"
            active={waiting && state.turn === HUMAN_SEAT}
            badge={
              state.phase === "play" ? (
                <span className="text-xs text-[var(--color-text-muted)]">
                  {tricksWonBy(state, sideOf(HUMAN_SEAT))} tricks
                </span>
              ) : undefined
            }
            onCardClick={
              waiting && state.phase === "play" && playingSeat === HUMAN_SEAT
                ? (card) => onPlay(card)
                : undefined
            }
            dimmed={state.phase === "play" && !waiting}
          />
          {state.phase === "play" && waiting && playableIds.size < humanHand.length && (
            <p className="text-xs text-[var(--color-text-muted)]">
              You must follow suit — only {playable.length} of your cards are legal.
            </p>
          )}
        </div>
      </div>

      {/* The bidding box, during the auction only. */}
      {state.phase === "auction" && (
        <div className="flex flex-col gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 max-lg:p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-[var(--color-text)]">
              {waiting ? "Your call" : `${SEAT_LABEL[state.turn]} is thinking…`}
            </span>
            <span className="text-xs text-[var(--color-text-muted)]">
              {highCardPoints(humanHand)} high-card points
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
              Level
            </span>
            {Array.from({ length: BRIDGE_MAX_LEVEL }, (_, index) => index + 1).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setLevel(value)}
                disabled={!waiting}
                className={`h-8 w-8 rounded border font-mono text-sm transition-colors disabled:opacity-40 ${
                  level === value
                    ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-accent-contrast)]"
                    : "border-[var(--color-border)] text-[var(--color-text)] hover:border-[var(--color-accent)]"
                }`}
              >
                {value}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
              Bid
            </span>
            {BRIDGE_DENOMINATIONS.map((denomination) => {
              const legal = waiting && canBid(state, level, denomination);
              return (
                <button
                  key={denomination}
                  type="button"
                  onClick={() => bid(denomination)}
                  disabled={!legal}
                  title={`${level}${DENOMINATION_SYMBOL[denomination]}`}
                  className={`h-9 min-w-[3rem] rounded border px-2 font-mono text-sm transition-colors disabled:opacity-30 ${
                    isRedDenomination(denomination)
                      ? "text-[var(--color-danger)]"
                      : "text-[var(--color-text)]"
                  } border-[var(--color-border)] enabled:hover:border-[var(--color-accent)]`}
                >
                  {level}
                  {DENOMINATION_SYMBOL[denomination]}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setState((c) => (c ? makePass(c) : c))}
              disabled={!waiting || !calls.includes("pass")}
            >
              Pass
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setState((c) => (c ? makeDouble(c) : c))}
              disabled={!waiting || !canDoubleContract(state)}
            >
              Double
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setState((c) => (c ? makeRedouble(c) : c))}
              disabled={!waiting || !canRedouble(state)}
            >
              Redouble
            </Button>
          </div>

          {state.auction.length > 0 && <AuctionGrid state={state} />}
        </div>
      )}

      {/* The result, as a plain panel — never a nested Modal. */}
      {over && (
        <div className="flex flex-col gap-3 rounded-lg border border-[var(--color-accent)] bg-[var(--color-surface)] p-4">
          <h3 className="text-lg font-medium text-[var(--color-text)]">
            {state.outcome === "passed-out"
              ? "Passed out"
              : state.outcome === "won"
                ? "You won it"
                : "You lost it"}
          </h3>

          {state.outcome === "passed-out" ? (
            <p className="text-sm text-[var(--color-text-muted)]">
              Nobody opened the bidding, so the hand is thrown in. No cards are played and
              nothing scores.
            </p>
          ) : (
            score && (
              <>
                <p className="text-sm text-[var(--color-text-muted)]">
                  {contractLabel(state)} by {SEAT_LABEL[contract?.declarer ?? 0]} —{" "}
                  {score.made
                    ? `made${score.overtricks > 0 ? ` with ${score.overtricks} over` : ""}`
                    : `${score.undertricks} down`}
                  , {score.tricksTaken} tricks of {score.tricksNeeded} needed.
                </p>
                <dl className="flex flex-col gap-1 text-sm">
                  {score.lines.map((line) => (
                    <div key={line.label} className="flex justify-between gap-4">
                      <dt className="text-[var(--color-text-muted)]">{line.label}</dt>
                      <dd className="font-mono text-[var(--color-text)]">{line.value}</dd>
                    </div>
                  ))}
                  <div className="flex justify-between gap-4 border-t border-[var(--color-border)] pt-1">
                    <dt className="text-[var(--color-text)]">Scored</dt>
                    <dd className="font-mono text-[var(--color-text)]">{scoreBridge(state)}</dd>
                  </div>
                </dl>
              </>
            )
          )}

          <p className="text-xs text-[var(--color-text-muted)]">
            Only a contract you make, or one you beat as a defender, scores. Best so far:{" "}
            {bestScore}.{saved?.best ? " That is a new record." : ""}
          </p>

          <div>
            <Button size="sm" onClick={restart}>
              Deal again
            </Button>
          </div>
        </div>
      )}

      {/* Table controls. */}
      <div className="flex flex-wrap items-center gap-2">
        {!over && (
          <Button size="sm" variant="secondary" onClick={restart}>
            New deal
          </Button>
        )}
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setSoundOn((on) => !on)}
          ariaLabel={soundOn ? "Turn sound off" : "Turn sound on"}
        >
          {soundOn ? "Sound on" : "Sound off"}
        </Button>
      </div>
    </div>
  );
}

/**
 * One opponent or partner: their name, how many cards they hold, and their tricks.
 *
 * Face-down cards are drawn as a count rather than thirteen backs — three fanned hands
 * of thirteen around a phone-width table is unreadable, and the number is the only fact
 * a player can actually use. Dummy is the exception and shows its real cards.
 */
function SeatSummary({
  state,
  seat,
  showCards,
  label,
}: {
  state: BridgeState;
  seat: Seat;
  showCards: boolean;
  label: string;
}) {
  const hand = bridgeHandOf(state, seat);
  const isTurn = state.turn === seat && state.phase !== "ended";
  const partner = arePartners(seat, HUMAN_SEAT);

  if (showCards) {
    return (
      <CardHand
        title={`${label} (dummy)`}
        cards={sortHand(hand)}
        size="sm"
        layout="fan"
        active={isTurn}
      />
    );
  }

  return (
    <div
      className={`flex min-w-[5.5rem] flex-col gap-1 rounded border px-2 py-1.5 ${
        isTurn
          ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
          : "border-[var(--color-border)]"
      }`}
    >
      <span className="text-xs font-medium text-[var(--color-text)]">
        {label}
        {partner && seat !== HUMAN_SEAT ? " ♦" : ""}
      </span>
      <span className="flex items-center gap-1.5">
        <PlayingCard size="sm" className="scale-[0.55] -ml-2 -my-3" />
        <span className="font-mono text-xs text-[var(--color-text-muted)]">{hand.length}</span>
      </span>
    </div>
  );
}

/**
 * The middle of the table: the trick being played, or the one just taken.
 *
 * Each card sits at its player's side of the square, which is how a real trick reads —
 * you can see who led and who trumped without a legend.
 */
function TrickArea({
  state,
  lastTrick,
}: {
  state: BridgeState;
  lastTrick: BridgeState["tricks"][number] | undefined;
}) {
  // Show the live trick while it is being played; once it is swept, hold the completed
  // one for a moment so it can be read.
  const showing = state.currentTrick.length > 0 ? state.currentTrick : (lastTrick?.cards ?? []);
  const winner = state.currentTrick.length > 0 ? undefined : lastTrick?.winner;

  const bySeat = new Map(showing.map((played) => [played.seat, played.card]));

  const slot = (seat: Seat) => {
    const card = bySeat.get(seat);
    return card ? (
      <PlayingCard
        card={card}
        size="sm"
        selected={winner === seat}
        dimmed={winner !== undefined && winner !== seat}
      />
    ) : (
      <span className="h-[58px] w-[41px]" />
    );
  };

  return (
    <div className="grid grid-cols-3 grid-rows-3 place-items-center gap-0.5">
      <span />
      {slot(3)}
      <span />
      {slot(0)}
      <span className="font-mono text-[0.6rem] uppercase text-[var(--color-text-muted)]">
        {state.phase === "play" ? `${state.tricks.length}/13` : ""}
      </span>
      {slot(2)}
      <span />
      {slot(1)}
      <span />
    </div>
  );
}

/**
 * The auction so far, one column per seat, as a bridge player writes it.
 *
 * Columns start at the dealer rather than at seat 0, so the first call is always in the
 * first column — which is what makes the grid readable as a sequence.
 */
function AuctionGrid({ state }: { state: BridgeState }) {
  const order: Seat[] = [0, 1, 2, 3].map(
    (offset) => ((state.dealer + offset) % 4) as Seat,
  );

  // Lay the calls out in rows of four, in the order they were made.
  const rows: (typeof state.auction)[] = [];
  for (let index = 0; index < state.auction.length; index += 4) {
    rows.push(state.auction.slice(index, index + 4));
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="grid grid-cols-4 gap-1">
        {order.map((seat) => (
          <span
            key={seat}
            className="text-[0.65rem] uppercase tracking-wide text-[var(--color-text-muted)]"
          >
            {SEAT_LABEL[seat]}
          </span>
        ))}
      </div>
      {rows.map((row, rowIndex) => (
        <div key={rowIndex} className="grid grid-cols-4 gap-1">
          {row.map((call, callIndex) => (
            <span
              key={`${rowIndex}-${callIndex}`}
              className={`font-mono text-sm ${
                call.denomination && isRedDenomination(call.denomination)
                  ? "text-[var(--color-danger)]"
                  : "text-[var(--color-text)]"
              }`}
            >
              {callLabel(call)}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
