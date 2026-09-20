"use client";

// Replaying the portfolio's value forward through its own history.
//
// Pick a step — daily, weekly, monthly, yearly — and press Playback History, and the
// value chart redraws itself one period at a time while a large figure reads out
// what the portfolio was worth at each step. It's the same snapshot data the
// Portfolio History chart already draws, revealed in sequence rather than all at
// once.
//
// Every frame comes from `buildPlaybackFrames` in the lib; this file owns only
// the timer, the reveal, and the layout.

import { useEffect, useMemo, useRef, useState } from "react";
import { BigValueReadout } from "@/components/big-value-readout";
import { Button } from "@/components/button";
import { ChartLine } from "@/components/chart-line";
import { ViewModeSwitch, type ViewModeOption } from "@/components/view-mode-switch";
import {
  buildPlaybackFrames,
  canPlayBack,
  playbackFrameMs,
  type PlaybackStep,
} from "@/lib/stock-dashboard";
import type { DailySnapshot } from "@/lib/stock-daily-snapshot";
import { centsToDollars, formatCents } from "@/lib/shared/money";

const STEP_OPTIONS: readonly ViewModeOption<PlaybackStep>[] = [
  { key: "daily", label: "Daily", hint: "One frame per captured day" },
  { key: "weekly", label: "Weekly", hint: "One frame per week of history" },
  { key: "monthly", label: "Monthly", hint: "One frame per month of history" },
  { key: "yearly", label: "Yearly", hint: "One frame per year of history" },
];

function gainClass(cents: number): string {
  return cents < 0 ? "text-red-400" : "text-emerald-400";
}

/** What one frame of each step is called, for the line under the chart. */
const STEP_NOUN: Record<PlaybackStep, string> = {
  daily: "day",
  weekly: "week",
  monthly: "month",
  yearly: "year",
};

export function StockPlaybackControl({ snapshots }: { snapshots: DailySnapshot[] }) {
  // Daily by default: it is the step with the most frames, so it is the one
  // that actually reads as an animation on a short history.
  const [step, setStep] = useState<PlaybackStep>("daily");
  /**
   * How many frames are currently revealed. `undefined` means "not playing" —
   * the chart then shows the whole curve, which is also where a finished
   * playback rests.
   */
  const [revealed, setRevealed] = useState<number | undefined>(undefined);

  const frames = useMemo(() => buildPlaybackFrames(snapshots, step), [snapshots, step]);
  const playable = canPlayBack(frames);
  const isPlaying = revealed !== undefined && revealed < frames.length;

  // A step change mid-playback would leave `revealed` indexing a different set
  // of frames, so changing the cut stops the run rather than reinterpreting it.
  useEffect(() => {
    setRevealed(undefined);
  }, [step]);

  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  // Paced by total duration, not a fixed tick, so every step runs about as long
  // regardless of how coarsely it cut the history.
  const frameMs = playbackFrameMs(frames.length);

  useEffect(() => {
    if (!isPlaying) return;

    timer.current = setInterval(() => {
      setRevealed((current) => {
        if (current === undefined) return current;
        const next = current + 1;
        // Land exactly on the full set and stop — the effect tears the interval
        // down on the re-render, so it never ticks past the end.
        return next >= frames.length ? frames.length : next;
      });
    }, frameMs);

    return () => clearInterval(timer.current);
  }, [isPlaying, frames.length, frameMs]);

  function play() {
    if (!playable) return;

    // Reduced motion: the animation is the only carrier of this information, so
    // per design.md it survives rather than stopping — it jumps to the end and
    // shows the final value instead of stepping there. A reader who asked for
    // less motion still gets the answer, just not the journey.
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    setRevealed(reduced ? frames.length : 1);
  }

  const shownFrames = revealed === undefined ? frames : frames.slice(0, revealed);
  const currentFrame = shownFrames[shownFrames.length - 1];

  const chartData = shownFrames.map((frame) => ({
    period: frame.periodLabel,
    total: centsToDollars(frame.totalValueCents),
    stock: centsToDollars(frame.stockValueCents),
    etf: centsToDollars(frame.etfValueCents),
  }));

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <ViewModeSwitch
          options={STEP_OPTIONS}
          value={step}
          onChange={setStep}
          label="Playback"
          className="max-lg:w-full"
        />
        <Button onClick={play} disabled={!playable || isPlaying} className="max-lg:w-full">
          {isPlaying ? "Playing…" : "Playback History"}
        </Button>
      </div>

      {!playable ? (
        <p className="mt-3 text-xs text-muted">
          Not enough history yet for a {step} playback — there&apos;s only{" "}
          {frames.length === 0 ? "no captured period" : "one captured period"} at this step. Try a
          finer step, or keep capturing daily snapshots.
        </p>
      ) : (
        <>
          <BigValueReadout
            className="mt-4"
            label={isPlaying ? "Playing back" : "Latest close"}
            value={currentFrame ? formatCents(currentFrame.totalValueCents) : "—"}
            caption={
              currentFrame
                ? `${currentFrame.snapshotDate} · frame ${shownFrames.length} of ${frames.length}`
                : undefined
            }
            valueClassName={currentFrame ? gainClass(currentFrame.totalGainLossCents) : "text-ink"}
            live={isPlaying}
          />

          <ChartLine
            className="mt-2"
            data={chartData}
            series={[
              { key: "total", label: "Total" },
              { key: "stock", label: "Stock" },
              { key: "etf", label: "ETF" },
            ]}
            xKey="period"
            formatValue={(value) => formatCents(Math.round(value * 100))}
            // `linear`, unlike the day-by-day history chart above: these points
            // are period closes with real gaps between them, and a smoothed
            // curve would imply movement between two months that isn't recorded.
            curve="linear"
            pointLabels="last"
            // Drawn as a shadowed area rather than a bare line: the curve is the
            // thing being watched here, and a fill that fades out beneath it
            // gives the growing line some weight as it advances. The reader can
            // still switch back to a plain line from the chart's own toolbar.
            chartTypes={["area", "line"]}
            defaultChartType="area"
            gradientFill
            displayStorageKey="myhomebase:chart:stock-playback"
          />
          <p className="mt-1 text-xs text-muted">
            One point per {STEP_NOUN[step]} — the last close actually captured in that period.
            Press Playback History to draw it forward from the start.
          </p>
        </>
      )}
    </div>
  );
}
