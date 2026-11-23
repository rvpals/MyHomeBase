"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/button";
import { ChessBoard, ChessPieceGlyph } from "@/components/chess-board";
import { Modal } from "@/components/modal";
import { useGameSounds } from "@/components/use-game-sounds";
import {
  CHESS_LEVELS,
  CHESS_LEVEL_SETUP,
  buildChessSave,
  canUndoChessMove,
  chessCapturedPieces,
  chessCheckedKingSquare,
  chessFullMoves,
  chessHint,
  chessMoveTargets,
  chessMovesFrom,
  chooseChessMove,
  describeChessResult,
  gameToPgn,
  isChessGameOver,
  isHumanTurn,
  moveToUci,
  oppositeColor,
  parseFen,
  playChessMove,
  resignChessGame,
  agreeChessDraw,
  scoreChessGame,
  shouldAcceptChessDraw,
  squareFromName,
  squareName,
  startChessGame,
  toFen,
  undoChessMove,
  type ChessColor,
  type ChessGame,
  type ChessLevel,
  type ChessPieceType,
  type ChessPromotionType,
  type ChessSaveSummary,
} from "@/lib/games";
import type { ChessWorkerReply, ChessWorkerRequest } from "./chess-worker";
import {
  autosaveChessAction,
  deleteChessGameAction,
  discardChessAutosaveAction,
  listChessGamesAction,
  loadChessAutosaveAction,
  loadChessGameAction,
  saveChessGameAction,
  saveScoreAction,
} from "./games-actions";

// Chess against the computer.
//
// A client component that owns only presentation state — which square is picked up,
// which dialog is open, whether the computer is thinking. Every rule comes from
// @/lib/games: what a legal move is, whether that was mate, what the computer plays,
// what a win is worth, and what a saved game replays to.
//
// The computer thinks in a Web Worker (`chess-worker.ts`), because Advanced searches
// for up to two and a half seconds and doing that on the main thread freezes the page
// — including the "Thinking…" line that would explain the freeze. There is a
// main-thread fallback for the case where the worker cannot be created, which runs the
// same engine; see `useChessEngine`.
//
// Phone: the board takes the full width and the panel stacks beneath it. Desktop: the
// board on the left, the panel beside it. `max-lg:` variants only, so the wide layout
// provably cannot regress.

const GAME_KEY = "chess";

/** How long after a move the game is autosaved. */
const AUTOSAVE_DELAY_MS = 1_200;

/**
 * The shortest the computer's reply may appear to take.
 *
 * Beginner answers in a few milliseconds, and a reply that lands before the player's
 * own piece has finished being put down reads as a glitch rather than as a move. This
 * is a floor, never a delay added to a search that already took longer.
 */
const MIN_REPLY_MS = 350;

type ColorChoice = ChessColor | "random";

function useSounds(enabled: boolean) {
  const sounds = useGameSounds(enabled);
  return useMemo(
    () => ({
      /** A piece set down: a short, soft wooden knock. */
      move: () =>
        sounds.play({ startHz: 320, endHz: 180, durationMs: 55, type: "triangle", peak: 0.05 }),
      /** A capture is the same knock with a harder edge — wood against wood. */
      capture: () =>
        sounds.play({ startHz: 420, endHz: 120, durationMs: 110, type: "sawtooth", peak: 0.06, cutoffHz: 1800 }),
      /** Check: two rising notes, so it is heard as a warning and not as a move. */
      check: () =>
        sounds.playSequence([
          { startHz: 660, endHz: 660, durationMs: 90, type: "triangle", peak: 0.05 },
          { startHz: 880, endHz: 880, durationMs: 140, type: "triangle", peak: 0.05, afterMs: 100 },
        ]),
      won: () =>
        sounds.playSequence(
          [523, 659, 784, 1047].map((hz, index) => ({
            startHz: hz,
            endHz: hz,
            durationMs: index === 3 ? 320 : 120,
            type: "triangle" as OscillatorType,
            peak: 0.05,
            afterMs: index * 130,
          })),
        ),
      lost: () =>
        sounds.playSequence(
          [392, 330, 262].map((hz, index) => ({
            startHz: hz,
            endHz: hz,
            durationMs: index === 2 ? 420 : 160,
            type: "sine" as OscillatorType,
            peak: 0.05,
            afterMs: index * 170,
          })),
        ),
    }),
    [sounds],
  );
}

/**
 * Runs the engine, in a worker when one can be had and on the main thread when it
 * cannot.
 *
 * The fallback exists because a worker is the one thing on this screen that can fail
 * for reasons that have nothing to do with the game — a bundler that did not emit it,
 * a browser that refuses one. Falling back to the same engine on the main thread costs
 * a frozen second on Advanced; having no fallback would cost a board that never moves.
 */
function useChessEngine() {
  const workerRef = useRef<Worker | undefined>(undefined);
  const nextId = useRef(0);
  const pending = useRef<Map<number, (uci: string | undefined) => void>>(new Map());

  useEffect(() => {
    // Copied once here, and used in the cleanup instead of `pending.current`. The ref
    // holds one Map for the component's whole life, so the copy and the ref are always
    // the same object — but reading a ref in a cleanup is the pattern that breaks when
    // that stops being true, so it is read here instead.
    const inflight = pending.current;

    let worker: Worker | undefined;
    try {
      worker = new Worker(new URL("./chess-worker.ts", import.meta.url));
      worker.addEventListener("message", (event: MessageEvent<ChessWorkerReply>) => {
        const resolve = pending.current.get(event.data.id);
        if (!resolve) return;
        pending.current.delete(event.data.id);
        resolve(event.data.uci);
      });
      worker.addEventListener("error", () => {
        // Give up on the worker for the rest of the session and answer every request
        // still outstanding, so nothing is left waiting on a thread that has died.
        workerRef.current = undefined;
        for (const [, resolve] of inflight) resolve(undefined);
        inflight.clear();
      });
      workerRef.current = worker;
    } catch {
      workerRef.current = undefined;
    }

    return () => {
      worker?.terminate();
      workerRef.current = undefined;
      inflight.clear();
    };
  }, []);

  /** The computer's move for a position, in coordinate form. */
  return useCallback((fen: string, level: ChessLevel): Promise<string | undefined> => {
    const worker = workerRef.current;

    if (!worker) {
      return new Promise((resolve) => {
        // Yielded to the event loop, so React paints "Thinking…" before the search
        // takes the thread. Without this the player sees nothing at all until the move
        // appears.
        setTimeout(() => {
          const position = parseFen(fen);
          const move = position ? chooseChessMove(position, level) : undefined;
          resolve(move ? moveToUci(move) : undefined);
        }, 0);
      });
    }

    const id = nextId.current++;
    return new Promise((resolve) => {
      pending.current.set(id, resolve);
      worker.postMessage({ id, fen, level } satisfies ChessWorkerRequest);
    });
  }, []);
}

export function GameChessView({ bestScore }: { bestScore: number }) {
  const [game, setGame] = useState<ChessGame | undefined>(undefined);
  const [level, setLevel] = useState<ChessLevel>("intermediate");
  const [colorChoice, setColorChoice] = useState<ColorChoice>("w");

  const [selected, setSelected] = useState<number | undefined>(undefined);
  const [promotion, setPromotion] = useState<{ from: number; to: number } | undefined>(undefined);
  const [hint, setHint] = useState<{ from: number; to: number } | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [soundOn, setSoundOn] = useState(true);

  const [resume, setResume] = useState<{ savedAt: string; game: ChessGame } | undefined>(undefined);
  const [saves, setSaves] = useState<ChessSaveSummary[]>([]);
  const [dialog, setDialog] = useState<"save" | "load" | "resign" | "pgn" | undefined>(undefined);
  const [saveName, setSaveName] = useState("");
  const [pgn, setPgn] = useState("");

  const sounds = useSounds(soundOn);
  const think = useChessEngine();

  const over = game ? isChessGameOver(game) : false;
  const humanTurn = game ? isHumanTurn(game) : false;

  /*
    The computer's reply is keyed on this: the game's own move count plus whose turn it
    is. An effect that depended on `game` would re-fire on every unrelated state change
    that produced a new object, and the computer would start a second search for a
    position it is already thinking about.
  */
  const replyKey = game && !over && !humanTurn ? `${game.moves.length}:${game.position.turn}` : "";

  /*
    Thinking is **derived, not stored**. It is true exactly while it is the computer's
    turn in a live game — which is what `replyKey` already says — and playing the reply
    changes the game, which empties the key. A `useState` here would have to be set
    synchronously at the top of the effect below, which is the cascading render React
    warns about, and it could then disagree with the board's own `disabled`.
  */
  const thinking = replyKey !== "";

  /*
    The score, also derived: `scoreChessGame` is a pure function of a finished game, so
    storing it would be keeping a second copy of something already on screen. The effect
    further down only does the things that genuinely are side effects — posting it,
    clearing the autosave, playing a sound — and a ref keeps those to once per ending.
  */
  const scored = game && over ? scoreChessGame(game) : undefined;
  const settled = useRef<string | undefined>(undefined);

  /** The autosave, read once when the game is opened. */
  useEffect(() => {
    let live = true;
    void loadChessAutosaveAction().then((result) => {
      if (live && result.ok && result.run) setResume(result.run);
    });
    return () => {
      live = false;
    };
  }, []);

  /** The computer's move. */
  useEffect(() => {
    if (!replyKey || !game) return;

    let live = true;
    const started = Date.now();

    void think(toFen(game.position), game.level).then(async (uci) => {
      // A reply for a position the player has since left (undo, New game, a load) is
      // dropped rather than played.
      if (!live) return;

      const wait = Math.max(0, MIN_REPLY_MS - (Date.now() - started));
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      if (!live) return;

      if (!uci) {
        // The engine failed — a worker that could not start *and* a main-thread search
        // that threw. The board stays unpressable because it genuinely is the
        // computer's turn and it genuinely cannot move; the line says so rather than
        // pretending the game can continue.
        setNotice("The computer could not find a move. Start a new game.");
        return;
      }

      // Played against the game this effect was started for, not against a functional
      // update. Anything that changes the game also changes `replyKey`, which runs this
      // effect's cleanup and clears `live` — so a reply for a position the player has
      // since left never gets here. Doing it in a `setGame` updater would mean making
      // sounds and setting state from inside a reducer, which React may run twice.
      const played = playChessMove(game, uci);
      if (!played.ok) return;
      setGame(played.game);
      announce(played.game, played.san);
    });

    return () => {
      live = false;
    };
    // `game` is read inside but deliberately not a dependency — see `replyKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replyKey, think]);

  /** The autosave, written a beat after the board settles. */
  useEffect(() => {
    if (!game || over || game.moves.length === 0) return;
    const timer = setTimeout(() => {
      void autosaveChessAction(buildChessSave(game));
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [game, over]);

  /**
   * A finished game: post the score once, clear the autosave, play the ending.
   *
   * Guarded by a ref rather than by a piece of state, so nothing is set synchronously
   * in the effect body. The key is the ending itself, so taking a game back and losing
   * it a second way posts both results — and re-rendering for any other reason posts
   * neither.
   */
  useEffect(() => {
    if (!game || !over) return;

    const ending = `${game.moves.length}:${game.status}:${game.winner ?? ""}`;
    if (settled.current === ending) return;
    settled.current = ending;

    void discardChessAutosaveAction();

    if (game.winner === game.humanColor) sounds.won();
    else if (game.winner) sounds.lost();

    // A draw and a loss both score 0, and `saveScoreAction` happily records a 0 — the
    // same rule Blackjack's broke run follows, so the Played count stays honest about
    // how many games were actually played.
    void saveScoreAction(GAME_KEY, scoreChessGame(game), game.moves.length);
  }, [game, over, sounds]);

  /** Plays the sound and sets the line that describes what just happened. */
  function announce(next: ChessGame, san: string) {
    if (isChessGameOver(next)) {
      setNotice(describeChessResult(next));
      return;
    }
    if (next.status === "check") sounds.check();
    else if (san.includes("x")) sounds.capture();
    else sounds.move();
    setNotice(undefined);
  }

  function beginGame(next: ChessGame) {
    // Cleared so a new game that ends the same way as the last one still posts its
    // score — the ref is "have I already dealt with *this* ending", not "ever".
    settled.current = undefined;
    setGame(next);
    setSelected(undefined);
    setPromotion(undefined);
    setHint(undefined);
    setNotice(undefined);
    setDialog(undefined);
  }

  function startNew() {
    const color: ChessColor =
      colorChoice === "random" ? (Math.random() < 0.5 ? "w" : "b") : colorChoice;
    void discardChessAutosaveAction();
    setResume(undefined);
    beginGame(startChessGame({ humanColor: color, level }));
  }

  function squarePressed(square: number) {
    if (!game || over || !humanTurn || thinking || promotion) return;
    setHint(undefined);

    // Picking a piece up, or swapping to another of your own.
    const piece = game.position.board[square];
    if (piece && piece.color === game.humanColor) {
      setSelected(square === selected ? undefined : square);
      return;
    }

    if (selected === undefined) return;

    const moves = chessMovesFrom(game, selected).filter((move) => move.to === square);
    if (moves.length === 0) {
      setSelected(undefined);
      return;
    }

    // Four moves share this from-and-to when a pawn reaches the last rank, and only the
    // player can say which piece they want.
    if (moves.some((move) => move.promotion)) {
      setPromotion({ from: selected, to: square });
      return;
    }

    playHuman(moveToUci(moves[0]!));
  }

  function playHuman(uci: string) {
    if (!game) return;
    const played = playChessMove(game, uci);
    if (!played.ok) {
      setNotice(played.reason);
      return;
    }
    setSelected(undefined);
    setPromotion(undefined);
    setGame(played.game);
    announce(played.game, played.san);
  }

  function choosePromotion(piece: ChessPromotionType) {
    if (!promotion) return;
    playHuman(`${squareName(promotion.from)}${squareName(promotion.to)}${piece}`);
  }

  function takeBack() {
    if (!game) return;
    setGame(undoChessMove(game));
    setSelected(undefined);
    setHint(undefined);
    setNotice(undefined);
  }

  function showHint() {
    if (!game || over || !humanTurn) return;
    setBusy(true);
    // Deferred so the button's busy state paints before the search takes the thread.
    // The hint always searches at Advanced strength (see `chessHint`), so it is the one
    // place a Beginner game pays Advanced's budget.
    setTimeout(() => {
      const found = chessHint(game);
      setBusy(false);
      if (!found) return;
      setHint({ from: found.move.from, to: found.move.to });
      setNotice(`Try ${squareName(found.move.from)}–${squareName(found.move.to)}.`);
    }, 0);
  }

  function offerDraw() {
    if (!game || over) return;
    setBusy(true);
    setTimeout(() => {
      const accepted = shouldAcceptChessDraw(game);
      setBusy(false);
      if (accepted) {
        const drawn = agreeChessDraw(game);
        setGame(drawn);
        setNotice(describeChessResult(drawn));
      } else {
        setNotice("The computer declines the draw.");
      }
    }, 0);
  }

  function resign() {
    if (!game) return;
    const resigned = resignChessGame(game);
    setGame(resigned);
    setNotice(describeChessResult(resigned));
    setDialog(undefined);
  }

  async function openLoad() {
    setDialog("load");
    const result = await listChessGamesAction();
    if (result.ok) setSaves(result.games);
    else setNotice(result.error);
  }

  async function saveGame() {
    if (!game) return;
    setBusy(true);
    const result = await saveChessGameAction(saveName, buildChessSave(game));
    setBusy(false);
    if (!result.ok) {
      setNotice(result.error);
      return;
    }
    setDialog(undefined);
    setNotice(`Saved as "${saveName.trim()}".`);
  }

  async function loadGame(id: number) {
    setBusy(true);
    const result = await loadChessGameAction(id);
    setBusy(false);
    if (!result.ok) {
      setNotice(result.error);
      return;
    }
    beginGame(result.loaded.game);
    setNotice(`Loaded "${result.loaded.name}".`);
  }

  async function removeSave(id: number) {
    const result = await deleteChessGameAction(id);
    if (!result.ok) {
      setNotice(result.error);
      return;
    }
    setSaves((current) => current.filter((row) => row.id !== id));
  }

  if (!game) {
    return (
      <ChessSetup
        level={level}
        onLevel={setLevel}
        colorChoice={colorChoice}
        onColor={setColorChoice}
        onStart={startNew}
        onResume={resume ? () => beginGame(resume.game) : undefined}
        resumeAt={resume?.savedAt}
        onLoad={openLoad}
        bestScore={bestScore}
      />
    );
  }

  const targets = selected === undefined ? [] : chessMoveTargets(game, selected);
  const lastMove = lastMoveSquares(game);
  const checked = chessCheckedKingSquare(game);

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex gap-6 max-lg:flex-col max-lg:gap-4">
        {/* The board gets the width it can take and stays square. `min-w-0` so a long
            move list in the panel beside it can never squeeze it off the screen. */}
        <div className="min-w-0 flex-1">
          <ChessBoard
            squares={game.position.board}
            orientation={game.humanColor}
            selected={selected}
            targets={targets}
            lastMove={lastMove}
            checkSquare={checked >= 0 ? checked : undefined}
            hint={hint}
            onSquare={squarePressed}
            disabled={over || !humanTurn || thinking || busy}
          />
        </div>

        <ChessPanel
          game={game}
          thinking={thinking}
          notice={notice}
          scored={scored}
          bestScore={bestScore}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={takeBack} disabled={!canUndoChessMove(game) || thinking || busy}>
          Undo
        </Button>
        <Button size="sm" variant="secondary" onClick={showHint} disabled={over || !humanTurn || thinking || busy}>
          Hint
        </Button>
        <Button size="sm" variant="secondary" onClick={offerDraw} disabled={over || thinking || busy}>
          Offer draw
        </Button>
        <Button size="sm" variant="danger" onClick={() => setDialog("resign")} disabled={over || busy}>
          Resign
        </Button>

        <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />

        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setSaveName(defaultSaveName(game));
            setDialog("save");
          }}
          disabled={over || busy}
        >
          Save
        </Button>
        <Button size="sm" variant="secondary" onClick={openLoad} disabled={busy}>
          Load
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setPgn(gameToPgn(game, { date: pgnDate() }));
            setDialog("pgn");
          }}
        >
          Export PGN
        </Button>
        <Button
          size="sm"
          variant="secondary"
          // Back to the setup screen. `resume` is cleared here rather than when the
          // game ended, so that nothing has to be set from inside an effect: the offer
          // is only ever read on the screen this button opens.
          onClick={() => {
            setResume(undefined);
            setGame(undefined);
          }}
          disabled={busy}
        >
          New game
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setSoundOn((on) => !on)}
          ariaPressed={soundOn}
        >
          {soundOn ? "Sound on" : "Sound off"}
        </Button>
      </div>

      {promotion && (
        <Modal title="Promote to" description="Your pawn reaches the last rank." onClose={() => setPromotion(undefined)}>
          <div className="flex justify-center gap-3 py-2">
            {(["q", "r", "b", "n"] as const).map((piece) => (
              <button
                key={piece}
                type="button"
                className="flex h-16 w-16 items-center justify-center rounded-lg border border-line bg-paper-raised hover:border-brass focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
                onClick={() => choosePromotion(piece)}
                aria-label={PROMOTION_NAMES[piece]}
              >
                <ChessPieceGlyph
                  piece={{ type: piece, color: game.humanColor }}
                  className="h-12 w-12"
                />
              </button>
            ))}
          </div>
        </Modal>
      )}

      {dialog === "resign" && (
        <Modal
          title="Resign this game?"
          description="The computer takes the win, and the game is scored as a loss."
          onClose={() => setDialog(undefined)}
          footer={
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={() => setDialog(undefined)}>
                Keep playing
              </Button>
              <Button size="sm" variant="danger" onClick={resign}>
                Resign
              </Button>
            </div>
          }
        >
          <p className="text-sm text-muted">This cannot be undone.</p>
        </Modal>
      )}

      {dialog === "save" && (
        <Modal
          title="Save this game"
          description="Saving under a name you have used before replaces that game."
          onClose={() => setDialog(undefined)}
          footer={
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={() => setDialog(undefined)}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => void saveGame()} disabled={!saveName.trim() || busy}>
                Save
              </Button>
            </div>
          }
        >
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">Name</span>
            <input
              value={saveName}
              onChange={(event) => setSaveName(event.target.value)}
              maxLength={60}
              className="rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
            />
          </label>
        </Modal>
      )}

      {dialog === "load" && (
        <Modal title="Saved games" onClose={() => setDialog(undefined)}>
          <ChessSaveList saves={saves} onLoad={(id) => void loadGame(id)} onDelete={(id) => void removeSave(id)} />
        </Modal>
      )}

      {dialog === "pgn" && (
        <Modal
          title="PGN"
          description="Paste this into any chess program or analysis board."
          onClose={() => setDialog(undefined)}
        >
          <textarea
            readOnly
            value={pgn}
            rows={14}
            className="w-full rounded-md border border-line bg-paper px-3 py-2 font-mono text-xs text-ink"
            onFocus={(event) => event.currentTarget.select()}
          />
        </Modal>
      )}
    </div>
  );
}

const PROMOTION_NAMES: Record<ChessPromotionType, string> = {
  q: "Queen",
  r: "Rook",
  b: "Bishop",
  n: "Knight",
};

/** The squares of the move just played, for the board's amber marks. */
function lastMoveSquares(game: ChessGame): { from: number; to: number } | undefined {
  const last = game.moves.at(-1);
  if (!last) return undefined;
  const from = squareFromName(last.uci.slice(0, 2));
  const to = squareFromName(last.uci.slice(2, 4));
  return from >= 0 && to >= 0 ? { from, to } : undefined;
}

/** A name the Save dialog starts with, so saving is one press for someone in a hurry. */
function defaultSaveName(game: ChessGame): string {
  const level = CHESS_LEVEL_SETUP[game.level].label;
  return `${level} — move ${Math.max(1, chessFullMoves(game))}`;
}

/** Today, in PGN's own `YYYY.MM.DD`. Read here rather than in `lib`, which has no clock. */
function pgnDate(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())}`;
}

/** The opening screen: pick a level and a colour, or come back to a game. */
function ChessSetup({
  level,
  onLevel,
  colorChoice,
  onColor,
  onStart,
  onResume,
  resumeAt,
  onLoad,
  bestScore,
}: {
  level: ChessLevel;
  onLevel: (level: ChessLevel) => void;
  colorChoice: ColorChoice;
  onColor: (choice: ColorChoice) => void;
  onStart: () => void;
  onResume?: () => void;
  resumeAt?: string;
  onLoad: () => void;
  bestScore: number;
}) {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 py-4">
      {onResume && (
        <div className="rounded-xl border border-line bg-paper-raised p-4 card-raised">
          <h3 className="font-display text-base text-ink">You have a game in progress</h3>
          <p className="mt-1 text-sm text-muted">
            Last saved {resumeAt ? new Date(resumeAt).toLocaleString() : "recently"}. Starting a
            new game will discard it.
          </p>
          <Button size="sm" className="mt-3" onClick={onResume}>
            Resume
          </Button>
        </div>
      )}

      <div>
        <h3 className="font-display text-base text-ink">Strength</h3>
        <div className="mt-2 flex flex-col gap-2">
          {CHESS_LEVELS.map((key) => {
            const setup = CHESS_LEVEL_SETUP[key];
            const active = key === level;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onLevel(key)}
                aria-pressed={active}
                className={`rounded-lg border p-3 text-left transition-colors ${
                  active ? "border-brass bg-brass-soft" : "border-line bg-paper-raised hover:border-brass"
                } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass`}
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span className="font-display text-sm text-ink">{setup.label}</span>
                  <span className="text-xs text-muted">×{setup.multiplier} points</span>
                </span>
                <span className="mt-0.5 block text-sm text-muted">{setup.hint}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <h3 className="font-display text-base text-ink">Your pieces</h3>
        <div className="mt-2 flex gap-2">
          {(["w", "b", "random"] as const).map((choice) => (
            <Button
              key={choice}
              size="sm"
              variant={choice === colorChoice ? "primary" : "secondary"}
              onClick={() => onColor(choice)}
              ariaPressed={choice === colorChoice}
            >
              {choice === "w" ? "White" : choice === "b" ? "Black" : "Random"}
            </Button>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted">White moves first. Playing Black, the computer opens.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onStart}>New game</Button>
        <Button variant="secondary" onClick={onLoad}>
          Load a saved game
        </Button>
      </div>

      {bestScore > 0 && (
        <p className="text-xs text-muted">Best score on this board: {bestScore.toLocaleString()} pts.</p>
      )}
    </div>
  );
}

/** Whose turn it is, what just happened, the move list and the pieces taken. */
function ChessPanel({
  game,
  thinking,
  notice,
  scored,
  bestScore,
}: {
  game: ChessGame;
  thinking: boolean;
  notice?: string;
  scored?: number;
  bestScore: number;
}) {
  const over = isChessGameOver(game);
  const computerColor = oppositeColor(game.humanColor);

  return (
    <aside className="flex w-72 shrink-0 flex-col gap-3 max-lg:w-full">
      <div className="rounded-xl border border-line bg-paper-raised p-3">
        <p className="font-display text-sm text-ink">
          {over
            ? describeChessResult(game)
            : thinking
              ? "The computer is thinking…"
              : isHumanTurn(game)
                ? "Your move."
                : "The computer's move."}
        </p>
        {!over && game.status === "check" && (
          <p className="mt-1 text-sm text-red-400">Check.</p>
        )}
        {notice && !over && <p className="mt-1 text-sm text-muted">{notice}</p>}
        {over && scored !== undefined && (
          <p className="mt-1 text-sm text-muted">
            {scored > 0 ? `Scored ${scored.toLocaleString()} pts.` : "No points for this one."}
            {bestScore > 0 && ` Best: ${bestScore.toLocaleString()} pts.`}
          </p>
        )}
      </div>

      <div className="rounded-xl border border-line bg-paper-raised p-3">
        <h4 className="text-xs uppercase tracking-wide text-muted">Taken</h4>
        <div className="mt-1 flex flex-col gap-1">
          <CapturedRow label="You" pieces={chessCapturedPieces(game, computerColor)} color={computerColor} />
          <CapturedRow label="Computer" pieces={chessCapturedPieces(game, game.humanColor)} color={game.humanColor} />
        </div>
      </div>

      <div className="rounded-xl border border-line bg-paper-raised p-3">
        <h4 className="text-xs uppercase tracking-wide text-muted">Moves</h4>
        {/* Capped and scrolling, so a long game never pushes the controls off a phone
            screen. `max-lg:` shortens it further, where the board already takes most of
            the viewport. */}
        <ol className="mt-1 max-h-64 overflow-auto font-mono text-xs text-ink max-lg:max-h-32">
          {pairMoves(game).map((pair, index) => (
            <li key={index} className="flex gap-2 py-0.5">
              <span className="w-7 shrink-0 text-right text-muted">{pair.number}.</span>
              <span className="w-16">{pair.white}</span>
              <span className="w-16">{pair.black}</span>
            </li>
          ))}
          {game.moves.length === 0 && <li className="py-0.5 text-muted">No moves yet.</li>}
        </ol>
      </div>
    </aside>
  );
}

function CapturedRow({
  label,
  pieces,
  color,
}: {
  label: string;
  pieces: readonly ChessPieceType[];
  color: ChessColor;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-xs text-muted">{label}</span>
      <div className="flex flex-wrap">
        {pieces.map((type, index) => (
          <ChessPieceGlyph key={`${type}-${index}`} piece={{ type, color }} className="h-5 w-5" />
        ))}
        {pieces.length === 0 && <span className="text-xs text-muted">—</span>}
      </div>
    </div>
  );
}

/** The move list in pairs, as a score sheet prints it. */
function pairMoves(game: ChessGame): { number: number; white: string; black: string }[] {
  const startsWithBlack = game.initialFen.trim().split(/\s+/)[1] === "b";
  const pairs: { number: number; white: string; black: string }[] = [];

  // A game set up with Black to move opens with a blank White column, so the numbering
  // still lines up with the position rather than with this list's own index.
  const entries = startsWithBlack
    ? ["", ...game.moves.map((move) => move.san)]
    : game.moves.map((move) => move.san);

  for (let index = 0; index < entries.length; index += 2) {
    pairs.push({
      number: Math.floor(index / 2) + 1,
      white: entries[index] ?? "",
      black: entries[index + 1] ?? "",
    });
  }
  return pairs;
}

function ChessSaveList({
  saves,
  onLoad,
  onDelete,
}: {
  saves: ChessSaveSummary[];
  onLoad: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  if (saves.length === 0) {
    return <p className="py-3 text-sm text-muted">You have no saved games yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {saves.map((save) => (
        <li
          key={save.id}
          className="flex items-center gap-3 rounded-lg border border-line bg-paper-raised px-3 py-2 max-lg:flex-col max-lg:items-stretch max-lg:gap-2"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-sm text-ink">{save.name}</p>
            <p className="text-xs text-muted">
              {save.readable
                ? `${CHESS_LEVEL_SETUP[save.level].label} · ${save.humanColor === "w" ? "White" : "Black"} · ${Math.ceil(save.moveCount / 2)} moves`
                : "This save cannot be read by this version."}
              {" · "}
              {new Date(save.savedAt).toLocaleString()}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button size="sm" onClick={() => onLoad(save.id)} disabled={!save.readable}>
              Load
            </Button>
            {/* A text link rather than a second pill: design.md keeps a destructive row
                action as plain red text, so it never competes with the real action. */}
            <button
              type="button"
              className="text-sm text-red-400 hover:underline"
              onClick={() => onDelete(save.id)}
            >
              Delete
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
