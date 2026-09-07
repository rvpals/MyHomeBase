"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/button";
import { useGameSounds } from "@/components/use-game-sounds";
import { CardHand } from "@/components/card-hand";
import { DEAL_MS, PlayingCard, type CardDeal } from "@/components/playing-card";
import {
  BLACKJACK_BET_STEP,
  BLACKJACK_MAX_BET,
  BLACKJACK_MIN_BET,
  BLACKJACK_STARTING_CHIPS,
  canDouble,
  canSplit,
  cashOut,
  dealBlackjack,
  doubleDown,
  handValue,
  hit,
  nextRound,
  scoreBlackjack,
  setBet,
  split,
  stand,
  startBlackjack,
  type BlackjackState,
  type Card,
  type Hand,
  type HandResult,
} from "@/lib/games";
import { saveScoreAction } from "./games-actions";

// The Blackjack table. A client component that owns only presentation state — nothing
// here decides what a hand is worth or what a bet pays. Every rule comes from
// @/lib/games (src/lib/games/game-blackjack.ts), which is also why there is no
// "should the dealer hit" branch anywhere in this file.
//
// Unlike Tetris and Sudoku there is no clock, so no interval: a hand advances only
// when the player presses something.

const GAME_KEY = "blackjack";

/**
 * How far apart the cards of one deal land.
 *
 * A real deal goes round the table a card at a time, and that rhythm is most of what
 * makes it read as dealing rather than as a hand appearing. Four cards at this spacing
 * put the opening deal at roughly 270ms of stagger plus the flight — brisk enough that
 * nobody waits on it, and the controls stay live the whole time regardless.
 */
const DEAL_STAGGER_MS = 90;

/**
 * Where the shoe sits relative to each row, as the card's starting offset.
 *
 * Two sets rather than one because the shoe is at the table's top-right: the dealer's
 * row is level with it and just to its left, where the player's rows are well below it.
 * A single shared offset would have one of the two flying out of the table instead of
 * in from the shoe.
 *
 * Fixed lengths, not viewport units — a phone gets the same short legible flight rather
 * than a card crossing the whole screen.
 */
const DEAL_FROM = {
  dealer: { fromX: "9rem", fromY: "-2.5rem", spinDeg: 10 },
  player: { fromX: "9rem", fromY: "-9rem", spinDeg: 14 },
} as const;

/** How each settled result reads to the player. */
const RESULT_LABELS: Record<HandResult, string> = {
  blackjack: "Blackjack!",
  win: "Win",
  push: "Push",
  lose: "Lose",
  bust: "Bust",
};

/* ---------------------------------------------------------------------------------
   Sound. Synthesized rather than loaded, so the game ships no audio files.
--------------------------------------------------------------------------------- */

/**
 * Blackjack's cue vocabulary, over the arcade's shared beeper.
 *
 * `useGameSounds` owns the audio context and the envelope; what lives here is only
 * *what a Blackjack event sounds like*.
 */
function useSounds(enabled: boolean) {
  const sounds = useGameSounds(enabled);

  return useMemo(
    () => ({
      /**
       * One card landing.
       *
       * Short and papery — a whole opening deal is four of these in 270ms, and anything
       * with a tail would run them together into a buzz.
       */
      card: (afterMs = 0) =>
        sounds.playSequence([
          { startHz: 900, endHz: 380, durationMs: 55, type: "triangle", peak: 0.04, afterMs },
        ]),
      /** Moving the stake up or down. */
      chip: () =>
        sounds.play({ startHz: 640, endHz: 820, durationMs: 45, type: "sine", peak: 0.035 }),
      /** A fresh shoe. Longer and grainier — six decks going back in the box. */
      shuffle: () =>
        sounds.playSequence([
          { startHz: 180, endHz: 320, durationMs: 260, type: "sawtooth", peak: 0.035 },
          { startHz: 220, endHz: 140, durationMs: 240, type: "sawtooth", peak: 0.03, afterMs: 130 },
        ]),
      /** A hand over 21. */
      bust: (afterMs = 0) =>
        sounds.playSequence([
          { startHz: 260, endHz: 70, durationMs: 420, type: "sawtooth", peak: 0.075, afterMs },
        ]),
      /** A hand taken. */
      win: (afterMs = 0) =>
        sounds.playSequence([
          { startHz: 587, endHz: 587, durationMs: 110, type: "triangle", peak: 0.06, afterMs },
          {
            startHz: 880,
            endHz: 880,
            durationMs: 200,
            type: "triangle",
            peak: 0.06,
            afterMs: afterMs + 100,
          },
        ]),
      /** A hand lost to the dealer. Softer than a bust — this one was not your doing. */
      lose: (afterMs = 0) =>
        sounds.playSequence([
          { startHz: 330, endHz: 200, durationMs: 300, type: "sine", peak: 0.05, afterMs },
        ]),
      /** A stand-off. Deliberately flat: nothing happened. */
      push: (afterMs = 0) =>
        sounds.playSequence([
          { startHz: 420, endHz: 420, durationMs: 180, type: "sine", peak: 0.04, afterMs },
        ]),
      /** A natural. The best two cards in the game deserve the best sound in it. */
      blackjack: (afterMs = 0) =>
        sounds.playSequence(
          [659, 784, 988, 1319].map((hz, index) => ({
            startHz: hz,
            endHz: hz,
            durationMs: index === 3 ? 320 : 110,
            type: "triangle" as OscillatorType,
            peak: 0.08,
            afterMs: afterMs + index * 90,
          })),
        ),
      /** Walking away with the chips. */
      cashOut: () =>
        sounds.playSequence(
          [523, 659, 784, 1047].map((hz, index) => ({
            startHz: hz,
            endHz: hz,
            durationMs: index === 3 ? 340 : 120,
            type: "sine" as OscillatorType,
            peak: 0.075,
            afterMs: index * 100,
          })),
        ),
      /** Out of chips. */
      broke: (afterMs = 0) =>
        sounds.playSequence([
          { startHz: 300, endHz: 50, durationMs: 700, type: "sawtooth", peak: 0.085, afterMs },
        ]),
    }),
    [sounds],
  );
}

/** Every card id on the table, player seats and dealer alike. */
function cardIdsOf(state: BlackjackState): number[] {
  const ids: number[] = [];
  for (const hand of state.hands) for (const card of hand.cards) ids.push(card.id);
  for (const card of state.dealer) ids.push(card.id);
  return ids;
}

export function GameBlackjackView({ bestScore }: { bestScore: number }) {
  // Lazily initialised, and only ever on the client — the shoe is shuffled, so
  // building it during SSR would render different markup on the server than the client
  // and trip a hydration mismatch. Starts `undefined` (an empty table, identical on
  // both sides) and is seeded by the mount effect, the same trade as `GameSudokuView`.
  const [state, setState] = useState<BlackjackState | undefined>(undefined);
  const [saveNote, setSaveNote] = useState<string | undefined>(undefined);

  // Guards the one-shot save: `outcome` alone would re-fire on every re-render after
  // the run ended, posting the same score repeatedly.
  const savedRef = useRef(false);

  const [soundOn, setSoundOn] = useState(true);

  const sounds = useSounds(soundOn);

  /**
   * The cues, read off the change in state.
   *
   * The library resolves a whole round in **one** state update — a natural settles
   * inside `deal`, and `stand` can draw the dealer out, settle every hand and end the
   * run without any intermediate state reaching React. So there is nothing to hook per
   * step; everything about a round has to be recovered by diffing one transition.
   *
   * The cues are then spread back out over time to match the deal animation, which the
   * view *does* stage: `afterMs` on each one lines it up with the cards it is about.
   * Firing them all at the transition would land the whole round's audio while the
   * first card was still in the air.
   */
  const previousRef = useRef<BlackjackState | undefined>(undefined);
  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = state;
    if (!state || !previous) return;

    // A new run replaces the table wholesale; a fresh shoe is not a reshuffle cue.
    if (state.handsPlayed < previous.handsPlayed) return;

    // A shuffle is the only way the shoe grows — every other path draws from it.
    if (state.shoe.length > previous.shoe.length) sounds.shuffle();

    // Cards arriving anywhere on the table, in the order they would really be dealt.
    // Same slot maths as `useDealtCards`, which paces the animation: player seats on
    // even slots, dealer on odd, rebased so the batch starts immediately.
    const before = new Set(cardIdsOf(previous));
    const arriving: number[] = [];
    state.hands.forEach((hand) => {
      hand.cards.forEach((card, index) => {
        if (!before.has(card.id)) arriving.push(index * 2);
      });
    });
    state.dealer.forEach((card, index) => {
      if (!before.has(card.id)) arriving.push(index * 2 + 1);
    });

    let settleAt = 0;
    if (arriving.length > 0) {
      const earliest = Math.min(...arriving);
      const delays = arriving.map((slot) => (slot - earliest) * DEAL_STAGGER_MS);
      for (const delay of delays) sounds.card(delay);
      // Hold the round's verdict until the last card has landed, not merely left the
      // shoe: a "you win" over a card still in flight reads as a bug.
      settleAt = Math.max(...delays) + DEAL_MS;
    }

    // The bet moved. Guarded on the value, not on identity — `setBet` returns a new
    // object even when the clamp leaves the stake where it was.
    if (state.bet !== previous.bet && state.phase === "betting") sounds.chip();

    // Results land all at once at settle, so they are read wholesale rather than
    // diffed per hand — a split changes `hands.length` and index-matching would be
    // wrong across it.
    const settled = previous.phase !== "settled" && state.phase === "settled";
    if (settled) {
      // A split can win one seat and bust the other; both deserve their cue, spaced so
      // the pair is legible rather than played as a chord.
      state.hands.forEach((hand, index) => {
        const at = settleAt + index * 260;
        if (hand.result === "blackjack") sounds.blackjack(at);
        else if (hand.result === "win") sounds.win(at);
        else if (hand.result === "bust") sounds.bust(at);
        else if (hand.result === "lose") sounds.lose(at);
        else if (hand.result === "push") sounds.push(at);
      });
    }

    if (!previous.outcome && state.outcome === "cashed-out") sounds.cashOut();
    // Going broke arrives bundled with the losing hand that caused it, so it queues
    // behind that hand's cue rather than playing over it.
    if (!previous.outcome && state.outcome === "broke") {
      sounds.broke(settleAt + state.hands.length * 260 + 220);
    }
  }, [state, sounds]);

  const newRun = useCallback(() => {
    setState(startBlackjack(Math.random));
    setSaveNote(undefined);
    savedRef.current = false;
  }, []);

  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect --
       Seeding client-only random state on mount; a lazy initialiser would run during
       SSR and render different markup on the server than the client. */
    newRun();
  }, [newRun]);

  const finished = state?.outcome !== undefined;

  // Save once, when the run ends — on a cash-out or on going broke. A broke run scores
  // 0 and is still posted: it is a finished game, and the scoreboard's `played` count
  // should reflect that somebody sat down. `moves` carries hands played.
  useEffect(() => {
    if (!state || !finished || savedRef.current) return;
    savedRef.current = true;

    void saveScoreAction(GAME_KEY, scoreBlackjack(state), state.handsPlayed).then((result) => {
      if (!result.ok) {
        setSaveNote(result.error);
        return;
      }
      setSaveNote(result.best ? "New record — saved to the board." : "Score saved.");
    });
  }, [finished, state]);

  /** Applies one pure rule to the run. Every control goes through here. */
  const apply = useCallback((rule: (current: BlackjackState) => BlackjackState) => {
    setState((current) => (current ? rule(current) : current));
  }, []);

  const onDeal = useCallback(() => {
    // `nextRound` clears a settled table first; on a fresh one it is a no-op, so both
    // the first deal and every later one are the same press.
    apply((current) => dealBlackjack(nextRound(current), Math.random));
  }, [apply]);

  const adjustBet = useCallback(
    (delta: number) => apply((current) => setBet(current, current.bet + delta)),
    [apply],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!state || state.outcome) return;

      const playing = state.phase === "playing";
      // Lower-cased so a shifted H is still Hit; the arrows and Enter are unaffected.
      const handled: Record<string, () => void> = {
        // H, S and D only while a hand is live; Enter deals, which is the only press
        // that makes sense at a settled or empty table. A key that does not apply to
        // the current phase is left out of the map entirely, so the browser keeps it
        // rather than having it swallowed by a handler that does nothing.
        ...(playing
          ? {
              h: () => apply(hit),
              s: () => apply(stand),
              d: () => apply(doubleDown),
            }
          : {
              Enter: onDeal,
              ArrowUp: () => adjustBet(BLACKJACK_BET_STEP),
              ArrowDown: () => adjustBet(-BLACKJACK_BET_STEP),
            }),
      };

      const action = handled[event.key.length === 1 ? event.key.toLowerCase() : event.key];
      if (!action) return;
      event.preventDefault();
      action();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [adjustBet, apply, onDeal, state]);

  // Which cards are mid-flight this render. Must sit above the early derivations so it
  // sees every state change, including the one that ends a round.
  const delayOf = useDealtCards(state);

  // One per seat, because the flight offsets differ — see DEAL_FROM.
  const dealDealer = useMemo(() => dealFor(delayOf, "dealer"), [delayOf]);
  const dealPlayer = useMemo(() => dealFor(delayOf, "player"), [delayOf]);

  const betting = !state || state.phase === "betting";
  const playing = state?.phase === "playing";
  const settled = state?.phase === "settled";

  // The dealer's hole card stays hidden while the player is still acting. A view
  // concern only — the state holds the real card either way.
  const holeHidden = playing;
  const dealerCards = state?.dealer ?? [];
  // Valued on only the face-up cards while the hole card is down, so the shown total
  // is exactly what the player is entitled to work with.
  const dealerShown = holeHidden ? dealerCards.slice(0, 1) : dealerCards;
  const { total: dealerTotal, soft: dealerSoft } = handValue(dealerShown);

  return (
    <div className="flex flex-col gap-4">
      {/* The stat strip, matching Tetris and Sudoku so the arcade reads as one app. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Stat label="Chips" value={(state?.chips ?? BLACKJACK_STARTING_CHIPS).toLocaleString()} />
          <Stat label="Bet" value={(state?.bet ?? BLACKJACK_MIN_BET).toLocaleString()} />
          <Stat label="Hands" value={String(state?.handsPlayed ?? 0)} />
          <Stat label="Best" value={bestScore.toLocaleString()} />
        </div>
        <div className="flex flex-wrap gap-2">
          {/*
            Cash out is the scoring move, so it is the prominent one — a run that is
            never cashed out scores nothing. Only offered between hands, because
            walking away mid-hand would mean abandoning a stake.
          */}
          <Button
            onClick={() => apply(cashOut)}
            variant="primary"
            size="sm"
            disabled={finished || playing}
          >
            Cash out
          </Button>
          <Button onClick={newRun} variant="secondary" size="sm">
            New run
          </Button>
          <Button
            onClick={() => setSoundOn((value) => !value)}
            variant="secondary"
            size="sm"
            aria-pressed={soundOn}
            title={soundOn ? "Mute sound effects" : "Unmute sound effects"}
          >
            {soundOn ? "Sound on" : "Sound off"}
          </Button>
        </div>
      </div>

      {/*
        The table. A fixed max width rather than a viewport-scaled board: unlike the
        Tetris well and the Sudoku grid, this layout is rows of cards that reflow, so
        it needs no aspect ratio to preserve. `max-lg:` handles the phone.
      */}
      <div className="relative mx-auto flex w-full max-w-xl flex-col gap-4 rounded-xl border border-line bg-paper-raised p-4 max-lg:p-3">
        {/*
          The shoe. Absolutely positioned so it is a landmark on the table rather than a
          member of the card rows — it must not take part in the flex layout, or the
          dealer's hand would shift sideways to make room for it.

          Its job is to give the flight somewhere to come *from*: a card sliding in from
          empty space reads as a UI transition, where a card leaving a visible deck reads
          as being dealt. Hidden once the run is over, since there is nothing left to deal.
        */}
        {!finished && (
          <div aria-hidden className="absolute right-4 top-4 max-lg:right-3 max-lg:top-3">
            {/* Two stacked backs, the lower one offset, so the shoe has depth and is
                obviously a pile rather than a single face-down card. */}
            <PlayingCard size="sm" className="absolute left-0.5 top-0.5 opacity-60" />
            <PlayingCard size="sm" className="relative" />
          </div>
        )}

        <CardHand
          title="Dealer"
          // Only the face-up card counts towards the shown total while the hole card
          // is down — `holeHidden` already trimmed `dealerCards` for the calculation.
          total={dealerCards.length > 0 ? formatTotal(dealerTotal, dealerSoft) : undefined}
          // A hidden hole card means the shown total is only what is face up, so the
          // label says so rather than quietly under-reporting the dealer's hand.
          totalNote={holeHidden && dealerCards.length > 1 ? "showing" : undefined}
          cards={dealerCards}
          hideFrom={holeHidden ? 1 : undefined}
          size="lg"
          dealing={dealDealer}
          // Keeps the dealer's row clear of the shoe above it. A dealer drawing to a
          // soft 17 can reach five or six cards, and without this the last of them
          // would slide under the deck.
          className="pr-16 max-lg:pr-14"
        />

        <div className="h-px bg-line" />

        {state && state.hands.length > 0 ? (
          <div className="flex flex-col gap-3">
            {state.hands.map((hand, index) => (
              <PlayerHand
                // Index as key is correct here: a hand is a fixed seat at the table for
                // the length of a round, not a value that travels between positions.
                key={index}
                hand={hand}
                dealing={dealPlayer}
                // The active marker is only meaningful with two hands in play; with one
                // there is nothing to distinguish it from.
                active={playing && state.hands.length > 1 && state.activeHand === index}
              />
            ))}
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-muted">
            {finished ? "The run is over." : "Place your bet and deal."}
          </p>
        )}
      </div>

      {/* The controls, one row per phase — the phases are mutually exclusive, so
          exactly one of these is ever on screen. */}
      <div className="mx-auto flex w-full max-w-xl flex-col gap-2">
        {!finished && betting && state && (
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button
              onClick={() => adjustBet(-BLACKJACK_BET_STEP)}
              variant="secondary"
              size="sm"
              ariaLabel="Lower the bet"
              disabled={state.bet <= BLACKJACK_MIN_BET}
            >
              −{BLACKJACK_BET_STEP}
            </Button>
            <span className="min-w-24 text-center font-display text-lg tabular-nums text-ink">
              {state.bet.toLocaleString()}
            </span>
            <Button
              onClick={() => adjustBet(BLACKJACK_BET_STEP)}
              variant="secondary"
              size="sm"
              ariaLabel="Raise the bet"
              disabled={state.bet >= Math.min(BLACKJACK_MAX_BET, state.chips)}
            >
              +{BLACKJACK_BET_STEP}
            </Button>
            <Button onClick={onDeal} size="sm">
              Deal
            </Button>
          </div>
        )}

        {playing && state && (
          <div className="grid grid-cols-4 gap-2 max-lg:grid-cols-2">
            <Button onClick={() => apply(hit)} size="sm">
              Hit
            </Button>
            <Button onClick={() => apply(stand)} variant="secondary" size="sm">
              Stand
            </Button>
            <Button
              onClick={() => apply(doubleDown)}
              variant="secondary"
              size="sm"
              disabled={!canDouble(state)}
            >
              Double
            </Button>
            <Button
              onClick={() => apply(split)}
              variant="secondary"
              size="sm"
              disabled={!canSplit(state)}
            >
              Split
            </Button>
          </div>
        )}

        {!finished && settled && (
          <div className="flex justify-center">
            <Button onClick={onDeal} size="sm">
              Deal again
            </Button>
          </div>
        )}
      </div>

      <div aria-live="polite" className="min-h-6 text-center text-sm">
        {settled && !finished && <span className="text-ink">{roundSummary(state)}</span>}
        {saveNote && <span className="ml-2 text-muted">{saveNote}</span>}
      </div>

      {/*
        A plain bordered div, NOT a Modal. Two nested Modals both register their Escape
        handler on `document` in the capture phase, so the outer one would win and
        Escape would close the whole game instead of this panel. modules.md records this.
      */}
      {finished && state && (
        <div className="mx-auto max-w-sm rounded-xl border border-line bg-paper-raised p-4 text-center">
          <h3 className="font-display text-base text-ink">
            {state.outcome === "cashed-out" ? "Cashed out" : "Out of chips"}
          </h3>
          <p className="mt-1 text-sm text-muted">
            {state.outcome === "cashed-out" ? (
              <>
                Banked {state.chips.toLocaleString()} chips over{" "}
                {state.handsPlayed.toLocaleString()}{" "}
                {state.handsPlayed === 1 ? "hand" : "hands"} — {scoreBlackjack(state).toLocaleString()}{" "}
                pts.
              </>
            ) : (
              <>
                Broke after {state.handsPlayed.toLocaleString()}{" "}
                {state.handsPlayed === 1 ? "hand" : "hands"}, having peaked at{" "}
                {state.peakChips.toLocaleString()}. A run that goes broke scores nothing.
              </>
            )}
          </p>
          <Button onClick={newRun} size="sm" className="mt-3">
            Play again
          </Button>
        </div>
      )}

      <p className="text-center text-xs text-muted max-lg:hidden">
        H to hit, S to stand, D to double, Enter to deal, arrows to change the bet.
      </p>
    </div>
  );
}

/**
 * Which cards arrived since the last render, and when each should start its flight.
 *
 * The whole animation rests on `Card.id` being unique across a shoe: a card that was on
 * the table last render is not arriving now, whatever index it has moved to. So this
 * keeps the ids it has already seen and returns delays only for the ones it has not.
 *
 * A ref rather than state, and written during the render that reports the arrivals: the
 * flight is started by the same commit that adds the card to the DOM, so there is no
 * frame where a new card is drawn in place and then jumps back to the shoe. Nothing
 * re-renders as a result — the map is read once per arrival and the entry then never
 * matters again, which is also why there is no timer here clearing anything.
 *
 * The delay comes from the real dealing order, not from array position: a deal goes
 * player, dealer, player, dealer — which is the order `deal` in game-blackjack.ts draws
 * them in — and the state stores those two rows separately. A card at index `n` of a row
 * therefore lands in slot `n * 2`, +1 for the dealer. A lone hit is the only card
 * arriving, so it is rebased to slot 0 and gets no stagger.
 */
// `react-hooks/refs` flags every `arrivals.current` / `seen.current` touch
// below as "Cannot access refs during render", and here that is the point rather than
// a mistake — see the doc comment above. The flight has to start in the same commit
// that mounts the card, so the arrival map must be computed during the render that
// reports it; moving this into an effect reintroduces exactly the one-frame "card
// drawn in place, then jumps back to the shoe" glitch it was written to avoid, and
// state would re-render for a value that is read once and never matters again.
// Scoped to this hook, not the file.
/* eslint-disable react-hooks/refs */
function useDealtCards(state: BlackjackState | undefined): (card: Card) => number | undefined {
  const seen = useRef<Set<number>>(new Set());
  const arrivals = useRef<Map<number, number>>(new Map());

  // An empty table resets the seen set, and it has to: `buildShoe` numbers its cards
  // 0..311 deterministically, so a card id is unique only *within* a shoe. A reshuffle
  // (`deal` builds a new shoe when the old one runs low) reissues every one of those
  // ids, and a `seen` set that outlived it would draw the reissued cards in place.
  //
  // `nextRound` empties both rows before every deal, so this fires between rounds as
  // well — which is free, since a round's cards are all in `seen` by the time it ends,
  // and it means a new run and a mid-run reshuffle need no separate handling.
  const tableIsEmpty = state !== undefined && state.hands.length === 0 && state.dealer.length === 0;

  if (tableIsEmpty && seen.current.size > 0) {
    seen.current = new Set();
    arrivals.current = new Map();
  }

  if (state) {
    const next = new Map<number, number>();

    // Player rows first, then the dealer, so a card's slot matches the order it would
    // really be dealt in. Every hand at index `n` shares slot `n * 2` — a split deals
    // to both seats at once, and staggering them against each other would suggest an
    // order the game does not have.
    for (const hand of state.hands) {
      hand.cards.forEach((card, index) => {
        if (!seen.current.has(card.id)) next.set(card.id, index * 2);
      });
    }

    state.dealer.forEach((card, index) => {
      if (!seen.current.has(card.id)) next.set(card.id, index * 2 + 1);
    });

    if (next.size > 0) {
      // Rebased so the earliest arrival in *this* batch always starts immediately. The
      // dealer drawing its third card after the player stood would otherwise sit idle
      // for 5 slots' worth of delay before moving, because its slot is absolute.
      const earliest = Math.min(...next.values());
      arrivals.current = new Map(
        Array.from(next, ([id, slot]) => [id, (slot - earliest) * DEAL_STAGGER_MS]),
      );

      for (const id of next.keys()) seen.current.add(id);
    } else if (arrivals.current.size > 0) {
      // Nothing new: a re-render from a bet change or a save note. Clearing here is what
      // stops the last batch re-flying when the component redraws for another reason.
      arrivals.current = new Map();
    }
  }

  return useCallback((card: Card) => arrivals.current.get(card.id), []);
}
/* eslint-enable react-hooks/refs */

/** Builds the `dealing` callback for one row, or `undefined` when nothing is arriving there. */
function dealFor(
  delayOf: (card: Card) => number | undefined,
  seat: keyof typeof DEAL_FROM,
): (card: Card) => CardDeal | undefined {
  return (card) => {
    const delayMs = delayOf(card);
    return delayMs === undefined ? undefined : { ...DEAL_FROM[seat], delayMs };
  };
}

/** One line of the round's outcome, for the live region under the table. */
function roundSummary(state: BlackjackState | undefined): string {
  if (!state || state.hands.length === 0) return "";
  return state.hands
    .map((hand) => (hand.result ? RESULT_LABELS[hand.result] : ""))
    .filter(Boolean)
    .join(" · ");
}

/**
 * A hand's total as the player reads it.
 *
 * A soft hand shows both readings — soft 17 is A+6, which plays very differently from
 * a hard 17, and the player should not have to spot the ace themselves. `CardHand`
 * takes a formatted string precisely so this rule can live here, with the game that
 * has the opinion, rather than in the shared component.
 */
function formatTotal(total: number, soft: boolean): string {
  return soft && total > 11 ? `${total - 10}/${total}` : String(total);
}

/** The player's hand: the cards, its stake, and its result once settled. */
function PlayerHand({
  hand,
  active,
  dealing,
}: {
  hand: Hand;
  active: boolean;
  dealing: (card: Card) => CardDeal | undefined;
}) {
  const { total, soft } = handValue(hand.cards);

  return (
    <CardHand
      title="You"
      total={formatTotal(total, soft)}
      cards={hand.cards}
      size="lg"
      active={active}
      dealing={dealing}
      // A settled losing hand is dimmed, so a split round reads at a glance: the hand
      // that won stays bright next to the one that did not.
      dimmed={hand.result === "bust" || hand.result === "lose"}
      badge={
        <span className="flex items-center gap-2 text-xs text-muted">
          <span className="tabular-nums">{hand.bet.toLocaleString()} chips</span>
          {hand.doubled && <span className="text-brass-dark">Doubled</span>}
          {hand.result && (
            <span
              className={
                hand.result === "bust" || hand.result === "lose"
                  ? // The theme has no error token — one accent family only. The
                    // arcade already marks a losing move with this literal in
                    // `game-arrows-view.tsx` and `game-sudoku-view.tsx`.
                    "text-red-400"
                  : hand.result === "push"
                    ? "text-muted"
                    : "text-brass-dark"
              }
            >
              {RESULT_LABELS[hand.result]}
            </span>
          )}
        </span>
      }
    />
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-paper-raised px-3 py-1.5 text-center">
      <div className="text-[0.65rem] uppercase tracking-wide text-muted">{label}</div>
      <div className="font-display text-lg tabular-nums text-ink">{value}</div>
    </div>
  );
}
