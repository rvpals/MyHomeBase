"use client";

import { useCallback, useRef, useState } from "react";

// The client half of photo culling: chunking, progress, cancellation, and the verdict
// map the grids read.
//
// WHY THE SET IS SENT IN CHUNKS rather than one request. A server action is one POST
// that returns once -- there is no channel to report progress through and no way to
// interrupt it. Sending the set in pieces buys both:
//
//   - PROGRESS is real rather than indeterminate, because the client counts the chunks
//     it has back. A sweeping bar on a job that runs for a minute reads as a stalled
//     page.
//   - CANCEL stops actual work. The flag is checked between chunks, so pressing it
//     stops the NAS decoding within a chunk rather than merely abandoning a result that
//     keeps being computed.
//
// The cost is that duplicate grouping happens WITHIN a chunk, not across the whole set
// -- see `CHUNK_SIZE`.

/** One photograph's verdict, as the culling actions report it. */
export interface CullVerdict {
  relativePath: string;
  score: number;
  reason: string;
  isKeeper: boolean;
  rejectReason?: string;
  duplicateOf?: string;
}

/** What a culling action resolves to. Structurally matches both actions' results. */
export interface CullActionOutcome {
  ok: boolean;
  error?: string;
  photos?: CullVerdict[];
  keeperCount?: number;
  requested?: number;
  examined?: number;
  wasTruncated?: boolean;
  unreadable?: string[];
}

/**
 * How many photographs travel in one request.
 *
 * THE TRADE-OFF THIS NUMBER SETS: duplicates are grouped within a chunk, so two
 * near-identical pictures land in the same group only when they land in the same
 * request. Larger chunks group better and cancel more slowly; smaller ones cancel
 * promptly and miss cross-chunk duplicates.
 *
 * Forty because the archive's duplicates are bursts -- consecutive frames of the same
 * moment, which sit next to each other in any ordering the gallery shows. A burst
 * longer than forty frames is rare enough to accept missing, and at roughly a few
 * hundred milliseconds per photograph over SMB a chunk is a handful of seconds, which
 * is how long Cancel takes to bite.
 */
const CHUNK_SIZE = 40;

export interface CullingState {
  /** Verdicts by relative path, or `undefined` before the first cull. */
  verdicts?: Record<string, CullVerdict>;
  /** How many photographs survived. */
  keeperCount?: number;
  /** How many were scored. */
  examined?: number;
  /** How many could not be read at all. */
  unreadableCount?: number;
  /** True while a cull is running. */
  isCulling: boolean;
  /** Photographs judged so far, for the progress bar. */
  progressDone: number;
  /** Photographs the run set out to judge. */
  progressTotal: number;
  /** A failed cull. */
  error?: string;
  /** True when the reader stopped it partway. */
  wasCancelled: boolean;
}

const IDLE: CullingState = {
  isCulling: false,
  progressDone: 0,
  progressTotal: 0,
  wasCancelled: false,
};

/**
 * Runs a cull in cancellable chunks and holds its verdicts.
 *
 * @param cull The server action to call with each chunk of paths.
 * @returns The state the UI renders, plus `start`, `cancel` and `reset`.
 */
export function useCulling(cull: (relativePaths: string[]) => Promise<CullActionOutcome>) {
  const [state, setState] = useState<CullingState>(IDLE);

  // A ref, not state: the loop below reads it between chunks and must see the CURRENT
  // value. A state variable captured when the loop started would stay false forever,
  // which is the bug that makes a cancel button do nothing.
  const cancelRef = useRef(false);

  const cancel = useCallback(() => {
    cancelRef.current = true;
  }, []);

  /** Drops the verdicts. For when the photo set itself changes. */
  const reset = useCallback(() => setState(IDLE), []);

  const start = useCallback(
    async (relativePaths: string[], keepCount?: number) => {
      if (relativePaths.length === 0) return;

      cancelRef.current = false;
      setState({
        isCulling: true,
        progressDone: 0,
        progressTotal: relativePaths.length,
        wasCancelled: false,
      });

      const verdicts: Record<string, CullVerdict> = {};
      let keeperCount = 0;
      let examined = 0;
      let unreadableCount = 0;

      for (let start = 0; start < relativePaths.length; start += CHUNK_SIZE) {
        // Checked BEFORE the request rather than after, so a cancel pressed during the
        // previous chunk costs no further reads.
        if (cancelRef.current) {
          setState((current) => ({
            ...current,
            isCulling: false,
            wasCancelled: true,
            // Partial verdicts are KEPT, not discarded: the reader asked to stop, not
            // to undo. What was judged is still true of the photographs it judged.
            verdicts,
            keeperCount,
            examined,
            unreadableCount,
          }));
          return;
        }

        const chunk = relativePaths.slice(start, start + CHUNK_SIZE);
        const result = await cull(chunk);

        if (!result.ok) {
          setState((current) => ({
            ...current,
            isCulling: false,
            error: result.error ?? "Culling failed.",
            // Whatever earlier chunks produced survives the failure, for the same
            // reason a cancel keeps its partial result.
            verdicts: Object.keys(verdicts).length > 0 ? verdicts : undefined,
            keeperCount,
            examined,
            unreadableCount,
          }));
          return;
        }

        for (const verdict of result.photos ?? []) verdicts[verdict.relativePath] = verdict;
        keeperCount += result.keeperCount ?? 0;
        examined += result.examined ?? 0;
        unreadableCount += result.unreadable?.length ?? 0;

        setState((current) => ({
          ...current,
          progressDone: Math.min(start + chunk.length, relativePaths.length),
        }));
      }

      // The keep limit is applied HERE, across the whole stitched result, not inside
      // each request. "The best 20" of a 200-photograph set is not "the best 20 of each
      // chunk of 40" -- asking the server per chunk would keep five times too many and
      // call it a limit.
      const limited = applyKeepLimit(verdicts, keepCount);

      setState({
        isCulling: false,
        progressDone: relativePaths.length,
        progressTotal: relativePaths.length,
        wasCancelled: false,
        verdicts: limited.verdicts,
        keeperCount: limited.keeperCount,
        examined,
        unreadableCount,
      });
    },
    [cull],
  );

  return { ...state, start, cancel, reset };
}

/**
 * Demotes all but the best `keepCount` keepers.
 *
 * Returns the verdicts unchanged when no limit was asked for, which is the default --
 * culling always groups duplicates, but discarding on a score threshold nobody chose is
 * hard to trust.
 *
 * A demoted photograph keeps its score and reason and gains `rejectReason: "low score"`,
 * so the grid can say WHY it dimmed rather than just dimming it.
 */
function applyKeepLimit(
  verdicts: Record<string, CullVerdict>,
  keepCount?: number,
): { verdicts: Record<string, CullVerdict>; keeperCount: number } {
  const keepers = Object.values(verdicts).filter((verdict) => verdict.isKeeper);

  if (keepCount === undefined || keepCount >= keepers.length) {
    return { verdicts, keeperCount: keepers.length };
  }

  const survivors = new Set(
    [...keepers]
      .sort((left, right) => right.score - left.score || left.relativePath.localeCompare(right.relativePath))
      .slice(0, Math.max(0, Math.floor(keepCount)))
      .map((verdict) => verdict.relativePath),
  );

  const next: Record<string, CullVerdict> = {};
  for (const [path, verdict] of Object.entries(verdicts)) {
    next[path] =
      verdict.isKeeper && !survivors.has(path)
        ? { ...verdict, isKeeper: false, rejectReason: "low score" }
        : verdict;
  }

  return { verdicts: next, keeperCount: survivors.size };
}
