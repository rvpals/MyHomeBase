"use client";

// The calculator's display and keypad. Pure presentation: it receives a
// `CalculatorState` and raises a key press; every decision about what a key *does* lives
// in `applyKey` (src/lib/calculator), and every key's label and binding comes from the
// catalogue rather than from JSX here.
//
// Registered rather than route-local because a calculator plausibly belongs inside the
// Expense module later — at which point this is already the component, with the floating
// window reduced to one of its callers.
//
// Keys are plain `<button>`s with the `.calc-key` classes, not `Button`. That follows
// the sudoku board's precedent: `Button`'s hard offset shadow is for discrete
// page-level actions, and 36 of them in one panel is visually deafening. See
// `globals.css` → the calculator's keypad.

import { useEffect, useRef, type ReactNode } from "react";
import {
  NUMERIC_KEYS,
  SCIENTIFIC_KEYS,
  keyForKeyboardEvent,
  type CalculatorKey,
  type CalculatorState,
  type KeyTone,
} from "@/lib/calculator";

/** Tone to class. A table, so a new tone is a line here rather than a branch inline. */
const toneClass: Record<KeyTone, string> = {
  digit: "",
  operator: "calc-key-operator",
  function: "calc-key-function",
  action: "calc-key-action",
  danger: "calc-key-danger",
};

export interface CalculatorKeypadProps {
  state: CalculatorState;
  /** Raised for every press, from a button or the keyboard. */
  onKey: (key: CalculatorKey) => void;
  /**
   * Whether to bind physical keys.
   *
   * Off by default, and the floating window turns it on. The binding is scoped to this
   * component's own subtree, never `document`: the floating window is **non-modal**, so
   * a global handler would swallow digits meant for the page behind it — a reader typing
   * in a form with the calculator open would lose every number they typed.
   */
  captureKeyboard?: boolean;
  /** Rendered under the keypad — the history tape, in the floating window's case. */
  children?: ReactNode;
  className?: string;
}

export function CalculatorKeypad({
  state,
  onKey,
  captureKeyboard = false,
  children,
  className = "",
}: CalculatorKeypadProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  // Physical keys, bound to this subtree rather than to the document — see
  // `captureKeyboard`. `keydown` on the wrapper catches everything inside it because
  // the events bubble, and a press that maps to no calculator key is left entirely
  // alone so Tab, the arrows and browser shortcuts still work.
  useEffect(() => {
    if (!captureKeyboard) return;
    const root = rootRef.current;
    if (!root) return;

    // Captured in a const so the closure below narrows it once, rather than re-reading
    // a ref that TypeScript cannot know is still non-null.
    const element = root;

    function handleKeyDown(event: KeyboardEvent) {
      // Never intercept a modified press: Ctrl+C, Cmd+R and friends belong to the
      // browser, and `-` with a modifier is a zoom gesture, not a minus sign.
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const key = keyForKeyboardEvent(event.key);
      if (!key) return;

      // Enter on a focused button would both activate the button and evaluate, so the
      // click handler is left to it. Any other mapped key is ours.
      if (
        event.key === "Enter" &&
        document.activeElement instanceof HTMLButtonElement &&
        element.contains(document.activeElement)
      ) {
        return;
      }

      event.preventDefault();
      onKey(key);
    }

    element.addEventListener("keydown", handleKeyDown);
    return () => element.removeEventListener("keydown", handleKeyDown);
  }, [captureKeyboard, onKey]);

  function renderKey(key: CalculatorKey) {
    // The angle-mode key is the one whose label depends on state: it *shows* the mode
    // it is currently in, which is what a physical calculator's DEG/RAD indicator does.
    const label = key.action === "angle-mode" ? state.angleMode.toUpperCase() : key.label;

    return (
      <button
        key={key.id}
        type="button"
        onClick={() => onKey(key)}
        className={`calc-key ${toneClass[key.tone]}`}
        // A glyph-only key has nothing for a screen reader to read, so the catalogue
        // carries a name for each.
        aria-label={key.ariaLabel ?? undefined}
        // The mode key is a toggle, so it reports its state rather than just its label.
        aria-pressed={key.action === "angle-mode" ? state.angleMode === "rad" : undefined}
        title={key.ariaLabel}
      >
        {label}
      </button>
    );
  }

  return (
    <div ref={rootRef} className={className}>
      {/* The display. Two lines: what is being built, and the result or the error.
          `aria-live="polite"` on the result only — announcing every keystroke of the
          expression would make the pad unusable with a screen reader, while the answer
          is exactly the thing a reader wants read out. */}
      <div className="rounded-lg border border-line bg-paper px-3 py-2 text-right">
        <p className="min-h-[1.25rem] break-all font-mono text-sm text-muted">
          {/* A non-breaking space keeps the line's height so the panel doesn't resize
              between an empty and a filled expression. */}
          {state.entry || " "}
        </p>
        <p
          className={`min-h-[2rem] break-all font-mono text-2xl leading-tight tabular-nums ${
            state.error ? "text-red-400" : "text-ink"
          }`}
          aria-live="polite"
        >
          {state.error ? state.error.message : (state.lastResult ?? " ")}
        </p>
      </div>

      {/* The scientific rows, then the numeric pad. Both 4-column, so the two grids
          line up into one continuous pad rather than reading as separate blocks. */}
      <div className="mt-3 grid grid-cols-4 gap-1.5">{SCIENTIFIC_KEYS.map(renderKey)}</div>
      <div className="mt-1.5 grid grid-cols-4 gap-1.5">{NUMERIC_KEYS.map(renderKey)}</div>

      {children}
    </div>
  );
}
