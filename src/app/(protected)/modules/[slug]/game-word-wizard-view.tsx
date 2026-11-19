"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/button";
import {
  WORD_WIZARD_BLANK,
  WORD_WIZARD_BOT_LEVELS,
  WORD_WIZARD_CENTRE,
  WORD_WIZARD_MAX_NAME_LENGTH,
  WORD_WIZARD_MAX_PLAYERS,
  WORD_WIZARD_MIN_BAG_TO_SWAP,
  WORD_WIZARD_MIN_PLAYERS,
  WORD_WIZARD_SIZE,
  canWordWizardSwap,
  evaluateWordWizardPlay,
  isWordWizardWord,
  parseWordWizardLexicon,
  passWordWizardTurn,
  playWordWizardTiles,
  scoreWordWizard,
  startWordWizard,
  swapWordWizardTiles,
  takeWordWizardBotTurn,
  wordWizardSquareAt,
  wordWizardStandings,
  wordWizardTileValue,
  type WordWizardBotLevel,
  type WordWizardLexicon,
  type WordWizardMode,
  type WordWizardPlacement,
  type WordWizardSquare,
  type WordWizardState,
  type WordWizardTile,
  type WordWizardTurn,
} from "@/lib/games";
import { saveScoreAction } from "./games-actions";

// The Word Wizard table. A client component that owns only presentation state — which
// rack tile is picked up, the tiles laid this turn but not yet played, the rack's
// display order, whether the device has been handed over. Every rule comes from
// @/lib/games (game-word-wizard.ts, word-wizard-bot.ts), so nothing here decides what
// is a legal play, what it scores, or what the bot does.
//
// No `Modal` in here, for the reason the Bridge table gives: the Arcade already plays
// the game inside one. The blank-letter picker, the hand-over screen and the result are
// plain panels.

const GAME_KEY = "word-wizard";

/** Where the word list is served from. A static file, so the browser caches it. */
const WORD_LIST_URL = "/games/word-wizard-words.txt";

/** The bot waits this long before moving, so its play doesn't land the instant yours does. */
const BOT_TURN_MS = 600;

/**
 * One download and one build per page load, shared by every game opened since. The list
 * is 1.6 MB of text; rebuilding the tree each time the dialog reopens would be a visible
 * stall for nothing.
 */
let lexiconPromise: Promise<WordWizardLexicon> | undefined;

function loadLexicon(): Promise<WordWizardLexicon> {
  lexiconPromise ??= fetch(WORD_LIST_URL)
    .then((response) => {
      if (!response.ok) throw new Error(`The word list did not load (${response.status}).`);
      return response.text();
    })
    .then((text) => parseWordWizardLexicon(text))
    .catch((error: unknown) => {
      lexiconPromise = undefined; // let Retry try again
      throw error;
    });
  return lexiconPromise;
}

const LEVEL_LABEL: Record<WordWizardBotLevel, string> = {
  easy: "Easy",
  normal: "Normal",
  hard: "Hard",
};

/**
 * How each bonus square is drawn. Spelled out rather than built from a key, because
 * Tailwind only emits class names it finds as literal text. Letter bonuses are brass,
 * word bonuses ink, and the stronger of each is the deeper tint — always token mixes, so
 * every theme, light or dark, gets its own version.
 */
const SQUARE_STYLE: Record<WordWizardSquare, { className: string; label: string }> = {
  plain: { className: "bg-paper", label: "" },
  "double-letter": { className: "bg-brass/15 text-brass-dark", label: "2L" },
  "triple-letter": { className: "bg-brass/40 text-ink", label: "3L" },
  "double-word": { className: "bg-ink/10 text-muted", label: "2W" },
  "triple-word": { className: "bg-ink/25 text-ink", label: "3W" },
};

const LETTERS = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));

interface Setup {
  mode: WordWizardMode;
  level: WordWizardBotLevel;
  names: string[];
}

const DEFAULT_SETUP: Setup = { mode: "bot", level: "normal", names: ["Player 1", "Player 2"] };

export function GameWordWizardView({ bestScore }: { bestScore: number }) {
  const [lexicon, setLexicon] = useState<WordWizardLexicon | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [setup, setSetup] = useState<Setup>(DEFAULT_SETUP);
  const [setupError, setSetupError] = useState<string | undefined>(undefined);
  const [game, setGame] = useState<WordWizardState | undefined>(undefined);
  const [pending, setPending] = useState<WordWizardPlacement[]>([]);
  const [picked, setPicked] = useState<number | undefined>(undefined);
  const [blankAt, setBlankAt] = useState<{ index: number; tileId: number } | undefined>(undefined);
  const [order, setOrder] = useState<number[]>([]);
  const [swapping, setSwapping] = useState(false);
  const [swapIds, setSwapIds] = useState<ReadonlySet<number>>(new Set());
  const [confirmPass, setConfirmPass] = useState(false);
  const [message, setMessage] = useState<string | undefined>(undefined);
  // Pass-and-play: the history length at which the current player last revealed their
  // tiles. While it lags behind the game, the rack is hidden behind a hand-over screen.
  const [revealedAt, setRevealedAt] = useState(-1);
  const [saved, setSaved] = useState<{ best: boolean } | undefined>(undefined);
  const savedRef = useRef(false);

  const [loadAttempt, setLoadAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    loadLexicon().then(
      (loaded) => {
        if (live) setLexicon(loaded);
      },
      (error: unknown) => {
        if (live) setLoadError(error instanceof Error ? error.message : "The word list did not load.");
      },
    );
    return () => {
      live = false;
    };
  }, [loadAttempt]);

  const isWord = useMemo(
    () => (word: string) => (lexicon ? isWordWizardWord(lexicon, word) : false),
    [lexicon],
  );

  // The bot's turn, on a timer. `takeWordWizardBotTurn` plays, swaps or passes, so the
  // chain stops itself as soon as the turn comes back to a person.
  const botToMove = game?.phase === "playing" && game.players[game.turn].kind === "bot";
  useEffect(() => {
    if (!botToMove || !lexicon) return;
    const timer = window.setTimeout(() => {
      setGame((current) => (current ? takeWordWizardBotTurn(current, lexicon, Math.random) : current));
    }, BOT_TURN_MS);
    return () => window.clearTimeout(timer);
  }, [botToMove, lexicon, game]);

  // Save a won bot game exactly once. A loss, a tie and pass-and-play all score 0 and post
  // nothing — the rule Bridge applies to a hand the human did not win.
  useEffect(() => {
    if (!game || game.phase !== "over" || savedRef.current) return;
    savedRef.current = true;
    const points = scoreWordWizard(game);
    if (points <= 0) return;
    void saveScoreAction(GAME_KEY, points, game.history.length).then((result) => {
      if (result.ok) setSaved({ best: result.best });
    });
  }, [game]);

  const evaluation = useMemo(
    () => (game && pending.length > 0 ? evaluateWordWizardPlay(game, pending, isWord) : undefined),
    [game, pending, isWord],
  );

  if (!game) {
    return (
      <SetupPanel
        setup={setup}
        onChange={(next) => {
          setSetup(next);
          setSetupError(undefined);
        }}
        error={setupError}
        lexiconReady={lexicon !== undefined}
        loadError={loadError}
        onRetry={() => {
          setLoadError(undefined);
          setLoadAttempt((n) => n + 1);
        }}
        bestScore={bestScore}
        onStart={() => {
          try {
            const entrants =
              setup.mode === "bot"
                ? [
                    { name: "You", kind: "human" as const },
                    { name: "Wizard", kind: "bot" as const },
                  ]
                : setup.names.map((name) => ({ name, kind: "human" as const }));
            setGame(startWordWizard({ mode: setup.mode, botLevel: setup.level, entrants, random: Math.random }));
            setPending([]);
            setPicked(undefined);
            setBlankAt(undefined);
            setOrder([]);
            setSwapping(false);
            setSwapIds(new Set());
            setConfirmPass(false);
            setMessage(undefined);
            setRevealedAt(-1);
            setSaved(undefined);
            savedRef.current = false;
          } catch (error) {
            setSetupError(error instanceof Error ? error.message : "That game could not start.");
          }
        }}
      />
    );
  }

  const over = game.phase === "over";
  const passAndPlay = game.mode === "pass-and-play";
  // Whose rack is on screen: the current player's in pass-and-play, always yours against
  // the bot (the bot's is never shown).
  const rackSeat = passAndPlay ? game.turn : 0;
  const myTurn = !over && game.players[game.turn].kind === "human" && (!passAndPlay || revealedAt === game.history.length);
  const handingOver = passAndPlay && !over && revealedAt !== game.history.length;

  const rackTiles = game.players[rackSeat].rack;
  const pendingIds = new Set(pending.map((p) => p.tileId));
  // The rack in its shuffled display order; tiles drawn since the last shuffle go last.
  const shownRack = [
    ...order.flatMap((id) => rackTiles.filter((tile) => tile.id === id)),
    ...rackTiles.filter((tile) => !order.includes(tile.id)),
  ].filter((tile) => !pendingIds.has(tile.id));
  const pendingAt = new Map(pending.map((p) => [p.index, p]));
  const tileById = new Map(rackTiles.map((tile) => [tile.id, tile]));

  const clearTurnState = () => {
    setPending([]);
    setPicked(undefined);
    setBlankAt(undefined);
    setSwapping(false);
    setSwapIds(new Set());
    setConfirmPass(false);
    setMessage(undefined);
  };

  const placeAt = (index: number, tileId: number) => {
    if (!myTurn || game.board[index] || pendingAt.has(index)) return;
    const tile = tileById.get(tileId);
    if (!tile || pendingIds.has(tileId)) return;
    setPicked(undefined);
    setMessage(undefined);
    if (tile.letter === WORD_WIZARD_BLANK) setBlankAt({ index, tileId });
    else setPending((current) => [...current, { index, tileId }]);
  };

  const onSquare = (index: number) => {
    if (!myTurn || swapping) return;
    if (pendingAt.has(index)) {
      setPending((current) => current.filter((p) => p.index !== index));
      setMessage(undefined);
      return;
    }
    if (picked !== undefined) placeAt(index, picked);
  };

  const onRackTile = (tileId: number) => {
    if (!myTurn) return;
    if (swapping) {
      setSwapIds((current) => {
        const next = new Set(current);
        if (next.has(tileId)) next.delete(tileId);
        else next.add(tileId);
        return next;
      });
      return;
    }
    setPicked((current) => (current === tileId ? undefined : tileId));
  };

  const play = () => {
    const { state, result } = playWordWizardTiles(game, pending, isWord);
    if (!result.ok) {
      setMessage(result.reason);
      return;
    }
    setGame(state);
    clearTurnState();
  };

  const shuffle = () => {
    const ids = shownRack.map((tile) => tile.id);
    for (let i = ids.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    setOrder(ids);
  };

  const confirmSwap = () => {
    if (swapIds.size === 0) return;
    setGame(swapWordWizardTiles(game, [...swapIds], Math.random));
    clearTurnState();
  };

  const pass = () => {
    if (!confirmPass) {
      setConfirmPass(true);
      return;
    }
    setGame(passWordWizardTurn(game));
    clearTurnState();
  };

  const lastTurn = game.history.at(-1);
  const lastPlayed = new Set(
    lastTurn?.kind === "play" ? lastTurn.words.flatMap((word) => word.indices).filter((i) => !pendingAt.has(i)) : [],
  );

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <div className="flex w-full flex-col gap-3 lg:max-w-[34rem]">
        <Board
          state={game}
          pendingAt={pendingAt}
          tileById={tileById}
          lastPlayed={lastPlayed}
          canDrop={myTurn && !swapping}
          onSquare={onSquare}
          onDropTile={placeAt}
          hidePending={handingOver}
        />

        {blankAt && (
          <div className="rounded-lg border border-line bg-paper-raised p-3">
            <p className="mb-2 text-sm text-ink">Which letter should the blank be?</p>
            <div className="grid grid-cols-9 gap-1 max-lg:grid-cols-7">
              {LETTERS.map((letter) => (
                <button
                  key={letter}
                  type="button"
                  className="rounded border border-line bg-paper py-1.5 font-display text-sm text-ink hover:border-brass focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
                  onClick={() => {
                    setPending((current) => [...current, { ...blankAt, letter }]);
                    setBlankAt(undefined);
                  }}
                >
                  {letter}
                </button>
              ))}
            </div>
            <Button size="sm" variant="secondary" className="mt-2" onClick={() => setBlankAt(undefined)}>
              Cancel
            </Button>
          </div>
        )}

        {over ? (
          <ResultPanel
            state={game}
            saved={saved}
            onNewGame={() => {
              setGame(undefined);
              clearTurnState();
            }}
          />
        ) : handingOver ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-line bg-paper-raised p-5 text-center">
            <LastTurnLine state={game} turn={lastTurn} />
            <p className="font-display text-lg text-ink">Pass the device to {game.players[game.turn].name}</p>
            <p className="text-sm text-muted">Their tiles stay hidden until they are holding it.</p>
            <Button onClick={() => setRevealedAt(game.history.length)}>
              I&rsquo;m {game.players[game.turn].name} — show my tiles
            </Button>
          </div>
        ) : (
          <>
            <Rack
              tiles={shownRack}
              picked={picked}
              swapIds={swapping ? swapIds : undefined}
              active={myTurn}
              onTile={onRackTile}
            />
            <div className="min-h-5 text-sm" aria-live="polite">
              {!myTurn ? (
                <span className="text-muted">{game.players[game.turn].name} is thinking…</span>
              ) : message ? (
                <span className="text-red-400">{message}</span>
              ) : swapping ? (
                <span className="text-muted">Tap the tiles to put back, then Swap.</span>
              ) : evaluation ? (
                evaluation.ok ? (
                  <span className="text-ink">
                    {evaluation.words.map((w) => w.word).join(", ")} — {evaluation.score} pts
                    {evaluation.fullRackBonus && " (all seven tiles!)"}
                  </span>
                ) : (
                  <span className="text-muted">{evaluation.reason}</span>
                )
              ) : (
                <span className="text-muted">
                  {picked !== undefined
                    ? "Now tap a square."
                    : "Tap a tile, then a square. Tap a placed tile to take it back."}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {swapping ? (
                <>
                  <Button onClick={confirmSwap} disabled={swapIds.size === 0}>
                    Swap {swapIds.size > 0 ? swapIds.size : ""}
                  </Button>
                  <Button variant="secondary" onClick={() => setSwapping(false)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <Button onClick={play} disabled={!myTurn || pending.length === 0}>
                    Play
                  </Button>
                  <Button variant="secondary" onClick={() => setPending([])} disabled={!myTurn || pending.length === 0}>
                    Recall
                  </Button>
                  <Button variant="secondary" onClick={shuffle} disabled={!myTurn}>
                    Shuffle
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setPending([]);
                      setPicked(undefined);
                      setSwapping(true);
                      setMessage(undefined);
                    }}
                    disabled={!myTurn || !canWordWizardSwap(game)}
                  >
                    Swap
                  </Button>
                  <Button variant="secondary" onClick={pass} disabled={!myTurn}>
                    {confirmPass ? "Tap again to pass" : "Pass"}
                  </Button>
                </>
              )}
            </div>
            {!canWordWizardSwap(game) && myTurn && (
              <p className="text-xs text-muted">
                Swapping needs at least {WORD_WIZARD_MIN_BAG_TO_SWAP} tiles in the bag.
              </p>
            )}
          </>
        )}
      </div>

      <SidePanel state={game} bestScore={bestScore} />
    </div>
  );
}

function SetupPanel({
  setup,
  onChange,
  error,
  lexiconReady,
  loadError,
  onRetry,
  onStart,
  bestScore,
}: {
  setup: Setup;
  onChange: (setup: Setup) => void;
  error?: string;
  lexiconReady: boolean;
  loadError?: string;
  onRetry: () => void;
  onStart: () => void;
  bestScore: number;
}) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 rounded-lg border border-line bg-paper-raised p-5 max-lg:p-4">
      <div>
        <h4 className="font-display text-lg text-ink">New game</h4>
        <p className="text-sm text-muted">
          {bestScore > 0 ? `The record to beat is ${bestScore.toLocaleString()} pts.` : "No record yet."}
        </p>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-xs uppercase tracking-wide text-muted">Who is playing</legend>
        <div className="flex gap-2">
          <Button
            variant={setup.mode === "bot" ? "primary" : "secondary"}
            ariaPressed={setup.mode === "bot"}
            onClick={() => onChange({ ...setup, mode: "bot" })}
            className="flex-1"
          >
            Against the bot
          </Button>
          <Button
            variant={setup.mode === "pass-and-play" ? "primary" : "secondary"}
            ariaPressed={setup.mode === "pass-and-play"}
            onClick={() => onChange({ ...setup, mode: "pass-and-play" })}
            className="flex-1"
          >
            Pass and play
          </Button>
        </div>
      </fieldset>

      {setup.mode === "bot" ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-xs uppercase tracking-wide text-muted">Bot strength</legend>
          <div className="flex gap-2">
            {WORD_WIZARD_BOT_LEVELS.map((level) => (
              <Button
                key={level}
                size="sm"
                variant={setup.level === level ? "primary" : "secondary"}
                ariaPressed={setup.level === level}
                onClick={() => onChange({ ...setup, level })}
                className="flex-1"
              >
                {LEVEL_LABEL[level]}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted">A win puts your score on the shared board.</p>
        </fieldset>
      ) : (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-xs uppercase tracking-wide text-muted">
            Players ({WORD_WIZARD_MIN_PLAYERS}–{WORD_WIZARD_MAX_PLAYERS})
          </legend>
          {setup.names.map((name, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                value={name}
                maxLength={WORD_WIZARD_MAX_NAME_LENGTH}
                aria-label={`Player ${i + 1} name`}
                onChange={(event) =>
                  onChange({ ...setup, names: setup.names.map((n, j) => (j === i ? event.target.value : n)) })
                }
                className="min-w-0 flex-1 rounded border border-line bg-paper px-2 py-1.5 text-sm text-ink focus:border-brass focus:outline-none"
              />
              {setup.names.length > WORD_WIZARD_MIN_PLAYERS && (
                <Button
                  size="sm"
                  variant="secondary"
                  ariaLabel={`Remove ${name || `player ${i + 1}`}`}
                  onClick={() => onChange({ ...setup, names: setup.names.filter((_, j) => j !== i) })}
                >
                  ✕
                </Button>
              )}
            </div>
          ))}
          {setup.names.length < WORD_WIZARD_MAX_PLAYERS && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onChange({ ...setup, names: [...setup.names, `Player ${setup.names.length + 1}`] })}
            >
              Add a player
            </Button>
          )}
          <p className="text-xs text-muted">Pass-and-play scores last for this game only.</p>
        </fieldset>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}
      {loadError ? (
        <div className="flex items-center gap-2">
          <p className="flex-1 text-sm text-red-400">{loadError}</p>
          <Button size="sm" variant="secondary" onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : (
        <Button onClick={onStart} disabled={!lexiconReady}>
          {lexiconReady ? "Start" : "Loading the word list…"}
        </Button>
      )}
    </div>
  );
}

function Board({
  state,
  pendingAt,
  tileById,
  lastPlayed,
  canDrop,
  onSquare,
  onDropTile,
  hidePending,
}: {
  state: WordWizardState;
  pendingAt: ReadonlyMap<number, WordWizardPlacement>;
  tileById: ReadonlyMap<number, WordWizardTile>;
  lastPlayed: ReadonlySet<number>;
  canDrop: boolean;
  onSquare: (index: number) => void;
  onDropTile: (index: number, tileId: number) => void;
  hidePending: boolean;
}) {
  return (
    <div
      aria-label="Word Wizard board"
      className="grid aspect-square w-full gap-px rounded-md border border-line bg-line p-px"
      style={{ gridTemplateColumns: `repeat(${WORD_WIZARD_SIZE}, minmax(0, 1fr))` }}
    >
      {state.board.map((cell, index) => {
        const placement = hidePending ? undefined : pendingAt.get(index);
        const square = wordWizardSquareAt(index);
        const style = SQUARE_STYLE[square];
        const row = Math.floor(index / WORD_WIZARD_SIZE) + 1;
        const col = (index % WORD_WIZARD_SIZE) + 1;
        let content: ReactNode;
        let label = `Row ${row}, column ${col}`;
        if (cell) {
          content = <TileFace letter={cell.letter} blank={cell.blank} tone={lastPlayed.has(index) ? "recent" : "placed"} />;
          label += `, ${cell.letter}`;
        } else if (placement) {
          const tile = tileById.get(placement.tileId);
          const blank = tile?.letter === WORD_WIZARD_BLANK;
          const letter = blank ? (placement.letter ?? "?") : (tile?.letter ?? "?");
          content = <TileFace letter={letter} blank={blank} tone="pending" />;
          label += `, ${letter}, not yet played`;
        } else {
          content =
            index === WORD_WIZARD_CENTRE ? (
              <span className="text-[0.7rem] leading-none max-lg:text-[0.55rem]" aria-hidden>
                ★
              </span>
            ) : style.label ? (
              <span className="text-[0.55rem] font-semibold leading-none max-lg:text-[0.42rem]" aria-hidden>
                {style.label}
              </span>
            ) : null;
          if (style.label) label += `, ${square.replace("-", " ")}`;
        }
        return (
          <button
            key={index}
            type="button"
            aria-label={label}
            onClick={() => onSquare(index)}
            onDragOver={(event) => {
              if (canDrop && !cell && !placement) event.preventDefault();
            }}
            onDrop={(event) => {
              event.preventDefault();
              const tileId = Number(event.dataTransfer.getData("text/plain"));
              if (Number.isFinite(tileId)) onDropTile(index, tileId);
            }}
            className={`relative flex aspect-square items-center justify-center overflow-hidden focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${style.className}`}
          >
            {content}
          </button>
        );
      })}
    </div>
  );
}

/** One letter tile. `tone` says whether it is on the rack, laid this turn, or played. */
function TileFace({
  letter,
  blank,
  tone,
}: {
  letter: string;
  blank: boolean;
  tone: "rack" | "pending" | "placed" | "recent";
}) {
  const toneClass =
    tone === "pending"
      ? "bg-brass text-paper border-brass-dark"
      : tone === "recent"
        ? "bg-brass-soft text-ink border-brass"
        : tone === "rack"
          ? "bg-brass-soft text-ink border-brass/50"
          : "bg-brass-soft text-ink border-brass/40";
  const value = blank ? 0 : wordWizardTileValue(letter);
  return (
    <span
      className={`absolute inset-0 flex items-center justify-center rounded-[3px] border font-display font-semibold ${toneClass} ${
        tone === "rack" ? "text-xl" : "text-sm max-lg:text-[0.7rem]"
      }`}
    >
      <span className={blank ? "italic opacity-80" : undefined}>{letter === WORD_WIZARD_BLANK ? "" : letter}</span>
      {letter !== WORD_WIZARD_BLANK && !blank && (
        <span
          className={`absolute bottom-px right-0.5 font-sans leading-none ${
            tone === "rack" ? "text-[0.6rem]" : "text-[0.45rem] max-lg:text-[0.35rem]"
          }`}
        >
          {value}
        </span>
      )}
    </span>
  );
}

function Rack({
  tiles,
  picked,
  swapIds,
  active,
  onTile,
}: {
  tiles: readonly WordWizardTile[];
  picked?: number;
  swapIds?: ReadonlySet<number>;
  active: boolean;
  onTile: (tileId: number) => void;
}) {
  return (
    <div className="flex min-h-14 items-center justify-center gap-1.5 rounded-lg border border-line bg-paper-raised p-2">
      {tiles.length === 0 && <span className="text-sm text-muted">All your tiles are on the board.</span>}
      {tiles.map((tile) => {
        const selected = swapIds ? swapIds.has(tile.id) : picked === tile.id;
        return (
          <button
            key={tile.id}
            type="button"
            draggable={active && !swapIds}
            onDragStart={(event) => event.dataTransfer.setData("text/plain", String(tile.id))}
            onClick={() => onTile(tile.id)}
            disabled={!active}
            aria-pressed={selected}
            aria-label={tile.letter === WORD_WIZARD_BLANK ? "Blank tile" : `${tile.letter}, ${wordWizardTileValue(tile.letter)} points`}
            className={`relative h-11 w-11 shrink-0 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass disabled:opacity-60 max-lg:h-10 max-lg:w-10 motion-reduce:transition-none ${
              selected ? "-translate-y-1.5 rounded ring-2 ring-brass" : ""
            }`}
          >
            <TileFace letter={tile.letter} blank={false} tone="rack" />
          </button>
        );
      })}
    </div>
  );
}

function turnText(state: WordWizardState, turn: WordWizardTurn): string {
  const who = state.players[turn.player].name;
  if (turn.kind === "pass") return `${who} passed`;
  if (turn.kind === "swap") return `${who} swapped ${turn.swapped} tile${turn.swapped === 1 ? "" : "s"}`;
  return `${who} played ${turn.words.map((w) => w.word).join(", ")} for ${turn.score}${turn.fullRackBonus ? " (all seven!)" : ""}`;
}

function LastTurnLine({ state, turn }: { state: WordWizardState; turn?: WordWizardTurn }) {
  if (!turn) return null;
  return <p className="text-sm text-muted">{turnText(state, turn)}.</p>;
}

function SidePanel({ state, bestScore }: { state: WordWizardState; bestScore: number }) {
  const recent = state.history.slice(-8).reverse();
  return (
    <aside className="flex w-full flex-col gap-3 lg:w-56 lg:shrink-0">
      <div className="rounded-lg border border-line bg-paper-raised p-3">
        <ul className="flex flex-col gap-1.5">
          {state.players.map((player, i) => (
            <li
              key={player.name}
              className={`flex items-baseline justify-between gap-2 rounded px-2 py-1 ${
                i === state.turn && state.phase === "playing" ? "bg-brass-soft" : ""
              }`}
            >
              <span className="truncate text-sm text-ink">
                {player.name}
                {player.kind === "bot" && <span className="text-muted"> ({LEVEL_LABEL[state.botLevel]})</span>}
              </span>
              <span className="font-display text-base tabular-nums text-ink">{player.score}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted">
          {state.bag.length} tile{state.bag.length === 1 ? "" : "s"} in the bag
          {state.mode === "bot" && bestScore > 0 && ` · record ${bestScore.toLocaleString()}`}
        </p>
      </div>
      {recent.length > 0 && (
        <div className="rounded-lg border border-line bg-paper-raised p-3">
          <h5 className="mb-1 text-xs uppercase tracking-wide text-muted">Moves</h5>
          <ol className="flex flex-col gap-1 text-xs text-ink">
            {recent.map((turn, i) => (
              <li key={state.history.length - i}>{turnText(state, turn)}</li>
            ))}
          </ol>
        </div>
      )}
    </aside>
  );
}

function ResultPanel({
  state,
  saved,
  onNewGame,
}: {
  state: WordWizardState;
  saved?: { best: boolean };
  onNewGame: () => void;
}) {
  const ranked = wordWizardStandings(state);
  const winners = state.winners.map((i) => state.players[i].name);
  const headline =
    winners.length > 1
      ? `A tie between ${winners.join(" and ")}`
      : state.mode === "bot"
        ? state.winners[0] === 0
          ? "You win!"
          : "The Wizard wins"
        : `${winners[0]} wins!`;
  const points = scoreWordWizard(state);
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-paper-raised p-4">
      <p className="font-display text-xl text-ink">{headline}</p>
      <ol className="flex flex-col gap-1 text-sm">
        {ranked.map((entry) => {
          const adjustment = state.finalAdjustments[entry.seat];
          return (
            <li key={entry.seat} className="flex justify-between gap-2">
              <span className="text-ink">{entry.name}</span>
              <span className="tabular-nums text-ink">
                {entry.score}
                {adjustment !== 0 && (
                  <span className="text-muted">
                    {" "}
                    ({adjustment > 0 ? "+" : ""}
                    {adjustment} tiles)
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="text-xs text-muted">
        {state.mode === "pass-and-play"
          ? "Pass-and-play games are not saved to the scoreboard."
          : points > 0
            ? saved
              ? saved.best
                ? "Saved — a new record!"
                : "Saved to the scoreboard."
              : "Saving…"
            : "Only a win is saved to the scoreboard."}
      </p>
      <Button onClick={onNewGame}>New game</Button>
    </div>
  );
}
