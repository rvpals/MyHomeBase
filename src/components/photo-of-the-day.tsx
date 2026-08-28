// "Photo of the Day" — a dialog that finds the photographs taken on one date, or
// anywhere inside a date range, and shows them as a browsable grid.
//
// The generalisation of the journal entry viewer's "Pictures of this date" card, which
// now calls this instead of holding its own copy. Two things changed on the way to
// being reusable:
//
//   - It takes EITHER a `date` or a `range`, so one component answers "what did I
//     photograph on the 27th?" and "what did I photograph this month?".
//   - It closes. The card was parked inside a page; this opens over whatever called it
//     and returns the reader there, which is what a calendar cell needs.
//
// Pure presentation, per `components.md`: it fetches nothing itself. The two lookups
// arrive as async props from the route that owns the server actions, because
// `src/components/` may not import them.

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/button";
import { Modal } from "@/components/modal";
import { PhotoLightbox, type LightboxPhoto } from "@/components/photo-lightbox";
import { SlotIcon } from "@/components/slot-icon";
import { getIconSlot } from "@/lib/icons";
import type { PhotoFile, PhotoFolder } from "@/lib/journal-photos";

// Resolved once at module scope; the registry is static, so this is not I/O.
const PHOTO_SLOT = getIconSlot("homescreen_card_photo_of_the_day")!;

/** How many photos to show before the grid asks to be expanded. */
const INITIAL_GRID_LIMIT = 24;

/** A span of dates, inclusive at both ends. */
export interface PhotoDateRange {
  /** `YYYY-MM-DD`, on or before `to`. */
  from: string;
  /** `YYYY-MM-DD`. */
  to: string;
}

/**
 * Why the photo root could not be used, mirrored from the lookup's own union.
 *
 * Restated here as a string union rather than imported as a type from the domain,
 * because a component may take domain *types* but this one is really the wire shape of
 * whatever the caller's action returns — and every caller has to be able to produce it.
 */
export type PhotoLookupReason =
  | "ok"
  | "not-configured"
  | "missing"
  | "no-permission"
  | "not-a-directory"
  | "unreachable"
  | "no-year-folder";

/** What the caller's folder lookup returns. */
export interface PhotoFoldersOutcome {
  ok: boolean;
  error?: string;
  isAvailable?: boolean;
  reason?: PhotoLookupReason;
  rootPath?: string;
  folders?: PhotoFolder[];
}

/** What the caller's folder-contents lookup returns. */
export interface PhotoContentsOutcome {
  ok: boolean;
  error?: string;
  photos?: PhotoFile[];
  examined?: number;
  isEmptyAfterFilter?: boolean;
}

export interface PhotoOfTheDayProps {
  /**
   * A single day, `YYYY-MM-DD`. Mutually exclusive with `range` — pass exactly one.
   *
   * Not a union type, because the two callers that pass these are React event handlers
   * building an object, and a discriminated union there costs more at every call site
   * than the one runtime check below is worth.
   */
  date?: string;
  /** A span of days. Mutually exclusive with `date`. */
  range?: PhotoDateRange;
  /**
   * Finds the folders holding photos for the date or range. Cheap by contract: names
   * and counts only, nothing opened.
   */
  onFindFolders: (query: PhotoQuery) => Promise<PhotoFoldersOutcome>;
  /**
   * Lists one folder's photos. Expensive for a month folder — it reads the head of
   * every JPEG in it — so it is only called when a folder is actually opened.
   */
  onListPhotos: (
    query: PhotoQuery,
    relativePath: string,
    includeAll: boolean,
  ) => Promise<PhotoContentsOutcome>;
  /** Builds the URL for one photo's bytes from its archive-relative path. */
  photoUrl: (relativePath: string) => string;
  /** Raised by Escape, the ✕, and an overlay click. Returns the reader to the caller. */
  onClose: () => void;
  /**
   * Look for the photos on mount instead of waiting for the button.
   *
   * Default false, which is the entry card's behaviour and the safe one: the archive
   * lives on a share that can be slow or offline. A caller that opened this dialog
   * *specifically* to see photos (a calendar cell's photo button) should pass true —
   * there, the button press already was the "go and look" instruction.
   */
  autoLookup?: boolean;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

/** The question being asked of the archive: one day, or a span of them. */
export type PhotoQuery = { date: string } | { from: string; to: string };

/** What is known about one folder's contents once it has been opened. */
interface FolderState {
  isLoading: boolean;
  photos?: PhotoFile[];
  examined?: number;
  isEmptyAfterFilter?: boolean;
  /** True once "show the whole month" has been used, so the label can say so. */
  isShowingAll?: boolean;
  error?: string;
  /** How many of `photos` the grid is currently rendering. */
  visibleCount: number;
}

type LookupState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | {
      phase: "done";
      isAvailable: boolean;
      reason?: PhotoLookupReason;
      rootPath?: string;
      folders: PhotoFolder[];
    };

export function PhotoOfTheDay({
  date,
  range,
  onFindFolders,
  onListPhotos,
  photoUrl,
  onClose,
  autoLookup = false,
  className = "",
}: PhotoOfTheDayProps) {
  // Memoized on its contents rather than rebuilt each render: it is a dependency of
  // both lookups below, and an object literal would give them a new identity every
  // render -- which would re-arm the auto-lookup effect on each one.
  // Pulled apart into two strings first, so the memo below can depend on values the
  // caller keeps stable rather than on a `range` object literal that is new every
  // render -- depending on that object would defeat the memo entirely.
  const rangeFrom = range?.from;
  const rangeTo = range?.to;

  const query = useMemo<PhotoQuery | undefined>(
    () =>
      date !== undefined
        ? { date }
        : rangeFrom !== undefined && rangeTo !== undefined
          ? { from: rangeFrom, to: rangeTo }
          : undefined,
    [date, rangeFrom, rangeTo],
  );

  const [lookup, setLookup] = useState<LookupState>(
    // `autoLookup` starts in `loading` rather than firing an effect, so the first paint
    // already says "looking" instead of flashing the button for one frame.
    autoLookup && query !== undefined ? { phase: "loading" } : { phase: "idle" },
  );
  // Keyed by relativePath: several folders can be open at once, and each remembers its
  // own scan result so re-opening one doesn't re-scan the month.
  const [folderStates, setFolderStates] = useState<Record<string, FolderState>>({});
  const [openFolders, setOpenFolders] = useState<string[]>([]);
  const [lightbox, setLightbox] = useState<{ photos: LightboxPhoto[]; index: number } | undefined>(
    undefined,
  );

  const handleCheck = useCallback(async () => {
    if (query === undefined) return;
    setLookup({ phase: "loading" });
    const result = await onFindFolders(query);
    if (!result.ok) {
      setLookup({ phase: "error", message: result.error ?? "Photo lookup failed." });
      return;
    }
    setLookup({
      phase: "done",
      isAvailable: result.isAvailable ?? false,
      reason: result.reason,
      rootPath: result.rootPath,
      folders: result.folders ?? [],
    });
  }, [onFindFolders, query]);

  useAutoLookup(autoLookup && query !== undefined, handleCheck);

  const loadFolder = useCallback(
    async (folder: PhotoFolder, includeAll: boolean) => {
      if (query === undefined) return;

      setFolderStates((current) => ({
        ...current,
        [folder.relativePath]: { isLoading: true, visibleCount: INITIAL_GRID_LIMIT },
      }));

      const result = await onListPhotos(query, folder.relativePath, includeAll);

      setFolderStates((current) => ({
        ...current,
        [folder.relativePath]: result.ok
          ? {
              isLoading: false,
              photos: result.photos ?? [],
              examined: result.examined,
              isEmptyAfterFilter: result.isEmptyAfterFilter,
              isShowingAll: includeAll,
              visibleCount: INITIAL_GRID_LIMIT,
            }
          : {
              isLoading: false,
              error: result.error ?? "Could not read the folder.",
              visibleCount: INITIAL_GRID_LIMIT,
            },
      }));
    },
    [onListPhotos, query],
  );

  function toggleFolder(folder: PhotoFolder) {
    const isOpen = openFolders.includes(folder.relativePath);
    if (isOpen) {
      setOpenFolders((current) => current.filter((path) => path !== folder.relativePath));
      return;
    }
    setOpenFolders((current) => [...current, folder.relativePath]);
    // Only scan the first time a folder is opened; the result is kept after that.
    if (folderStates[folder.relativePath] === undefined) void loadFolder(folder, false);
  }

  function openLightbox(folder: PhotoFolder, photos: PhotoFile[], index: number) {
    setLightbox({
      photos: photos.map((photo) => ({
        src: photoUrl(photo.relativePath),
        caption: photo.name,
        subcaption: folder.name,
      })),
      index,
    });
  }

  const totalFound =
    lookup.phase === "done"
      ? lookup.folders.reduce((sum, folder) => sum + folder.photoCount, 0)
      : 0;

  return (
    <>
      <Modal
        title={titleFor(date, range)}
        description={descriptionFor(date, range)}
        size="lg"
        onClose={onClose}
        className={className}
        footer={
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        }
      >
        {query === undefined ? (
          // A caller that passed neither. Said plainly rather than silently showing an
          // empty dialog, because it is a wiring bug and not an empty archive.
          <p className="text-sm text-red-400">
            No date was given. Pass either a <code>date</code> or a <code>range</code>.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {lookup.phase === "idle" && (
              <div className="flex flex-col items-start gap-2">
                <Button size="sm" onClick={() => void handleCheck()}>
                  Check if photos available
                </Button>
                <p className="text-xs text-muted">
                  Looks in the photo archive for folders from{" "}
                  {range === undefined ? "this date" : "these dates"}. Nothing is read
                  until you ask.
                </p>
              </div>
            )}

            {lookup.phase === "loading" && (
              <p className="text-sm text-muted">
                Looking for folders from {range === undefined ? "this date" : "these dates"}…
              </p>
            )}

            {lookup.phase === "error" && (
              <div className="flex flex-col items-start gap-2">
                <p className="text-sm text-red-400">{lookup.message}</p>
                <Button size="sm" variant="secondary" onClick={() => void handleCheck()}>
                  Try again
                </Button>
              </div>
            )}

            {lookup.phase === "done" && (
              <>
                {!lookup.isAvailable &&
                  (() => {
                    const { headline, detail } = rootProblemMessage(
                      lookup.reason,
                      lookup.rootPath,
                    );
                    return (
                      <div className="flex flex-col gap-1">
                        <p className="text-sm text-ink">{headline}</p>
                        <p className="text-xs text-muted">{detail}</p>
                      </div>
                    );
                  })()}

                {lookup.isAvailable && lookup.folders.length === 0 && (
                  <p className="text-sm text-muted">
                    {lookup.reason === "no-year-folder"
                      ? `No photos are filed under ${yearsOf(date, range)}.`
                      : "No photo folders found."}
                  </p>
                )}

                {lookup.folders.length > 0 && (
                  <p className="text-xs text-muted">
                    {lookup.folders.length === 1 ? "1 folder" : `${lookup.folders.length} folders`}
                    {", "}
                    {totalFound === 1 ? "1 photo" : `${totalFound} photos`} in them. Open one
                    to see its pictures.
                  </p>
                )}

                {lookup.folders.map((folder) => (
                  <FolderRow
                    key={folder.relativePath}
                    folder={folder}
                    matchLabel={matchLabelOf(folder, date)}
                    photoUrl={photoUrl}
                    isOpen={openFolders.includes(folder.relativePath)}
                    state={folderStates[folder.relativePath]}
                    onToggle={() => toggleFolder(folder)}
                    onShowWholeMonth={() => void loadFolder(folder, true)}
                    onShowMore={() =>
                      setFolderStates((current) => {
                        const existing = current[folder.relativePath];
                        if (existing === undefined) return current;
                        return {
                          ...current,
                          [folder.relativePath]: {
                            ...existing,
                            visibleCount: existing.visibleCount + INITIAL_GRID_LIMIT,
                          },
                        };
                      })
                    }
                    onOpenPhoto={(photos, index) => openLightbox(folder, photos, index)}
                  />
                ))}

                {lookup.folders.length > 0 && (
                  <div>
                    <Button size="sm" variant="secondary" onClick={() => void handleCheck()}>
                      Check again
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </Modal>

      {lightbox && (
        <PhotoLightbox
          photos={lightbox.photos}
          index={lightbox.index}
          onIndexChange={(index) => setLightbox({ photos: lightbox.photos, index })}
          onClose={() => setLightbox(undefined)}
        />
      )}
    </>
  );
}

/**
 * Runs the lookup once, on mount, when the caller asked for it.
 *
 * Its own hook so the dependency list can be exactly `[]` with the reason written down:
 * this must fire once per mount and never again. `run` changes whenever the date does,
 * but the dialog is remounted per date rather than re-pointed at a new one, so
 * re-running on that change could only ever mean a duplicate scan of the archive.
 *
 * The `hasRun` ref is what makes that true under React's development double-mount,
 * which would otherwise fire two scans of a thousand-photo month over SMB.
 */
function useAutoLookup(isEnabled: boolean, run: () => Promise<void>) {
  const hasRun = useRef(false);

  useEffect(() => {
    if (!isEnabled || hasRun.current) return;
    // Set before awaiting, so React's development double-mount cannot start a second
    // scan of a thousand-photo month over SMB.
    hasRun.current = true;
    void run();
  }, [isEnabled, run]);
}

/** The dialog's heading. */
function titleFor(date?: string, range?: PhotoDateRange): string {
  if (date !== undefined) return `Photo of the Day (${toDisplayDate(date)})`;
  if (range === undefined) return "Photo of the Day";
  return `Photos ${toDisplayDate(range.from)} – ${toDisplayDate(range.to)}`;
}

/** The sub-heading: how wide a net was cast, in plain words. */
function descriptionFor(date?: string, range?: PhotoDateRange): string {
  if (date !== undefined) return "Photographs filed under this date in the photo archive.";
  if (range === undefined) return "";
  const dayCount = daysBetween(range.from, range.to);
  return `Photographs filed anywhere in these ${dayCount} days.`;
}

/** `2019-06-09` -> `06-09-2019`, the format this app's dates read in. */
function toDisplayDate(date: string): string {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return date;
  return `${match[2]}-${match[3]}-${match[1]}`;
}

/** Inclusive day count of a range, for the sub-heading. */
function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.floor((end - start) / 86_400_000) + 1;
}

/** The year, or years, the query covers — for the "nothing filed" message. */
function yearsOf(date?: string, range?: PhotoDateRange): string {
  if (date !== undefined) return date.slice(0, 4);
  if (range === undefined) return "that year";
  const first = range.from.slice(0, 4);
  const last = range.to.slice(0, 4);
  return first === last ? first : `${first}–${last}`;
}

/**
 * The badge on a folder row: which day it is, or that it is a whole month.
 *
 * A single-date query says "This day", because there is only one and the title already
 * named it. A range says the actual date, since that is the one thing a reader scanning
 * thirty folders needs and cannot get from the title.
 */
function matchLabelOf(folder: PhotoFolder, queryDate?: string): string {
  if (folder.kind === "month") return "Whole month";
  if (queryDate !== undefined) return "This day";
  return folder.matchedDate === undefined ? "This day" : toDisplayDate(folder.matchedDate);
}

/**
 * What went wrong with the photo root, and what to do about it.
 *
 * Each cause names its own fix, and points at the Configuration screen where the path
 * lives. Collapsing them into one "isn't configured or can't be reached" was true and
 * useless: it could not distinguish a typo'd path from a share the app's user was not
 * allowed to read.
 */
function rootProblemMessage(
  reason: PhotoLookupReason | undefined,
  rootPath?: string,
): { headline: string; detail: string } {
  const shown = rootPath !== undefined && rootPath !== "" ? rootPath : "(unset)";

  switch (reason) {
    case "not-configured":
      return {
        headline: "No photo folder is set.",
        detail:
          "Set it in My Journal → Configuration → Photo folder, and use Check Access there to confirm the app can read it.",
      };
    case "missing":
      return {
        headline: `No folder at ${shown}.`,
        detail:
          "Correct the path in My Journal → Configuration, then press Check Access. On the NAS, mind the volume (/volume1 vs /volume2) and the exact capitalisation.",
      };
    case "no-permission":
      return {
        headline: `${shown} exists, but the app isn't allowed to read it.`,
        detail:
          "Grant the user the app runs as read access to that shared folder. Check Access in My Journal → Configuration reports this in detail.",
      };
    case "not-a-directory":
      return {
        headline: `${shown} is a file, not a folder.`,
        detail:
          "In My Journal → Configuration, point the photo folder at the directory that holds the year folders.",
      };
    default:
      return {
        headline: `Couldn't reach ${shown}.`,
        detail:
          "The path is configured but the filesystem didn't answer. If the archive is on a network share, check that it's mounted and the host is up.",
      };
  }
}

/**
 * One matched folder: a clickable header, and its thumbnail grid once opened.
 *
 * A day folder and a month folder read differently on purpose. The day folder states
 * its photo count up front, because every photo in it belongs to the date. The month
 * folder can't — knowing how many of its photos fall in the query means reading them
 * all — so it offers to be scanned instead of promising a number.
 */
function FolderRow({
  folder,
  matchLabel,
  photoUrl,
  isOpen,
  state,
  onToggle,
  onShowWholeMonth,
  onShowMore,
  onOpenPhoto,
}: {
  folder: PhotoFolder;
  matchLabel: string;
  /** Builds the URL for one photo's bytes, forwarded from the dialog's caller. */
  photoUrl: (relativePath: string) => string;
  isOpen: boolean;
  state?: FolderState;
  onToggle: () => void;
  onShowWholeMonth: () => void;
  onShowMore: () => void;
  onOpenPhoto: (photos: PhotoFile[], index: number) => void;
}) {
  const isMonth = folder.kind === "month";
  const photos = state?.photos ?? [];
  const visible = photos.slice(0, state?.visibleCount ?? 0);

  return (
    <div className="rounded-lg border border-line">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="flex w-full items-center gap-3 px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
      >
        <span className="shrink-0 text-brass-dark" aria-hidden>
          {isOpen ? "▾" : "▸"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-ink">
            {folder.label !== "" ? folder.label : folder.name}
          </span>
          {/* The folder's own name, then the count. The name is skipped when the label
              above already IS the name (a bare `2016-03`), rather than printing it
              twice. */}
          <span className="block truncate font-mono text-xs text-muted">
            {folder.label !== "" && `${folder.name} · `}
            {folder.photoCount} photo{folder.photoCount === 1 ? "" : "s"}
            {isMonth && " in this month"}
          </span>
        </span>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
            isMonth ? "bg-paper text-muted" : "bg-brass-soft text-brass-dark"
          }`}
        >
          {/* Says which kind of match this is, so a month folder never looks like it
              was named for the date. */}
          {matchLabel}
        </span>
      </button>

      {isOpen && (
        <div className="border-t border-line px-3 py-3">
          {state?.isLoading && (
            <p className="text-sm text-muted">
              {isMonth ? (
                <>
                  Reading the date each of {folder.photoCount} photos in {folder.name} was
                  taken…
                  {/* A cold folder of a thousand photos measured ~8ms per file over
                      SMB, so a big month really does take ten seconds. Saying so beats
                      a spinner that looks stuck. */}
                  {folder.photoCount > 400 && (
                    <span className="mt-1 block text-xs">
                      A folder this size can take a few seconds.
                    </span>
                  )}
                </>
              ) : (
                "Reading the folder…"
              )}
            </p>
          )}

          {state?.error && <p className="text-sm text-red-400">{state.error}</p>}

          {!state?.isLoading && !state?.error && photos.length === 0 && (
            <div className="flex flex-col items-start gap-2">
              <p className="text-sm text-muted">
                {state?.isEmptyAfterFilter
                  ? `None of the ${state.examined} photos in ${folder.name} were taken in this period.`
                  : "This folder has no photos."}
              </p>
              {state?.isEmptyAfterFilter && (
                <Button size="sm" variant="secondary" onClick={onShowWholeMonth}>
                  Show all {state.examined} photos from {folder.name}
                </Button>
              )}
            </div>
          )}

          {photos.length > 0 && (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-muted">
                {state?.isShowingAll
                  ? `All ${photos.length} photos in ${folder.name}.`
                  : isMonth
                    ? `${photos.length} of ${state?.examined} photos in ${folder.name} fall in this period.`
                    : `${photos.length} photos.`}
              </p>

              {/* Two columns on a phone, up to five on a wide screen. Desktop classes
                  are the base; the narrow case is the max-lg override, so a wide
                  screen can't regress. */}
              <ul className="grid grid-cols-5 gap-2 max-lg:grid-cols-3 max-sm:grid-cols-2">
                {visible.map((photo, index) => (
                  <li key={photo.relativePath}>
                    <button
                      type="button"
                      onClick={() => onOpenPhoto(photos, index)}
                      title={photo.name}
                      className="block w-full overflow-hidden rounded-md border border-line focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- the bytes
                          come from our own session-gated route over a NAS share, not a
                          static asset next/image can optimize. */}
                      <img
                        src={photoUrl(photo.relativePath)}
                        alt={photo.name}
                        // Lazy: a folder can hold hundreds, and the full-size JPEG is
                        // what gets scaled — nothing is written to the archive to make
                        // a thumbnail.
                        loading="lazy"
                        className="aspect-square w-full bg-paper object-cover transition-opacity hover:opacity-90"
                      />
                    </button>
                  </li>
                ))}
              </ul>

              {visible.length < photos.length && (
                <div>
                  <Button size="sm" variant="secondary" onClick={onShowMore}>
                    Show more ({photos.length - visible.length} left)
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A small photo button, for a caller that wants to *open* this dialog.
 *
 * Registered alongside the dialog rather than hand-rolled per caller, so the journal
 * calendar's per-day and per-month buttons are provably the same control — a reader
 * learns the glyph once. 24px square, which clears the 44px tap target only when the
 * cell around it is the real target; on a calendar day cell that is exactly the case.
 */
export function PhotoOfTheDayButton({
  hint,
  onOpen,
  className = "",
}: {
  /** The native tooltip and the accessible name. Say which photos it will show. */
  hint: string;
  onOpen: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={hint}
      aria-label={hint}
      onClick={(event) => {
        // The calendar's day cell is itself a click target ("select this day"), so a
        // press here must not also select the day.
        event.stopPropagation();
        onOpen();
      }}
      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted transition-colors hover:bg-brass-soft hover:text-brass-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${className}`}
    >
      <SlotIcon slot={PHOTO_SLOT} className="h-3.5 w-3.5" />
    </button>
  );
}
