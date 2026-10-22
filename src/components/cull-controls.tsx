"use client";

import { Button } from "./button";

// The culling controls: a button, the counts it produced, and the dim toggle.
//
// Reusable because three Picture Gallery sections need exactly this row -- Magic List,
// Albums and Favorite Photos -- and a third hand-rolled copy is how three versions of
// the same wording drift apart. The DIMMING itself stays in each view, because each
// grid has its own markup; only the controls and the sentence are shared.
//
// Pure presentation: it holds no cull state and performs no cull. The view owns the
// request, the verdicts and the busy flag, and passes the facts down.
//
// NOT used by the journal's photo dialog, which renders its own inline version. That
// dialog is a `Modal` with several folders open at once, each culling independently, so
// its controls live per folder row rather than once per screen -- see
// `photo-of-the-day.tsx`.

export interface CullControlsProps {
  /** How many photographs the view is offering to cull. */
  total: number;
  /** True while a cull is in flight; the button is replaced by a progress line. */
  isCulling: boolean;
  /** How many survived, or `undefined` before the first cull. */
  keeperCount?: number;
  /**
   * How many the view asked about, when that is larger than `examined`.
   *
   * Reported rather than hidden: a cull that silently judged the first 300 of 412
   * would give counts that do not describe the set the reader is looking at.
   */
  requested?: number;
  /** How many were actually scored. */
  examined?: number;
  /** True when the set exceeded the ceiling and the tail was not scored. */
  wasTruncated?: boolean;
  /** How many files could not be read or decoded at all. */
  unreadableCount?: number;
  /** Whether the grid is dimming set-aside photographs right now. */
  isShowingCull: boolean;
  /** A cull that failed, shown in place rather than replacing the grid. */
  error?: string;
  /**
   * The best-N limit, or `undefined` for duplicates-only.
   *
   * Off by default, deliberately: culling always groups duplicates, but discarding on a
   * score threshold nobody chose is hard to trust. The reader asks for it.
   */
  keepCount?: number;
  onKeepCountChange: (keepCount: number | undefined) => void;
  onCull: () => void;
  onToggleCullView: () => void;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

export function CullControls({
  total,
  isCulling,
  keeperCount,
  requested,
  examined,
  wasTruncated = false,
  unreadableCount = 0,
  isShowingCull,
  error,
  keepCount,
  onKeepCountChange,
  onCull,
  onToggleCullView,
  className = "",
}: CullControlsProps) {
  const hasCulled = keeperCount !== undefined;
  const setAside = hasCulled && examined !== undefined ? examined - keeperCount : 0;

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        {isCulling ? (
          <p className="text-sm text-muted">Culling {total} photograph{total === 1 ? "" : "s"}…</p>
        ) : (
          <>
            <Button size="sm" variant="secondary" onClick={onCull} disabled={total === 0}>
              {hasCulled ? "Cull again" : "Cull"}
            </Button>

            {/* The best-N box. A blank value means duplicates-only, which is why this
                is a text-ish number input rather than a stepper with a floor of 1 --
                there has to be an "off". */}
            <label className="flex items-center gap-1.5 text-sm text-muted">
              <span>keep best</span>
              <input
                type="number"
                min={1}
                max={total === 0 ? 1 : total}
                step={1}
                value={keepCount === undefined ? "" : String(keepCount)}
                placeholder="all"
                onChange={(event) => {
                  const raw = event.target.value.trim();
                  if (raw === "") {
                    onKeepCountChange(undefined);
                    return;
                  }
                  const parsed = Number(raw);
                  onKeepCountChange(
                    Number.isInteger(parsed) && parsed > 0 ? parsed : undefined,
                  );
                }}
                aria-label="Keep only the best this many photographs"
                className="w-20 rounded-md border border-line bg-paper px-2 py-1 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
              />
            </label>

            {hasCulled && (
              <>
                <span className="text-sm text-muted">
                  {examined} image{examined === 1 ? "" : "s"}
                  {" · "}
                  <strong className="font-semibold text-ink">
                    {keeperCount} keeper{keeperCount === 1 ? "" : "s"}
                  </strong>
                  {setAside > 0 && ` · ${setAside} set aside`}
                </span>
                <Button size="sm" variant="secondary" onClick={onToggleCullView}>
                  {isShowingCull ? "Undim all" : "Dim set-aside"}
                </Button>
              </>
            )}
          </>
        )}
      </div>

      {wasTruncated && requested !== undefined && examined !== undefined && (
        <p className="text-sm text-muted">
          Culled the first {examined} of {requested} photographs — the remaining{" "}
          {requested - examined} {requested - examined === 1 ? "was" : "were"} not scored.
          The counts above describe only what was judged.
        </p>
      )}

      {unreadableCount > 0 && (
        <p className="text-sm text-muted">
          {unreadableCount} file{unreadableCount === 1 ? " was" : "s were"} unreadable and
          could not be scored.
        </p>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
