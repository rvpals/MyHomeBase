"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { PhotoLightbox, type LightboxPhoto } from "@/components/photo-lightbox";
import type { PhotoFile, PhotoFolder } from "@/lib/journal-photos";
import {
  findPhotoFoldersAction,
  listPhotosInFolderAction,
  type PhotoFoldersResult,
} from "./journal-photos-actions";

// "Pictures of this date" — the entry viewer's card for photographs taken on the day
// the entry describes.
//
// Route-local, not a shared component: it is one screen's arrangement of two things
// that ARE shared (CollapsibleCard, PhotoLightbox) wired to this module's actions.
// Nothing else shows a journal entry's photos.
//
// Nothing touches the NAS until the button is pressed. The archive lives on a share
// that can be slow or offline, and an entry page must render regardless — so this is a
// button rather than a fetch on mount.

/** How many photos to show before the grid asks to be expanded. */
const INITIAL_GRID_LIMIT = 24;

/** The URL for one photo's bytes. Encoded whole: these folder names contain spaces. */
function photoUrl(relativePath: string): string {
  return `/api/journal/photos?path=${encodeURIComponent(relativePath)}`;
}

/** `2019-06-09` -> `06-09-2019`, the format the card's title shows. */
function toDisplayDate(date: string): string {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return date;
  return `${match[2]}-${match[3]}-${match[1]}`;
}

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
      // Mirrors the action's type rather than restating the union, so a cause added in
      // lib/ shows up here as a type error instead of falling into a generic message.
      reason?: PhotoFoldersResult["reason"];
      rootPath?: string;
      folders: PhotoFolder[];
    };

/**
 * What went wrong with the photo root, and what to do about it.
 *
 * Each cause names its own fix, and points at the Configuration screen where the path
 * lives. The first version collapsed all of them into "isn't configured or can't be
 * reached", which was true and useless: it could not distinguish a typo'd path from a
 * share the app's user was not allowed to read.
 */
function rootProblemMessage(
  reason: PhotoFoldersResult["reason"],
  rootPath?: string,
): { headline: string; detail: string } {
  const shown = rootPath && rootPath !== "" ? rootPath : "(unset)";

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

export function JournalPhotosCard({ date }: { date: string }) {
  const [lookup, setLookup] = useState<LookupState>({ phase: "idle" });
  // Keyed by relativePath: several folders can be open at once, and each remembers
  // its own scan result so re-opening one doesn't re-scan the month.
  const [folderStates, setFolderStates] = useState<Record<string, FolderState>>({});
  const [openFolders, setOpenFolders] = useState<string[]>([]);
  const [lightbox, setLightbox] = useState<{ photos: LightboxPhoto[]; index: number } | undefined>(
    undefined,
  );

  const handleCheck = useCallback(async () => {
    setLookup({ phase: "loading" });
    const result = await findPhotoFoldersAction(date);
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
  }, [date]);

  const loadFolder = useCallback(
    async (folder: PhotoFolder, includeAll: boolean) => {
      setFolderStates((current) => ({
        ...current,
        [folder.relativePath]: { isLoading: true, visibleCount: INITIAL_GRID_LIMIT },
      }));

      const result = await listPhotosInFolderAction(date, folder.relativePath, includeAll);

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
    [date],
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

  return (
    <>
      <CollapsibleCard title={`Pictures of this date (${toDisplayDate(date)})`}>
        {lookup.phase === "idle" && (
          <div className="flex flex-col gap-2">
            <Button size="sm" onClick={handleCheck}>
              Check if photos available
            </Button>
            <p className="text-xs text-muted">
              Looks in the photo archive for folders from this date. Nothing is read until
              you ask.
            </p>
          </div>
        )}

        {lookup.phase === "loading" && (
          <p className="text-sm text-muted">Looking for folders from this date…</p>
        )}

        {lookup.phase === "error" && (
          <div className="flex flex-col items-start gap-2">
            <p className="text-sm text-red-400">{lookup.message}</p>
            <Button size="sm" variant="secondary" onClick={handleCheck}>
              Try again
            </Button>
          </div>
        )}

        {lookup.phase === "done" && (
          <div className="flex flex-col gap-3">
            {!lookup.isAvailable &&
              (() => {
                const { headline, detail } = rootProblemMessage(lookup.reason, lookup.rootPath);
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
                  ? `No photos are filed under ${date.slice(0, 4)}.`
                  : "No photo folders found for this date."}
              </p>
            )}

            {lookup.folders.map((folder) => (
              <FolderRow
                key={folder.relativePath}
                folder={folder}
                date={date}
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
                <Button size="sm" variant="secondary" onClick={handleCheck}>
                  Check again
                </Button>
              </div>
            )}
          </div>
        )}
      </CollapsibleCard>

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
 * One matched folder: a clickable header, and its thumbnail grid once opened.
 *
 * A day folder and a month folder read differently on purpose. The day folder states
 * its photo count up front, because every photo in it belongs to the date. The month
 * folder can't — knowing how many of its photos were taken on the day means reading
 * them all — so it offers to be scanned instead of promising a number.
 */
function FolderRow({
  folder,
  date,
  isOpen,
  state,
  onToggle,
  onShowWholeMonth,
  onShowMore,
  onOpenPhoto,
}: {
  folder: PhotoFolder;
  date: string;
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
          {isMonth ? "Whole month" : "This day"}
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
                  ? `None of the ${state.examined} photos in ${folder.name} were taken on ${date}.`
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
                    ? `${photos.length} of ${state?.examined} photos in ${folder.name} were taken on ${date}.`
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
