// Turning captured daily snapshots into the frames of a playback animation.
//
// The dashboard's Portfolio History chart draws every captured day. Playback
// re-cuts that same history at a chosen step — one frame per day, week, month or
// year — and the view then reveals those frames in sequence so the curve draws
// itself forward.
//
// Every frame's value is a real recorded close, never an interpolation. A period
// is represented by the **last day actually captured inside it**: if the week
// ending Friday was only captured through Wednesday, Wednesday's close is that
// week's frame. That keeps the animation honest about a portfolio whose history
// has gaps — which this one does, since a snapshot exists only for days the
// reader pressed refresh.

import type { DailySnapshot } from "@/lib/stock-daily-snapshot";
import type { PlaybackFrame, PlaybackStep } from "./types";

/** Playback needs at least this many frames to be an animation rather than a dot. */
export const MIN_PLAYBACK_FRAMES = 2;

/**
 * The bucket key a snapshot date falls in, for the given step.
 *
 * Weekly buckets are ISO weeks keyed by their Monday, so a week is a stable span
 * rather than "seven days back from whenever we started". Monthly and yearly are
 * plain date-prefix cuts, which is why they need no date arithmetic at all.
 *
 * Dates are "YYYY-MM-DD" local-calendar strings and are treated as such: the
 * weekly case parses to UTC deliberately, so the arithmetic can't be shifted
 * across a day boundary by the runner's timezone.
 */
function bucketKey(snapshotDate: string, step: PlaybackStep): string {
  // Daily is the degenerate cut: the day is its own period, so every captured
  // snapshot becomes a frame and nothing is collapsed.
  if (step === "daily") return snapshotDate;
  if (step === "yearly") return snapshotDate.slice(0, 4);
  if (step === "monthly") return snapshotDate.slice(0, 7);

  const date = new Date(`${snapshotDate}T00:00:00Z`);
  // getUTCDay(): 0 = Sunday. Shift so Monday starts the week.
  const dayOfWeek = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayOfWeek);
  return date.toISOString().slice(0, 10);
}

/**
 * How a frame labels the period it stands for. The chart's x-axis shows this, so
 * it has to stay short — the full date is in the frame's `snapshotDate`, which
 * the big readout shows alongside the value.
 */
function bucketLabel(key: string, step: PlaybackStep): string {
  if (step === "daily") return key;
  if (step === "yearly") return key;
  if (step === "monthly") return key;
  return `w/c ${key}`;
}

/**
 * Roll `snapshots` up into one frame per period, oldest first.
 *
 * Input need not be sorted; output always is. Snapshots are grouped by period
 * and each group contributes its latest captured day — so the returned frames
 * are a subsequence of the real closes, carrying all three value series the
 * chart draws (total, stock, ETF) plus the day's move.
 *
 * Returns `[]` for no input. A caller showing a Play button should check
 * `MIN_PLAYBACK_FRAMES` rather than just truthiness: one frame is a still.
 */
export function buildPlaybackFrames(
  snapshots: DailySnapshot[],
  step: PlaybackStep,
): PlaybackFrame[] {
  const latestPerBucket = new Map<string, DailySnapshot>();

  for (const snapshot of snapshots) {
    const key = bucketKey(snapshot.snapshotDate, step);
    const held = latestPerBucket.get(key);
    // Strictly later wins, so a duplicated date can't reorder a settled bucket.
    if (!held || snapshot.snapshotDate > held.snapshotDate) {
      latestPerBucket.set(key, snapshot);
    }
  }

  return [...latestPerBucket.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, snapshot]) => ({
      periodKey: key,
      periodLabel: bucketLabel(key, step),
      snapshotDate: snapshot.snapshotDate,
      totalValueCents: snapshot.totalValueCents,
      stockValueCents: snapshot.stockValueCents,
      etfValueCents: snapshot.etfValueCents,
      totalGainLossCents: snapshot.totalGainLossCents,
    }));
}

/**
 * How long one frame should hold, in milliseconds, for a run of `frameCount`.
 *
 * Playback is paced by *total* duration rather than a fixed per-frame tick, so
 * every step feels the same length regardless of how it cut the history. A flat
 * tick doesn't survive the spread: at 600ms the same history is a 1-second
 * monthly blink and a 22-second daily sit.
 *
 * `TARGET_PLAYBACK_MS` is the budget; the per-frame result is clamped so a short
 * run doesn't flash past (the floor) and a very long history doesn't become a
 * flicker (the ceiling). A history long enough to hit the floor therefore does
 * run longer than the target — the floor wins, because legibility is the point.
 *
 * Fifteen seconds rather than ten: at ten the daily step was technically
 * followable but gave you no time to sit on any one value, and watching the
 * number is half the point of a playback.
 */
export const TARGET_PLAYBACK_MS = 15_000;
export const MIN_FRAME_MS = 120;
export const MAX_FRAME_MS = 600;

export function playbackFrameMs(frameCount: number): number {
  if (frameCount <= 0) return MAX_FRAME_MS;
  const paced = TARGET_PLAYBACK_MS / frameCount;
  return Math.round(Math.min(MAX_FRAME_MS, Math.max(MIN_FRAME_MS, paced)));
}

/**
 * Whether `frames` can actually be played back.
 *
 * Split out so the view asks the library rather than hard-coding the threshold
 * next to its disabled state — the reason a yearly playback is unavailable is a
 * fact about the data, not a UI detail.
 */
export function canPlayBack(frames: PlaybackFrame[]): boolean {
  return frames.length >= MIN_PLAYBACK_FRAMES;
}
