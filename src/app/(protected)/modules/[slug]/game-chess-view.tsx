"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/button";
import { ChessBoard, ChessPieceGlyph } from "@/components/chess-board";
import { CollapsibleCard } from "@/components/collapsible-card";
import { Modal } from "@/components/modal";
import { useGameSounds } from "@/components/use-game-sounds";
import { useIsCompact } from "@/components/viewport-context";
import {
  CHESS_LEVELS,
  CHESS_LEVEL_SETUP,
  CHESS_PUZZLES,
  CHESS_TIME_CONTROLS,
  CHESS_TIME_CONTROL_SETUP,
  buildChessSave,
  canUndoChessMove,
  chessCapturedPieces,
  chessCheckedKingSquare,
  chessClockReading,
  chessInfluence,
  chessPlayerOptions,
  chessPositionAtPly,
  chessSearchBudgetMs,
  importChessFen,
  importChessPgn,
  looksLikeChessPgn,
  chessFullMoves,
  chessRecordGames,
  chessResultOf,
  chessHint,
  chessMoveTargets,
  chessMovesFrom,
  chooseChessMove,
  describeChessResult,
  flagChessGame,
  formatChessRecord,
  formatChessClock,
  gameToPgn,
  isChessClockUrgent,
  isChessGameOver,
  isHumanTurn,
  moveToUci,
  oppositeColor,
  parseFen,
  playChessMove,
  recordChessHint,
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
  type ChessRecord,
  type ChessPromotionType,
  type ChessSaveSummary,
  type ChessThinkingEvent,
  type ChessTimeControl,
} from "@/lib/games";
import { ChessAnalysisView } from "./chess-analysis-view";
import type { ChessAdviceRequest, ChessMoveRequest, ChessWorkerMessage } from "./chess-worker";
import {
  autosaveChessAction,
  listChessRecordsAction,
  recordChessResultAction,
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

/**
 * Where this screen's choices are remembered, per device.
 *
 * `localStorage` rather than a user preference, for the reason the Arcade's Cards/List
 * switch uses it: these are properties of the screen you are playing on, not of you — a
 * beginner learning on the tablet does not want the hints following them to the desktop.
 *
 * One key holding every choice rather than one key each: they are read together on
 * mount and written together on any change, so splitting them would mean six reads and
 * a partial-restore case to think about, for no gain.
 */
const PREFERENCES_KEY = "myhomebase:chess-preferences";

/** What is remembered. Every field optional, so an older or damaged value still loads. */
interface ChessPreferences {
  level?: ChessLevel;
  color?: ColorChoice;
  timeControl?: ChessTimeControl;
  sound?: boolean;
  log?: boolean;
  moves?: boolean;
  influence?: boolean;
}

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
  const pending = useRef<
    Map<
      number,
      {
        resolve: (answer: EngineAnswer) => void;
        /** Present only while the machine log is on; see `chess-worker.ts`. */
        onEvent?: (event: ChessThinkingEvent) => void;
      }
    >
  >(new Map());

  useEffect(() => {
    // Copied once here, and used in the cleanup instead of `pending.current`. The ref
    // holds one Map for the component's whole life, so the copy and the ref are always
    // the same object — but reading a ref in a cleanup is the pattern that breaks when
    // that stops being true, so it is read here instead.
    const inflight = pending.current;

    let worker: Worker | undefined;
    try {
      worker = new Worker(new URL("./chess-worker.ts", import.meta.url));
      worker.addEventListener("message", (event: MessageEvent<ChessWorkerMessage>) => {
        const message = event.data;
        const entry = pending.current.get(message.id);
        if (!entry) return;

        // A line of the machine log: hand it on and keep waiting for the answer.
        if (message.kind === "thinking") {
          entry.onEvent?.(message.event);
          return;
        }
        // Moves and advice both come back here. Analysis has its own short-lived
        // worker, so an analysis message is never ours to act on.
        if (message.kind === "move") {
          pending.current.delete(message.id);
          entry.resolve({ uci: message.uci });
          return;
        }
        if (message.kind !== "advice") return;

        pending.current.delete(message.id);
        entry.resolve({ uci: message.uci, accept: message.accept });
      });
      worker.addEventListener("error", () => {
        // Give up on the worker for the rest of the session and answer every request
        // still outstanding, so nothing is left waiting on a thread that has died.
        workerRef.current = undefined;
        for (const [, entry] of inflight) entry.resolve({});
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

  /**
   * Hint and Offer draw, also off the main thread.
   *
   * Both search at Advanced strength, so both used to freeze the page for as long as a
   * computer move does — and their machine-log lines all landed in one burst at the end
   * rather than as the search deepened. They go through the same worker as a move
   * because they are the same kind of job: a short search the player is waiting on.
   */
  const advise = useCallback(
    (
      job: "hint" | "draw",
      fen: string,
      humanColor: ChessColor,
      onEvent?: (event: ChessThinkingEvent) => void,
    ): Promise<EngineAnswer> => {
      const worker = workerRef.current;

      if (!worker) {
        return new Promise((resolve) => {
          setTimeout(() => {
            const position = parseFen(fen);
            if (!position) {
              resolve({});
              return;
            }
            const game = startChessGame({ humanColor, level: "advanced", fen: toFen(position) });
            if (job === "draw") {
              resolve({ accept: shouldAcceptChessDraw(game, { onEvent }) });
              return;
            }
            const advice = chessHint(game, { onEvent });
            resolve({ uci: advice ? moveToUci(advice.move) : undefined });
          }, 0);
        });
      }

      const id = nextId.current++;
      return new Promise((resolve) => {
        pending.current.set(id, { resolve, onEvent });
        worker.postMessage({
          kind: "advice",
          id,
          job,
          fen,
          humanColor,
          log: onEvent !== undefined,
        } satisfies ChessAdviceRequest);
      });
    },
    [],
  );

  /**
   * The computer's move for a position, in coordinate form.
   *
   * `onEvent` is the machine log. Passing nothing means nothing is narrated: the worker
   * is told not to build events, and the fallback passes the engine no listener.
   */
  const think = useCallback((
    fen: string,
    level: ChessLevel,
    onEvent?: (event: ChessThinkingEvent) => void,
    budgetMs?: number,
    history?: readonly string[],
  ): Promise<string | undefined> => {
    const worker = workerRef.current;

    if (!worker) {
      return new Promise((resolve) => {
        // Yielded to the event loop, so React paints "Thinking…" before the search
        // takes the thread. Without this the player sees nothing at all until the move
        // appears.
        setTimeout(() => {
          const position = parseFen(fen);
          // On this path the events arrive in one burst when the search ends, because
          // the search holds the thread — the log is complete but not live.
          const move = position
            ? chooseChessMove(position, level, { onEvent, timeBudgetMs: budgetMs, history })
            : undefined;
          resolve(move ? moveToUci(move) : undefined);
        }, 0);
      });
    }

    const id = nextId.current++;
    return new Promise<EngineAnswer>((resolve) => {
      pending.current.set(id, { resolve, onEvent });
      worker.postMessage({
        kind: "move",
        id,
        fen,
        level,
        log: onEvent !== undefined,
        budgetMs,
        history: history ? [...history] : undefined,
      } satisfies ChessMoveRequest);
    }).then((answer) => answer.uci);
  }, []);

  return { think, advise };
}

/** What a worker job comes back with: a move, a draw verdict, or neither on failure. */
interface EngineAnswer {
  uci?: string;
  accept?: boolean;
}

export function GameChessView({ bestScore }: { bestScore: number }) {
  const [game, setGame] = useState<ChessGame | undefined>(undefined);
  const [level, setLevel] = useState<ChessLevel>("intermediate");
  const [colorChoice, setColorChoice] = useState<ColorChoice>("w");
  const [timeControl, setTimeControl] = useState<ChessTimeControl>("untimed");

  const [selected, setSelected] = useState<number | undefined>(undefined);
  const [promotion, setPromotion] = useState<{ from: number; to: number } | undefined>(undefined);
  const [hint, setHint] = useState<{ from: number; to: number } | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [soundOn, setSoundOn] = useState(true);

  const [resume, setResume] = useState<{ savedAt: string; game: ChessGame } | undefined>(undefined);
  const [saves, setSaves] = useState<ChessSaveSummary[]>([]);
  const [dialog, setDialog] = useState<"save" | "load" | "resign" | "pgn" | undefined>(undefined);
  /** The save the player picked while a game was still running, pending confirmation. */
  const [pendingLoad, setPendingLoad] = useState<number | undefined>(undefined);
  const [saveName, setSaveName] = useState("");
  const [pgn, setPgn] = useState("");
  const [analysing, setAnalysing] = useState(false);
  /**
   * Which way the board is drawn, when the player has asked for something other than
   * their own side. Undefined means "follow my colour", so starting a game as Black
   * still turns the board round without anybody pressing anything.
   */
  const [flipped, setFlipped] = useState<ChessColor | undefined>(undefined);
  /**
   * The move being looked back at, or undefined when watching the live game.
   *
   * A ply index, not a position: the position is derived from it, so there is never a
   * stored board that could disagree with the move list.
   */
  const [reviewPly, setReviewPly] = useState<number | undefined>(undefined);
  /**
   * What a screen reader is told after each of the computer's moves.
   *
   * The board is sixty-four buttons, so somebody reading it has no way to notice that
   * one of them changed. A live region is the only thing that says "the computer
   * played Nf3" without their having to go looking for it.
   */
  const [spoken, setSpoken] = useState("");
  /** The player's record against each level, shown before they pick one. */
  const [records, setRecords] = useState<ChessRecord[]>([]);
  /*
    Set when a search comes back with no move at all.

    Without it the panel says "The computer is thinking…" for ever, because thinking is
    derived from whose turn it is and it is still, correctly, the computer's. The board
    genuinely cannot continue, so the honest thing is to stop claiming it is working on
    it. Cleared whenever a new position arrives to think about.
  */
  const [engineFailed, setEngineFailed] = useState(false);

  // The machine log. Off by default, and while it is off **nothing is narrated at all** —
  // no listener reaches the engine, so no events are built. Entries survive the switch
  // being turned off (so a log is not lost by a stray click) and are cleared by Clear.
  /*
    The two learning aids, both off so the board is unchanged for anyone who has not
    asked for them.

    One state object rather than two booleans: they are written together, read from one
    stored value, and restoring them is a single update instead of two cascading ones.
  */
  const [boardHelp, setBoardHelp] = useState<{ moves: boolean; influence: boolean }>({
    moves: false,
    influence: false,
  });
  const showMoves = boardHelp.moves;
  const showInfluence = boardHelp.influence;

  const [logOn, setLogOn] = useState(false);
  const [log, setLog] = useState<ChessLogEntry[]>([]);
  const logKey = useRef(0);

  const sounds = useSounds(soundOn);
  const { think, advise } = useChessEngine();

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
  const thinking = replyKey !== "" && !engineFailed;

  /*
    The score, also derived: `scoreChessGame` is a pure function of a finished game, so
    storing it would be keeping a second copy of something already on screen. The effect
    further down only does the things that genuinely are side effects — posting it,
    clearing the autosave, playing a sound — and a ref keeps those to once per ending.
  */
  const scored = game && over ? scoreChessGame(game) : undefined;
  const settled = useRef<string | undefined>(undefined);

  /*
    When the side to move started thinking, as a wall-clock reading.

    **State, not a ref, and it is set from handlers rather than from an effect.** Every
    moment the turn changes is already an event — a move played, a game begun, a game
    resumed — so the stopwatch is reset there. A ref would not re-render the clock when
    it moved, and an effect would be setting state synchronously in an effect body.

    It is pushed *forward* while a dialog is open (see `pauseClock`) rather than keeping
    a separate paused total, so the time spent is always `now - turnStartedAt` with
    nothing to subtract.
  */
  const [turnStartedAt, setTurnStartedAt] = useState(() => Date.now());
  const toMove = game && !over ? game.position.turn : undefined;

  /** How long the side to move has been thinking, right now. */
  const spentMs = () => Date.now() - turnStartedAt;

  /**
   * Holds the clock still while a dialog is open.
   *
   * Save, Load and PGN are not moves, and a player reading their own save list should
   * not be losing a blitz game while they do it. Resign and the promotion picker are
   * deliberately **not** paused: resigning ends the game anyway, and choosing which
   * piece a pawn becomes is part of making the move.
   */
  function pauseClock(close: () => void) {
    const pausedFrom = Date.now();
    close();
    setTurnStartedAt((at) => at + (Date.now() - pausedFrom));
  }

  /**
   * The remembered aid switches.
   *
   * Read after mount rather than in the initial state, because `localStorage` does not
   * exist on the server and reading it during the first render would hydrate differently.
   * Same pattern, and the same lint exemption, as the Arcade's Cards/List switch.
   */
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(PREFERENCES_KEY);
      if (!stored) return;
      const saved = JSON.parse(stored) as ChessPreferences;

      /* eslint-disable react-hooks/set-state-in-effect -- see above. */
      if (saved.level && CHESS_LEVELS.includes(saved.level)) setLevel(saved.level);
      if (saved.color === "w" || saved.color === "b" || saved.color === "random") {
        setColorChoice(saved.color);
      }
      if (saved.timeControl && CHESS_TIME_CONTROLS.includes(saved.timeControl)) {
        setTimeControl(saved.timeControl);
      }
      if (typeof saved.sound === "boolean") setSoundOn(saved.sound);
      if (typeof saved.log === "boolean") setLogOn(saved.log);
      setBoardHelp({ moves: saved.moves === true, influence: saved.influence === true });
      /* eslint-enable react-hooks/set-state-in-effect */
    } catch {
      // Storage blocked or the value is damaged: everything stays at its default.
    }
  }, []);

  /**
   * Writes the whole set, taking whichever field changed.
   *
   * Called from the handler that changed it rather than from an effect watching all
   * six — an effect would also fire on the restore above and write back what it had
   * just read.
   */
  function remember(change: ChessPreferences) {
    const updated: ChessPreferences = {
      level,
      color: colorChoice,
      timeControl,
      sound: soundOn,
      log: logOn,
      moves: boardHelp.moves,
      influence: boardHelp.influence,
      ...change,
    };
    try {
      window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(updated));
    } catch {
      // Storage blocked — the choice just does not persist.
    }
  }

  /** Flips one aid and remembers both, since they share a single stored value. */
  function changeBoardHelp(next: { moves?: boolean; influence?: boolean }) {
    const updated = {
      moves: next.moves ?? boardHelp.moves,
      influence: next.influence ?? boardHelp.influence,
    };
    setBoardHelp(updated);
    remember(updated);
  }

  /** The autosave and the record, both read once when the game is opened. */
  useEffect(() => {
    let live = true;
    void loadChessAutosaveAction().then((result) => {
      if (live && result.ok && result.run) setResume(result.run);
    });
    void listChessRecordsAction().then((result) => {
      if (live && result.ok) setRecords(result.records);
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

    // Read once, when the search starts: switching the log on mid-search takes effect
    // from the next move, because the search in flight has already been told whether to
    // narrate.
    const narrate = logOn ? narrator(game) : undefined;
    // The computer rations its remaining time rather than always spending its level's
    // full budget, which in a one-minute game would flag it long before the board did.
    const budget = chessSearchBudgetMs(
      game.clock,
      game.position.turn,
      CHESS_LEVEL_SETUP[game.level].timeMs,
    );

    // The repetition keys travel with the request, so the computer can see a draw
    // coming instead of walking into one from a winning position.
    void think(
      toFen(game.position),
      game.level,
      narrate,
      budget,
      game.repetitionKeys,
    ).then(async (uci) => {
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
        setEngineFailed(true);
        setNotice(
          "The computer could not work out a move. Take the last move back, or start a new game.",
        );
        return;
      }

      // Played against the game this effect was started for, not against a functional
      // update. Anything that changes the game also changes `replyKey`, which runs this
      // effect's cleanup and clears `live` — so a reply for a position the player has
      // since left never gets here. Doing it in a `setGame` updater would mean making
      // sounds and setting state from inside a reducer, which React may run twice.
      // Charged with the real time the search took, measured here — the same count the
      // ticking display has been showing, so what the player watched is what is deducted.
      const played = playChessMove(game, uci, { elapsedMs: spentMs() });
      if (!played.ok) return;
      setGame(played.game);
      setTurnStartedAt(Date.now());
      setEngineFailed(false);
      setSpoken(`The computer played ${played.san}.`);
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
    const points = scoreChessGame(game);
    void saveScoreAction(GAME_KEY, points, game.moves.length);

    /*
      And the result, which the scoreboard cannot recover from that score: a loss, a
      draw and a win with enough hints charged against it all post 0. Recorded after
      the score and refreshed afterwards, so returning to the setup screen shows a
      record that already counts the game just finished.
    */
    const outcome = chessResultOf(game);
    if (outcome) {
      void recordChessResultAction(game.level, outcome, chessFullMoves(game), points).then(() =>
        listChessRecordsAction().then((result) => {
          if (result.ok) setRecords(result.records);
        }),
      );
    }
  }, [game, over, sounds]);

  /**
   * The clock has run out for whoever is to move.
   *
   * Called by the ticker below, which is the only thing watching: a player who simply
   * stops moving never calls `playChessMove`, so nothing else would ever notice.
   */
  function flag(color: ChessColor) {
    if (!game) return;
    const flagged = flagChessGame(game, color);
    setGame(flagged);
    setNotice(describeChessResult(flagged));
  }

  /** Appends one line to the machine log. Only ever called from a callback or handler. */
  function pushLog(item: ChessLogItem) {
    const key = logKey.current++;
    // Capped, so a long game cannot grow the list without limit.
    setLog((current) => [...current.slice(-299), { key, item }]);
  }

  /**
   * The listener handed to the engine: each search opens with a heading naming whose
   * move it is, then every event the engine reports is appended as it arrives.
   */
  function narrator(forGame: ChessGame): (event: ChessThinkingEvent) => void {
    const move = forGame.position.fullmoveNumber;
    const side = forGame.position.turn === "w" ? "White" : "Black";
    return (event) => {
      if (event.kind === "start") {
        pushLog({ kind: "heading", text: `${event.label} · move ${move} (${side})` });
      }
      pushLog(event);
    };
  }

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
    setAnalysing(false);
    setEngineFailed(false);
    setReviewPly(undefined);
    setFlipped(undefined);
    setSpoken("");
    setTurnStartedAt(Date.now());
    setSelected(undefined);
    setPromotion(undefined);
    setHint(undefined);
    setNotice(undefined);
    setDialog(undefined);
  }

  /**
   * Starts a game from pasted text or a puzzle.
   *
   * The level and the colour come from the pickers above it, except that a pasted
   * position decides its own side to move — somebody setting up a puzzle is nearly
   * always about to play the side that is to move in it.
   */
  function startImported(text: string): string | undefined {
    const result = looksLikeChessPgn(text)
      ? importChessPgn(text, { level })
      : importChessFen(text, { level });

    if (!result.ok) return result.reason;

    void discardChessAutosaveAction();
    setResume(undefined);
    beginGame(result.game);
    return undefined;
  }

  function startNew() {
    const color: ChessColor =
      colorChoice === "random" ? (Math.random() < 0.5 ? "w" : "b") : colorChoice;
    void discardChessAutosaveAction();
    setResume(undefined);
    beginGame(startChessGame({ humanColor: color, level, timeControl }));
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
    squarePressedFrom(selected, square);
  }

  /**
   * A piece dropped on a square — the same intent as tapping it and then the target.
   *
   * Routed through the tap handler rather than given its own rules, so a drag can
   * never become a second, subtly different way to make a move: it picks the piece up
   * and puts it down, and promotion, illegal targets and the rest behave identically.
   */
  function dragMove(from: number, to: number) {
    if (!game || reviewing || over || !humanTurn || thinking) return;
    const piece = game.position.board[from];
    if (!piece || piece.color !== game.humanColor) return;

    setSelected(from);
    squarePressedFrom(from, to);
  }

  /**
   * The second half of a move, given both squares. Shared by tapping and dragging, so
   * the two can never become subtly different ways to play.
   */
  function squarePressedFrom(from: number, to: number) {
    if (!game) return;

    const moves = chessMovesFrom(game, from).filter((move) => move.to === to);
    if (moves.length === 0) {
      setSelected(undefined);
      return;
    }

    // Four moves share this from-and-to when a pawn reaches the last rank, and only the
    // player can say which piece they want.
    if (moves.some((move) => move.promotion)) {
      setPromotion({ from, to });
      return;
    }

    playHuman(moveToUci(moves[0]!));
  }

  function playHuman(uci: string) {
    if (!game) return;
    const played = playChessMove(game, uci, { elapsedMs: spentMs() });
    if (!played.ok) {
      setNotice(played.reason);
      return;
    }
    setSelected(undefined);
    setPromotion(undefined);
    setGame(played.game);
    setTurnStartedAt(Date.now());
    setEngineFailed(false);
    // Playing returns to the live board: reviewing and moving are different things to
    // be doing, and a move landing while you look at move 12 would be bewildering.
    setReviewPly(undefined);
    announce(played.game, played.san);
  }

  function choosePromotion(piece: ChessPromotionType) {
    if (!promotion) return;
    playHuman(`${squareName(promotion.from)}${squareName(promotion.to)}${piece}`);
  }

  function takeBack() {
    if (!game) return;
    setEngineFailed(false);
    setGame(undoChessMove(game));
    setSelected(undefined);
    setHint(undefined);
    setNotice(undefined);
  }

  async function showHint() {
    if (!game || over || !humanTurn) return;
    setBusy(true);

    // Run in the worker, so a Beginner game asking for Advanced-strength advice does
    // not freeze the board for two and a half seconds.
    const answer = await advise(
      "hint",
      toFen(game.position),
      game.humanColor,
      logOn ? narrator(game) : undefined,
    );
    setBusy(false);

    if (!answer.uci) {
      setNotice("The computer could not suggest a move.");
      return;
    }

    const from = squareFromName(answer.uci.slice(0, 2));
    const to = squareFromName(answer.uci.slice(2, 4));
    if (from < 0 || to < 0) return;

    // Counted against the score: Hint searches at Advanced strength whatever level this
    // game is, so a free one would make the scoreboard meaningless.
    setGame(recordChessHint(game));
    setHint({ from, to });
    setNotice(`Try ${squareName(from)}–${squareName(to)}.`);
  }

  async function offerDraw() {
    if (!game || over) return;
    setBusy(true);

    const answer = await advise(
      "draw",
      toFen(game.position),
      game.humanColor,
      logOn ? narrator(game) : undefined,
    );
    setBusy(false);

    if (answer.accept) {
      const drawn = agreeChessDraw(game);
      setGame(drawn);
      setNotice(describeChessResult(drawn));
      return;
    }
    setNotice("The computer declines the draw.");
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
    /*
      A game in progress is about to be replaced by another one, and the autosave only
      holds one game — so without this the game on screen is simply gone. A finished
      game has nothing left to lose, so it loads straight away.
    */
    if (game && !over && game.moves.length > 0) {
      setPendingLoad(id);
      return;
    }
    await loadGameNow(id);
  }

  async function loadGameNow(id: number) {
    setPendingLoad(undefined);
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
        records={records}
        onImport={startImported}
        level={level}
        onLevel={(next) => {
          setLevel(next);
          remember({ level: next });
        }}
        colorChoice={colorChoice}
        onColor={(next) => {
          setColorChoice(next);
          remember({ color: next });
        }}
        timeControl={timeControl}
        onTimeControl={(next) => {
          setTimeControl(next);
          remember({ timeControl: next });
        }}
        onStart={startNew}
        onResume={resume ? () => beginGame(resume.game) : undefined}
        resumeAt={resume?.savedAt}
        onLoad={openLoad}
        bestScore={bestScore}
      />
    );
  }

  /*
    The analysis takes over the screen instead of opening in a dialog.

    A nested `Modal` was the obvious call and is the wrong one: the game already runs
    inside the Arcade's full-bleed dialog, and two stacked dialogs share Escape and the
    focus trap — the same reason the Bridge board's result panel is a plain div. There
    is nothing to lose by replacing the board, because analysis is only offered once the
    game is over.
  */
  if (analysing) {
    return <ChessAnalysisView game={game} onBack={() => setAnalysing(false)} />;
  }

  const targets = selected === undefined ? [] : chessMoveTargets(game, selected);

  /*
    Both aids are computed only while their switch is on, and both are cheap: the move
    options come from one walk of the legal move list the board already generates, and
    the influence map is 128 `isSquareAttacked` calls over a position that is not moving.
    Neither runs at all with the switches off, which is what keeps this free by default.
  */
  const options = showMoves ? chessPlayerOptions(game) : undefined;
  const influence = showInfluence ? chessInfluence(game) : undefined;
  const checked = chessCheckedKingSquare(game);

  /*
    Reviewing an earlier move draws that position instead of the live one.

    Everything else on the board stands down while it does: no selection, no legal-move
    dots, no check glow, no learning aids — they all describe a position that is not
    the one being shown, and leaving them on would be actively misleading. The board is
    disabled too, so there is no way to try to move in the past.
  */
  const reviewing = reviewPly !== undefined;
  const review = reviewing ? chessPositionAtPly(game, reviewPly) : undefined;
  const shown = review?.position ?? game.position;
  const lastMove = review ? review.lastMove : lastMoveSquares(game);

  /** Which way up the board is drawn: the player's own side unless they asked. */
  const orientation = flipped ?? game.humanColor;

  /** The move to slide in — never while reviewing, where nothing was just played. */
  const animate = reviewing ? undefined : lastMove;

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex gap-6 max-lg:flex-col max-lg:gap-4">
        {/*
          The board takes the width it can and stays square, but is also **capped by
          the window height**: a square that grows with the column alone runs off the
          bottom of a short, wide window, and the controls under it go with it. Tying
          the maximum width to `dvh` is what keeps the whole thing on screen —
          `dvh` rather than `vh` because Safari's collapsing URL bar makes `vh` lie.

          `min-w-0` so a long move list in the panel beside it can never squeeze it.
        */}
        <div className="flex min-w-0 flex-1 flex-col items-center">
          <div className="w-full max-w-[min(100%,calc(100dvh-15rem))] max-lg:max-w-full">
          {game.clock && (
            <ChessClockRow
              // Keyed on the turn, so each turn gets a fresh row whose stopwatch starts
              // at zero — cheaper and less error-prone than resetting it by hand.
              key={turnStartedAt}
              game={game}
              color={oppositeColor(game.humanColor)}
              toMove={toMove}
              startedAt={turnStartedAt}
              onFlag={flag}
            />
          )}
          <ChessBoard
            squares={shown.board}
            orientation={orientation}
            selected={reviewing ? undefined : selected}
            targets={reviewing ? [] : targets}
            lastMove={lastMove}
            checkSquare={!reviewing && checked >= 0 ? checked : undefined}
            hint={reviewing ? undefined : hint}
            reachable={reviewing ? undefined : options?.reachable}
            movable={reviewing ? undefined : options?.movable}
            influence={reviewing ? undefined : influence}
            animate={animate}
            onSquare={squarePressed}
            onDragMove={dragMove}
            disabled={reviewing || over || !humanTurn || thinking || busy}
          />
          {game.clock && (
            <ChessClockRow
              key={turnStartedAt}
              game={game}
              color={game.humanColor}
              toMove={toMove}
              startedAt={turnStartedAt}
              onFlag={flag}
            />
          )}
          </div>

          <MoveReview
            game={game}
            ply={reviewPly}
            onPly={setReviewPly}
            orientation={orientation}
            onFlip={() => setFlipped(oppositeColor(orientation))}
          />

          {/*
            What a screen reader is told. Off-screen rather than hidden, because
            `display: none` takes a live region out of the accessibility tree and it
            then announces nothing at all.
          */}
          <p className="sr-only" role="status" aria-live="polite">
            {spoken}
          </p>
        </div>

        <ChessPanel
          game={game}
          thinking={thinking}
          notice={notice}
          scored={scored}
          bestScore={bestScore}
          showMoves={showMoves}
          showInfluence={showInfluence}
          onBoardHelp={changeBoardHelp}
          logOn={logOn}
          onLogOn={(next) => {
            setLogOn(next);
            remember({ log: next });
          }}
          log={log}
          onClearLog={() => setLog([])}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={takeBack}
          disabled={!canUndoChessMove(game) || thinking || busy}
          title={game.clock ? "Takebacks are off in a timed game" : undefined}
        >
          Undo
        </Button>
        <Button size="sm" variant="secondary" onClick={() => void showHint()} disabled={over || !humanTurn || thinking || busy}>
          Hint
        </Button>
        <Button size="sm" variant="secondary" onClick={() => void offerDraw()} disabled={over || thinking || busy}>
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
        {/* Only once the game is over: mid-game this would be a stronger Hint with
            extra steps, and the game already has a Hint. */}
        {over && (
          <Button size="sm" variant="secondary" onClick={() => setAnalysing(true)}>
            Analyse game
          </Button>
        )}
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
          /*
            Back to the setup screen, with the Resume offer **re-read** rather than
            cleared.

            Clearing it was wrong: the autosave is still on the server, so the game the
            player just stepped away from was recoverable and the setup screen was
            hiding that. Re-reading also catches the opposite case — a finished game
            whose autosave was deleted — so the offer matches what is actually stored
            either way.
          */
          onClick={() => {
            setGame(undefined);
            void loadChessAutosaveAction().then((result) => {
              if (result.ok) setResume(result.run);
            });
          }}
          disabled={busy}
        >
          New game
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            const next = !soundOn;
            setSoundOn(next);
            remember({ sound: next });
          }}
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
          // Closing a dialog hands the clock back the time it was open for. Reading your
          // own save list is not thinking about the position.
          onClose={() => pauseClock(() => setDialog(undefined))}
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
        <Modal title="Saved games" onClose={() => pauseClock(() => setDialog(undefined))}>
          <ChessSaveList saves={saves} onLoad={(id) => void loadGame(id)} onDelete={(id) => void removeSave(id)} />
        </Modal>
      )}

      {pendingLoad !== undefined && (
        <Modal
          title="Replace the game you are playing?"
          description="Your current game is autosaved, but the autosave only holds one game — loading another will overwrite it."
          onClose={() => pauseClock(() => setPendingLoad(undefined))}
          footer={
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => pauseClock(() => setPendingLoad(undefined))}
              >
                Keep playing
              </Button>
              <Button size="sm" onClick={() => void loadGameNow(pendingLoad)}>
                Load anyway
              </Button>
            </div>
          }
        >
          <p className="text-sm text-muted">
            Save this game under a name first if you want to come back to it.
          </p>
        </Modal>
      )}

      {dialog === "pgn" && (
        <Modal
          title="PGN"
          description="Paste this into any chess program or analysis board."
          onClose={() => pauseClock(() => setDialog(undefined))}
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

/** One level's record, or an empty one when nothing has been played against it. */
function recordFor(records: readonly ChessRecord[], level: ChessLevel): ChessRecord {
  return (
    records.find((record) => record.level === level) ?? {
      level,
      wins: 0,
      losses: 0,
      draws: 0,
    }
  );
}

/** Whether a player has any recorded games at all, for the note on the setup screen. */
function hasAnyChessRecord(records: readonly ChessRecord[]): boolean {
  return records.some((record) => chessRecordGames(record) > 0);
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
  records,
  onImport,
  level,
  onLevel,
  colorChoice,
  onColor,
  timeControl,
  onTimeControl,
  onStart,
  onResume,
  resumeAt,
  onLoad,
  bestScore,
}: {
  /** The player's record against each level, in level order. */
  records: ChessRecord[];
  /** Returns a reason when the text could not be read, or nothing on success. */
  onImport: (text: string) => string | undefined;
  level: ChessLevel;
  onLevel: (level: ChessLevel) => void;
  colorChoice: ColorChoice;
  onColor: (choice: ColorChoice) => void;
  timeControl: ChessTimeControl;
  onTimeControl: (control: ChessTimeControl) => void;
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
                {/* The record against this level, so the choice is made knowing how it
                    has actually gone rather than from the description alone. */}
                <span className="mt-1 block text-xs text-brass-dark">
                  Your record: {formatChessRecord(recordFor(records, key))}
                </span>
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

      <div>
        <h3 className="font-display text-base text-ink">Clock</h3>
        {/* A collection of six short chips, so it wraps rather than needing a column
            count per breakpoint. */}
        <div className="mt-2 flex flex-wrap gap-2">
          {CHESS_TIME_CONTROLS.map((control) => (
            <Button
              key={control}
              size="sm"
              variant={control === timeControl ? "primary" : "secondary"}
              onClick={() => onTimeControl(control)}
              ariaPressed={control === timeControl}
              title={CHESS_TIME_CONTROL_SETUP[control].hint}
            >
              {CHESS_TIME_CONTROL_SETUP[control].label}
            </Button>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted">
          {CHESS_TIME_CONTROL_SETUP[timeControl].hint}
          {timeControl !== "untimed" && " Running out of time loses, and Undo is off."}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onStart}>New game</Button>
        <Button variant="secondary" onClick={onLoad}>
          Load a saved game
        </Button>
      </div>

      {!hasAnyChessRecord(records) && (
        <p className="text-xs text-muted">
          Your record starts from now — games played before this was added were not
          recorded.
        </p>
      )}

      <ChessImport onImport={onImport} />

      {bestScore > 0 && (
        <p className="text-xs text-muted">Best score on this board: {bestScore.toLocaleString()} pts.</p>
      )}
    </div>
  );
}

/**
 * Setting up from a position or a game, and the practice positions.
 *
 * Collapsed by default: most games start from the opening, and this is a box of text
 * nobody needs to see to press New game. One field takes **either** a FEN or a PGN
 * rather than asking which — `looksLikeChessPgn` can tell them apart, and making
 * somebody classify their own clipboard is a question with an obvious answer.
 */
function ChessImport({ onImport }: { onImport: (text: string) => string | undefined }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);

  function run(value: string) {
    const reason = onImport(value);
    setError(reason);
    if (!reason) setText("");
  }

  return (
    <CollapsibleCard title="Set up a position" defaultOpen={false}>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Paste a position (FEN) or a game (PGN)</span>
          <textarea
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setError(undefined);
            }}
            rows={4}
            spellCheck={false}
            placeholder={"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1\n\nor\n\n1. e4 e5 2. Nf3 Nc6"}
            className="w-full rounded-md border border-line bg-paper px-3 py-2 font-mono text-xs text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
          />
        </label>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <div>
          <Button size="sm" onClick={() => run(text)} disabled={text.trim() === ""}>
            Set up this position
          </Button>
        </div>

        <div>
          <h4 className="text-xs uppercase tracking-wide text-muted">Practice positions</h4>
          <ul className="mt-1 flex flex-col gap-1">
            {CHESS_PUZZLES.map((puzzle) => (
              <li key={puzzle.id}>
                <button
                  type="button"
                  onClick={() => run(puzzle.fen)}
                  className="w-full rounded px-2 py-1 text-left hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
                >
                  <span className="block text-sm text-ink">{puzzle.name}</span>
                  <span className="block text-xs text-muted">{puzzle.goal}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </CollapsibleCard>
  );
}

/** Whose turn it is, what just happened, the move list and the pieces taken. */
function ChessPanel({
  game,
  thinking,
  notice,
  scored,
  bestScore,
  showMoves,
  showInfluence,
  onBoardHelp,
  logOn,
  onLogOn,
  log,
  onClearLog,
}: {
  game: ChessGame;
  thinking: boolean;
  notice?: string;
  scored?: number;
  bestScore: number;
  showMoves: boolean;
  showInfluence: boolean;
  onBoardHelp: (next: { moves?: boolean; influence?: boolean }) => void;
  logOn: boolean;
  onLogOn: (on: boolean) => void;
  log: ChessLogEntry[];
  onClearLog: () => void;
}) {
  const over = isChessGameOver(game);
  const computerColor = oppositeColor(game.humanColor);
  // Open on a desktop, where there is room beside the board, and closed on a phone,
  // where it would push the board's controls a long way down. Only the first visit's
  // default: `CollapsibleCard` remembers whatever the reader chooses after that.
  const compact = useIsCompact();

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

      <CollapsibleCard title="Board help" defaultOpen={false}>
        <BoardHelp
          showMoves={showMoves}
          showInfluence={showInfluence}
          onChange={onBoardHelp}
          humanTurn={isHumanTurn(game)}
        />
      </CollapsibleCard>

      <CollapsibleCard title="Messages" defaultOpen={!compact}>
        <MachineLog
          on={logOn}
          onToggle={onLogOn}
          entries={log}
          thinking={thinking}
          onClear={onClearLog}
        />
      </CollapsibleCard>
    </aside>
  );
}

/**
 * One side's clock, above or below the board.
 *
 * It re-renders itself ten times a second **only while it is the running side**, so an
 * untimed game and the idle half of a timed one cost nothing. The countdown shown is
 * the banked time less what this turn has spent so far; what is actually deducted
 * happens in the library when the move lands, so a throttled tab can make the display
 * stutter but cannot change the result.
 */
function ChessClockRow({
  game,
  color,
  toMove,
  startedAt,
  onFlag,
}: {
  game: ChessGame;
  color: ChessColor;
  toMove?: ChessColor;
  /** When this turn began, as a wall-clock reading. Owned by the board. */
  startedAt: number;
  onFlag: (color: ChessColor) => void;
}) {
  const running = toMove === color;

  /*
    How long this turn has run, updated by the ticker rather than read during render.

    `Date.now()` in the render body is an impure call: React may re-render this
    component for reasons that have nothing to do with the clock, and it would then show
    a different time each pass with no state behind it. Keeping it in the interval
    callback means the figure on screen is always one that was deliberately recorded.

    It starts at 0 and the parent remounts this row each turn (see its `key`), so there
    is nothing to reset. The display can be up to one tick stale, which at 100ms is
    invisible — and nothing here decides the game anyway: the real deduction happens in
    the library when the move lands.
  */
  const [spent, setSpent] = useState(0);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setSpent(Date.now() - startedAt), 100);
    return () => clearInterval(timer);
  }, [running, startedAt]);

  const clock = game.clock;
  const remaining = clock ? chessClockReading(clock, color, running ? spent : 0) : 0;

  /*
    The flag is raised from an effect rather than during render, because it sets state
    on the parent. It fires once: the moment it lands the game is over, `toMove` is
    undefined, and this stops being the running side.
  */
  useEffect(() => {
    if (running && remaining <= 0) onFlag(color);
  }, [running, remaining, color, onFlag]);

  const urgent = isChessClockUrgent(remaining);
  const label = color === game.humanColor ? "You" : "Computer";

  return (
    <div
      className={`mb-2 flex items-center justify-between rounded-lg border px-3 py-1.5 last:mb-0 last:mt-2 ${
        running ? "border-brass bg-brass-soft" : "border-line bg-paper-raised"
      }`}
    >
      <span className="text-xs uppercase tracking-wide text-muted">{label}</span>
      <span
        className={`font-display text-lg tabular-nums ${urgent ? "text-red-400" : "text-ink"}`}
        // Read out only when it matters, so a screen reader is not told the time ten
        // times a second for the whole game.
        aria-live={running && urgent ? "polite" : "off"}
      >
        {formatChessClock(remaining)}
      </span>
    </div>
  );
}

/**
 * The two learning aids, and what each one draws.
 *
 * Both are for the player's side only. The computer is given no help, and neither aid
 * shows anything that is not already on the board — the influence map is worked out
 * from the pieces in front of you, so it cannot leak what the computer is planning.
 */
function BoardHelp({
  showMoves,
  showInfluence,
  onChange,
  humanTurn,
}: {
  showMoves: boolean;
  showInfluence: boolean;
  onChange: (next: { moves?: boolean; influence?: boolean }) => void;
  humanTurn: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={showMoves}
            onChange={(event) => onChange({ moves: event.target.checked })}
            className="h-4 w-4 accent-brass"
          />
          Show valid moves
        </label>
        <p className="mt-0.5 pl-6 text-xs text-muted">
          Outlines every piece of yours that can move, and tints every square you could
          move one to. Picking a piece up still shows that piece&rsquo;s own moves as dots.
        </p>
      </div>

      <div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={showInfluence}
            onChange={(event) => onChange({ influence: event.target.checked })}
            className="h-4 w-4 accent-brass"
          />
          Show sphere of influence
        </label>
        <p className="mt-0.5 pl-6 text-xs text-muted">
          A corner mark on every square showing who controls it:{" "}
          <span className="font-semibold text-emerald-400">green</span> where you attack or
          defend, <span className="font-semibold text-red-400">red</span> where the computer
          does, both where it is contested. A square with only a red mark is one you should
          usually not move to.
        </p>
      </div>

      {showMoves && !humanTurn && (
        <p className="text-xs text-muted">
          Valid moves are hidden while it is the computer&rsquo;s turn.
        </p>
      )}
    </div>
  );
}

/**
 * Stepping back through the game, and turning the board round.
 *
 * Shown under the board rather than in the side panel because both controls are about
 * the board itself. It disappears entirely on a game with no moves, where every button
 * on it would be dead.
 *
 * `ply` is `undefined` while watching the live game, which is deliberately not the
 * same as "at the last move": a game still being played moves on, and pinning the
 * review to the final ply would quietly stop following it.
 */
function MoveReview({
  game,
  ply,
  onPly,
  orientation,
  onFlip,
}: {
  game: ChessGame;
  ply?: number;
  onPly: (ply: number | undefined) => void;
  orientation: ChessColor;
  onFlip: () => void;
}) {
  const total = game.moves.length;
  const at = ply ?? total;
  const reviewing = ply !== undefined;

  /** Moves to a ply, dropping back to the live board when it reaches the end. */
  function go(next: number) {
    const clamped = Math.max(0, Math.min(total, next));
    onPly(clamped >= total ? undefined : clamped);
  }

  return (
    <div className="mt-2 flex w-full flex-wrap items-center justify-center gap-2">
      <Button
        size="sm"
        variant="secondary"
        onClick={() => go(0)}
        disabled={total === 0 || at === 0}
        ariaLabel="Go to the start of the game"
      >
        &laquo;
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => go(at - 1)}
        disabled={total === 0 || at === 0}
        ariaLabel="Previous move"
      >
        &lsaquo;
      </Button>

      <span className="min-w-28 text-center text-xs text-muted" aria-live="polite">
        {total === 0
          ? "No moves yet"
          : reviewing
            ? `Move ${at} of ${total}`
            : "Live"}
      </span>

      <Button
        size="sm"
        variant="secondary"
        onClick={() => go(at + 1)}
        disabled={!reviewing}
        ariaLabel="Next move"
      >
        &rsaquo;
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => onPly(undefined)}
        disabled={!reviewing}
        ariaLabel="Back to the current position"
      >
        &raquo;
      </Button>

      <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />

      <Button
        size="sm"
        variant="secondary"
        onClick={onFlip}
        ariaLabel={`Turn the board round — currently ${orientation === "w" ? "White" : "Black"} at the bottom`}
      >
        Flip
      </Button>
    </div>
  );
}

/** One line of the machine log: an engine event, or a heading the view adds. */
type ChessLogItem = ChessThinkingEvent | { kind: "heading"; text: string };

interface ChessLogEntry {
  key: number;
  item: ChessLogItem;
}

/** Milliseconds as a person reads them: `412 ms`, `0.9s`. */
function formatElapsed(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** A node count, abbreviated: `880`, `9.1k`, `1.2M`. */
function formatNodes(nodes: number): string {
  if (nodes < 1000) return String(nodes);
  if (nodes < 1_000_000) return `${(nodes / 1000).toFixed(1)}k`;
  return `${(nodes / 1_000_000).toFixed(1)}M`;
}

/**
 * The Messages card's contents: the "See machine log" switch and, when it is on, what
 * the computer reported while it thought.
 *
 * Presentation only. Every line was written by the engine (`ChessThinkingEvent`) and is
 * laid out here; nothing is computed from the board. With the switch off the engine is
 * never asked to narrate, so this is an empty prompt and not a hidden list.
 */
function MachineLog({
  on,
  onToggle,
  entries,
  thinking,
  onClear,
}: {
  on: boolean;
  onToggle: (on: boolean) => void;
  entries: ChessLogEntry[];
  thinking: boolean;
  onClear: () => void;
}) {
  const listRef = useRef<HTMLOListElement>(null);

  // Keeps the newest line in view as the search deepens. DOM only — no state is set.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [entries.length, thinking]);

  return (
    <div className="flex flex-col gap-2">
      <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={on}
          onChange={(event) => onToggle(event.target.checked)}
          className="h-4 w-4 accent-brass"
        />
        See machine log
      </label>

      {!on && (
        <p className="text-xs text-muted">
          Turn this on to watch the computer think: the move it is favouring at each depth,
          how many positions it looked at, and how long it took. With it off, nothing is
          recorded.
        </p>
      )}

      {on && (
        <>
          <ol
            ref={listRef}
            className="max-h-64 overflow-auto font-mono text-xs text-ink max-lg:max-h-40"
            aria-live="off"
          >
            {entries.length === 0 && !thinking && (
              <li className="py-0.5 text-muted">Waiting for the computer&rsquo;s next move.</li>
            )}
            {entries.map((entry) => (
              <MachineLogLine key={entry.key} item={entry.item} />
            ))}
            {thinking && <ThinkingTicker />}
          </ol>
          <div className="flex justify-end">
            <button
              type="button"
              className="text-xs text-muted hover:underline"
              onClick={onClear}
              disabled={entries.length === 0}
            >
              Clear
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function MachineLogLine({ item }: { item: ChessLogItem }) {
  switch (item.kind) {
    case "heading":
      return (
        <li className="mt-2 border-t border-line pt-1 font-display text-xs text-brass-dark first:mt-0 first:border-t-0">
          {item.text}
        </li>
      );
    case "start":
      return (
        <li className="py-0.5 text-muted">
          {item.legalMoves} legal moves · up to depth {item.depth} in {formatElapsed(item.budgetMs)}
          {" · "}recapture check {item.quiescence ? "on" : "off"}
        </li>
      );
    case "depth":
      return (
        <li className="py-0.5">
          <span className="text-muted">depth {item.depth}</span> best{" "}
          <strong>{item.san}</strong> {item.scoreText}
          <span className="text-muted">
            {" "}
            · {formatNodes(item.nodes)} positions · {formatElapsed(item.elapsedMs)}
          </span>
        </li>
      );
    case "candidates":
      return (
        <li className="py-0.5">
          <span className="text-muted">top choices </span>
          {item.items.map((entry) => `${entry.san} ${entry.scoreText}`).join(", ")}
        </li>
      );
    case "note":
      return <li className="py-0.5 italic text-muted">{item.text}</li>;
    case "chosen":
      return (
        <li className="py-0.5 font-semibold text-ink">
          Chose {item.san} in {formatElapsed(item.elapsedMs)}
          {item.depth !== undefined && item.nodes !== undefined && (
            <span className="font-normal text-muted">
              {" "}
              (depth {item.depth}, {formatNodes(item.nodes)} positions)
            </span>
          )}
        </li>
      );
  }
}

/**
 * "Thinking… 1.2s", counting up while the computer searches.
 *
 * Its own component so it exists only while there is a search to time: mounting starts the
 * clock from zero and unmounting stops it, which is what lets the count restart on every
 * move with no reset logic. It is a view-side stopwatch — the engine's own elapsed figures
 * are the ones on the lines above it.
 */
function ThinkingTicker() {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const timer = setInterval(() => setElapsed(Date.now() - startedAt), 100);
    return () => clearInterval(timer);
  }, []);

  return (
    <li className="py-0.5 text-brass-dark">Thinking… {formatElapsed(elapsed)}</li>
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
