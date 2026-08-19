import type Database from "better-sqlite3";
import type {
  LibraryFolder,
  LibraryFolderNode,
  LibraryGroup,
  Playlist,
  PlaylistEntry,
} from "./browse";
import { MUSIC_FORMATS, type MusicExtension } from "./formats";
import type { LyricsStatus, TrackLyrics } from "./lyrics";
import type { MusicRepository } from "./ports";
import type {
  Album,
  AlbumCover,
  ScanRun,
  ScanRunProgress,
  ScanStatus,
  Track,
  TrackFileFacts,
  TrackSearchQuery,
  TrackUpsert,
} from "./types";

// The only file in this module that knows SQL.
//
// Two rules are load-bearing here and easy to break by accident:
//
//  1. `mus_albums.cover_image` is a BLOB, so no query in this file may `SELECT *`
//     from that table. Reads use an explicit column list and expose only
//     `has_cover_image`; the sole reader of the bytes is `getAlbumCover`, which the
//     cover-serving route calls. See coding-guide.md on per-row images.
//  2. `mus_tracks` is read fifty rows at a time by the library screen, so its
//     queries stay narrow and indexed. There is no lyric text on this table for the
//     same reason -- lyrics live in mus_track_lyrics.

interface TrackRow {
  id: number;
  relative_path: string;
  file_name: string;
  title: string;
  artist: string;
  album: string;
  album_artist: string;
  genre: string;
  release_year: number | null;
  track_number: number | null;
  disc_number: number | null;
  duration_seconds: number | null;
  extension: string;
  mime_type: string;
  file_size: number;
  file_mtime: string;
  is_streamable: number;
  has_cue_sheet: number;
  album_id: number | null;
  play_count: number;
  last_played_at: string | null;
}

interface AlbumRow {
  id: number;
  name: string;
  album_artist: string;
  genre: string;
  release_year: number | null;
  track_count: number;
  has_cover_image: number;
}

interface ScanRunRow {
  id: number;
  root_folder: string;
  formats_json: string;
  status: string;
  files_total: number;
  files_seen: number;
  tracks_added: number;
  tracks_updated: number;
  files_skipped: number;
  files_failed: number;
  last_error: string;
  current_path: string;
  started_at: string;
  finished_at: string | null;
  updated_at: string;
}

interface LyricsRow {
  track_id: number;
  status: string;
  lyrics: string;
  source: string;
  search_artist: string;
  search_title: string;
  fetched_at: string;
}

const TRACK_COLUMNS = `
  id, relative_path, file_name, title, artist, album, album_artist, genre,
  release_year, track_number, disc_number, duration_seconds, extension, mime_type,
  file_size, file_mtime, is_streamable, has_cue_sheet, album_id,
  play_count, last_played_at
`;

// Note the absence of cover_image: see rule 1 above.
const ALBUM_COLUMNS = `
  id, name, album_artist, genre, release_year, track_count,
  cover_image IS NOT NULL AS has_cover_image
`;

function toTrack(row: TrackRow): Track {
  const extension = row.extension as MusicExtension;
  return {
    id: row.id,
    relativePath: row.relative_path,
    fileName: row.file_name,
    title: row.title,
    // Never blank: a list row with no text reads as a broken record.
    displayTitle: row.title.trim() !== "" ? row.title : row.file_name,
    artist: row.artist,
    album: row.album,
    albumArtist: row.album_artist,
    genre: row.genre,
    releaseYear: row.release_year ?? undefined,
    trackNumber: row.track_number ?? undefined,
    discNumber: row.disc_number ?? undefined,
    durationSeconds: row.duration_seconds ?? undefined,
    extension,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    fileMtime: row.file_mtime,
    isStreamable: row.is_streamable === 1,
    hasCueSheet: row.has_cue_sheet === 1,
    albumId: row.album_id ?? undefined,
    playCount: row.play_count,
    lastPlayedAt: row.last_played_at ?? undefined,
  };
}

function toAlbum(row: AlbumRow): Album {
  return {
    id: row.id,
    name: row.name,
    albumArtist: row.album_artist,
    genre: row.genre,
    releaseYear: row.release_year ?? undefined,
    trackCount: row.track_count,
    hasCoverImage: row.has_cover_image === 1,
  };
}

function toScanRun(row: ScanRunRow): ScanRun {
  let extensions: MusicExtension[] = [];
  try {
    const parsed = JSON.parse(row.formats_json) as unknown;
    if (Array.isArray(parsed)) {
      extensions = parsed.filter(
        (entry): entry is MusicExtension =>
          typeof entry === "string" && Object.hasOwn(MUSIC_FORMATS, entry),
      );
    }
  } catch {
    // A malformed record of a past choice is not worth failing a read over.
  }

  return {
    id: row.id,
    rootFolder: row.root_folder,
    extensions,
    status: row.status as ScanStatus,
    filesTotal: row.files_total,
    filesSeen: row.files_seen,
    tracksAdded: row.tracks_added,
    tracksUpdated: row.tracks_updated,
    filesSkipped: row.files_skipped,
    filesFailed: row.files_failed,
    lastError: row.last_error,
    currentPath: row.current_path,
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? undefined,
    updatedAt: row.updated_at,
  };
}

function toLyrics(row: LyricsRow): TrackLyrics {
  return {
    trackId: row.track_id,
    status: row.status as LyricsStatus,
    lyrics: row.lyrics,
    source: row.source,
    searchArtist: row.search_artist,
    searchTitle: row.search_title,
    fetchedAt: row.fetched_at,
  };
}

export class SqliteMusicRepository implements MusicRepository {
  constructor(private readonly db: Database.Database) {}

  // --- tracks ---

  upsertTrack(track: TrackUpsert): number {
    // ON CONFLICT on relative_path: a re-scan revisits the same file and must update
    // it, not add a second row. The unique index is what makes this reliable.
    const statement = this.db.prepare(`
      INSERT INTO mus_tracks (
        relative_path, file_name, title, artist, album, album_artist, genre,
        release_year, track_number, disc_number, duration_seconds, extension,
        mime_type, file_size, file_mtime, is_streamable, has_cue_sheet, album_id
      ) VALUES (
        @relativePath, @fileName, @title, @artist, @album, @albumArtist, @genre,
        @releaseYear, @trackNumber, @discNumber, @durationSeconds, @extension,
        @mimeType, @fileSize, @fileMtime, @isStreamable, @hasCueSheet, @albumId
      )
      ON CONFLICT (relative_path) DO UPDATE SET
        file_name = excluded.file_name,
        title = excluded.title,
        artist = excluded.artist,
        album = excluded.album,
        album_artist = excluded.album_artist,
        genre = excluded.genre,
        release_year = excluded.release_year,
        track_number = excluded.track_number,
        disc_number = excluded.disc_number,
        duration_seconds = excluded.duration_seconds,
        extension = excluded.extension,
        mime_type = excluded.mime_type,
        file_size = excluded.file_size,
        file_mtime = excluded.file_mtime,
        is_streamable = excluded.is_streamable,
        has_cue_sheet = excluded.has_cue_sheet,
        album_id = excluded.album_id
      RETURNING id
    `);

    const row = statement.get({
      relativePath: track.relativePath,
      fileName: track.fileName,
      title: track.title,
      artist: track.artist,
      album: track.album,
      albumArtist: track.albumArtist,
      genre: track.genre,
      releaseYear: track.releaseYear ?? null,
      trackNumber: track.trackNumber ?? null,
      discNumber: track.discNumber ?? null,
      durationSeconds: track.durationSeconds ?? null,
      extension: track.extension,
      mimeType: track.mimeType,
      fileSize: track.fileSize,
      fileMtime: track.fileMtime,
      isStreamable: track.isStreamable ? 1 : 0,
      hasCueSheet: track.hasCueSheet ? 1 : 0,
      albumId: track.albumId ?? null,
    }) as { id: number };

    return row.id;
  }

  getTrackFileFacts(relativePath: string): TrackFileFacts | undefined {
    // Deliberately three columns: this runs once per file during a scan, and the
    // whole point is to decide "unchanged, skip" as cheaply as possible.
    const row = this.db
      .prepare(
        `SELECT relative_path, file_size, file_mtime FROM mus_tracks WHERE relative_path = ?`,
      )
      .get(relativePath) as
      | { relative_path: string; file_size: number; file_mtime: string }
      | undefined;

    if (row === undefined) return undefined;
    return {
      relativePath: row.relative_path,
      fileSize: row.file_size,
      fileMtime: row.file_mtime,
    };
  }

  getTrack(id: number): Track | undefined {
    const row = this.db
      .prepare(`SELECT ${TRACK_COLUMNS} FROM mus_tracks WHERE id = ?`)
      .get(id) as TrackRow | undefined;
    return row === undefined ? undefined : toTrack(row);
  }

  searchTracks(query: TrackSearchQuery): { tracks: Track[]; totalCount: number } {
    const conditions: string[] = [];
    const parameters: Record<string, unknown> = {};

    if (query.search !== undefined && query.search.trim() !== "") {
      // Matched across the three fields a listener would type into a search box.
      conditions.push(
        `(title LIKE @search COLLATE NOCASE
          OR artist LIKE @search COLLATE NOCASE
          OR album LIKE @search COLLATE NOCASE
          OR file_name LIKE @search COLLATE NOCASE)`,
      );
      parameters.search = `%${query.search.trim()}%`;
    }
    if (query.albumId !== undefined) {
      conditions.push(`album_id = @albumId`);
      parameters.albumId = query.albumId;
    }
    // Exact matches for the grouping views, NOCASE so they agree with how the groups were
    // derived. An empty string is a real filter here -- it selects the untagged group,
    // which is a category a listener can click, not an absent parameter.
    if (query.artist !== undefined) {
      conditions.push(`artist = @artist COLLATE NOCASE`);
      parameters.artist = query.artist;
    }
    if (query.genre !== undefined) {
      conditions.push(`genre = @genre COLLATE NOCASE`);
      parameters.genre = query.genre;
    }
    if (query.releaseYear !== undefined) {
      // `null` means "year unknown", which is IS NULL rather than `= NULL`.
      if (query.releaseYear === null) conditions.push(`release_year IS NULL`);
      else {
        conditions.push(`release_year = @releaseYear`);
        parameters.releaseYear = query.releaseYear;
      }
    }
    if (query.folder !== undefined && query.folder !== "") {
      // Subtree match, so picking CHINESE also shows CHINESE/Beyond.
      conditions.push(`relative_path LIKE @folder`);
      parameters.folder = `${query.folder}/%`;
    }
    if (query.streamableOnly === true) {
      conditions.push(`is_streamable = 1`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const totalRow = this.db
      .prepare(`SELECT COUNT(*) AS total FROM mus_tracks ${where}`)
      .get(parameters) as { total: number };

    const rows = this.db
      .prepare(
        `SELECT ${TRACK_COLUMNS} FROM mus_tracks ${where}
         ORDER BY artist COLLATE NOCASE, album COLLATE NOCASE, disc_number, track_number,
                  title COLLATE NOCASE
         LIMIT @limit OFFSET @offset`,
      )
      .all({ ...parameters, limit: query.limit, offset: query.offset }) as TrackRow[];

    return { tracks: rows.map(toTrack), totalCount: totalRow.total };
  }

  deleteTracksMissingFrom(relativeFolder: string, keptPaths: readonly string[]): number {
    // Only ever removes CATALOG rows. Nothing on disk is touched -- see the
    // read-only note on MusicFileStore.
    const kept = new Set(keptPaths);
    const prefix = relativeFolder === "" ? "%" : `${relativeFolder}/%`;

    const existing = this.db
      .prepare(`SELECT id, relative_path FROM mus_tracks WHERE relative_path LIKE ?`)
      .all(prefix) as { id: number; relative_path: string }[];

    const stale = existing.filter((row) => !kept.has(row.relative_path));
    if (stale.length === 0) return 0;

    const remove = this.db.prepare(`DELETE FROM mus_tracks WHERE id = ?`);
    const removeLyrics = this.db.prepare(`DELETE FROM mus_track_lyrics WHERE track_id = ?`);
    const runAll = this.db.transaction((rows: { id: number }[]) => {
      for (const row of rows) {
        removeLyrics.run(row.id);
        remove.run(row.id);
      }
    });
    runAll(stale);

    return stale.length;
  }

  countTracks(): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS total FROM mus_tracks`).get() as {
      total: number;
    };
    return row.total;
  }

  // --- albums ---

  upsertAlbum(album: {
    name: string;
    albumArtist: string;
    genre: string;
    releaseYear?: number;
  }): number {
    const existing = this.db
      .prepare(
        `SELECT id FROM mus_albums
         WHERE name = ? COLLATE NOCASE AND album_artist = ? COLLATE NOCASE`,
      )
      .get(album.name, album.albumArtist) as { id: number } | undefined;

    if (existing !== undefined) return existing.id;

    const row = this.db
      .prepare(
        `INSERT INTO mus_albums (name, album_artist, genre, release_year)
         VALUES (?, ?, ?, ?) RETURNING id`,
      )
      .get(album.name, album.albumArtist, album.genre, album.releaseYear ?? null) as {
      id: number;
    };
    return row.id;
  }

  setAlbumCover(albumId: number, cover: AlbumCover): void {
    this.db
      .prepare(`UPDATE mus_albums SET cover_image = ?, cover_mime_type = ? WHERE id = ?`)
      .run(cover.data, cover.mimeType, albumId);
  }

  albumHasCover(albumId: number): boolean {
    const row = this.db
      .prepare(`SELECT cover_image IS NOT NULL AS has_cover FROM mus_albums WHERE id = ?`)
      .get(albumId) as { has_cover: number } | undefined;
    return row?.has_cover === 1;
  }

  /** The one place the cover bytes are read. Called only by the serving route. */
  getAlbumCover(albumId: number): AlbumCover | undefined {
    const row = this.db
      .prepare(`SELECT cover_image, cover_mime_type FROM mus_albums WHERE id = ?`)
      .get(albumId) as { cover_image: Buffer | null; cover_mime_type: string } | undefined;

    if (row?.cover_image === null || row?.cover_image === undefined) return undefined;
    return { data: row.cover_image, mimeType: row.cover_mime_type };
  }

  listAlbums(options: { limit: number; offset: number; search?: string }): {
    albums: Album[];
    totalCount: number;
  } {
    const hasSearch = options.search !== undefined && options.search.trim() !== "";
    const where = hasSearch
      ? `WHERE (name LIKE @search COLLATE NOCASE OR album_artist LIKE @search COLLATE NOCASE)`
      : "";
    const parameters: Record<string, unknown> = hasSearch
      ? { search: `%${(options.search as string).trim()}%` }
      : {};

    const totalRow = this.db
      .prepare(`SELECT COUNT(*) AS total FROM mus_albums ${where}`)
      .get(parameters) as { total: number };

    const rows = this.db
      .prepare(
        `SELECT ${ALBUM_COLUMNS} FROM mus_albums ${where}
         ORDER BY album_artist COLLATE NOCASE, name COLLATE NOCASE
         LIMIT @limit OFFSET @offset`,
      )
      .all({ ...parameters, limit: options.limit, offset: options.offset }) as AlbumRow[];

    return { albums: rows.map(toAlbum), totalCount: totalRow.total };
  }

  recountAlbumTracks(albumId: number): void {
    this.db
      .prepare(
        `UPDATE mus_albums
         SET track_count = (SELECT COUNT(*) FROM mus_tracks WHERE album_id = ?)
         WHERE id = ?`,
      )
      .run(albumId, albumId);
  }

  // --- scan runs ---

  createScanRun(run: { rootFolder: string; extensions: readonly MusicExtension[] }): number {
    const row = this.db
      .prepare(
        `INSERT INTO mus_scan_runs (root_folder, formats_json, status)
         VALUES (?, ?, 'running') RETURNING id`,
      )
      .get(run.rootFolder, JSON.stringify([...run.extensions])) as { id: number };
    return row.id;
  }

  setScanRunTotal(id: number, filesTotal: number): void {
    this.db
      .prepare(
        `UPDATE mus_scan_runs SET files_total = ?, updated_at = datetime('now') WHERE id = ?`,
      )
      .run(filesTotal, id);
  }

  updateScanRunProgress(id: number, progress: ScanRunProgress): void {
    // updated_at is set explicitly rather than by a trigger: a scan writes this row
    // thousands of times and a trigger would double every one of those writes.
    this.db
      .prepare(
        `UPDATE mus_scan_runs SET
           files_seen = @filesSeen,
           tracks_added = @tracksAdded,
           tracks_updated = @tracksUpdated,
           files_skipped = @filesSkipped,
           files_failed = @filesFailed,
           current_path = @currentPath,
           last_error = COALESCE(@lastError, last_error),
           updated_at = datetime('now')
         WHERE id = @id`,
      )
      .run({
        id,
        filesSeen: progress.filesSeen,
        tracksAdded: progress.tracksAdded,
        tracksUpdated: progress.tracksUpdated,
        filesSkipped: progress.filesSkipped,
        filesFailed: progress.filesFailed,
        currentPath: progress.currentPath,
        lastError: progress.lastError ?? null,
      });
  }

  finishScanRun(id: number, status: "completed" | "failed" | "cancelled", lastError?: string): void {
    this.db
      .prepare(
        `UPDATE mus_scan_runs SET
           status = ?, finished_at = datetime('now'), updated_at = datetime('now'),
           current_path = '', last_error = COALESCE(?, last_error)
         WHERE id = ?`,
      )
      .run(status, lastError ?? null, id);
  }

  getScanRun(id: number): ScanRun | undefined {
    const row = this.db.prepare(`SELECT * FROM mus_scan_runs WHERE id = ?`).get(id) as
      | ScanRunRow
      | undefined;
    return row === undefined ? undefined : toScanRun(row);
  }

  getActiveScanRun(): ScanRun | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM mus_scan_runs WHERE status = 'running' ORDER BY started_at DESC LIMIT 1`,
      )
      .get() as ScanRunRow | undefined;
    return row === undefined ? undefined : toScanRun(row);
  }

  listRecentScanRuns(limit: number): ScanRun[] {
    const rows = this.db
      .prepare(`SELECT * FROM mus_scan_runs ORDER BY started_at DESC LIMIT ?`)
      .all(limit) as ScanRunRow[];
    return rows.map(toScanRun);
  }

  // --- browse views (see migrations/0056) ---

  listArtists(options: { limit: number; offset: number; search?: string }): {
    groups: LibraryGroup[];
    totalCount: number;
  } {
    // Untagged tracks group under '' and are labelled by the caller, rather than being
    // filtered out -- "no artist" is a real category in a library this untidy, and
    // dropping those rows would make the counts not add up to the track total.
    const hasSearch = options.search !== undefined && options.search.trim() !== "";
    const where = hasSearch ? `WHERE artist LIKE @search COLLATE NOCASE` : "";
    const parameters: Record<string, unknown> = hasSearch
      ? { search: `%${(options.search as string).trim()}%` }
      : {};

    const totalRow = this.db
      .prepare(
        `SELECT COUNT(*) AS total FROM (
           SELECT artist FROM mus_tracks ${where} GROUP BY artist COLLATE NOCASE
         )`,
      )
      .get(parameters) as { total: number };

    const rows = this.db
      .prepare(
        `SELECT artist AS key,
                COUNT(*) AS track_count,
                COUNT(DISTINCT album) AS album_count
         FROM mus_tracks ${where}
         GROUP BY artist COLLATE NOCASE
         ORDER BY artist = '' , artist COLLATE NOCASE
         LIMIT @limit OFFSET @offset`,
      )
      .all({ ...parameters, limit: options.limit, offset: options.offset }) as {
      key: string;
      track_count: number;
      album_count: number;
    }[];

    return {
      groups: rows.map((row) => ({
        key: row.key,
        label: row.key === "" ? "Unknown artist" : row.key,
        trackCount: row.track_count,
        detail:
          row.album_count > 1 ? `${row.album_count} albums` : row.album_count === 1 ? "1 album" : undefined,
      })),
      totalCount: totalRow.total,
    };
  }

  listGenres(): LibraryGroup[] {
    // No paging: a library has tens of genres, not thousands, and a genre list that
    // paginates would be worse than one that scrolls.
    const rows = this.db
      .prepare(
        `SELECT genre AS key, COUNT(*) AS track_count, COUNT(DISTINCT artist) AS artist_count
         FROM mus_tracks
         GROUP BY genre COLLATE NOCASE
         ORDER BY genre = '', track_count DESC, genre COLLATE NOCASE`,
      )
      .all() as { key: string; track_count: number; artist_count: number }[];

    return rows.map((row) => ({
      key: row.key,
      label: row.key === "" ? "No genre" : row.key,
      trackCount: row.track_count,
      detail: `${row.artist_count} ${row.artist_count === 1 ? "artist" : "artists"}`,
    }));
  }

  listYears(): LibraryGroup[] {
    // NULL years sort last rather than as year 0. Newest first otherwise, which is how
    // someone browsing by year usually looks.
    const rows = this.db
      .prepare(
        `SELECT release_year AS year, COUNT(*) AS track_count, COUNT(DISTINCT artist) AS artist_count
         FROM mus_tracks
         GROUP BY release_year
         ORDER BY release_year IS NULL, release_year DESC`,
      )
      .all() as { year: number | null; track_count: number; artist_count: number }[];

    return rows.map((row) => ({
      key: row.year === null ? "" : String(row.year),
      label: row.year === null ? "Year unknown" : String(row.year),
      trackCount: row.track_count,
      detail: `${row.artist_count} ${row.artist_count === 1 ? "artist" : "artists"}`,
    }));
  }

  listTrackFolders(options: { limit: number; offset: number; search?: string }): {
    folders: LibraryFolder[];
    totalCount: number;
  } {
    // The folder is derived in SQL rather than in JS so the count and the page come from
    // one query each instead of pulling 20k paths into memory to group them.
    //
    // rtrim(relative_path, replace(relative_path, '/', '')) is the standard SQLite idiom
    // for "everything up to the last slash": the inner replace strips the slashes, and
    // rtrim removes those characters from the right, leaving the directory part with its
    // trailing slash. A path with no slash yields '' -- the library root.
    const hasSearch = options.search !== undefined && options.search.trim() !== "";
    const folderExpression =
      `rtrim(relative_path, replace(relative_path, '/', ''))`;
    const where = hasSearch ? `WHERE relative_path LIKE @search COLLATE NOCASE` : "";
    const parameters: Record<string, unknown> = hasSearch
      ? { search: `%${(options.search as string).trim()}%` }
      : {};

    const totalRow = this.db
      .prepare(
        `SELECT COUNT(*) AS total FROM (
           SELECT ${folderExpression} AS folder FROM mus_tracks ${where} GROUP BY folder
         )`,
      )
      .get(parameters) as { total: number };

    const rows = this.db
      .prepare(
        `SELECT ${folderExpression} AS folder, COUNT(*) AS track_count
         FROM mus_tracks ${where}
         GROUP BY folder
         ORDER BY folder COLLATE NOCASE
         LIMIT @limit OFFSET @offset`,
      )
      .all({ ...parameters, limit: options.limit, offset: options.offset }) as {
      folder: string;
      track_count: number;
    }[];

    // The subtree total is a second query per row, so it is only worth doing for a page
    // of fifty. Counting descendants in the same GROUP BY is not expressible without a
    // recursive CTE over a path column, which would cost more than fifty cheap lookups.
    const subtreeCount = this.db.prepare(
      `SELECT COUNT(*) AS total FROM mus_tracks WHERE relative_path LIKE ? COLLATE NOCASE`,
    );

    return {
      folders: rows.map((row) => {
        const relativePath = row.folder.replace(/\/+$/, "");
        const total = (
          subtreeCount.get(relativePath === "" ? "%" : `${relativePath}/%`) as { total: number }
        ).total;
        return {
          relativePath,
          name: relativePath === "" ? "(library root)" : (relativePath.split("/").pop() as string),
          trackCount: row.track_count,
          totalTrackCount: total,
        };
      }),
      totalCount: totalRow.total,
    };
  }

  listFolderChildren(relativeFolder: string): LibraryFolderNode[] {
    // Derived from the CATALOG, not the filesystem: the tree then shows what has been
    // scanned (which is what a listener can actually play) and needs no NAS round-trip,
    // which matters when the NAS is asleep.
    const prefix = relativeFolder === "" ? "" : `${relativeFolder}/`;
    const depth = prefix === "" ? 0 : prefix.split("/").length - 1;

    const rows = this.db
      .prepare(
        `SELECT relative_path FROM mus_tracks
         WHERE (@prefix = '' OR relative_path LIKE @like COLLATE NOCASE)`,
      )
      .all({ prefix, like: `${prefix}%` }) as { relative_path: string }[];

    // Grouping in JS rather than SQL here: extracting "the segment at depth N" needs
    // nested instr/substr arithmetic that is unreadable, and this runs over one subtree
    // rather than the whole library.
    const children = new Map<string, { direct: number; total: number; hasChildren: boolean }>();

    for (const row of rows) {
      const segments = row.relative_path.split("/");
      // A file directly in this folder has exactly depth+1 segments (the filename).
      if (segments.length <= depth + 1) continue;

      const name = segments[depth];
      const entry = children.get(name) ?? { direct: 0, total: 0, hasChildren: false };
      entry.total += 1;
      // depth+2 segments means the file sits directly in this child folder.
      if (segments.length === depth + 2) entry.direct += 1;
      else entry.hasChildren = true;
      children.set(name, entry);
    }

    return [...children.entries()]
      .map(([name, counts]) => ({
        relativePath: `${prefix}${name}`,
        name,
        trackCount: counts.direct,
        totalTrackCount: counts.total,
        hasChildren: counts.hasChildren,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  // --- play counts (see migrations/0056) ---

  recordPlay(trackId: number, userId?: number): void {
    // One transaction: the counter and the log entry are one fact, and a counter that
    // moved without a matching event would break the retro-compute path 0055 describes.
    const bump = this.db.prepare(
      `UPDATE mus_tracks
       SET play_count = play_count + 1, last_played_at = datetime('now')
       WHERE id = ?`,
    );
    const log = this.db.prepare(
      `INSERT INTO mus_play_events (track_id, user_id) VALUES (?, ?)`,
    );
    this.db.transaction(() => {
      bump.run(trackId);
      log.run(trackId, userId ?? null);
    })();
  }

  listMostPlayed(options: { limit: number; offset: number }): {
    tracks: Track[];
    totalCount: number;
  } {
    const totalRow = this.db
      .prepare(`SELECT COUNT(*) AS total FROM mus_tracks WHERE play_count > 0`)
      .get() as { total: number };

    // `id` as the tiebreak, so equal counts come back in a stable order instead of
    // shuffling between page loads.
    const rows = this.db
      .prepare(
        `SELECT ${TRACK_COLUMNS} FROM mus_tracks
         WHERE play_count > 0
         ORDER BY play_count DESC, id
         LIMIT @limit OFFSET @offset`,
      )
      .all({ limit: options.limit, offset: options.offset }) as TrackRow[];

    return { tracks: rows.map(toTrack), totalCount: totalRow.total };
  }

  // --- playlists (shared, not per-user; see migrations/0056) ---

  createPlaylist(playlist: { name: string; description: string }): number {
    const row = this.db
      .prepare(
        `INSERT INTO mus_playlists (name, description) VALUES (?, ?) RETURNING id`,
      )
      .get(playlist.name, playlist.description) as { id: number };
    return row.id;
  }

  updatePlaylist(id: number, playlist: { name: string; description: string }): void {
    this.db
      .prepare(`UPDATE mus_playlists SET name = ?, description = ? WHERE id = ?`)
      .run(playlist.name, playlist.description, id);
  }

  deletePlaylist(id: number): void {
    // The entries go with it. No music file is touched -- a playlist is only a list.
    this.db.transaction(() => {
      this.db.prepare(`DELETE FROM mus_playlist_tracks WHERE playlist_id = ?`).run(id);
      this.db.prepare(`DELETE FROM mus_playlists WHERE id = ?`).run(id);
    })();
  }

  listPlaylists(): Playlist[] {
    const rows = this.db
      .prepare(
        `SELECT p.id, p.name, p.description, p.updated_at,
                (SELECT COUNT(*) FROM mus_playlist_tracks t WHERE t.playlist_id = p.id) AS track_count
         FROM mus_playlists p
         ORDER BY p.name COLLATE NOCASE`,
      )
      .all() as {
      id: number;
      name: string;
      description: string;
      updated_at: string;
      track_count: number;
    }[];

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      trackCount: row.track_count,
      updatedAt: row.updated_at,
    }));
  }

  getPlaylist(id: number): Playlist | undefined {
    const row = this.db
      .prepare(
        `SELECT p.id, p.name, p.description, p.updated_at,
                (SELECT COUNT(*) FROM mus_playlist_tracks t WHERE t.playlist_id = p.id) AS track_count
         FROM mus_playlists p WHERE p.id = ?`,
      )
      .get(id) as
      | { id: number; name: string; description: string; updated_at: string; track_count: number }
      | undefined;

    if (row === undefined) return undefined;
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      trackCount: row.track_count,
      updatedAt: row.updated_at,
    };
  }

  listPlaylistTracks(playlistId: number): { entry: PlaylistEntry; track: Track }[] {
    // An INNER JOIN drops entries whose track has been removed from the catalog, which is
    // the wanted behaviour: a scan that finds a file gone deletes the track row, and a
    // playlist should then simply be shorter rather than showing a broken line.
    const rows = this.db
      .prepare(
        `SELECT pt.id AS playlist_track_id, pt.position, ${TRACK_COLUMNS
          .split(",")
          .map((column) => `t.${column.trim()}`)
          .join(", ")}
         FROM mus_playlist_tracks pt
         JOIN mus_tracks t ON t.id = pt.track_id
         WHERE pt.playlist_id = ?
         ORDER BY pt.position, pt.id`,
      )
      .all(playlistId) as (TrackRow & { playlist_track_id: number; position: number })[];

    return rows.map((row) => ({
      entry: { playlistTrackId: row.playlist_track_id, position: row.position, trackId: row.id },
      track: toTrack(row),
    }));
  }

  addTracksToPlaylist(playlistId: number, trackIds: readonly number[]): void {
    if (trackIds.length === 0) return;
    // Appended after whatever is already there. `MAX(position)` rather than the row count,
    // because a removal leaves a gap and counting would collide with an existing position.
    const nextRow = this.db
      .prepare(
        `SELECT COALESCE(MAX(position), -1) + 1 AS next FROM mus_playlist_tracks WHERE playlist_id = ?`,
      )
      .get(playlistId) as { next: number };

    const insert = this.db.prepare(
      `INSERT INTO mus_playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)`,
    );
    const touch = this.db.prepare(`UPDATE mus_playlists SET name = name WHERE id = ?`);

    this.db.transaction(() => {
      let position = nextRow.next;
      for (const trackId of trackIds) insert.run(playlistId, trackId, position++);
      // Nudges the playlist's own row so its updated_at trigger fires -- adding tracks is
      // a change to the playlist even though no column on it changed.
      touch.run(playlistId);
    })();
  }

  removePlaylistEntry(playlistTrackId: number): void {
    this.db.prepare(`DELETE FROM mus_playlist_tracks WHERE id = ?`).run(playlistTrackId);
  }

  reorderPlaylist(playlistId: number, orderedPlaylistTrackIds: readonly number[]): void {
    // Positions are rewritten from 0 in the order given. Scoped by playlist_id as well as
    // entry id so a caller cannot reorder another playlist's entries by passing their ids.
    const update = this.db.prepare(
      `UPDATE mus_playlist_tracks SET position = ? WHERE id = ? AND playlist_id = ?`,
    );
    this.db.transaction(() => {
      let position = 0;
      for (const entryId of orderedPlaylistTrackIds) update.run(position++, entryId, playlistId);
    })();
  }

  // --- lyrics ---

  getTrackLyrics(trackId: number): TrackLyrics | undefined {
    const row = this.db
      .prepare(
        `SELECT track_id, status, lyrics, source, search_artist, search_title, fetched_at
         FROM mus_track_lyrics WHERE track_id = ?`,
      )
      .get(trackId) as LyricsRow | undefined;
    return row === undefined ? undefined : toLyrics(row);
  }

  saveTrackLyrics(lyrics: Omit<TrackLyrics, "fetchedAt">): void {
    // Replaces rather than accumulates: there is no lyric history worth keeping, and
    // the unique index on track_id makes that explicit rather than relying on the
    // caller to delete first.
    this.db
      .prepare(
        `INSERT INTO mus_track_lyrics
           (track_id, status, lyrics, source, search_artist, search_title, fetched_at)
         VALUES (@trackId, @status, @lyrics, @source, @searchArtist, @searchTitle, datetime('now'))
         ON CONFLICT (track_id) DO UPDATE SET
           status = excluded.status,
           lyrics = excluded.lyrics,
           source = excluded.source,
           search_artist = excluded.search_artist,
           search_title = excluded.search_title,
           fetched_at = excluded.fetched_at`,
      )
      .run({
        trackId: lyrics.trackId,
        status: lyrics.status,
        lyrics: lyrics.lyrics,
        source: lyrics.source,
        searchArtist: lyrics.searchArtist,
        searchTitle: lyrics.searchTitle,
      });
  }

  countLyricsByStatus(): Record<LyricsStatus, number> {
    const rows = this.db
      .prepare(`SELECT status, COUNT(*) AS total FROM mus_track_lyrics GROUP BY status`)
      .all() as { status: string; total: number }[];

    const counts: Record<LyricsStatus, number> = {
      found: 0,
      instrumental: 0,
      not_found: 0,
      failed: 0,
    };
    for (const row of rows) {
      if (Object.hasOwn(counts, row.status)) counts[row.status as LyricsStatus] = row.total;
    }
    return counts;
  }
}
