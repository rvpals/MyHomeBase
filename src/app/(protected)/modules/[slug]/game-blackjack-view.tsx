"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/button";
import { CardHand } from "@/components/card-hand";
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

/** How each settled result reads to the player. */
const RESULT_LABELS: Record<HandResult, string> = {
  blackjack: "Blackjack!",
  win: "Win",
  push: "Push",
  lose: "Lose",
  bust: "Bust",
};

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
        </div>
      </div>

      {/*
        The table. A fixed max width rather than a viewport-scaled board: unlike the
        Tetris well and the Sudoku grid, this layout is rows of cards that reflow, so
        it needs no aspect ratio to preserve. `max-lg:` handles the phone.
      */}
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4 rounded-xl border border-line bg-paper-raised p-4 max-lg:p-3">
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
function PlayerHand({ hand, active }: { hand: Hand; active: boolean }) {
  const { total, soft } = handValue(hand.cards);

  return (
    <CardHand
      title="You"
      total={formatTotal(total, soft)}
      cards={hand.cards}
      size="lg"
      active={active}
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
