"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/button";
import { useGameSounds } from "@/components/use-game-sounds";
import {
  BATTLESHIP_DIFFICULTIES,
  BATTLESHIP_FLEET,
  BATTLESHIP_ROW_LABELS,
  BATTLESHIP_SETUP,
  BATTLESHIP_SHIP_KINDS,
  BATTLESHIP_SIZE,
  battleshipCoordLabel,
  battleshipPlayerView,
  battleshipShipAt,
  battleshipShipCells,
  canPlaceBattleship,
  clearBattleshipFleet,
  fireBattleship,
  placeBattleship,
  randomizeBattleshipFleet,
  readyBattleship,
  removeBattleship,
  revealedBattleshipFleet,
  scoreBattleship,
  startBattleship,
  takeBattleshipComputerTurn,
  validateBattleshipFleet,
  type BattleshipDifficulty,
  type BattleshipOrientation,
  type BattleshipShipKind,
  type BattleshipShot,
  type BattleshipState,
} from "@/lib/games";
import { saveScoreAction } from "./games-actions";

// Battleship against the computer. A client component that owns only presentation
// state — which ship is selected, which way it points, where the pointer is, and the
// pause before the computer fires. Every rule comes from @/lib/games
// (src/lib/games/game-battleship.ts and battleship-bot.ts): whether a ship fits, what a
// shot hit, whose turn it is, where the computer aims and what a win is worth.
//
// The boards render from `battleshipPlayerView`, which masks the computer's unhit
// ships, rather than from the state. The state itself is client-side — the agreed
// trade-off for a single-player game — so this is tidiness, not anti-cheat.
//
// Phone: the two boards stack, the radar (the one you tap) first and your own fleet
// smaller beneath it. Desktop: side by side, your fleet on the left.

const GAME_KEY = "battleship";

/** The pause before the computer fires, so its shot reads as a reply rather than a flicker. */
const COMPUTER_DELAY_MS = 650;

/*
  The board is a radar scope: a fixed dark, green-phosphor palette in every theme.

  Literal colours, on the licence design.md gives the mahjong tile — "it's an object,
  not a surface". A radar screen rendered in Daybreak's white is not a light-mode radar,
  it is a different object. Only the two boards use these; every control, stat and panel
  around them stays on theme tokens. Red for a hit is the semantic red design.md already
  keeps literal.
*/
const SCOPE = "rounded-xl border border-emerald-500/30 bg-slate-950 p-1.5 shadow-[inset_0_0_24px_rgba(16,185,129,0.12)]";
const SCOPE_LABEL = "text-[0.6rem] leading-none text-emerald-300/70 tabular-nums";
const WATER = "bg-emerald-500/[0.04] border border-emerald-500/15";

function useSounds(enabled: boolean) {
  const sounds = useGameSounds(enabled);
  return useMemo(
    () => ({
      place: () => sounds.play({ startHz: 420, endHz: 520, durationMs: 60, type: "sine", peak: 0.04 }),
      rotate: () => sounds.play({ startHz: 520, endHz: 420, durationMs: 50, type: "sine", peak: 0.03 }),
      splash: () =>
        sounds.play({ startHz: 260, endHz: 140, durationMs: 160, type: "triangle", peak: 0.04 }),
      hit: () =>
        sounds.play({ startHz: 180, endHz: 60, durationMs: 260, type: "sawtooth", peak: 0.07 }),
      sunk: () =>
        sounds.playSequence([
          { startHz: 200, endHz: 50, durationMs: 380, type: "sawtooth", peak: 0.08 },
          { startHz: 120, endHz: 40, durationMs: 500, type: "square", peak: 0.05, afterMs: 140 },
        ]),
      won: () =>
        sounds.playSequence(
          [523, 659, 784, 1047].map((hz, index) => ({
            startHz: hz,
            endHz: hz,
            durationMs: index === 3 ? 300 : 120,
            type: "triangle" as OscillatorType,
            peak: 0.08,
            afterMs: index * 95,
          })),
        ),
      lost: () =>
        sounds.playSequence(
          [392, 330, 262].map((hz, index) => ({
            startHz: hz,
            endHz: hz * 0.97,
            durationMs: 220,
            type: "triangle" as OscillatorType,
            peak: 0.06,
            afterMs: index * 200,
          })),
        ),
    }),
    [sounds],
  );
}

/** "B7 — SUNK Destroyer", in the words the spec asked for. */
function describeShot(shot: BattleshipShot): string {
  const where = battleshipCoordLabel(shot.index);
  if (shot.result === "miss") return `${where} — MISS`;
  if (shot.result === "hit") return `${where} — HIT`;
  return `${where} — SUNK ${shot.sunk ? BATTLESHIP_FLEET[shot.sunk].name : ""}`.trim();
}

export function GameBattleshipView({ bestScore }: { bestScore: number }) {
  // Deterministic on first render: nothing random happens until Randomize or Ready.
  const [state, setState] = useState<BattleshipState>(() => startBattleship("normal"));
  const [selected, setSelected] = useState<BattleshipShipKind | undefined>("carrier");
  const [orientation, setOrientation] = useState<BattleshipOrientation>("horizontal");
  const [hover, setHover] = useState<number | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [playerLine, setPlayerLine] = useState<string | undefined>(undefined);
  const [computerLine, setComputerLine] = useState<string | undefined>(undefined);
  const [saveNote, setSaveNote] = useState<string | undefined>(undefined);
  const [soundOn, setSoundOn] = useState(true);
  const savedRef = useRef(false);
  const sounds = useSounds(soundOn);

  const view = useMemo(() => battleshipPlayerView(state), [state]);
  const placedShips = state.boards.player.ships;
  const placedKinds = new Set(placedShips.map((ship) => ship.kind));
  const fleetCheck = validateBattleshipFleet(placedShips);

  const newGame = useCallback((difficulty: BattleshipDifficulty) => {
    setState(startBattleship(difficulty));
    setSelected("carrier");
    setOrientation("horizontal");
    setNotice(undefined);
    setPlayerLine(undefined);
    setComputerLine(undefined);
    setSaveNote(undefined);
    savedRef.current = false;
  }, []);

  const playShotSound = useCallback(
    (shot: BattleshipShot) => {
      if (shot.result === "miss") sounds.splash();
      else if (shot.result === "hit") sounds.hit();
      else sounds.sunk();
    },
    [sounds],
  );

  /* ---------------------------------------------------------------- placement */

  const rotate = useCallback(() => {
    setOrientation((value) => (value === "horizontal" ? "vertical" : "horizontal"));
    sounds.rotate();
  }, [sounds]);

  // R rotates, the way most placement screens do. Only while placing.
  useEffect(() => {
    if (state.phase !== "placement") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "r" && event.key !== "R") return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      rotate();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [rotate, state.phase]);

  /** The cells the selected ship would occupy with its bow at `index`, and whether that fits. */
  const preview = useMemo(() => {
    if (state.phase !== "placement" || !selected || hover === undefined) return undefined;
    const ship = {
      kind: selected,
      row: Math.floor(hover / BATTLESHIP_SIZE),
      col: hover % BATTLESHIP_SIZE,
      orientation,
    };
    // Off the board there are no cells to show, so only the hovered one goes red.
    const cells = battleshipShipCells(ship) ?? [hover];
    return { cells: new Set(cells), fits: canPlaceBattleship(placedShips, ship) };
  }, [hover, orientation, placedShips, selected, state.phase]);

  const tapOwnCell = useCallback(
    (index: number) => {
      if (state.phase !== "placement") return;
      const existing = battleshipShipAt(placedShips, index);
      // Tapping a placed ship picks it back up, keeping its heading.
      if (existing && existing.kind !== selected) {
        setState((current) => removeBattleship(current, existing.kind));
        setSelected(existing.kind);
        setOrientation(existing.orientation);
        setNotice(undefined);
        return;
      }
      if (!selected) {
        setNotice("Pick a ship to place.");
        return;
      }
      const ship = {
        kind: selected,
        row: Math.floor(index / BATTLESHIP_SIZE),
        col: index % BATTLESHIP_SIZE,
        orientation,
      };
      if (!canPlaceBattleship(placedShips, ship)) {
        setNotice(`The ${BATTLESHIP_FLEET[selected].name} doesn't fit there.`);
        return;
      }
      const next = placeBattleship(state, ship);
      setState(next);
      setNotice(undefined);
      sounds.place();
      const placed = new Set(next.boards.player.ships.map((each) => each.kind));
      setSelected(BATTLESHIP_SHIP_KINDS.find((kind) => !placed.has(kind)));
    },
    [orientation, placedShips, selected, sounds, state],
  );

  const randomize = useCallback(() => {
    setState((current) => randomizeBattleshipFleet(current, Math.random));
    setSelected(undefined);
    setNotice(undefined);
    sounds.place();
  }, [sounds]);

  const clearFleet = useCallback(() => {
    setState((current) => clearBattleshipFleet(current));
    setSelected("carrier");
    setNotice(undefined);
  }, []);

  const startBattle = useCallback(() => {
    const result = readyBattleship(state, Math.random);
    if (!result.ok) {
      setNotice(result.reason);
      return;
    }
    setState(result.state);
    setHover(undefined);
    setNotice(undefined);
  }, [state]);

  /* ------------------------------------------------------------------- battle */

  const fireAt = useCallback(
    (index: number) => {
      const result = fireBattleship(state, "player", index);
      if (!result.ok) return; // the radar disables every cell this could refuse
      setState(result.state);
      setPlayerLine(`You: ${describeShot(result.shot)}`);
      playShotSound(result.shot);
    },
    [playShotSound, state],
  );

  // The computer's reply, after a pause. Keyed on the state so a new game mid-pause
  // cancels the pending shot rather than firing it onto the fresh board.
  useEffect(() => {
    if (state.phase !== "battle" || state.turn !== "computer") return;
    const timer = setTimeout(() => {
      const result = takeBattleshipComputerTurn(state, Math.random);
      if (!result.ok) return;
      setState(result.state);
      setComputerLine(`Computer: ${describeShot(result.shot)}`);
      playShotSound(result.shot);
    }, COMPUTER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [playShotSound, state]);

  // Game over: the sting, and a one-shot save on a win. `moves` carries shots fired.
  useEffect(() => {
    if (state.phase !== "game-over" || savedRef.current) return;
    savedRef.current = true;
    if (state.winner !== "player") {
      sounds.lost();
      return;
    }
    sounds.won();
    void saveScoreAction(GAME_KEY, scoreBattleship(state), view.shotsFired).then((result) => {
      if (!result.ok) {
        setSaveNote(result.error);
        return;
      }
      setSaveNote(result.best ? "New record — saved to the board." : "Score saved.");
    });
  }, [sounds, state, view.shotsFired]);

  /* ------------------------------------------------------------------- render */

  const placing = state.phase === "placement";
  const over = state.phase === "game-over";
  const revealed = revealedBattleshipFleet(state);
  const revealedCells = useMemo(
    () => new Set((revealed ?? []).flatMap((ship) => battleshipShipCells(ship) ?? [])),
    [revealed],
  );
  const setup = BATTLESHIP_SETUP[state.difficulty];

  const ownBoard = (
    <BoardGrid
      title={placing ? "Your waters" : "Your fleet"}
      compact={!placing}
      ariaLabel={(index) => {
        const cell = view.own[index];
        const where = battleshipCoordLabel(index);
        const ship = cell.ship ? BATTLESHIP_FLEET[cell.ship].name : "open water";
        return `${where}: ${ship}${cell.shot ? (cell.ship ? ", hit" : ", missed") : ""}`;
      }}
      interactive={placing}
      onCell={tapOwnCell}
      onHover={placing ? setHover : undefined}
      renderCell={(index) => {
        const cell = view.own[index];
        const inPreview = preview?.cells.has(index);
        const sunk = cell.ship && view.ownSunk.includes(cell.ship);
        const className = [
          "relative flex aspect-square items-center justify-center rounded-[2px]",
          inPreview
            ? preview?.fits
              ? "bg-emerald-400/45"
              : "bg-red-400/45"
            : cell.ship
              ? sunk
                ? "bg-red-500/35 border border-red-400/50"
                : "bg-slate-400/60 border border-slate-300/40"
              : WATER,
        ].join(" ");
        const mark = cell.shot ? (cell.ship ? <HitMark /> : <MissMark />) : null;
        return { className, content: mark };
      }}
    />
  );

  const radarBoard = (
    <BoardGrid
      title="Enemy waters"
      ariaLabel={(index) => {
        const where = battleshipCoordLabel(index);
        const cell = view.opponent[index];
        return `${where}: ${cell === "unknown" ? (revealedCells.has(index) ? "ship, not found" : "not fired at") : cell}`;
      }}
      interactive={state.phase === "battle" && state.turn === "player"}
      isDisabled={(index) => view.opponent[index] !== "unknown"}
      onCell={fireAt}
      renderCell={(index) => {
        const cell = view.opponent[index];
        const className = [
          "relative flex aspect-square items-center justify-center rounded-[2px]",
          cell === "sunk"
            ? "bg-red-500/35 border border-red-400/50"
            : cell === "hit"
              ? "bg-red-500/15 border border-red-400/30"
              : revealedCells.has(index)
                ? // After the game: ships the player never found, outlined.
                  "border border-dashed border-slate-300/60 bg-slate-400/20"
                : WATER,
          cell === "unknown" && state.phase === "battle" && state.turn === "player"
            ? "hover:bg-emerald-400/25 cursor-crosshair"
            : "",
        ].join(" ");
        const mark = cell === "miss" ? <MissMark /> : cell === "hit" || cell === "sunk" ? <HitMark /> : null;
        return { className, content: mark };
      }}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Stat label="Shots" value={String(view.shotsFired)} />
          <Stat label="Sunk" value={`${view.opponentSunk.length}/5`} />
          <Stat label="Lost" value={`${view.ownSunk.length}/5`} />
          <Stat label="Best" value={bestScore.toLocaleString()} />
        </div>
        <div className="flex flex-wrap gap-2">
          {/* The level deals a new game immediately, as Sudoku's and Minesweeper's do. */}
          {BATTLESHIP_DIFFICULTIES.map((level) => (
            <Button
              key={level}
              onClick={() => newGame(level)}
              variant={level === state.difficulty ? "primary" : "secondary"}
              size="sm"
            >
              {BATTLESHIP_SETUP[level].label}
            </Button>
          ))}
        </div>
      </div>

      {placing && (
        <div className="flex flex-col gap-3">
          {/* The ship selector. A placed ship shows a tick; selecting it and tapping the
              board moves it, and tapping a placed ship on the board picks it up. */}
          <div className="flex flex-wrap justify-center gap-2" role="radiogroup" aria-label="Ship to place">
            {BATTLESHIP_SHIP_KINDS.map((kind) => {
              const { name, length } = BATTLESHIP_FLEET[kind];
              const placed = placedKinds.has(kind);
              return (
                <button
                  key={kind}
                  type="button"
                  role="radio"
                  aria-checked={selected === kind}
                  onClick={() => setSelected(kind)}
                  className={[
                    "flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm",
                    selected === kind
                      ? "border-brass bg-brass/15 text-ink"
                      : "border-line bg-paper-raised text-muted hover:text-ink",
                  ].join(" ")}
                >
                  <span>{name}</span>
                  <span className="flex gap-0.5" aria-hidden>
                    {Array.from({ length }, (_, step) => (
                      <span
                        key={step}
                        className={`h-2 w-2 rounded-[1px] ${placed ? "bg-brass" : "bg-muted/40"}`}
                      />
                    ))}
                  </span>
                  {placed && <span className="sr-only">(placed)</span>}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={rotate} variant="secondary" size="sm" title="Rotate (R)">
              Rotate: {orientation === "horizontal" ? "Across" : "Down"}
            </Button>
            <Button onClick={randomize} variant="secondary" size="sm">
              Randomize Fleet
            </Button>
            <Button onClick={clearFleet} variant="secondary" size="sm" disabled={placedShips.length === 0}>
              Clear
            </Button>
            <Button onClick={startBattle} size="sm" disabled={!fleetCheck.ok}>
              Ready
            </Button>
          </div>
        </div>
      )}

      {placing ? (
        <div className="flex justify-center">{ownBoard}</div>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          {/* Desktop: your fleet left, the radar right. Phone: the radar — the board
              you play on — comes first, and your fleet sits smaller beneath it. */}
          <div className="flex justify-center max-lg:order-2">{ownBoard}</div>
          <div className="flex justify-center max-lg:order-1">{radarBoard}</div>
        </div>
      )}

      <div aria-live="polite" className="flex min-h-6 flex-col items-center gap-0.5 text-center text-sm">
        {placing && (
          <span className="text-muted">
            {notice ??
              (fleetCheck.ok
                ? "Fleet ready. Press Ready to start."
                : selected
                  ? `Place your ${BATTLESHIP_FLEET[selected].name} (${BATTLESHIP_FLEET[selected].length}).`
                  : fleetCheck.reason)}
          </span>
        )}
        {state.phase === "battle" && (
          <span className="text-ink">
            {state.turn === "player" ? "Your turn — pick a square on the radar." : "The computer is aiming…"}
          </span>
        )}
        {playerLine && <span className="font-display tabular-nums text-ink">{playerLine}</span>}
        {computerLine && <span className="font-display tabular-nums text-muted">{computerLine}</span>}
      </div>

      {!placing && (
        <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-xs">
          <FleetStatus title="Enemy fleet" sunk={view.opponentSunk} />
          <FleetStatus title="Your fleet" sunk={view.ownSunk} />
        </div>
      )}

      {/* A plain bordered div, not a Modal — see the Minesweeper view for why. */}
      {over && (
        <div className="mx-auto max-w-sm rounded-xl border border-line bg-paper-raised p-4 text-center">
          <h3 className="font-display text-base text-ink">
            {state.winner === "player" ? "Victory" : "Fleet lost"}
          </h3>
          <p className="mt-1 text-sm text-muted">
            {state.winner === "player" ? (
              <>
                {setup.label}: the enemy fleet sunk in {view.shotsFired} shots —{" "}
                {scoreBattleship(state).toLocaleString()} pts.
              </>
            ) : (
              <>
                The computer sank all five of your ships. You sank {view.opponentSunk.length}. A
                lost game scores nothing.
              </>
            )}
          </p>
          {saveNote && <p className="mt-1 text-xs text-muted">{saveNote}</p>}
          <Button onClick={() => newGame(state.difficulty)} size="sm" className="mt-3">
            Play again
          </Button>
        </div>
      )}

      <div className="flex justify-center gap-2">
        {!placing && !over && (
          <Button onClick={() => newGame(state.difficulty)} variant="secondary" size="sm">
            New game
          </Button>
        )}
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

      <p className="text-center text-xs text-muted max-lg:hidden">
        {placing
          ? "Click to place the selected ship from its bow, R or Rotate to turn it, click a placed ship to move it."
          : "Click a square on the enemy radar to fire."}
      </p>
      <p className="hidden text-center text-xs text-muted max-lg:block">
        {placing
          ? "Tap to place the selected ship from its bow, Rotate to turn it, tap a placed ship to move it."
          : "Tap a square on the enemy radar to fire."}
      </p>
    </div>
  );
}

/**
 * One 10x10 board with its A–J and 1–10 rulers. `renderCell` supplies each cell's
 * look; the grid supplies the buttons, the labels and the pointer wiring.
 */
function BoardGrid({
  title,
  compact = false,
  interactive,
  isDisabled,
  onCell,
  onHover,
  renderCell,
  ariaLabel,
}: {
  title: string;
  compact?: boolean;
  interactive: boolean;
  isDisabled?: (index: number) => boolean;
  onCell: (index: number) => void;
  onHover?: (index: number | undefined) => void;
  renderCell: (index: number) => { className: string; content: ReactNode };
  ariaLabel: (index: number) => string;
}) {
  const columns = Array.from({ length: BATTLESHIP_SIZE }, (_, col) => col);
  return (
    <div className={`flex w-full flex-col gap-1.5 ${compact ? "max-w-[26rem] max-lg:max-w-[16rem]" : "max-w-[26rem]"}`}>
      <div className="text-center text-xs uppercase tracking-wide text-muted">{title}</div>
      <div className={SCOPE} onPointerLeave={() => onHover?.(undefined)}>
        <div
          className="grid gap-px"
          style={{ gridTemplateColumns: `1.1rem repeat(${BATTLESHIP_SIZE}, minmax(0, 1fr))` }}
          role="grid"
          aria-label={title}
        >
          <span aria-hidden />
          {columns.map((col) => (
            <span key={`c${col}`} aria-hidden className={`${SCOPE_LABEL} pb-0.5 text-center`}>
              {col + 1}
            </span>
          ))}
          {Array.from({ length: BATTLESHIP_SIZE }, (_, row) => (
            <div key={`r${row}`} role="row" className="contents">
              <span aria-hidden className={`${SCOPE_LABEL} flex items-center justify-center`}>
                {BATTLESHIP_ROW_LABELS[row]}
              </span>
              {columns.map((col) => {
                const index = row * BATTLESHIP_SIZE + col;
                const { className, content } = renderCell(index);
                const disabled = !interactive || (isDisabled?.(index) ?? false);
                return (
                  <button
                    key={index}
                    type="button"
                    role="gridcell"
                    aria-label={ariaLabel(index)}
                    disabled={disabled}
                    onClick={() => onCell(index)}
                    onPointerEnter={(event) => {
                      // Mouse only: a touch has no hover, and a preview that sticks
                      // after a tap would read as a placed ship.
                      if (event.pointerType === "mouse") onHover?.(index);
                    }}
                    className={`${className} min-h-0 text-[min(0.85rem,3vw)] leading-none disabled:cursor-default`}
                  >
                    {content}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** A miss: a pale splash dot. Glyphs rather than icons — game pieces, not places. */
function MissMark() {
  return <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-sky-200/70" />;
}

/** A hit: a red cross. */
function HitMark() {
  return (
    <span aria-hidden className="font-display font-bold text-red-400">
      ✕
    </span>
  );
}

/** Which ships of a fleet are still afloat, struck through as they sink. */
function FleetStatus({ title, sunk }: { title: string; sunk: readonly BattleshipShipKind[] }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="uppercase tracking-wide text-muted">{title}</span>
      <ul className="flex flex-wrap justify-center gap-x-2 gap-y-0.5">
        {BATTLESHIP_SHIP_KINDS.map((kind) => (
          <li
            key={kind}
            className={sunk.includes(kind) ? "text-red-400 line-through" : "text-ink"}
          >
            {BATTLESHIP_FLEET[kind].name}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One figure in the strip above the board. Matches the other games'. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-paper-raised px-3 py-1.5 text-center">
      <div className="text-[0.65rem] uppercase tracking-wide text-muted">{label}</div>
      <div className="font-display text-lg tabular-nums text-ink">{value}</div>
    </div>
  );
}
