"use client";

// "Merging & Dedup": the Location Manager's dialog for folding duplicate places
// into one.
//
// The library fills from two directions — places typed by hand and places built
// in bulk from coordinates already on entries — so the same shop arrives twice
// under names differing by an apostrophe or a pin nudged a few metres. This
// screen surfaces those pairs and lets the reader resolve each one.
//
// **The reader picks the survivor; nothing here decides.** Each group offers a
// radio per place ("keep this one") and merges the rest into it. The scan is a
// suggestion — see `lib/journal-locations/dedup.ts` — so a group can also be
// skipped outright, and nothing is written until Merge is pressed.
//
// Route-local rather than registered: only the Journal has a location library.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { Modal } from "@/components/modal";
import {
  DEFAULT_DISTANCE_METRES,
  DEFAULT_NAME_THRESHOLD,
  MAX_DISTANCE_METRES,
  MAX_NAME_THRESHOLD,
  MIN_DISTANCE_METRES,
  MIN_NAME_THRESHOLD,
  type LocationDuplicateGroup,
} from "@/lib/journal-locations";
import {
  findLocationDuplicatesAction,
  mergeSavedLocationsAction,
} from "./journal-location-dedup-actions";

/**
 * A group's heading. Blank when every member is unnamed, which is now a real
 * group rather than something the scan skips — so it needs words of its own.
 */
function groupHeading(group: LocationDuplicateGroup): string {
  return group.label !== "" ? group.label : "Unnamed places at one spot";
}

/** "38 m apart" / "1.2 km apart" — how far a copy sits from the group's first. */
function formatDistance(metres: number): string {
  if (metres === 0) return "same point";
  if (metres < 1000) return `${metres} m apart`;
  return `${(metres / 1000).toFixed(1)} km apart`;
}

export function JournalLocationDedupModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [threshold, setThreshold] = useState(DEFAULT_NAME_THRESHOLD);
  const [maxMetres, setMaxMetres] = useState(DEFAULT_DISTANCE_METRES);
  // `undefined` while the first scan runs, so the empty state doesn't flash.
  const [groups, setGroups] = useState<LocationDuplicateGroup[] | undefined>(undefined);
  /** group key → the id the reader wants to keep. Defaults to the first member. */
  const [survivors, setSurvivors] = useState<Record<string, number>>({});
  /** Group keys the reader has dismissed this session. Not persisted. */
  const [skipped, setSkipped] = useState<string[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [busyGroup, setBusyGroup] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  /**
   * Adopts a fresh set of groups, keeping any survivor choice the reader has
   * already made for a group that survived the rescan. Re-defaulting every
   * group after each merge would throw away those choices.
   */
  const adoptGroups = useCallback((next: LocationDuplicateGroup[]) => {
    setGroups(next);
    setSurvivors((current) => {
      const merged: Record<string, number> = {};
      for (const group of next) {
        const chosen = current[group.key];
        const stillThere = chosen !== undefined && group.locations.some((p) => p.id === chosen);
        merged[group.key] = stillThere ? chosen : group.locations[0].id;
      }
      return merged;
    });
  }, []);

  const scan = useCallback(
    async (value: number, metres: number) => {
      setIsScanning(true);
      setError(undefined);
      try {
        const result = await findLocationDuplicatesAction(value, metres);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        adoptGroups(result.groups ?? []);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Failed to scan for duplicates.");
      } finally {
        setIsScanning(false);
      }
    },
    [adoptGroups],
  );

  // The opening scan. Threshold changes re-scan from the slider's commit
  // handler instead of an effect keyed on `threshold`, so dragging the slider
  // doesn't fire a scan per pixel.
  useEffect(() => {
    void scan(DEFAULT_NAME_THRESHOLD, DEFAULT_DISTANCE_METRES);
  }, [scan]);

  async function runMerge(group: LocationDuplicateGroup) {
    const keepId = survivors[group.key] ?? group.locations[0].id;
    const removeIds = group.locations.map((place) => place.id).filter((id) => id !== keepId);
    if (removeIds.length === 0) return;

    setBusyGroup(group.key);
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await mergeSavedLocationsAction(keepId, removeIds, threshold, maxMetres);
      if (!result.ok) {
        setError(result.error ?? "Failed to merge those locations.");
        return;
      }
      const moved = result.movedCount ?? 0;
      const removed = result.removedCount ?? 0;
      setNotice(
        `Merged ${removed} ${removed === 1 ? "place" : "places"} into "${groupHeading(group)}".` +
          (moved > 0
            ? ` ${moved} journal ${moved === 1 ? "entry now points" : "entries now point"} at it.`
            : ""),
      );
      adoptGroups(result.groups ?? []);
      // The manager's list and map behind this dialog are now stale.
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to merge those locations.");
    } finally {
      setBusyGroup(undefined);
    }
  }

  const visible = (groups ?? []).filter((group) => !skipped.includes(group.key));
  const isBusy = isScanning || busyGroup !== undefined;

  return (
    <Modal onClose={onClose} isBusy={busyGroup !== undefined} size="lg" title="Merging & Dedup">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          Places close enough together to be the same spot, whose names agree — or that
          have no name to disagree. Pick the one to{" "}
          <span className="text-ink">keep</span> in each group — the others are deleted, and
          every journal entry pointing at them is moved onto the one you keep.
        </p>

        {error && <p className="text-sm text-red-400">{error}</p>}
        {notice && <p className="text-sm text-ink">{notice}</p>}

        {/* The two knobs. `onMouseUp`/`onKeyUp` commit rather than `onChange`,
            so dragging doesn't fire a scan per pixel. */}
        <label className="flex flex-wrap items-center gap-3 text-sm">
          <span className="font-medium text-ink">How similar</span>
          <input
            type="range"
            min={MIN_NAME_THRESHOLD}
            max={MAX_NAME_THRESHOLD}
            step={0.02}
            value={threshold}
            disabled={isBusy}
            onChange={(event) => setThreshold(Number(event.target.value))}
            onMouseUp={() => void scan(threshold, maxMetres)}
            onTouchEnd={() => void scan(threshold, maxMetres)}
            onKeyUp={() => void scan(threshold, maxMetres)}
            className="max-lg:w-full"
          />
          <span className="tabular-nums text-muted">{Math.round(threshold * 100)}%</span>
          <span className="text-xs text-muted">
            Lower finds more, and more false matches.
          </span>
        </label>

        {/* How far apart two pins may be. Separate from the name slider
            because they fail differently: a scan that finds nothing at every
            similarity is usually looking in too small a radius, and before
            this existed there was no way to say so. */}
        <label className="flex flex-wrap items-center gap-3 text-sm">
          <span className="font-medium text-ink">Within</span>
          <input
            type="range"
            min={MIN_DISTANCE_METRES}
            max={MAX_DISTANCE_METRES}
            step={5}
            value={maxMetres}
            disabled={isBusy}
            onChange={(event) => setMaxMetres(Number(event.target.value))}
            onMouseUp={() => void scan(threshold, maxMetres)}
            onTouchEnd={() => void scan(threshold, maxMetres)}
            onKeyUp={() => void scan(threshold, maxMetres)}
            className="max-lg:w-full"
          />
          <span className="tabular-nums text-muted">{maxMetres} m</span>
          <span className="text-xs text-muted">
            Wider catches a pin dropped twice; too wide merges neighbours.
          </span>
        </label>

        {groups === undefined ? (
          <p className="text-sm text-muted">Scanning the library…</p>
        ) : isScanning ? (
          <p className="text-sm text-muted">Rescanning…</p>
        ) : visible.length === 0 ? (
          <p className="text-sm text-muted">
            {(groups ?? []).length === 0
              ? "No duplicate places found at this setting. Drag the slider left to look harder."
              : "Every group has been handled or skipped."}
          </p>
        ) : (
          <>
            <p className="text-xs text-muted">
              {visible.length} {visible.length === 1 ? "group" : "groups"} to review.
            </p>

            {/* A plain list, not a DataGrid: the unit of work is a *group* with
                a choice in it, which a flat row-per-place table can't express. */}
            <ul className="flex flex-col gap-3">
              {visible.map((group) => {
                const keepId = survivors[group.key] ?? group.locations[0].id;
                return (
                  <li
                    key={group.key}
                    className="rounded-lg border border-line bg-paper-raised p-3"
                  >
                    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium text-ink">{groupHeading(group)}</span>
                      <span className="text-xs text-muted">
                        {group.locations.length} copies ·{" "}
                        {Math.round(group.confidence * 100)}%{" "}
                        {group.label === "" ? "proximity" : "name match"}
                      </span>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      {group.locations.map((place) => (
                        <label
                          key={place.id}
                          className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-paper"
                        >
                          <input
                            type="radio"
                            name={`keep-${group.key}`}
                            checked={place.id === keepId}
                            disabled={isBusy}
                            onChange={() =>
                              setSurvivors((current) => ({ ...current, [group.key]: place.id }))
                            }
                            className="mt-1"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-ink">
                              {place.name === "" ? "(unnamed)" : place.name}
                              {place.id === keepId && (
                                <span className="ml-2 text-xs text-brass">keep</span>
                              )}
                            </span>
                            {place.address !== "" && (
                              <span className="block truncate text-xs text-muted">
                                {place.address}
                              </span>
                            )}
                            <span className="block text-xs text-muted">
                              used {place.usageCount}{" "}
                              {place.usageCount === 1 ? "time" : "times"} ·{" "}
                              {formatDistance(place.metresFromFirst)}
                              {place.categories.length + place.tags.length > 0 &&
                                ` · ${[...place.categories, ...place.tags].join(", ")}`}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>

                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        disabled={isBusy}
                        onClick={() => void runMerge(group)}
                      >
                        {busyGroup === group.key
                          ? "Merging…"
                          : `Merge ${group.locations.length - 1} into this`}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={isBusy}
                        onClick={() => setSkipped((current) => [...current, group.key])}
                      >
                        Not duplicates
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose} disabled={busyGroup !== undefined}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
