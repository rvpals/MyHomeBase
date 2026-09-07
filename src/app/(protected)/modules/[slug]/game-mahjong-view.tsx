"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/button";
import { MahjongWall } from "@/components/mahjong-wall";
import { MahjongTile } from "@/components/mahjong-tile";
import { useGameSounds } from "@/components/use-game-sounds";
import {
  HUMAN_SEAT,
  SEATS,
  applyCall,
  concealedKongOptions,
  declareConcealedKong,
  declareSelfWin,
  discardTile,
  handOf,
  isHandOver,
  isWaitingForHuman,
  isWinningHand,
  mahjongTilesLeft,
  resolveCalls,
  scoreMahjong,
  scoreMahjongHand,
  sortTiles,
  startMahjong,
  stepBots,
  windOf,
  type MahjongCall,
  type MahjongState,
  type Meld,
  type Seat,
  type Tile,
} from "@/lib/games";
import { saveScoreAction } from "./games-actions";

// The Mahjong table. A client component that owns only presentation state — which tile
// is selected, whether the bot timer is running, and the sound toggle. Every rule comes
// from @/lib/games (src/lib/games/game-mahjong.ts), so nothing here decides what may be
// claimed, who wins, or what a hand scores.
//
// The bot turns run on a `setTimeout` rather than a loop, for the reason the clock runs
// in Sudoku: pacing is a browser concern, but *what* a bot does is not. `stepBots`
// advances the game by exactly one action and no-ops when the human is to act, so this
// file never works out whose turn it is.

const GAME_KEY = "mahjong";

/**
 * How long the table pauses between bot actions.
 *
 * Slow enough to read what happened — which tile was thrown, who claimed it — and fast
 * enough that three bot turns between yours do not feel like a loading screen. A real
 * table is quicker than this, but a real table also lets you watch hands move.
 */
const BOT_TURN_MS = 700;

/**
 * How long the human has to answer a call before it lapses.
 *
 * Your spec's six-second window. Enforced here rather than on a server because there is
 * no server — but it is still the *game* that decides what a lapse means, so the timer
 * only fires `passCalls` and never invents a resolution of its own.
 */
const CALL_WINDOW_MS = 6000;

/** Where each seat sits on screen. The human is always at the bottom. */
const SEAT_POSITION: Record<Seat, "bottom" | "left" | "top" | "right"> = {
  0: "right",
  1: "bottom",
  2: "left",
  3: "top",
};

/** A seat's wind, capitalised for a badge. */
function windLabel(seat: Seat): string {
  const wind = windOf(seat);
  return wind.charAt(0).toUpperCase() + wind.slice(1);
}

/** What the action bar calls each claim. The names a player at a table would use. */
const CALL_LABEL: Record<MahjongCall["action"], string> = {
  chow: "Chow",
  pung: "Pung",
  kong: "Kong",
  win: "Win",
};

export function GameMahjongView({ bestScore }: { bestScore: number }) {
  // `undefined` until the first client render, so the server and client agree on the
  // markup — the same guard the other games use for an RNG-seeded board.
  const [state, setState] = useState<MahjongState | undefined>(undefined);
  const [selected, setSelected] = useState<number | undefined>(undefined);
  const [soundOn, setSoundOn] = useState(true);
  const [saved, setSaved] = useState<{ best: boolean } | undefined>(undefined);
  const sounds = useGameSounds(soundOn);

  const deal = useCallback(() => {
    setState(startMahjong(Math.random));
    setSelected(undefined);
    setSaved(undefined);
  }, []);

  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect --
       Seeding client-only random state on mount, exactly as `game-sudoku-view.tsx`
       does: a lazy initialiser would shuffle during SSR and render different markup on
       the server than on the client. */
    deal();
  }, [deal]);

  /* --- The bot timer. Runs whenever the table is not waiting on the human. --- */
  useEffect(() => {
    if (!state || isHandOver(state) || isWaitingForHuman(state)) return;
    const timer = window.setTimeout(() => {
      setState((current) => (current ? stepBots(current, Math.random) : current));
    }, BOT_TURN_MS);
    return () => window.clearTimeout(timer);
  }, [state]);

  /* --- The call window. Lapses to a pass if the human does not answer. --- */
  const myCalls = useMemo(
    () => (state ? state.openCalls.filter((call) => call.seat === HUMAN_SEAT) : []),
    [state],
  );

  useEffect(() => {
    if (!state || myCalls.length === 0) return;
    const timer = window.setTimeout(() => {
      setState((current) => (current ? resolveCalls(current, [HUMAN_SEAT]) : current));
    }, CALL_WINDOW_MS);
    return () => window.clearTimeout(timer);
  }, [state, myCalls]);

  /* --- Sound cues, driven off what changed rather than off each handler. --- */
  const lastPhase = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!state) return;
    const phase = `${state.phase}:${state.turn}:${state.outcome}`;
    if (lastPhase.current === phase) return;
    lastPhase.current = phase;

    if (state.outcome === "won") {
      // A once-per-game fanfare, so it may sit at the top of the documented peak range.
      sounds.playSequence([
        { startHz: 523, endHz: 523, durationMs: 120, type: "sine", peak: 0.07 },
        { startHz: 659, endHz: 659, durationMs: 120, type: "sine", peak: 0.07, afterMs: 120 },
        { startHz: 784, endHz: 880, durationMs: 240, type: "sine", peak: 0.09, afterMs: 240 },
      ]);
    } else if (state.outcome === "lost" || state.outcome === "draw") {
      sounds.play({ startHz: 220, endHz: 170, durationMs: 300, type: "sawtooth", peak: 0.04 });
    } else if (state.liveDiscard) {
      // Fires on every discard, so it stays quiet — the per-keypress budget.
      sounds.play({ startHz: 330, endHz: 300, durationMs: 55, type: "square", peak: 0.03 });
    }
  }, [state, sounds]);

  /* --- Saving the score, once, when a hand the human won ends. --- */
  const savedRef = useRef(false);
  useEffect(() => {
    if (!state || !isHandOver(state) || savedRef.current) return;
    savedRef.current = true;
    const points = scoreMahjong(state);
    if (points <= 0) return;
    void saveScoreAction(GAME_KEY, points, handOf(state, HUMAN_SEAT).discards.length).then(
      (result) => {
        if (result.ok) setSaved({ best: result.best });
      },
    );
  }, [state]);

  const restart = useCallback(() => {
    savedRef.current = false;
    deal();
  }, [deal]);

  if (!state) {
    return <p className="py-12 text-center text-sm text-muted">Shuffling the wall…</p>;
  }

  const myHand = handOf(state, HUMAN_SEAT);
  const myTurn = state.phase === "awaiting-discard" && state.turn === HUMAN_SEAT;
  const kongs = myTurn ? concealedKongOptions(myHand) : [];
  const canGoOut = myTurn && isWinningHand(myHand.tiles, myHand.melds);
  const over = isHandOver(state);

  const throwTile = (tile: Tile) => {
    if (!myTurn) return;
    // Tap once to select, again to throw — a mis-tap on a phone should not cost a tile.
    if (selected !== tile.id) {
      setSelected(tile.id);
      return;
    }
    setSelected(undefined);
    sounds.play({ startHz: 440, endHz: 400, durationMs: 60, type: "square", peak: 0.03 });
    setState((current) => (current ? discardTile(current, tile) : current));
  };

  const take = (call: MahjongCall) => {
    sounds.play({ startHz: 560, endHz: 680, durationMs: 110, type: "sine", peak: 0.045 });
    setState((current) => (current ? applyCall(current, call) : current));
  };

  const decline = () => {
    setState((current) => (current ? resolveCalls(current, [HUMAN_SEAT]) : current));
  };

  return (
    <div className="flex flex-col gap-4">
      {/* The table. A three-row grid on a desktop — opponents around a centre pond —
          and a single stacked column below 1024px, where the cross does not fit. */}
      <div className="rounded-xl border border-line bg-paper-raised p-4 max-lg:p-3">
        {/* Top seat. */}
        <OpponentRack state={state} seat={seatAt("top")} />

        {/* The middle band: left seat, pond, right seat. Stacks on a phone. */}
        <div className="my-3 flex items-stretch gap-3 max-lg:my-2 max-lg:flex-col">
          <OpponentRack state={state} seat={seatAt("left")} vertical />

          <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-lg bg-paper p-3 max-lg:p-2">
            <p className="text-xs uppercase tracking-wide text-muted">
              {mahjongTilesLeft(state)} tiles in the wall
            </p>
            {state.liveDiscard ? (
              <div className="flex flex-col items-center gap-1">
                <MahjongTile tile={state.liveDiscard} size="lg" />
                <span className="text-xs text-muted">
                  thrown by {windLabel(state.turn)}
                </span>
              </div>
            ) : (
              <MahjongTile size="lg" empty />
            )}
            <TurnBanner state={state} />
          </div>

          <OpponentRack state={state} seat={seatAt("right")} vertical />
        </div>

        {/* The human's own seat. */}
        <div className="flex flex-col gap-2">
          {myHand.melds.length > 0 && <Melds melds={myHand.melds} />}
          <MahjongWall
            title="Your rack"
            count={String(myHand.tiles.length)}
            tiles={sortTiles(myHand.tiles)}
            size="md"
            layout="rack"
            active={myTurn}
            selectedIndex={
              selected === undefined
                ? undefined
                : sortTiles(myHand.tiles).findIndex((tile) => tile.id === selected)
            }
            badge={
              <span className="rounded bg-brass-soft px-1.5 py-0.5 text-[0.65rem] uppercase tracking-wide text-brass-dark">
                {windLabel(HUMAN_SEAT)}
                {myHand.flowers.length > 0 && ` · ${myHand.flowers.length} flower`}
              </span>
            }
            onTileClick={myTurn ? (tile) => throwTile(tile) : undefined}
          />
          {myTurn && (
            <p className="text-xs text-muted">
              {selected === undefined
                ? "Tap a tile to pick it, tap again to throw it."
                : "Tap the same tile again to throw it."}
            </p>
          )}
        </div>
      </div>

      {/* The action bar: only ever shown when the game is actually offering something. */}
      {myCalls.length > 0 && !over && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-brass bg-brass-soft p-3">
          <span className="text-sm font-medium text-brass-dark">
            {state.liveDiscard ? "Claim the discard?" : "Your call"}
          </span>
          {myCalls.map((call, index) => (
            <Button
              key={`${call.action}-${index}`}
              size="sm"
              onClick={() => take(call)}
              variant={call.action === "win" ? "primary" : "secondary"}
            >
              {CALL_LABEL[call.action]}
              {call.action === "chow" && myCalls.filter((c) => c.action === "chow").length > 1
                ? ` ${call.tiles.map((tile) => (tile.kind === "suited" ? tile.rank : "")).join("")}`
                : ""}
            </Button>
          ))}
          <Button size="sm" variant="secondary" onClick={decline}>
            Pass
          </Button>
        </div>
      )}

      {/* Self-drawn win and concealed kong, both only on your own turn. */}
      {(canGoOut || kongs.length > 0) && !over && (
        <div className="flex flex-wrap items-center gap-2">
          {canGoOut && (
            <Button
              size="sm"
              onClick={() => setState((current) => (current ? declareSelfWin(current) : current))}
            >
              Go out
            </Button>
          )}
          {kongs.map((tiles, index) => (
            <Button
              key={index}
              size="sm"
              variant="secondary"
              onClick={() =>
                setState((current) => (current ? declareConcealedKong(current, tiles) : current))
              }
            >
              Concealed kong
            </Button>
          ))}
        </div>
      )}

      {over && <Result state={state} saved={saved} bestScore={bestScore} />}

      <div className="flex items-center justify-between gap-2">
        <Button size="sm" variant="secondary" onClick={restart}>
          {over ? "New hand" : "Restart"}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setSoundOn((on) => !on)}
          ariaLabel={soundOn ? "Mute sound" : "Unmute sound"}
          title={soundOn ? "Mute sound" : "Unmute sound"}
        >
          {soundOn ? "🔊" : "🔇"}
        </Button>
      </div>
    </div>
  );
}

/** The seat drawn at a screen position. */
function seatAt(position: "bottom" | "left" | "top" | "right"): Seat {
  const seat = SEATS.find((candidate) => SEAT_POSITION[candidate] === position);
  // Every position is assigned in `SEAT_POSITION`, so this cannot miss.
  return seat ?? 0;
}

/**
 * One opponent's seat: their concealed count face down, their melds and flowers face up.
 *
 * `hideFrom={0}` is what keeps a bot's hand secret — the whole rack draws face down,
 * which is exactly what `MahjongWall` was built for.
 */
function OpponentRack({
  state,
  seat,
  vertical = false,
}: {
  state: MahjongState;
  seat: Seat;
  vertical?: boolean;
}) {
  const hand = handOf(state, seat);
  const active = state.phase === "awaiting-discard" && state.turn === seat;

  return (
    <div className={vertical ? "flex w-40 flex-col gap-2 max-lg:w-full" : "flex flex-col gap-2"}>
      <MahjongWall
        title={windLabel(seat)}
        count={String(hand.tiles.length)}
        countNote="tiles"
        tiles={hand.tiles}
        hideFrom={0}
        size="sm"
        layout="wall"
        active={active}
        badge={
          hand.flowers.length > 0 ? (
            <span className="text-[0.65rem] text-muted">{hand.flowers.length} flower</span>
          ) : undefined
        }
      />
      {hand.melds.length > 0 && <Melds melds={hand.melds} size="sm" />}
      {hand.discards.length > 0 && (
        <MahjongWall
          tiles={hand.discards.slice(-8)}
          size="sm"
          layout="pool"
          count={String(hand.discards.length)}
          countNote="thrown"
          dimmed
        />
      )}
    </div>
  );
}

/** A seat's declared melds, face up. */
function Melds({ melds, size = "sm" }: { melds: readonly Meld[]; size?: "sm" | "md" }) {
  return (
    <div className="flex flex-wrap gap-2">
      {melds.map((meld, index) => (
        <div key={index} className="flex gap-0.5">
          {meld.tiles.map((tile) => (
            <MahjongTile key={tile.id} tile={tile} size={size} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Whose move it is, in words. */
function TurnBanner({ state }: { state: MahjongState }) {
  if (isHandOver(state)) return null;
  if (state.phase === "awaiting-calls") {
    return <p className="text-xs text-muted">Waiting on calls…</p>;
  }
  return (
    <p className="text-xs text-muted">
      {state.turn === HUMAN_SEAT ? "Your turn" : `${windLabel(state.turn)} to play`}
    </p>
  );
}

/** How the hand ended, and what it scored. */
function Result({
  state,
  saved,
  bestScore,
}: {
  state: MahjongState;
  saved: { best: boolean } | undefined;
  bestScore: number;
}) {
  const points = scoreMahjong(state);
  const won = state.outcome === "won";
  const score =
    state.winner !== undefined
      ? scoreMahjongHand(handOf(state, state.winner), {
          selfDrawn: state.selfDrawn,
          seatWind: windOf(state.winner),
        })
      : undefined;

  return (
    <div className="rounded-xl border border-line bg-paper-raised p-4">
      <h3 className="font-display text-base text-ink">
        {state.outcome === "draw"
          ? "A washout — the wall ran out."
          : won
            ? "You went out!"
            : `${windLabel(state.winner ?? 0)} went out.`}
      </h3>

      {score && score.fans.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {score.fans.map((fan) => (
            <li
              key={fan.id}
              className="rounded bg-brass-soft px-1.5 py-0.5 text-xs text-brass-dark"
            >
              {fan.label} +{fan.fan}
            </li>
          ))}
        </ul>
      )}

      {score && (
        <p className="mt-2 text-sm text-muted">
          {score.fan} fan{state.selfDrawn ? ", self drawn" : ""}
          {won && ` — ${points.toLocaleString()} points`}
        </p>
      )}

      {won && saved && (
        <p className="mt-1 text-sm text-brass-dark">
          {saved.best ? "A new record!" : `Saved. The record is ${bestScore.toLocaleString()}.`}
        </p>
      )}
      {!won && (
        <p className="mt-1 text-xs text-muted">
          Only a hand you win scores. The record is {bestScore.toLocaleString()}.
        </p>
      )}
    </div>
  );
}
