"use client";

// The Magic Playlist screen: pick criteria, generate, play, save.
//
// All presentation. Every decision -- which tracks are eligible, how the target is filled,
// what a thin result means -- lives in src/lib/music-magic and arrives here as data. This
// file chooses layout and wording only.
//
// LAYOUT: three CollapsibleCards -- Criteria builder (open, with a collapsible card per
// picker inside it: Genres, Artists, Albums, Folder), Existing Magic Playlists (shut), and
// The Playlist last, since it is the output of the two above.
//
// NARROW SCREENS: restyled with `max-lg:` throughout, never switched. The criteria row is
// a 4-column grid that stacks to one; the pickers keep their own scroll; the action bar
// wraps. Nothing here needs a genuinely different component, so `useViewport()` is not
// read -- per design.md, that keeps the desktop classes provably untouched. The folder
// picker drills down in place rather than opening a sheet, so it needs no narrow variant
// either: it is a breadcrumb over a capped scroll list at every width.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { Modal } from "@/components/modal";
import { useMusicPlayer, type PlayableTrack } from "@/components/music-player-provider";
import {
  MAGIC_TARGET_PRESETS,
  emptyCriteria,
  formatRunningTime,
  hasAnyFilter,
  isFolderWithin,
  pruneRedundantFolders,
  type MagicCriteria,
  type MagicFolderOption,
  type MagicGenerationStats,
  type MagicListSummary,
} from "@/lib/music-magic";
import { recordPlayAction } from "./music-actions";
import {
  countMagicCandidatesAction,
  deleteMagicListAction,
  generateMagicAction,
  listMagicFolderOptionsAction,
  listMagicListsAction,
  listMagicOptionsAction,
  loadMagicListAction,
  regenerateMagicListAction,
  saveMagicListAction,
  updateMagicListAction,
  type MagicPlaylistTrack,
} from "./music-magic-actions";
import { TrackList, type TrackListRow } from "./music-track-list";

interface PickerOption {
  value: string;
  label: string;
  trackCount: number;
}

interface AlbumOption {
  albumId: number;
  label: string;
  albumArtist: string;
  trackCount: number;
}

/**
 * A searchable multi-select list of chips.
 *
 * Local to this screen rather than a registered shared component: it is used three times,
 * all of them here, and `components.md` has nothing that fits. Promote it to
 * `src/components/` on the second screen that wants one -- that is the "promote on the
 * second caller" rule from ARCHITECTURE.md, and one screen is not two.
 *
 * Each picker is wrapped in its own `CollapsibleCard`, so the body here carries no border,
 * no background and no title row: the card supplies all three, and doubling them up put a
 * panel inside a panel with two competing headings. The selection count and Clear control
 * move to the card's `headerAction`, where they stay readable while the card is shut --
 * which is the whole point of collapsing a picker you have already used.
 */
function MultiSelectPicker<T extends string | number>({
  options,
  selected,
  onToggle,
  searchPlaceholder,
  searchLabel,
}: {
  options: { key: T; label: string; detail?: string; trackCount: number }[];
  selected: Set<T>;
  onToggle: (key: T) => void;
  searchPlaceholder: string;
  searchLabel: string;
}) {
  const [search, setSearch] = useState("");

  // Filtered in the browser, not by a round-trip: the whole option list is already here,
  // and a keystroke-per-request search over a few thousand artists would be slower and
  // noisier than a substring match.
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (term === "") return options;
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(term) ||
        (option.detail ?? "").toLowerCase().includes(term),
    );
  }, [options, search]);

  return (
    <div className="flex min-w-0 flex-col">
      <input
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={searchPlaceholder}
        aria-label={searchLabel}
        className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink placeholder:text-muted"
      />

      {/* A fixed max height with its own scroll: three of these side by side must not each
          be thousands of rows tall, and on a phone the whole page would otherwise be one
          endless artist list. */}
      <ul className="mt-2 max-h-64 overflow-y-auto max-lg:max-h-56">
        {visible.length === 0 && (
          <li className="px-1 py-2 text-xs text-muted">Nothing matches that search.</li>
        )}
        {visible.map((option) => {
          const isSelected = selected.has(option.key);
          return (
            <li key={String(option.key)}>
              <label
                className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-brass-soft ${
                  isSelected ? "bg-brass-soft" : ""
                }`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onToggle(option.key)}
                  className="accent-brass"
                />
                <span className="min-w-0 flex-1 truncate text-ink">{option.label}</span>
                {option.detail !== undefined && option.detail !== "" && (
                  <span className="max-w-[40%] truncate text-xs text-muted">{option.detail}</span>
                )}
                <span className="shrink-0 text-xs text-muted">{option.trackCount}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * A drill-down folder picker: a breadcrumb, one level of folders, and a checkbox per row.
 *
 * NOT a `MultiSelectPicker` with paths in it, and the difference is not cosmetic. The other
 * three pickers hold a flat list that arrives whole and is filtered in the browser; the
 * folder tree is walked a level at a time, so this one fetches on every step and has a
 * position (`parent`) that the others have no concept of. Sharing one component would mean
 * one component with two disjoint halves.
 *
 * Local to this screen for the same reason `MultiSelectPicker` is: nothing in
 * `components.md` fits, and one screen is not the second caller that ARCHITECTURE.md says
 * to promote on.
 *
 * A parent and a child are both tickable, but ticking a parent covers its children --
 * selecting a folder selects its whole subtree (migrations/0060). So a row inside an
 * already-selected folder shows as covered and its checkbox is disabled rather than
 * offering a tick that would do nothing.
 *
 * Selected folders are listed as chips ABOVE the browser, because a pick made three levels
 * down is otherwise invisible the moment you navigate away from it -- and the whole point
 * of drilling in is that you end up somewhere else.
 */
function FolderPicker({
  selected,
  onToggle,
  onRemove,
}: {
  selected: string[];
  onToggle: (relativePath: string) => void;
  onRemove: (relativePath: string) => void;
}) {
  const [parent, setParent] = useState("");
  const [nodes, setNodes] = useState<MagicFolderOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const segments = useMemo(() => (parent === "" ? [] : parent.split("/")), [parent]);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    void listMagicFolderOptionsAction(parent)
      .then((options) => {
        if (!cancelled) setNodes(options);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [parent]);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {/* What is picked, wherever in the tree it was picked. The full path, not just the
          last segment -- two folders called "Live" under different artists are otherwise
          indistinguishable in this list. */}
      {selected.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {selected.map((path) => (
            <li key={path}>
              <button
                type="button"
                onClick={() => onRemove(path)}
                title={`Remove ${path}`}
                className="flex max-w-full items-center gap-1.5 rounded-md border border-brass bg-brass-soft px-2 py-1 text-xs text-ink hover:border-brass-dark"
              >
                <span className="min-w-0 truncate">{path}</span>
                <span aria-hidden className="shrink-0 text-muted">
                  &times;
                </span>
                <span className="sr-only">Remove folder</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Breadcrumb. Same shape as the Library's Folder Hierarchy view, so the two screens
          navigate folders identically. */}
      <div className="flex flex-wrap items-center gap-1 text-xs">
        <button
          type="button"
          onClick={() => setParent("")}
          className="rounded px-2 py-1 text-brass-dark hover:bg-brass-soft"
        >
          All music
        </button>
        {segments.map((segment, index) => (
          <span key={`${segment}-${index}`} className="flex items-center gap-1">
            <span className="text-muted">/</span>
            <button
              type="button"
              onClick={() => setParent(segments.slice(0, index + 1).join("/"))}
              className="rounded px-2 py-1 text-brass-dark hover:bg-brass-soft"
            >
              {segment}
            </button>
          </span>
        ))}
      </div>

      {/* Capped and scrolled like the other three pickers, for the same reason: four of
          these on a phone must not each be a page-long list. */}
      <ul className="max-h-64 overflow-y-auto max-lg:max-h-56">
        {isLoading && nodes.length === 0 && (
          <li className="px-1 py-2 text-xs text-muted">Reading folders…</li>
        )}
        {!isLoading && nodes.length === 0 && (
          <li className="px-1 py-2 text-xs text-muted">
            {parent === ""
              ? "No folders catalogued yet."
              : "No sub-folders here — tick this folder in the breadcrumb's parent to use it."}
          </li>
        )}
        {nodes.map((node) => {
          const isSelected = selected.includes(node.relativePath);
          // Covered by an ancestor already picked: ticking it would select nothing new, and
          // the library would prune it on save anyway.
          const isCovered =
            !isSelected && selected.some((path) => isFolderWithin(node.relativePath, path));

          return (
            <li key={node.relativePath}>
              <div
                className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
                  isSelected ? "bg-brass-soft" : "hover:bg-brass-soft"
                }`}
              >
                <input
                  type="checkbox"
                  checked={isSelected || isCovered}
                  disabled={isCovered}
                  onChange={() => onToggle(node.relativePath)}
                  aria-label={`Use folder ${node.relativePath}`}
                  title={isCovered ? "Already covered by a folder above it" : node.relativePath}
                  className="accent-brass disabled:opacity-50"
                />
                <span className="min-w-0 flex-1 truncate text-ink" title={node.relativePath}>
                  {node.name}
                </span>
                {/* The subtree total, which is what ticking the row would select. A folder
                    of folders has 0 tracks of its own, so showing the direct count would
                    label most of the tree "0" and make it look unpickable. */}
                <span className="shrink-0 text-xs text-muted">{node.totalTrackCount}</span>
                {node.hasChildren ? (
                  <button
                    type="button"
                    onClick={() => setParent(node.relativePath)}
                    className="shrink-0 rounded px-2 py-1 text-xs text-brass-dark hover:bg-brass-soft"
                  >
                    Open
                  </button>
                ) : (
                  // A fixed-width spacer so the counts line up whether or not a row is
                  // drillable -- a ragged column reads as a rendering bug.
                  <span aria-hidden className="w-[3.25rem] shrink-0" />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The always-visible right-hand side of a picker card's header: how many are picked, and a
 * Clear control. Lives in `headerAction` rather than in the body so that a collapsed picker
 * still reports what it is contributing -- otherwise three shut cards look identical
 * whether or not they are filtering anything.
 *
 * Renders nothing at all when the picker is empty: a "0 picked" label and a Clear button
 * that clears nothing are noise on the common first-visit path.
 */
function PickerHeaderAction({ count, onClear }: { count: number; onClear: () => void }) {
  if (count === 0) return null;
  return (
    <span className="flex items-center gap-2">
      <span className="text-xs text-muted">{count} picked</span>
      <button
        type="button"
        onClick={onClear}
        className="text-xs text-muted underline hover:text-ink"
      >
        Clear
      </button>
    </span>
  );
}

/** The stat row under the generated list. */
function GenerationSummary({
  stats,
  message,
}: {
  stats: MagicGenerationStats;
  message: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-line bg-paper-raised px-4 py-3">
      <Stat label="Tracks" value={String(stats.selectedCount)} />
      <Stat label="Running time" value={formatRunningTime(stats.totalSeconds)} />
      <Stat label="Target" value={formatRunningTime(stats.targetSeconds)} />
      <Stat label="Matched" value={`${stats.candidateCount} eligible`} />
      <p className="min-w-0 flex-1 text-sm text-muted max-lg:w-full max-lg:flex-none">{message}</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="font-display text-xl text-ink">{value}</div>
    </div>
  );
}

export function MusicMagicView() {
  const player = useMusicPlayer();

  const [criteria, setCriteria] = useState<MagicCriteria>(emptyCriteria);
  const [genreOptions, setGenreOptions] = useState<PickerOption[]>([]);
  const [artistOptions, setArtistOptions] = useState<PickerOption[]>([]);
  const [albumOptions, setAlbumOptions] = useState<AlbumOption[]>([]);
  const [optionsLoaded, setOptionsLoaded] = useState(false);

  const [tracks, setTracks] = useState<MagicPlaylistTrack[]>([]);
  const [stats, setStats] = useState<MagicGenerationStats | undefined>(undefined);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [candidateCount, setCandidateCount] = useState<number | undefined>(undefined);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const [savedLists, setSavedLists] = useState<MagicListSummary[]>([]);
  /** The saved list currently loaded, if any -- what Regenerate and Update apply to. */
  const [loadedListId, setLoadedListId] = useState<number | undefined>(undefined);
  const [loadedName, setLoadedName] = useState("");

  const [isSaveOpen, setIsSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveDescription, setSaveDescription] = useState("");
  const [saveError, setSaveError] = useState<string | undefined>(undefined);

  const genreKeys = useMemo(() => new Set(criteria.genres), [criteria.genres]);
  const artistKeys = useMemo(() => new Set(criteria.artists), [criteria.artists]);
  const albumKeys = useMemo(() => new Set(criteria.albumIds), [criteria.albumIds]);

  const refreshSavedLists = useCallback(async () => {
    setSavedLists(await listMagicListsAction());
  }, []);

  useEffect(() => {
    void (async () => {
      const [options] = await Promise.all([listMagicOptionsAction(), refreshSavedLists()]);
      setGenreOptions(options.genres);
      setArtistOptions(options.artists);
      setAlbumOptions(options.albums);
      setOptionsLoaded(true);
    })();
  }, [refreshSavedLists]);

  // The live "how many tracks match" count, so a criteria set that matches almost nothing
  // is visible BEFORE generating rather than after. Debounced because it fires on every
  // checkbox tick.
  useEffect(() => {
    if (!optionsLoaded) return;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          setCandidateCount(await countMagicCandidatesAction(criteria));
        } catch {
          // A count is a nicety -- if it fails, the screen still generates.
          setCandidateCount(undefined);
        }
      })();
    }, 250);
    return () => clearTimeout(timer);
  }, [criteria, optionsLoaded]);

  const toggleGenre = (value: string) =>
    setCriteria((previous) => ({
      ...previous,
      genres: toggleIn(previous.genres, value),
    }));

  const toggleArtist = (value: string) =>
    setCriteria((previous) => ({
      ...previous,
      artists: toggleIn(previous.artists, value),
    }));

  const toggleAlbum = (value: number) =>
    setCriteria((previous) => ({
      ...previous,
      albumIds: toggleIn(previous.albumIds, value),
    }));

  /**
   * Adds or removes a folder, then prunes.
   *
   * `pruneRedundantFolders` is the library's own rule, called here rather than left to the
   * server so the chip list and the live candidate count reflect what will ACTUALLY be
   * stored. Without it, ticking a parent after its child would leave the child showing as a
   * separate pick that silently vanishes on save.
   */
  const toggleFolder = (value: string) =>
    setCriteria((previous) => ({
      ...previous,
      folders: pruneRedundantFolders(toggleIn(previous.folders, value)),
    }));

  const removeFolder = (value: string) =>
    setCriteria((previous) => ({
      ...previous,
      folders: previous.folders.filter((path) => path !== value),
    }));

  const generate = async () => {
    setIsBusy(true);
    setError(undefined);
    try {
      const result = await generateMagicAction(criteria);
      setTracks(result.tracks);
      setStats(result.stats);
      setMessage(result.message);
    } catch {
      setError("Could not build that playlist. Check the target length and try again.");
    } finally {
      setIsBusy(false);
    }
  };

  /**
   * Plays the generated set.
   *
   * The whole playlist becomes the player's queue, so it plays through unattended -- that
   * is the point of a Magic Playlist. Unstreamable formats are already excluded server
   * side by `streamableOnly`, but the filter is repeated here because the queue must never
   * contain something that will stall playback.
   */
  const playAll = () => {
    if (player === undefined) return;
    const playable = tracks.filter((track) => track.isStreamable).map(toPlayable);
    const first = playable[0];
    if (first === undefined) return;
    player.play(first, playable);
    void recordPlayAction(first.id);
  };

  const openSave = () => {
    setSaveName(loadedListId === undefined ? "" : loadedName);
    setSaveDescription("");
    setSaveError(undefined);
    setIsSaveOpen(true);
  };

  const save = async () => {
    setSaveError(undefined);
    const trimmed = saveName.trim();
    if (trimmed === "") {
      setSaveError("A magic list needs a name.");
      return;
    }

    setIsBusy(true);
    try {
      // Updating a loaded list rather than always creating: re-saving something you just
      // opened should edit it, not be refused as a duplicate name.
      const result =
        loadedListId !== undefined && trimmed.toLowerCase() === loadedName.toLowerCase()
          ? await updateMagicListAction({
              magicListId: loadedListId,
              name: trimmed,
              description: saveDescription,
              criteria,
            })
          : await saveMagicListAction({ name: trimmed, description: saveDescription, criteria });

      if ("error" in result) {
        setSaveError(result.error);
        return;
      }

      if ("magicListId" in result) {
        setLoadedListId(result.magicListId);
        setLoadedName(result.name);
        setTracks(result.tracks);
        if (result.stats !== undefined) setStats(result.stats);
        if (result.message !== undefined) setMessage(result.message);
      } else {
        setLoadedName(trimmed);
      }

      await refreshSavedLists();
      setIsSaveOpen(false);
    } finally {
      setIsBusy(false);
    }
  };

  const load = async (magicListId: number) => {
    setIsBusy(true);
    setError(undefined);
    try {
      const result = await loadMagicListAction(magicListId);
      if ("error" in result) {
        setError(result.error);
        await refreshSavedLists();
        return;
      }
      setCriteria(result.criteria);
      setTracks(result.tracks);
      setLoadedListId(result.magicListId);
      setLoadedName(result.name);
      // The stored set was not generated just now, so there are no fresh stats to show --
      // the count and running time are derived from the tracks instead.
      setStats(undefined);
      setMessage(
        result.tracks.length === 0
          ? "This list has no stored tracks yet. Press Regenerate to build it."
          : `Loaded "${result.name}" — ${result.tracks.length} tracks. Regenerate for a new draw.`,
      );
    } finally {
      setIsBusy(false);
    }
  };

  const regenerate = async () => {
    if (loadedListId === undefined) {
      await generate();
      return;
    }
    setIsBusy(true);
    setError(undefined);
    try {
      const result = await regenerateMagicListAction(loadedListId);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setCriteria(result.criteria);
      setTracks(result.tracks);
      setStats(result.stats);
      setMessage(result.message);
      await refreshSavedLists();
    } finally {
      setIsBusy(false);
    }
  };

  const remove = async (magicListId: number) => {
    setIsBusy(true);
    try {
      await deleteMagicListAction(magicListId);
      if (loadedListId === magicListId) {
        setLoadedListId(undefined);
        setLoadedName("");
      }
      await refreshSavedLists();
    } finally {
      setIsBusy(false);
    }
  };

  const startFresh = () => {
    setCriteria(emptyCriteria());
    setTracks([]);
    setStats(undefined);
    setMessage(undefined);
    setLoadedListId(undefined);
    setLoadedName("");
    setError(undefined);
  };

  const rows: TrackListRow[] = tracks.map((track) => ({
    id: track.id,
    displayTitle: track.title,
    artist: track.artist,
    album: track.album,
    albumId: track.albumId,
    durationSeconds: track.durationSeconds,
    // The generator only ever selects streamable tracks, so the extension is not shown as
    // a warning here; TrackList wants the field, and mp3 is a safe placeholder that
    // affects nothing but a label.
    extension: "",
    isStreamable: track.isStreamable,
  }));

  const storedRunningTime = tracks.reduce((total, track) => total + (track.durationSeconds ?? 0), 0);

  return (
    <div className="flex flex-col gap-4">
      {/* --- criteria ------------------------------------------------------------- */}
      {/* Open by default: this is the screen's primary control, and a reader who arrives to
          build a playlist should not have to open a card to start. The three pickers inside
          start shut -- see below. */}
      <CollapsibleCard
        title="Criteria builder"
        defaultOpen
        headerAction={
          <span className="text-sm text-muted">
            {candidateCount === undefined
              ? ""
              : `${candidateCount.toLocaleString()} tracks match${
                  hasAnyFilter(criteria) ? "" : " (the whole library)"
                }`}
          </span>
        }
      >
        <div className="flex flex-col gap-3">
          {/* "Selection criteria" is gone as a heading -- the card title carries it now.
              The editing-a-saved-list note is information, not decoration, so it moves into
              the body rather than being dropped with the heading it hung off. */}
          {loadedListId !== undefined && (
            <p className="text-sm text-muted">Editing &ldquo;{loadedName}&rdquo;</p>
          )}

          {/* Four pickers side by side above 1024px, stacked below. `max-lg:` only, so the
              desktop grid provably cannot regress.

              `items-start` matters now that each column is a card: without it the grid
              stretches all four to match the tallest, so opening one would leave three tall
              empty cards beside it. */}
          <div className="grid grid-cols-4 items-start gap-3 max-lg:grid-cols-1">
            {/* All four start collapsed. Four open pickers stacked on a phone was already
                why each caps its own scroll height; shut by default the builder fits one
                screen, and the header count says which ones are in play. */}
            <CollapsibleCard
              title="Genres"
              headerAction={
                <PickerHeaderAction
                  count={genreKeys.size}
                  onClear={() => setCriteria((previous) => ({ ...previous, genres: [] }))}
                />
              }
            >
              <MultiSelectPicker
                searchPlaceholder="Search genres"
                searchLabel="Search genres"
                options={genreOptions.map((option) => ({
                  key: option.value,
                  label: option.label,
                  trackCount: option.trackCount,
                }))}
                selected={genreKeys}
                onToggle={toggleGenre}
              />
            </CollapsibleCard>

            <CollapsibleCard
              title="Artists"
              headerAction={
                <PickerHeaderAction
                  count={artistKeys.size}
                  onClear={() => setCriteria((previous) => ({ ...previous, artists: [] }))}
                />
              }
            >
              <MultiSelectPicker
                searchPlaceholder="Search artists"
                searchLabel="Search artists"
                options={artistOptions.map((option) => ({
                  key: option.value,
                  label: option.label,
                  trackCount: option.trackCount,
                }))}
                selected={artistKeys}
                onToggle={toggleArtist}
              />
            </CollapsibleCard>

            <CollapsibleCard
              title="Albums"
              headerAction={
                <PickerHeaderAction
                  count={albumKeys.size}
                  onClear={() => setCriteria((previous) => ({ ...previous, albumIds: [] }))}
                />
              }
            >
              <MultiSelectPicker
                searchPlaceholder="Search albums"
                searchLabel="Search albums"
                options={albumOptions.map((option) => ({
                  key: option.albumId,
                  label: option.label,
                  detail: option.albumArtist,
                  trackCount: option.trackCount,
                }))}
                selected={albumKeys}
                onToggle={toggleAlbum}
              />
            </CollapsibleCard>

            {/* Folders. Last of the four because it is the odd one out: the other three
                slice by tag, this one slices by where the files actually sit -- which is the
                axis that catches the untagged corners of the library the tags cannot
                express. */}
            <CollapsibleCard
              title="Folder"
              headerAction={
                <PickerHeaderAction
                  count={criteria.folders.length}
                  onClear={() => setCriteria((previous) => ({ ...previous, folders: [] }))}
                />
              }
            >
              <FolderPicker
                selected={criteria.folders}
                onToggle={toggleFolder}
                onRemove={removeFolder}
              />
            </CollapsibleCard>
          </div>

        {/* --- target length and match mode --- */}
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3 rounded-xl border border-line bg-paper-raised px-4 py-3">
          <div className="min-w-0">
            <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">
              Playlist length
            </div>
            <div className="flex flex-wrap gap-1.5">
              {MAGIC_TARGET_PRESETS.map((preset) => (
                <button
                  key={preset.seconds}
                  type="button"
                  onClick={() =>
                    setCriteria((previous) => ({ ...previous, targetSeconds: preset.seconds }))
                  }
                  className={`rounded-md border px-2.5 py-1 text-sm ${
                    criteria.targetSeconds === preset.seconds
                      ? "border-brass bg-brass-soft text-ink"
                      : "border-line text-muted hover:bg-brass-soft hover:text-ink"
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-muted">
            or
            <input
              type="number"
              min={1}
              max={720}
              value={Math.round(criteria.targetSeconds / 60)}
              onChange={(event) => {
                const minutes = Number(event.target.value);
                if (!Number.isFinite(minutes)) return;
                setCriteria((previous) => ({
                  ...previous,
                  // Clamped to the schema's own bounds so the field cannot post something
                  // the boundary will reject.
                  targetSeconds: Math.min(Math.max(Math.round(minutes), 1), 720) * 60,
                }));
              }}
              aria-label="Playlist length in minutes"
              className="w-20 rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink"
            />
            minutes
          </label>

          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={criteria.matchAny}
              onChange={(event) =>
                setCriteria((previous) => ({ ...previous, matchAny: event.target.checked }))
              }
              className="accent-brass"
            />
            Match <em>any</em> criteria
            <span className="text-xs text-muted">
              (off: genres AND artists AND albums AND folders must all match)
            </span>
          </label>
        </div>

        {/* Action bar. Wraps rather than switching component on a narrow screen. */}
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void generate()} disabled={isBusy}>
            {isBusy ? "Working…" : "Generate"}
          </Button>
          <Button variant="secondary" onClick={() => void regenerate()} disabled={isBusy}>
            Regenerate
          </Button>
          <Button
            variant="secondary"
            onClick={playAll}
            disabled={isBusy || tracks.length === 0 || player === undefined}
          >
            Play all
          </Button>
          <Button variant="secondary" onClick={openSave} disabled={isBusy}>
            {loadedListId === undefined ? "Save as magic list" : "Save changes"}
          </Button>
          <Button variant="secondary" onClick={startFresh} disabled={isBusy}>
            Start fresh
          </Button>
        </div>

        {error !== undefined && (
          <p className="rounded-xl border border-line bg-paper-raised px-4 py-3 text-sm text-ink">
            {error}
          </p>
        )}
        </div>
      </CollapsibleCard>

      {/* --- saved lists --------------------------------------------------------- */}
      {/* Shut by default: on a first visit there is nothing in here, and once there is,
          it is a library to reach for rather than something to keep on screen while
          building. The count in the header is what makes a shut card worth having. */}
      <CollapsibleCard
        title="Existing Magic Playlists"
        headerAction={
          <span className="text-sm text-muted">
            {savedLists.length === 0 ? "" : `${savedLists.length} saved`}
          </span>
        }
      >
          {savedLists.length === 0 ? (
            <div className="rounded-xl border border-line p-6">
              <p className="text-sm text-muted">
                No saved magic lists yet. Generate something you like, then save its criteria.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-line rounded-xl border border-line">
              {savedLists.map((list) => (
                <li
                  key={list.id}
                  className="flex items-center gap-3 px-3 py-2 max-lg:flex-col max-lg:items-stretch max-lg:gap-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-display text-sm text-ink">
                      {list.name}
                      {loadedListId === list.id && (
                        <span className="ml-2 text-xs text-muted">loaded</span>
                      )}
                    </div>
                    <div className="truncate text-xs text-muted">
                      {formatRunningTime(list.targetSeconds)} target · {list.trackCount} tracks
                      {list.description === "" ? "" : ` · ${list.description}`}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={() => void load(list.id)} disabled={isBusy}>
                      Load
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void regenerateAndLoad(list.id)}
                      disabled={isBusy}
                    >
                      Regenerate
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => void remove(list.id)} disabled={isBusy}>
                      Delete
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
      </CollapsibleCard>

      {/* --- the generated playlist ---------------------------------------------- */}
      {/* Last on the page and open by default: it is the output, so it reads after the
          controls that produce it, and hiding a freshly generated playlist behind a
          shut card would bury the thing the reader just pressed Generate for. */}
      <CollapsibleCard
        title="The Playlist"
        defaultOpen
        headerAction={
          <span className="text-sm text-muted">
            {tracks.length === 0
              ? ""
              : `${tracks.length} tracks · ${formatRunningTime(storedRunningTime)}`}
          </span>
        }
      >
        <div className="flex flex-col gap-3">
          {stats !== undefined && message !== undefined && (
            <GenerationSummary stats={stats} message={message} />
          )}
          {stats === undefined && message !== undefined && (
            <p className="rounded-xl border border-line bg-paper-raised px-4 py-3 text-sm text-muted">
              {message}
            </p>
          )}

          <TrackList
            rows={rows}
            emptyMessage="Nothing generated yet. Pick some criteria and press Generate."
          />
        </div>
      </CollapsibleCard>

      {/* Conditionally rendered rather than passed an `isOpen` prop: Modal has no such prop
          -- it mounts open and resets its own state each time, which is what makes the name
          field start clean on every save. */}
      {isSaveOpen && (
      <Modal
        onClose={() => setIsSaveOpen(false)}
        title={loadedListId === undefined ? "Save this magic list" : "Save changes"}
      >
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm text-ink">
            Name
            <input
              type="text"
              value={saveName}
              onChange={(event) => setSaveName(event.target.value)}
              maxLength={120}
              className="rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink">
            Description <span className="text-xs text-muted">optional</span>
            <input
              type="text"
              value={saveDescription}
              onChange={(event) => setSaveDescription(event.target.value)}
              maxLength={500}
              className="rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink"
            />
          </label>
          <p className="text-xs text-muted">
            The criteria are saved along with the tracks just generated, so loading this list
            plays the same set until you regenerate it.
          </p>
          {saveError !== undefined && <p className="text-sm text-ink">{saveError}</p>}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void save()} disabled={isBusy}>
              Save
            </Button>
            <Button variant="secondary" onClick={() => setIsSaveOpen(false)} disabled={isBusy}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
      )}
    </div>
  );

  /** Regenerates a saved list from the list row, loading the result into the form. */
  async function regenerateAndLoad(magicListId: number) {
    setIsBusy(true);
    setError(undefined);
    try {
      const result = await regenerateMagicListAction(magicListId);
      if ("error" in result) {
        setError(result.error);
        await refreshSavedLists();
        return;
      }
      setCriteria(result.criteria);
      setTracks(result.tracks);
      setStats(result.stats);
      setMessage(result.message);
      setLoadedListId(result.magicListId);
      setLoadedName(result.name);
      await refreshSavedLists();
    } finally {
      setIsBusy(false);
    }
  }
}

/** Adds or removes a value, preserving order. */
function toggleIn<T>(values: T[], value: T): T[] {
  return values.includes(value)
    ? values.filter((entry) => entry !== value)
    : [...values, value];
}

function toPlayable(track: MagicPlaylistTrack): PlayableTrack {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    albumId: track.albumId,
    durationSeconds: track.durationSeconds,
  };
}
