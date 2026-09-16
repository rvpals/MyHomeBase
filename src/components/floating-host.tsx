"use client";

// Mounts the floating layer: the provider, and every floating component inside it.
//
// This file exists so the protected layout (a server component) has one client boundary
// to render rather than four, and so the music-puck bridge below lives in exactly one
// place instead of in each floating component.

import { useEffect, useState, type ReactNode } from "react";
import { FloatingCalculator, type CalculatorActions } from "@/components/floating-calculator";
import { FloatingClock } from "@/components/floating-clock";
import { FloatingLayerProvider, type FloatingActions } from "@/components/floating-layer";
import { FloatingScratchpad, type ScratchpadActions } from "@/components/floating-scratchpad";
import type { AngleMode, CalculationEntry } from "@/lib/calculator";
import type { ClockFaceOptions, ClockReading } from "@/lib/clock";
import type { FloatingId, FloatingState, PuckCorner } from "@/lib/floating";
import type { Note, NoteCategory } from "@/lib/scratchpad";

/**
 * Whether the music player is currently a puck, read from the attribute it already
 * mirrors onto `<html>`.
 *
 * Reading the DOM rather than a context, deliberately. That state is **local to
 * `MusicPlayerBar`** — intentionally so, per its own comment: minimizing is a
 * get-out-of-my-way gesture that is not persisted and not part of the player's public
 * surface. Lifting it into `MusicPlayerProvider` just so the clock could read it would
 * widen that component's API for one consumer, and `data-music-player` is already the
 * published seam for exactly this: `globals.css` reads it to place the bar.
 *
 * A `MutationObserver` rather than a poll, so this costs nothing while the attribute
 * sits still.
 */
function useMusicPuckUp(): boolean {
  const [isUp, setIsUp] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const read = () => setIsUp(root.getAttribute("data-music-player") === "minimized");

    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ["data-music-player"] });
    return () => observer.disconnect();
  }, []);

  return isUp;
}

export function FloatingHost({
  enabled,
  initialStates,
  initialCorners,
  actions,
  clockReading,
  clockOptions,
  clockWeather,
  calculatorActions,
  calculatorAngleMode,
  calculatorLastResult,
  calculatorHistory,
  scratchpadActions,
  scratchpadCategories,
  scratchpadNotes,
  scratchpadCategoryId,
}: {
  /** The ids an admin has enabled for the household. */
  enabled: readonly FloatingId[];
  /** This reader's stored state per component. */
  initialStates: Partial<Record<FloatingId, FloatingState>>;
  /** This reader's docked corner per component. */
  initialCorners: Partial<Record<FloatingId, PuckCorner>>;
  actions: FloatingActions;
  /** The Clock's server-side inputs, passed straight through. */
  clockReading: ClockReading;
  clockOptions: ClockFaceOptions;
  /** Pre-rendered weather markup — see `ClockFace`'s `weather` prop. */
  clockWeather?: ReactNode;
  /** The calculator's server actions, injected the same way the layer's are. */
  calculatorActions: CalculatorActions;
  calculatorAngleMode: AngleMode;
  calculatorLastResult?: string;
  calculatorHistory: readonly CalculationEntry[];
  /** The scratchpad's server actions, injected the same way the layer's are. */
  scratchpadActions: ScratchpadActions;
  /** The household's tab strip, and the active tab's notes for this reader. */
  scratchpadCategories: readonly NoteCategory[];
  scratchpadNotes: readonly Note[];
  scratchpadCategoryId?: number;
}) {
  const musicPuckUp = useMusicPuckUp();

  return (
    <FloatingLayerProvider
      enabled={enabled}
      initialStates={initialStates}
      initialCorners={initialCorners}
      actions={actions}
      musicPuckUp={musicPuckUp}
    >
      {/* One entry per registered floating component. A component whose id an admin
          has disabled renders nothing — the provider drops it from `states`, so each
          component's own `state === "closed"` guard catches it. */}
      <FloatingClock reading={clockReading} options={clockOptions} weather={clockWeather} />
      <FloatingCalculator
        angleMode={calculatorAngleMode}
        lastResult={calculatorLastResult}
        initialHistory={calculatorHistory}
        actions={calculatorActions}
      />
      <FloatingScratchpad
        categories={scratchpadCategories}
        initialNotes={scratchpadNotes}
        initialCategoryId={scratchpadCategoryId}
        actions={scratchpadActions}
      />
    </FloatingLayerProvider>
  );
}
