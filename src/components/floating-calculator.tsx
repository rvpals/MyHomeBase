"use client";

// The Floating Calculator: the second floating component, and the first with state worth
// preserving across a minimize.
//
// Thin, like `FloatingClock`. The arithmetic is `src/lib/calculator`, the chrome is
// `FloatingWindow` / `FloatingPuck`, the pad is `CalculatorKeypad`, and the layer owns
// open/minimized/closed. What is left here is the wiring plus the tape.

import { useCallback, useState } from "react";
import { CalculatorKeypad } from "@/components/calculator-keypad";
import { FloatingPuck, FloatingWindow } from "@/components/floating-window";
import { useFloatingLayer } from "@/components/floating-layer";
import { SlotIcon } from "@/components/slot-icon";
import {
  applyKey,
  formatForPuck,
  initialState,
  puckTextSize,
  type AngleMode,
  type CalculationEntry,
  type CalculatorKey,
  type CalculatorState,
} from "@/lib/calculator";
import { getIconSlot } from "@/lib/icons";

// Resolved once at module scope — `getIconSlot` reads the static registry, no I/O. The
// guard is for the registry, not the user: a removed id costs the window its glyph
// rather than crashing.
const CALCULATOR_SLOT = getIconSlot("floating_calculator_window");

/**
 * What the calculator needs from the server. Injected as props for the reason
 * `components.md` gives: a file under `src/components/` must not import from
 * `src/app/`.
 */
export interface CalculatorActions {
  /**
   * Records a completed calculation, returning the tape.
   *
   * Every signature here matches its server action **exactly**, so the mount site can
   * assign the action itself rather than wrapping it. A `"use server"` function is
   * passable to a client component because React recognises *that* function; wrapping
   * it in an arrow makes an ordinary closure, and serializing that fails at runtime
   * with "Functions cannot be passed directly to Client Components". Hence the
   * `{ ok, history? }` shape rather than a tidier `CalculationEntry[]` — the port
   * mirrors the action, and the component unwraps. Same rule as `MusicQueueActions`.
   */
  record: (
    expression: string,
    result: string,
  ) => Promise<{ ok: boolean; error?: string; history?: CalculationEntry[] }>;
  /** Wipes the tape. Its own action, never something `AC` triggers. */
  clearHistory: () => Promise<{ ok: boolean; error?: string }>;
  /** Persists the angle mode and/or the last result. */
  saveState: (update: {
    angleMode?: AngleMode;
    lastResult?: string;
  }) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * The puck's image: the last result.
 *
 * This is the "image of the last result" — the whole point of how this component
 * minimizes. The value is shortened by `formatForPuck` and sized by `puckTextSize`,
 * both in `lib`, because "how many digits fit in 56px" is a rule about numbers rather
 * than markup. The full value stays in the button's title and label, and one tap
 * restores the window, so the abbreviation loses nothing.
 */
function PuckResult({ lastResult }: { lastResult?: string }) {
  // `lastResult` is the formatted string, so it is parsed back to a number for the
  // puck's own shortening. A stored string that no longer parses (a hand-edited
  // preference row) falls through to the glyph rather than rendering NaN.
  const asNumber = lastResult === undefined ? undefined : Number(lastResult);
  const text =
    asNumber !== undefined && Number.isFinite(asNumber) ? formatForPuck(asNumber) : undefined;

  if (text === undefined) {
    // No result yet: the `=` glyph, so the puck still reads as a calculator rather than
    // as an empty circle.
    return (
      <span className="flex h-full w-full items-center justify-center font-mono text-xl text-brass">
        =
      </span>
    );
  }

  return (
    <span
      className={`flex h-full w-full items-center justify-center px-1 font-mono font-semibold tabular-nums text-ink ${puckTextSize(text)}`}
    >
      {text}
    </span>
  );
}

/** One line of the tape. Tapping it puts the result back into the calculator. */
function HistoryRow({
  entry,
  onReuse,
}: {
  entry: CalculationEntry;
  onReuse: (result: string) => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onReuse(entry.result)}
        title={`Use ${entry.result}`}
        className="flex w-full items-baseline justify-between gap-3 rounded px-2 py-1.5 text-left transition-colors hover:bg-brass-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
      >
        <span className="min-w-0 break-all font-mono text-xs text-muted">{entry.expression}</span>
        <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-ink">
          {entry.result}
        </span>
      </button>
    </li>
  );
}

export function FloatingCalculator({
  angleMode,
  lastResult,
  initialHistory,
  actions,
}: {
  /** The reader's stored angle mode, resolved on the server. */
  angleMode: AngleMode;
  /** The reader's stored last result — what the puck draws before anything is typed. */
  lastResult?: string;
  /** The tape, resolved on the server so the window opens with it already filled. */
  initialHistory: readonly CalculationEntry[];
  actions: CalculatorActions;
}) {
  const layer = useFloatingLayer();

  // Seeded from the stored values, so a reopened window remembers its last answer and
  // the mode the reader set. The in-progress *expression* is deliberately not stored —
  // a half-typed `3 * sin(` returning after a reload is clutter.
  // Annotated rather than inferred: the initialiser's `lastResult` is
  // `string | undefined`, which TypeScript widens into a *required* property, and the
  // setter would then reject a `CalculatorState` whose `lastResult` is optional.
  const [state, setState] = useState<CalculatorState>(() => ({
    ...initialState(angleMode),
    lastResult,
  }));
  // The tape written *in this window*, or `undefined` while the server's copy still
  // stands. Deliberately not seeded from `initialHistory` and re-synced in an effect:
  // mirroring a prop into state means a `setState` in an effect body, which is the
  // cascading-render pattern `react-hooks/set-state-in-effect` exists to catch (the
  // same rule `ClockFace`'s tick comment cites). Instead the server's prop is the
  // default and a local write overrides it, so a refresh from another tab or a
  // calculation made from the CLI simply arrives as a new prop.
  const [localHistory, setLocalHistory] = useState<readonly CalculationEntry[] | undefined>(
    undefined,
  );
  const history = localHistory ?? initialHistory;
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  const handleKey = useCallback(
    (key: CalculatorKey) => {
      setState((current) => {
        const next = applyKey(current, key, (expression, result) => {
          // Fire-and-forget, deliberately: the result is already on screen and the tape
          // is a record, not a confirmation. Making the display wait for a NAS round
          // trip would put a visible stall on every `=`.
          // The action returns `{ ok, history? }`; only the tape is of interest here.
          // A failed write is ignored on purpose — the result is already on screen and
          // the tape is a record, not a confirmation, so a NAS hiccup must not surface
          // as an error over a correct answer.
          void actions
            .record(expression, result)
            .then((outcome) => outcome.history && setLocalHistory(outcome.history));
          void actions.saveState({ lastResult: result });
        });

        // The angle mode is a preference, so a flip is persisted — otherwise a reader
        // who works in radians would reset to degrees on every reload.
        if (next.angleMode !== current.angleMode) {
          void actions.saveState({ angleMode: next.angleMode });
        }
        return next;
      });
    },
    [actions],
  );

  /** A tape entry tapped: its result becomes the current entry, ready to build on. */
  const handleReuse = useCallback((result: string) => {
    setState((current) => ({
      ...current,
      entry: result,
      error: undefined,
      // Treated as a fresh result rather than as typing, so an operator continues from
      // it and a digit replaces it — the same rule `=` sets up.
      justEvaluated: true,
    }));
  }, []);

  const handleClearHistory = useCallback(async () => {
    await actions.clearHistory();
    setLocalHistory([]);
  }, [actions]);

  if (!layer) return null;

  const floatingState = layer.states.calculator ?? "closed";
  if (floatingState === "closed") return null;

  if (floatingState === "minimized") {
    const puck = layer.puckSlots.find((candidate) => candidate.id === "calculator");
    return (
      <FloatingPuck
        label={
          state.lastResult ? `Floating Calculator — ${state.lastResult}` : "Floating Calculator"
        }
        index={puck?.index ?? 0}
        // The reader's docked corner, defaulting when the slot is somehow missing.
        corner={puck?.corner ?? "bottom-right"}
        onRestore={() => layer.restore("calculator")}
        onClose={() => layer.close("calculator")}
      >
        <PuckResult lastResult={state.lastResult} />
      </FloatingPuck>
    );
  }

  return (
    <FloatingWindow
      title="Calculator"
      titleIcon={
        CALCULATOR_SLOT ? <SlotIcon slot={CALCULATOR_SLOT} className="h-4 w-4" /> : undefined
      }
      onClose={() => layer.close("calculator")}
      onMinimize={() => layer.minimize("calculator")}
      // Narrower than the default floating window: a keypad has a natural width and
      // stretching it to 80vw on a monitor would leave enormous keys around a tiny sum.
      className="lg:h-auto lg:max-h-[min(90vh,46rem)] lg:w-[22rem]"
    >
      <CalculatorKeypad
        state={state}
        onKey={handleKey}
        // Physical keys, scoped to the panel — see `CalculatorKeypad`'s note on why
        // this is never bound to the document.
        captureKeyboard
      >
        <div className="mt-3 border-t border-line pt-2">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setIsHistoryOpen((open) => !open)}
              aria-expanded={isHistoryOpen}
              className="rounded px-1 text-xs font-medium text-brass-dark hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
            >
              {isHistoryOpen ? "Hide" : "Show"} history
              {history.length > 0 && ` (${history.length})`}
            </button>

            {isHistoryOpen && history.length > 0 && (
              // A row-level destructive action, so a text link in semantic red rather
              // than a `Button` — design.md's rule for actions inside a list.
              <button
                type="button"
                onClick={handleClearHistory}
                className="rounded px-1 text-xs text-red-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
              >
                Clear history
              </button>
            )}
          </div>

          {isHistoryOpen && (
            <>
              {history.length === 0 ? (
                <p className="mt-2 px-2 text-xs text-muted">
                  Nothing yet. Completed calculations are kept here — tap one to use its
                  result.
                </p>
              ) : (
                // Capped height with its own scroller, so a full tape can't push the
                // keypad off a short window.
                <ul className="mt-1 max-h-40 overflow-y-auto">
                  {history.map((entry) => (
                    <HistoryRow key={entry.id} entry={entry} onReuse={handleReuse} />
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </CalculatorKeypad>
    </FloatingWindow>
  );
}
