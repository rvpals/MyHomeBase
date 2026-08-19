// The Library section's eight views, as a domain concept.
//
// Each view is a different way of grouping the same catalog. Six of them are pure reads
// over what the scanner already stored; Playlists and Most Played need the tables and
// columns 0055 added.
//
// The list lives here rather than in the UI so the CLI can offer the same groupings, and
// so a view name is validated at the boundary rather than trusted.

export const LIBRARY_VIEWS = [
  "all-songs",
  "artists",
  "genres",
  "playlists",
  "most-played",
  "years",
  "folders",
  "folder-tree",
] as const;

export type LibraryView = (typeof LIBRARY_VIEWS)[number];

export function isLibraryView(value: string): value is LibraryView {
  return (LIBRARY_VIEWS as readonly string[]).includes(value);
}

/** Label and one-line description for each view, shared by the tabs and the CLI. */
export const LIBRARY_VIEW_INFO: Record<LibraryView, { label: string; description: string }> = {
  "all-songs": { label: "All Songs", description: "Everything in the catalog." },
  artists: { label: "Artists", description: "Grouped by performer." },
  genres: { label: "Genres", description: "Grouped by tagged genre." },
  playlists: { label: "Playlists", description: "Lists you have built by hand." },
  "most-played": { label: "Most Played", description: "Ordered by how often each track has been started." },
  years: { label: "Years", description: "Grouped by release year." },
  folders: { label: "Folders", description: "Every folder holding tracks, as a flat list." },
  "folder-tree": { label: "Folder Hierarchy", description: "Walk the folders as a tree." },
};

/**
 * Section icon for each view, keyed the same way TreeIcon keys everything else.
 *
 * Every value is a concept that already exists -- `TREE_ICONS` in tree-icons.tsx lists
 * the 24, and the generated sets cover 21 of them. This matters more than it looks:
 * `TreeIcon` renders **nothing** for a name it does not know rather than falling back to
 * a default, so an invented key is a silently blank icon. There is no music-note concept
 * in the set, and adding one means hand-drawing it plus naming candidates across all 12
 * generated sets (scripts/gen-icon-glyphs.mjs), so these are honest near-fits:
 *
 *   all-songs   list      -- a flat list of everything
 *   artists     users     -- people
 *   genres      shapes    -- categories
 *   playlists   note      -- something written down by hand
 *   most-played history   -- play history, ordered by frequency
 *   years       quote     -- no calendar concept exists; quote reads as a date stamp
 *   folders     grid      -- a flat set of containers
 *   folder-tree database  -- nested structure
 */
export const LIBRARY_VIEW_ICONS: Record<LibraryView, string> = {
  "all-songs": "list",
  artists: "users",
  genres: "shapes",
  playlists: "note",
  "most-played": "history",
  years: "quote",
  folders: "grid",
  "folder-tree": "database",
};

/**
 * One row in a grouping view: a name, how many tracks it holds, and enough detail to
 * show something useful beside it.
 *
 * Deliberately one shape for artists, genres, years and folders. They differ only in what
 * `key` means, so four near-identical types would be four places to change.
 */
export interface LibraryGroup {
  /** What to filter by. For years this is the year as a string; '' means "untagged". */
  key: string;
  /** What to show. Never blank -- an untagged group gets an explicit label. */
  label: string;
  trackCount: number;
  /** Longest-serving secondary fact: albums for an artist, artists for a genre or year. */
  detail?: string;
}

/** A folder that holds tracks, for the flat Folders view. */
export interface LibraryFolder {
  /** Relative to the music root. */
  relativePath: string;
  /** The last segment -- what the list shows. */
  name: string;
  /** Tracks directly in this folder, not counting sub-folders. */
  trackCount: number;
  /** Tracks anywhere beneath it, so a parent shows a meaningful total. */
  totalTrackCount: number;
}

/** A node in the Folder Hierarchy view: one level, walked on demand. */
export interface LibraryFolderNode {
  relativePath: string;
  name: string;
  trackCount: number;
  totalTrackCount: number;
  hasChildren: boolean;
}

export interface Playlist {
  id: number;
  name: string;
  description: string;
  trackCount: number;
  updatedAt: string;
}

/** A track's place in a playlist. The row id differs from the track id -- a playlist may
 *  hold the same track twice, so removing one entry must name the entry, not the track. */
export interface PlaylistEntry {
  playlistTrackId: number;
  position: number;
  trackId: number;
}

/**
 * The label for a group whose key is empty.
 *
 * Untagged files are common in this library, so "no genre" is a real category rather than
 * an error -- it needs a name a listener can click, not a blank row.
 */
export function labelForEmptyGroup(view: LibraryView): string {
  if (view === "artists") return "Unknown artist";
  if (view === "genres") return "No genre";
  if (view === "years") return "Year unknown";
  return "Unknown";
}
