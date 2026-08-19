import type { MusicExtension } from "./formats";
import type {
  LibraryFolder,
  LibraryFolderNode,
  LibraryGroup,
  Playlist,
  PlaylistEntry,
} from "./browse";
import type { LyricsQuery, LyricsStatus, TrackLyrics } from "./lyrics";
import type {
  Album,
  AlbumCover,
  FolderNode,
  ScanRun,
  ScanRunProgress,
  Track,
  TrackFileFacts,
  TrackSearchQuery,
  TrackUpsert,
} from "./types";

/**
 * Read-only access to the music folder.
 *
 * THE ENTIRE INTERFACE IS READ-ONLY, AND MUST STAY THAT WAY. There is no write,
 * create, move, rename, delete or set-times method here, and none may be added:
 * the user's music collection is irreplaceable and this module's job is to
 * catalog it, not to manage it. A bug in the app cannot damage a music file
 * because there is no code path from the app to a write — the capability does not
 * exist in the type.
 *
 * Consequences that follow from that and are deliberate:
 *
 * - Album art is COPIED into `mus_albums.cover_image`. Nothing is written back
 *   into a music folder, not even a cached cover or an index file.
 * - Tag corrections, if ever wanted, are stored in the database as overrides.
 *   They never rewrite a file's tags.
 * - A track that has vanished from disk is removed from the CATALOG only.
 * - Converting APE/WMA to a playable format is an offline job the owner runs
 *   themselves, never something this module does.
 *
 * If a future feature seems to need a write, it needs a separate, explicitly named
 * port and a migration log entry justifying it — not a method here.
 */
export interface MusicFileStore {
  /** Whether the configured music root exists and is readable. */
  isRootAvailable(): Promise<boolean>;

  /**
   * The immediate sub-folders of a relative folder, for the scan screen's picker.
   * One level only: the library is 2–8 levels deep and 20k files, so eagerly
   * walking the tree to build a picker would be slower than the scan itself.
   */
  listFolders(relativeFolder: string): Promise<FolderNode[]>;

  /**
   * Every candidate audio file under a relative folder, recursively, filtered to
   * the given extensions.
   *
   * Yields rather than returning an array so the caller can count and process
   * without holding 20k paths in memory, and so a cancelled scan stops walking
   * immediately. This phase does NOT open files — it only reads directory entries
   * and stats, which is what makes counting for a progress total affordable.
   */
  walkAudioFiles(
    relativeFolder: string,
    extensions: readonly MusicExtension[],
  ): AsyncIterable<TrackFileFacts>;

  /** Size and mtime for one file, or `undefined` when it no longer exists. */
  statFile(relativePath: string): Promise<TrackFileFacts | undefined>;

  /**
   * A byte range of a file, as a stream, for the streaming route.
   *
   * A range rather than the whole file: a 40 MB FLAC read into a buffer would cost
   * 40 MB of RAM per listener on a 2 GB NAS, and seeking would be impossible.
   */
  openRange(relativePath: string, start: number, end: number): Promise<ReadableStream<Uint8Array>>;

  /** A sibling cover image (`cover.jpg`, `folder.png`) for a track's folder. */
  readFolderCover(relativeFolder: string): Promise<AlbumCover | undefined>;
}

/**
 * Reads embedded tags from an audio file.
 *
 * Separate from MusicFileStore because it is the expensive half of a scan — it
 * opens and parses each file — and because faking it in tests is how the scanner
 * gets tested without any audio.
 */
export interface AudioMetadataReader {
  /**
   * Tags for one file. Resolves to `undefined` when the file cannot be parsed,
   * rather than rejecting: one corrupt file in 20,000 must not end a scan, and the
   * scanner counts it in `files_failed` and moves on.
   */
  read(relativePath: string): Promise<TrackTags | undefined>;
}

export interface TrackTags {
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  genre?: string;
  releaseYear?: number;
  trackNumber?: number;
  discNumber?: number;
  durationSeconds?: number;
  cover?: AlbumCover;
}

export interface MusicRepository {
  // --- tracks ---
  upsertTrack(track: TrackUpsert): number;
  /** Facts only, for the scanner's skip check — no tags, no join. */
  getTrackFileFacts(relativePath: string): TrackFileFacts | undefined;
  getTrack(id: number): Track | undefined;
  searchTracks(query: TrackSearchQuery): { tracks: Track[]; totalCount: number };
  deleteTracksMissingFrom(relativeFolder: string, keptPaths: readonly string[]): number;
  countTracks(): number;

  // --- albums ---
  upsertAlbum(album: { name: string; albumArtist: string; genre: string; releaseYear?: number }): number;
  setAlbumCover(albumId: number, cover: AlbumCover): void;
  albumHasCover(albumId: number): boolean;
  /** The only reader of the cover BLOB — see coding-guide.md on per-row images. */
  getAlbumCover(albumId: number): AlbumCover | undefined;
  listAlbums(options: { limit: number; offset: number; search?: string }): {
    albums: Album[];
    totalCount: number;
  };
  recountAlbumTracks(albumId: number): void;

  // --- scan runs ---
  createScanRun(run: { rootFolder: string; extensions: readonly MusicExtension[] }): number;
  /** Phase one's result: the denominator the progress bar needs. */
  setScanRunTotal(id: number, filesTotal: number): void;
  updateScanRunProgress(id: number, progress: ScanRunProgress): void;
  finishScanRun(id: number, status: "completed" | "failed" | "cancelled", lastError?: string): void;
  getScanRun(id: number): ScanRun | undefined;
  getActiveScanRun(): ScanRun | undefined;
  listRecentScanRuns(limit: number): ScanRun[];

  // --- browse views (see migrations/0056) ---
  /** Distinct artists with track counts, for the Artists view. */
  listArtists(options: { limit: number; offset: number; search?: string }): {
    groups: LibraryGroup[];
    totalCount: number;
  };
  /** Distinct genres with track counts. */
  listGenres(): LibraryGroup[];
  /** Distinct release years, newest first. */
  listYears(): LibraryGroup[];
  /** Every folder holding tracks, flat, for the Folders view. */
  listTrackFolders(options: { limit: number; offset: number; search?: string }): {
    folders: LibraryFolder[];
    totalCount: number;
  };
  /**
   * One level of the folder tree, for Folder Hierarchy.
   *
   * Derived from the catalog rather than the filesystem, so it shows what has been
   * scanned rather than what exists on disk -- and needs no NAS round-trip to render.
   */
  listFolderChildren(relativeFolder: string): LibraryFolderNode[];

  // --- play counts (see migrations/0056) ---
  /**
   * Records that playback started: increments the counter and logs the event.
   *
   * "Started" is the chosen definition, not "listened to" -- see migrations/0056 for the
   * tradeoff. Must never throw in a way that fails playback.
   */
  recordPlay(trackId: number, userId?: number): void;
  /** Most-played tracks, highest first. */
  listMostPlayed(options: { limit: number; offset: number }): {
    tracks: Track[];
    totalCount: number;
  };

  // --- playlists (shared, not per-user; see migrations/0056) ---
  createPlaylist(playlist: { name: string; description: string }): number;
  updatePlaylist(id: number, playlist: { name: string; description: string }): void;
  deletePlaylist(id: number): void;
  listPlaylists(): Playlist[];
  getPlaylist(id: number): Playlist | undefined;
  listPlaylistTracks(playlistId: number): { entry: PlaylistEntry; track: Track }[];
  addTracksToPlaylist(playlistId: number, trackIds: readonly number[]): void;
  /** Removes one ENTRY, not every copy of a track -- a playlist may hold it twice. */
  removePlaylistEntry(playlistTrackId: number): void;
  reorderPlaylist(playlistId: number, orderedPlaylistTrackIds: readonly number[]): void;

  // --- lyrics (cached on demand; see migrations/0054) ---
  getTrackLyrics(trackId: number): TrackLyrics | undefined;
  saveTrackLyrics(lyrics: Omit<TrackLyrics, "fetchedAt">): void;
  countLyricsByStatus(): Record<LyricsStatus, number>;
}

/**
 * Fetches lyrics from an external service.
 *
 * A port rather than a direct fetch so the use-case is testable offline, and so the
 * provider can be replaced without touching anything that calls it. Implemented by
 * LrclibLyricsClient.
 */
export interface LyricsClient {
  /**
   * Looks up one track. Resolves to a status rather than rejecting when the track
   * simply is not there -- "nobody has these lyrics" is an answer, not a failure.
   * Rejects only when the request itself could not be made or the service erred, so
   * the caller can record `failed` (retryable) instead of `not_found` (a real miss).
   */
  lookup(query: LyricsQuery): Promise<LyricsLookupResult>;
}

export interface LyricsLookupResult {
  status: Exclude<LyricsStatus, "failed">;
  /** Present only when status is `found`. */
  lyrics?: string;
  /** What the service thinks it matched, for showing "matched: X - Y" in the player. */
  matchedArtist?: string;
  matchedTitle?: string;
}
