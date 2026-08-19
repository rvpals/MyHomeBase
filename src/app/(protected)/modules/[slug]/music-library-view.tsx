"use client";

// The Library section: eight ways of looking at the same catalog.
//
// One component rather than eight routes, because the views share their whole apparatus --
// the track list, the pager, the player queue -- and differ only in how they group. The
// active view lives in the URL (`?view=`) so a view is linkable and survives a reload,
// which is the same reasoning the Journal module applies to its filter.
//
// Each grouping view is a two-step: pick a group (artist, genre, year, folder), then see
// its tracks. The chosen group also travels in the URL.
//
// Narrow screens keep the same components and restyle with `max-lg:`; the tab strip
// scrolls horizontally rather than becoming a select, so all eight stay one tap away.

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/button";
import { TreeIcon } from "@/components/tree-icons";
import {
  LIBRARY_VIEWS,
  LIBRARY_VIEW_ICONS,
  LIBRARY_VIEW_INFO,
  isLibraryView,
  type LibraryFolder,
  type LibraryFolderNode,
  type LibraryGroup,
  type LibraryView,
  type Playlist,
} from "@/lib/music";
import {
  createPlaylistAction,
  deletePlaylistAction,
  getPlaylistTracksAction,
  listArtistsAction,
  listFolderTreeAction,
  listFoldersFlatAction,
  listGenresAction,
  listGroupTracksAction,
  listMostPlayedAction,
  listPlaylistsAction,
  listYearsAction,
  removeFromPlaylistAction,
  searchTracksAction,
} from "./music-actions";
import { PlaylistSelectionBar, useTrackSelection } from "./music-selection";
import { Pager, TrackList, type TrackListRow } from "./music-track-list";

const PAGE_SIZE = 50;

export function MusicLibraryView() {
  const router = useRouter();
  const params = useSearchParams();

  const rawView = params.get("view") ?? "all-songs";
  const view: LibraryView = isLibraryView(rawView) ? rawView : "all-songs";
  // `null` means "no group chosen yet"; '' is a real group (the untagged one), so the two
  // cannot be collapsed.
  const groupKey = params.get("group");

  const setParams = useCallback(
    (next: { view?: LibraryView; group?: string | null }) => {
      const updated = new URLSearchParams(params.toString());
      if (next.view !== undefined) updated.set("view", next.view);
      if (next.group === null) updated.delete("group");
      else if (next.group !== undefined) updated.set("group", next.group);
      router.replace(`?${updated.toString()}`, { scroll: false });
    },
    [params, router],
  );

  return (
    <div>
      {/* The eight tabs. Horizontally scrollable when narrow rather than collapsing into a
          select: eight is few enough to keep them all reachable with one tap. */}
      <nav
        aria-label="Library views"
        className="mb-4 flex gap-1 overflow-x-auto border-b border-line pb-2"
      >
        {LIBRARY_VIEWS.map((candidate) => {
          const isActive = candidate === view;
          return (
            <button
              key={candidate}
              type="button"
              onClick={() => setParams({ view: candidate, group: null })}
              title={LIBRARY_VIEW_INFO[candidate].description}
              aria-current={isActive ? "page" : undefined}
              className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm ${
                isActive ? "bg-brass-soft text-brass-dark" : "text-muted hover:bg-brass-soft"
              }`}
            >
              <TreeIcon name={LIBRARY_VIEW_ICONS[candidate]} className="h-4 w-4" />
              <span className="max-lg:hidden">{LIBRARY_VIEW_INFO[candidate].label}</span>
              {/* Narrow keeps the label on the active tab only, so the strip stays short
                  without becoming a row of unlabelled glyphs. */}
              {isActive && <span className="lg:hidden">{LIBRARY_VIEW_INFO[candidate].label}</span>}
            </button>
          );
        })}
      </nav>

      <p className="mb-3 text-xs text-muted">{LIBRARY_VIEW_INFO[view].description}</p>

      {view === "all-songs" && <AllSongs />}
      {view === "most-played" && <MostPlayed />}
      {view === "playlists" && <Playlists />}
      {(view === "artists" || view === "genres" || view === "years") && (
        <GroupedView view={view} groupKey={groupKey} onPick={(key) => setParams({ group: key })} />
      )}
      {view === "folders" && (
        <FoldersFlat groupKey={groupKey} onPick={(key) => setParams({ group: key })} />
      )}
      {view === "folder-tree" && <FolderTree />}
    </div>
  );
}

// --- All Songs -----------------------------------------------------------------

function AllSongs() {
  const [search, setSearch] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<{ rows: TrackListRow[]; totalCount: number }>({
    rows: [],
    totalCount: 0,
  });
  // The search runs in an effect keyed on the submitted term, so there is no pending
  // action to wrap in a transition -- the pager just never shows a loading state here.
  const isLoading = false;
  const selection = useTrackSelection();

  useEffect(() => {
    let cancelled = false;
    void searchTracksAction({
      search: submitted === "" ? undefined : submitted,
      limit: PAGE_SIZE,
      offset,
    }).then((result) => {
      if (!cancelled) {
        setPage({ rows: result.tracks as TrackListRow[], totalCount: result.totalCount });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [submitted, offset]);

  return (
    <div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setOffset(0);
          setSubmitted(search.trim());
        }}
        className="mb-3 flex flex-wrap items-center gap-2"
      >
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search title, artist, album or filename"
          aria-label="Search the library"
          className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink"
        />
        <Button type="submit" disabled={isLoading}>
          Search
        </Button>
        {submitted !== "" && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setSearch("");
              setSubmitted("");
              setOffset(0);
            }}
          >
            Clear
          </Button>
        )}
      </form>

      <PlaylistSelectionBar selection={selection} pageTrackIds={page.rows.map((row) => row.id)} />

      <TrackList
        rows={page.rows}
        selectable
        selected={selection.selected}
        onToggleSelected={selection.toggle}
        emptyMessage={
          submitted === ""
            ? "The library is empty. Use Scan Music to catalog a folder from the NAS."
            : `Nothing matches "${submitted}".`
        }
      />
      <Pager
        offset={offset}
        shown={page.rows.length}
        totalCount={page.totalCount}
        pageSize={PAGE_SIZE}
        isLoading={isLoading}
        onOffsetChange={setOffset}
      />
    </div>
  );
}

// --- Most Played ---------------------------------------------------------------

function MostPlayed() {
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<{ rows: TrackListRow[]; totalCount: number }>({
    rows: [],
    totalCount: 0,
  });
  const selection = useTrackSelection();

  useEffect(() => {
    let cancelled = false;
    void listMostPlayedAction({ limit: PAGE_SIZE, offset }).then((result) => {
      if (!cancelled) {
        setPage({ rows: result.tracks as TrackListRow[], totalCount: result.totalCount });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [offset]);

  return (
    <div>
      <PlaylistSelectionBar selection={selection} pageTrackIds={page.rows.map((row) => row.id)} />
      <TrackList
        rows={page.rows}
        showPlayCount
        selectable
        selected={selection.selected}
        onToggleSelected={selection.toggle}
        emptyMessage="Nothing has been played yet. Play something and it will show up here."
      />
      {/* Says what the number means, because "started" is not the same as "listened to"
          and the difference is invisible otherwise. */}
      {page.rows.length > 0 && (
        <p className="mt-2 text-xs text-muted">
          Counted when a track starts playing, so browsing through a folder adds to these.
        </p>
      )}
      <Pager
        offset={offset}
        shown={page.rows.length}
        totalCount={page.totalCount}
        pageSize={PAGE_SIZE}
        isLoading={false}
        onOffsetChange={setOffset}
      />
    </div>
  );
}

// --- Artists / Genres / Years --------------------------------------------------

function GroupedView({
  view,
  groupKey,
  onPick,
}: {
  view: "artists" | "genres" | "years";
  groupKey: string | null;
  onPick: (key: string) => void;
}) {
  const [groups, setGroups] = useState<LibraryGroup[]>([]);
  const [totalGroups, setTotalGroups] = useState(0);
  const [groupOffset, setGroupOffset] = useState(0);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (view === "artists") {
        const result = await listArtistsAction({
          search: search.trim() === "" ? undefined : search.trim(),
          limit: PAGE_SIZE,
          offset: groupOffset,
        });
        if (!cancelled) {
          setGroups(result.groups);
          setTotalGroups(result.totalCount);
        }
        return;
      }
      // Genres and years are tens of rows, not thousands, so they load whole.
      const result = view === "genres" ? await listGenresAction() : await listYearsAction();
      if (!cancelled) {
        setGroups(result);
        setTotalGroups(result.length);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [view, search, groupOffset]);

  if (groupKey !== null) {
    const label = groups.find((group) => group.key === groupKey)?.label ?? groupKey;
    return <GroupTracks view={view} groupKey={groupKey} label={label} />;
  }

  return (
    <div>
      {view === "artists" && (
        <input
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setGroupOffset(0);
          }}
          placeholder="Search artists"
          aria-label="Search artists"
          className="mb-3 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink"
        />
      )}

      {groups.length === 0 ? (
        <div className="rounded-xl border border-line p-6">
          <p className="text-sm text-muted">Nothing catalogued yet.</p>
        </div>
      ) : (
        <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((group) => (
            <li key={group.key || "(none)"}>
              <button
                type="button"
                onClick={() => onPick(group.key)}
                className="flex w-full items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-left hover:bg-brass-soft"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm text-ink">{group.label}</span>
                  {group.detail !== undefined && (
                    <span className="block truncate text-xs text-muted">{group.detail}</span>
                  )}
                </span>
                <span className="shrink-0 font-mono text-xs text-muted">{group.trackCount}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {view === "artists" && (
        <Pager
          offset={groupOffset}
          shown={groups.length}
          totalCount={totalGroups}
          pageSize={PAGE_SIZE}
          isLoading={false}
          onOffsetChange={setGroupOffset}
        />
      )}
    </div>
  );
}

function GroupTracks({
  view,
  groupKey,
  label,
}: {
  view: LibraryView;
  groupKey: string;
  label: string;
}) {
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<{ rows: TrackListRow[]; totalCount: number }>({
    rows: [],
    totalCount: 0,
  });
  // Same selection affordance as All Songs: picking an artist and pushing the lot into a
  // playlist is the obvious thing to want once you are looking at one.
  const selection = useTrackSelection();

  useEffect(() => {
    let cancelled = false;
    void listGroupTracksAction({ view, key: groupKey, limit: PAGE_SIZE, offset }).then(
      (result) => {
        if (!cancelled) {
          setPage({ rows: result.tracks as TrackListRow[], totalCount: result.totalCount });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [view, groupKey, offset]);

  return (
    <div>
      <h3 className="mb-2 font-display text-lg text-ink">{label}</h3>
      <PlaylistSelectionBar selection={selection} pageTrackIds={page.rows.map((row) => row.id)} />
      <TrackList
        rows={page.rows}
        selectable
        selected={selection.selected}
        onToggleSelected={selection.toggle}
        emptyMessage="No tracks here."
      />
      <Pager
        offset={offset}
        shown={page.rows.length}
        totalCount={page.totalCount}
        pageSize={PAGE_SIZE}
        isLoading={false}
        onOffsetChange={setOffset}
      />
    </div>
  );
}

// --- Folders (flat) ------------------------------------------------------------

function FoldersFlat({
  groupKey,
  onPick,
}: {
  groupKey: string | null;
  onPick: (key: string) => void;
}) {
  const [folders, setFolders] = useState<LibraryFolder[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    void listFoldersFlatAction({
      search: search.trim() === "" ? undefined : search.trim(),
      limit: PAGE_SIZE,
      offset,
    }).then((result) => {
      if (!cancelled) {
        setFolders(result.folders);
        setTotalCount(result.totalCount);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [search, offset]);

  if (groupKey !== null) {
    return <GroupTracks view="folders" groupKey={groupKey} label={groupKey || "(library root)"} />;
  }

  return (
    <div>
      <input
        type="search"
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          setOffset(0);
        }}
        placeholder="Search folder paths"
        aria-label="Search folders"
        className="mb-3 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink"
      />

      {folders.length === 0 ? (
        <div className="rounded-xl border border-line p-6">
          <p className="text-sm text-muted">No folders catalogued yet.</p>
        </div>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {folders.map((folder) => (
            <li key={folder.relativePath || "(root)"}>
              <button
                type="button"
                onClick={() => onPick(folder.relativePath)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-brass-soft"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm text-ink">{folder.name}</span>
                  <span className="block truncate text-xs text-muted">
                    {folder.relativePath || "(library root)"}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-xs text-muted">
                  {folder.trackCount}
                  {folder.totalTrackCount !== folder.trackCount && ` (${folder.totalTrackCount})`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Pager
        offset={offset}
        shown={folders.length}
        totalCount={totalCount}
        pageSize={PAGE_SIZE}
        isLoading={false}
        onOffsetChange={setOffset}
      />
    </div>
  );
}

// --- Folder Hierarchy ----------------------------------------------------------

function FolderTree() {
  const [breadcrumb, setBreadcrumb] = useState<string[]>([]);
  const [children, setChildren] = useState<LibraryFolderNode[]>([]);
  const current = breadcrumb.join("/");

  useEffect(() => {
    let cancelled = false;
    void listFolderTreeAction(current).then((nodes) => {
      if (!cancelled) setChildren(nodes);
    });
    return () => {
      cancelled = true;
    };
  }, [current]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-1 text-xs">
        <button
          type="button"
          onClick={() => setBreadcrumb([])}
          className="rounded px-2 py-1 text-brass-dark hover:bg-brass-soft"
        >
          All music
        </button>
        {breadcrumb.map((segment, index) => (
          <span key={`${segment}-${index}`} className="flex items-center gap-1">
            <span className="text-muted">/</span>
            <button
              type="button"
              onClick={() => setBreadcrumb(breadcrumb.slice(0, index + 1))}
              className="rounded px-2 py-1 text-brass-dark hover:bg-brass-soft"
            >
              {segment}
            </button>
          </span>
        ))}
      </div>

      {children.length > 0 && (
        <ul className="mb-4 divide-y divide-line rounded-xl border border-line">
          {children.map((node) => (
            <li key={node.relativePath} className="flex items-center gap-2 px-3 py-2">
              <TreeIcon name="database" className="h-4 w-4 shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate text-sm text-ink">{node.name}</span>
              <span className="shrink-0 font-mono text-xs text-muted">
                {node.totalTrackCount}
              </span>
              {node.hasChildren && (
                <button
                  type="button"
                  onClick={() => setBreadcrumb([...breadcrumb, node.name])}
                  className="rounded px-2 py-1 text-xs text-brass-dark hover:bg-brass-soft"
                >
                  Open
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Tracks sitting directly in the folder we are standing in. */}
      {current !== "" && <GroupTracks view="folder-tree" groupKey={current} label={current} />}
      {current === "" && children.length === 0 && (
        <div className="rounded-xl border border-line p-6">
          <p className="text-sm text-muted">Nothing catalogued yet.</p>
        </div>
      )}
    </div>
  );
}

// --- Playlists -----------------------------------------------------------------

function Playlists() {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [openId, setOpenId] = useState<number | undefined>(undefined);
  const [name, setName] = useState("");
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [isBusy, startBusy] = useTransition();

  const refresh = useCallback(async () => {
    const rows = await listPlaylistsAction();
    setPlaylists(rows);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void listPlaylistsAction().then((rows) => {
      if (!cancelled) setPlaylists(rows);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (openId !== undefined) {
    return (
      <PlaylistDetail
        playlistId={openId}
        onBack={() => {
          setOpenId(undefined);
          void refresh();
        }}
      />
    );
  }

  return (
    <div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setMessage(undefined);
          startBusy(async () => {
            const result = await createPlaylistAction({ name });
            if ("error" in result) setMessage(result.error);
            else {
              setName("");
              await refresh();
            }
          });
        }}
        className="mb-3 flex flex-wrap items-center gap-2"
      >
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="New playlist name"
          aria-label="New playlist name"
          className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink"
        />
        <Button type="submit" disabled={isBusy || name.trim() === ""}>
          Create
        </Button>
      </form>

      {message !== undefined && <p className="mb-2 text-xs text-muted">{message}</p>}

      {playlists.length === 0 ? (
        <div className="rounded-xl border border-line p-6">
          <p className="text-sm text-muted">
            No playlists yet. Create one above, then add tracks to it from any view.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {playlists.map((playlist) => (
            <li key={playlist.id} className="flex items-center gap-2 px-3 py-2">
              <button
                type="button"
                onClick={() => setOpenId(playlist.id)}
                className="min-w-0 flex-1 text-left"
              >
                <span className="block truncate text-sm text-ink">{playlist.name}</span>
                <span className="block truncate text-xs text-muted">
                  {playlist.trackCount} {playlist.trackCount === 1 ? "track" : "tracks"}
                  {playlist.description !== "" && ` - ${playlist.description}`}
                </span>
              </button>
              <button
                type="button"
                onClick={() =>
                  startBusy(async () => {
                    await deletePlaylistAction(playlist.id);
                    await refresh();
                  })
                }
                className="rounded px-2 py-1 text-xs text-muted hover:text-ink"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PlaylistDetail({
  playlistId,
  onBack,
}: {
  playlistId: number;
  onBack: () => void;
}) {
  const [state, setState] = useState<{
    playlist?: Playlist;
    rows: (TrackListRow & { playlistTrackId: number })[];
  }>({ rows: [] });
  const [isBusy, startBusy] = useTransition();

  const load = useCallback(async () => {
    const result = await getPlaylistTracksAction(playlistId);
    setState({
      playlist: result.playlist,
      rows: result.entries.map((entry) => ({
        ...(entry.track as TrackListRow),
        playlistTrackId: entry.entry.playlistTrackId,
      })),
    });
  }, [playlistId]);

  useEffect(() => {
    let cancelled = false;
    void getPlaylistTracksAction(playlistId).then((result) => {
      if (cancelled) return;
      setState({
        playlist: result.playlist,
        rows: result.entries.map((entry) => ({
          ...(entry.track as TrackListRow),
          playlistTrackId: entry.entry.playlistTrackId,
        })),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [playlistId]);

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
        <h3 className="font-display text-lg text-ink">{state.playlist?.name ?? "Playlist"}</h3>
      </div>

      <TrackList
        rows={state.rows}
        emptyMessage="This playlist is empty. Add tracks to it from All Songs or any other view."
        onRemove={(row) => {
          const entryId = (row as TrackListRow & { playlistTrackId: number }).playlistTrackId;
          startBusy(async () => {
            await removeFromPlaylistAction(entryId);
            await load();
          });
        }}
      />
      {isBusy && <p className="mt-2 text-xs text-muted">Working...</p>}
    </div>
  );
}
