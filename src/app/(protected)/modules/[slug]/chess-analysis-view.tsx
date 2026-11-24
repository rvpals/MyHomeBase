"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/button";
import { ChartLine } from "@/components/chart-line";
import { ChessBoard } from "@/components/chess-board";
import { Progress3D } from "@/components/progress-3d";
import {
  CHESS_ANALYSIS_SPEEDS,
  CHESS_ANALYSIS_SPEED_SETUP,
  analyseChessGame,
  buildChessSave,
  chessEvalSeries,
  oppositeColor,
  parseFen,
  squareFromName,
  type ChessAnalysedPly,
  type ChessAnalysis,
  type ChessAnalysisSpeed,
  type ChessColor,
  type ChessGame,
  type ChessMoveQuality,
} from "@/lib/games";
import type { ChessAnalyseRequest, ChessWorkerMessage } from "./chess-worker";

// Post-game analysis: what every move was worth, drawn as a graph you can click into.
//
// Its own file rather than more of `game-chess-view.tsx`, which is already past 1,200
// lines. Nothing here decides anything about chess — `analyseChessGame` in
// `src/lib/games/chess-analysis.ts` produces the whole report and this lays it out.
//
// Phone: the graph, the board and the move list stack in that order. Desktop: the board
// sits beside the move list under the graph. `max-lg:` variants only.

/** How each label is shown. Colours are the app's semantic ones, kept literal. */
const QUALITY_STYLE: Record<ChessMoveQuality, { label: string; className: string }> = {
  best: { label: "Best", className: "text-emerald-400" },
  good: { label: "Good", className: "text-muted" },
  inaccuracy: { label: "Inaccuracy", className: "text-amber-400" },
  mistake: { label: "Mistake", className: "text-orange-400" },
  blunder: { label: "Blunder", className: "text-red-400" },
};

/** The labels worth counting under the graph. "Good" is the absence of a problem. */
const REPORTED_QUALITIES: readonly ChessMoveQuality[] = [
  "best",
  "inaccuracy",
  "mistake",
  "blunder",
];

type RunState =
  | { phase: "idle" }
  | { phase: "running"; scored: number; total: number }
  | { phase: "done"; analysis: ChessAnalysis }
  | { phase: "failed"; error: string };

/**
 * Runs an analysis in a worker of its own, and cancels it by terminating that worker.
 *
 * A dedicated instance rather than the one answering moves, for two reasons: a worker
 * cannot be interrupted mid-search, so cancelling means killing it, and killing the
 * shared one would leave the board unable to move afterwards.
 *
 * Falls back to the main thread when a worker cannot be created. That path **freezes
 * the page** for the length of the run, which is why the screen warns before using it
 * rather than quietly taking a minute of everyone's time.
 */
function useAnalysisRunner() {
  const workerRef = useRef<Worker | undefined>(undefined);

  /*
    Set only when a worker has actually failed to start, from inside `run` — a callback,
    not an effect.

    A probe at mount would have warned a little earlier, but it meant setting state in an
    effect body, and it spent a worker construction on every visit to the screen to
    answer a question that is almost always "yes". `typeof Worker` covers the browser
    that has none; this covers the bundler that did not emit ours, and after the first
    attempt the warning is accurate.
  */
  const [workerFailed, setWorkerFailed] = useState(false);
  const canWork = typeof Worker !== "undefined" && !workerFailed;

  useEffect(
    () => () => {
      workerRef.current?.terminate();
      workerRef.current = undefined;
    },
    [],
  );

  const cancel = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = undefined;
  }, []);

  const run = useCallback(
    (
      game: ChessGame,
      speed: ChessAnalysisSpeed,
      onProgress: (scored: number, total: number) => void,
    ): Promise<ChessAnalysis> =>
      new Promise((resolve, reject) => {
        let worker: Worker | undefined;
        try {
          worker = new Worker(new URL("./chess-worker.ts", import.meta.url));
        } catch {
          // No worker: run here and accept the freeze. Deferred one tick so the screen
          // paints its progress bar first, and recorded so the warning is right from
          // now on.
          setWorkerFailed(true);
          setTimeout(() => {
            try {
              resolve(analyseChessGame(game, { speed }));
            } catch (error) {
              reject(error instanceof Error ? error : new Error("Analysis failed."));
            }
          }, 0);
          return;
        }

        workerRef.current = worker;

        worker.addEventListener("message", (event: MessageEvent<ChessWorkerMessage>) => {
          const message = event.data;
          if (message.kind === "analysis-progress") {
            onProgress(message.scored, message.total);
            return;
          }
          if (message.kind !== "analysis") return;

          worker?.terminate();
          workerRef.current = undefined;
          if (message.analysis) resolve(message.analysis);
          else reject(new Error(message.error ?? "Analysis failed."));
        });

        worker.addEventListener("error", () => {
          worker?.terminate();
          workerRef.current = undefined;
          reject(new Error("The analysis worker stopped unexpectedly."));
        });

        worker.postMessage({
          kind: "analyse",
          id: 0,
          save: buildChessSave(game),
          speed,
        } satisfies ChessAnalyseRequest);
      }),
    [],
  );

  return { run, cancel, canWork };
}

export function ChessAnalysisView({ game, onBack }: { game: ChessGame; onBack: () => void }) {
  const [speed, setSpeed] = useState<ChessAnalysisSpeed>("normal");
  const [state, setState] = useState<RunState>({ phase: "idle" });
  const [selected, setSelected] = useState<number | undefined>(undefined);
  const { run, cancel, canWork } = useAnalysisRunner();

  const moves = game.moves.length;

  async function start() {
    setSelected(undefined);
    setState({ phase: "running", scored: 0, total: moves + 1 });
    try {
      const analysis = await run(game, speed, (scored, total) =>
        setState({ phase: "running", scored, total }),
      );
      setState({ phase: "done", analysis });
      // Open on the worst move of the player's own: it is the one thing a reader is
      // here to see, and finding it by hand means scrolling a list of eighty rows.
      setSelected(worstPlyFor(analysis, game.humanColor));
    } catch (error) {
      setState({
        phase: "failed",
        error: error instanceof Error ? error.message : "Analysis failed.",
      });
    }
  }

  function stop() {
    cancel();
    setState({ phase: "idle" });
  }

  const analysis = state.phase === "done" ? state.analysis : undefined;
  const ply = analysis?.plies.find((entry) => entry.index === selected);

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-base text-ink">Game analysis</h3>
        <Button size="sm" variant="secondary" onClick={onBack}>
          Back to the board
        </Button>
      </div>

      {state.phase !== "done" && (
        <div className="rounded-xl border border-line bg-paper-raised p-4">
          <p className="text-sm text-muted">
            Every position in the game is scored by the engine, so you can see where it
            turned and which moves cost you. {moves} moves to check.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            {CHESS_ANALYSIS_SPEEDS.map((key) => (
              <Button
                key={key}
                size="sm"
                variant={key === speed ? "primary" : "secondary"}
                onClick={() => setSpeed(key)}
                ariaPressed={key === speed}
                disabled={state.phase === "running"}
                title={CHESS_ANALYSIS_SPEED_SETUP[key].hint}
              >
                {CHESS_ANALYSIS_SPEED_SETUP[key].label}
              </Button>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted">{CHESS_ANALYSIS_SPEED_SETUP[speed].hint}</p>

          {!canWork && (
            <p className="mt-2 text-xs text-amber-400">
              Your browser could not start a background worker, so the page will stop
              responding while this runs. Fast is the kinder choice here.
            </p>
          )}

          {state.phase === "running" ? (
            <div className="mt-3 flex flex-col gap-2">
              <Progress3D
                value={state.scored}
                max={state.total}
                label={`Scoring position ${state.scored} of ${state.total}`}
              />
              <div>
                <Button size="sm" variant="secondary" onClick={stop} disabled={!canWork}>
                  Stop
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => void start()} disabled={moves === 0}>
                Analyse game
              </Button>
              {moves === 0 && <span className="text-xs text-muted">No moves to analyse.</span>}
            </div>
          )}

          {state.phase === "failed" && (
            <p className="mt-2 text-sm text-red-400">{state.error}</p>
          )}
        </div>
      )}

      {analysis && (
        <>
          {analysis.partial && (
            <p className="text-xs text-amber-400">
              This run was stopped early, so it covers only the first{" "}
              {analysis.plies.length} moves.
            </p>
          )}

          <AnalysisSummary analysis={analysis} humanColor={game.humanColor} />

          <EvaluationGraph
            analysis={analysis}
            humanColor={game.humanColor}
            onSelect={setSelected}
          />

          <div className="flex gap-4 max-lg:flex-col">
            <div className="w-80 shrink-0 max-lg:w-full">
              <AnalysisBoard ply={ply} humanColor={game.humanColor} />
            </div>
            <MoveTable
              analysis={analysis}
              selected={selected}
              onSelect={setSelected}
              humanColor={game.humanColor}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => setState({ phase: "idle" })}>
              Analyse again
            </Button>
            <Button size="sm" variant="secondary" onClick={onBack}>
              Back to the board
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/** The player's worst move, which is what the screen opens on. */
function worstPlyFor(analysis: ChessAnalysis, color: ChessColor): number | undefined {
  let worst: ChessAnalysedPly | undefined;
  for (const ply of analysis.plies) {
    if (ply.color !== color) continue;
    if (!worst || ply.lossCentipawns > worst.lossCentipawns) worst = ply;
  }
  // Nothing to point at when the player never lost anything worth naming.
  return worst && worst.lossCentipawns > 0 ? worst.index : analysis.plies[0]?.index;
}

function AnalysisSummary({
  analysis,
  humanColor,
}: {
  analysis: ChessAnalysis;
  humanColor: ChessColor;
}) {
  const sides: { color: ChessColor; label: string }[] = [
    { color: humanColor, label: "You" },
    { color: oppositeColor(humanColor), label: "Computer" },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 max-lg:grid-cols-1">
      {sides.map((side) => (
        <div key={side.color} className="rounded-xl border border-line bg-paper-raised p-3">
          <div className="flex items-baseline justify-between gap-2">
            <h4 className="font-display text-sm text-ink">{side.label}</h4>
            <span className="text-xs text-muted">
              {/* The one number that compares two games: how much, on average, each move
                  threw away. Lower is better, and it is far more telling than any single
                  blunder count. */}
              {(analysis.summary.averageLoss[side.color] / 100).toFixed(2)} pawns lost per move
            </span>
          </div>
          <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {REPORTED_QUALITIES.map((quality) => (
              <div key={quality} className="flex items-baseline gap-1">
                <dt className={QUALITY_STYLE[quality].className}>
                  {QUALITY_STYLE[quality].label}
                </dt>
                <dd className="font-display tabular-nums text-ink">
                  {analysis.summary.counts[side.color][quality]}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}

/**
 * The evaluation over the game, in pawns and always from White's point of view.
 *
 * `curve="linear"`, deliberately: a smoothed curve between two moves would imply the
 * evaluation drifted through values it never held. Straight segments are the truth —
 * it changed when somebody moved.
 */
function EvaluationGraph({
  analysis,
  humanColor,
  onSelect,
}: {
  analysis: ChessAnalysis;
  humanColor: ChessColor;
  onSelect: (index: number) => void;
}) {
  const points = chessEvalSeries(analysis);

  return (
    <div className="rounded-xl border border-line bg-paper-raised p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="font-display text-sm text-ink">Evaluation</h4>
        <span className="text-xs text-muted">
          Above the middle favours White; below favours Black.
          {humanColor === "b" && " You are Black."}
        </span>
      </div>
      <ChartLine
        data={points}
        series={[{ key: "evaluation", label: "Evaluation" }]}
        xKey="ply"
        curve="linear"
        height={200}
        showDots={false}
        formatValue={(value) => `${value >= 0 ? "+" : ""}${value.toFixed(1)}`}
        formatX={(value) => `${value}`}
        displayStorageKey="myhomebase:chess-analysis-graph"
      />
      <p className="mt-1 text-xs text-muted">
        Capped at ten pawns either way, so one forced mate does not flatten the rest.{" "}
        <button
          type="button"
          className="text-brass-dark hover:underline"
          onClick={() => onSelect(0)}
        >
          Jump to the first move
        </button>
      </p>
    </div>
  );
}

/** The position before the selected move, with what was played and what was better. */
function AnalysisBoard({ ply, humanColor }: { ply?: ChessAnalysedPly; humanColor: ChessColor }) {
  const position = ply ? parseFen(ply.fen) : undefined;

  if (!ply || !position) {
    return (
      <p className="rounded-xl border border-line bg-paper-raised p-3 text-sm text-muted">
        Pick a move to see the position it was played in.
      </p>
    );
  }

  const played = { from: squareFromName(ply.uci.slice(0, 2)), to: squareFromName(ply.uci.slice(2, 4)) };
  const better = ply.bestUci
    ? { from: squareFromName(ply.bestUci.slice(0, 2)), to: squareFromName(ply.bestUci.slice(2, 4)) }
    : undefined;

  return (
    <div className="flex flex-col gap-2">
      {/* The move played is marked amber, as it is during the game; the engine's choice
          is marked blue, the same colour a live Hint uses. Reusing both meanings rather
          than inventing a third keeps the board readable without a key. */}
      <ChessBoard
        squares={position.board}
        orientation={humanColor}
        lastMove={played.from >= 0 && played.to >= 0 ? played : undefined}
        hint={better}
        disabled
      />
      <p className="text-sm text-ink">
        <span className="font-display">{moveLabel(ply)}</span>{" "}
        <span className={QUALITY_STYLE[ply.quality].className}>
          {QUALITY_STYLE[ply.quality].label}
        </span>
        {ply.bestSan && (
          <span className="text-muted">
            {" "}
            — {ply.bestSan} was better, by {(ply.lossCentipawns / 100).toFixed(1)} pawns.
          </span>
        )}
      </p>
    </div>
  );
}

/** `12. Nf3` or `12… Nf6`, as a score sheet writes it. */
function moveLabel(ply: ChessAnalysedPly): string {
  const number = Math.floor(ply.index / 2) + 1;
  return ply.color === "w" ? `${number}. ${ply.san}` : `${number}… ${ply.san}`;
}

function MoveTable({
  analysis,
  selected,
  onSelect,
  humanColor,
}: {
  analysis: ChessAnalysis;
  selected?: number;
  onSelect: (index: number) => void;
  humanColor: ChessColor;
}) {
  return (
    <div className="min-w-0 flex-1 rounded-xl border border-line bg-paper-raised p-3">
      <h4 className="font-display text-sm text-ink">Every move</h4>
      {/* A plain scrolling list rather than `DataGrid`: these rows are a navigation
          control for the board beside them, not a table of records to sort or filter. */}
      <ol className="mt-1 max-h-96 overflow-auto max-lg:max-h-64">
        {analysis.plies.map((ply) => {
          const isSelected = ply.index === selected;
          return (
            <li key={ply.index}>
              <button
                type="button"
                onClick={() => onSelect(ply.index)}
                aria-current={isSelected}
                className={`flex w-full items-baseline gap-2 rounded px-2 py-1 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${
                  isSelected ? "bg-brass-soft" : "hover:bg-paper"
                }`}
              >
                <span className="w-16 shrink-0 font-mono text-xs text-muted">
                  {moveLabel(ply)}
                </span>
                <span className={`flex-1 text-xs ${QUALITY_STYLE[ply.quality].className}`}>
                  {QUALITY_STYLE[ply.quality].label}
                </span>
                {ply.lossCentipawns > 0 && (
                  <span className="shrink-0 font-mono text-xs text-muted">
                    −{(ply.lossCentipawns / 100).toFixed(1)}
                  </span>
                )}
                {ply.color === humanColor && (
                  <span className="shrink-0 text-[0.6rem] uppercase tracking-wide text-brass-dark">
                    you
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
