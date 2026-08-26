import type Database from "better-sqlite3";
import type { Track } from "@/lib/music";
import { MUSIC_FORMATS, type MusicExtension } from "@/lib/music";
import { folderLikePattern } from "./folders";
import type {
  MagicAlbumOption,
  MagicCandidateSource,
  MagicFolderOption,
  MagicListRepository,
  MagicPickerOption,
} from "./ports";
import type { MagicCriteria, MagicList, MagicListSummary } from "./types";

// The only file in this module that knows SQL.
//
// It reads `mus_tracks` and `mus_albums`, which belong to the Music Library's schema, and
// owns `mus_magic_list` / `mus_magic_list_tracks`. Reading another module's TABLES while
// importing only its index.ts is the deliberate line here: the tables are one database and
// duplicating the catalog would be worse, but the TYPES come through the front door
// (`Track` from @/lib/music) so the shape stays defined in one place.

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

interface MagicListRow {
  id: number;
  name: string;
  description: string;
  target_seconds: number;
  genres_json: string;
  artists_json: string;
  album_ids_json: string;
  folders_json: string;
  match_any: number;
  streamable_only: number;
  last_generated_at: string | null;
  created_at: string;
  updated_at: string;
}

// Qualified with the table alias because every query below joins mus_tracks to something.
const TRACK_COLUMNS = `
  t.id, t.relative_path, t.file_name, t.title, t.artist, t.album, t.album_artist, t.genre,
  t.release_year, t.track_number, t.disc_number, t.duration_seconds, t.extension,
  t.mime_type, t.file_size, t.file_mtime, t.is_streamable, t.has_cue_sheet, t.album_id,
  t.play_count, t.last_played_at
`;

/**
 * Row to domain type.
 *
 * Duplicated from `src/lib/music/repository.ts` rather than imported: that `toTrack` is a
 * private function inside another module, and exporting it through that module's index.ts
 * to share a 25-line mapping would widen its public surface for no gain. The `Track` TYPE
 * is imported, so a field added there breaks this file at compile time rather than
 * silently going missing.
 */
function toTrack(row: TrackRow): Track {
  const extension = row.extension as MusicExtension;
  return {
    id: row.id,
    relativePath: row.relative_path,
    fileName: row.file_name,
    title: row.title,
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
    mimeType: row.mime_type === "" ? (MUSIC_FORMATS[extension]?.mimeType ?? "") : row.mime_type,
    fileSize: row.file_size,
    fileMtime: row.file_mtime,
    isStreamable: row.is_streamable === 1,
    hasCueSheet: row.has_cue_sheet === 1,
    albumId: row.album_id ?? undefined,
    playCount: row.play_count,
    lastPlayedAt: row.last_played_at ?? undefined,
  };
}

/**
 * Parses a criteria JSON column.
 *
 * FORGIVING BY DESIGN, the same rule `resolveMusicSettings` follows: a stored criteria
 * array can outlive the tags it names, and hand-editing the row is a thing that happens.
 * Anything unparseable reads as "no restriction on that field" rather than throwing,
 * because a saved list that cannot be opened is far worse than one that matches too much
 * -- the criteria are re-pickable in four clicks, but a screen that throws is a dead end.
 */
function parseStringArray(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

function parseNumberArray(json: string): number[] {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is number => typeof entry === "number" && Number.isInteger(entry),
    );
  } catch {
    return [];
  }
}

function toMagicList(row: MagicListRow): MagicList {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    criteria: {
      genres: parseStringArray(row.genres_json),
      artists: parseStringArray(row.artists_json),
      albumIds: parseNumberArray(row.album_ids_json),
      folders: parseStringArray(row.folders_json),
      targetSeconds: row.target_seconds,
      matchAny: row.match_any === 1,
      streamableOnly: row.streamable_only === 1,
    },
    lastGeneratedAt: row.last_generated_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** A `?` list for an IN clause, e.g. `(?, ?, ?)`. */
function placeholders(count: number): string {
  return `(${Array.from({ length: count }, () => "?").join(", ")})`;
}

/**
 * The candidate WHERE clause, and its bound parameters.
 *
 * This function IS the AND/OR semantics from migrations/0057, in one place:
 *
 *   matchAny = false (default):  (genre IN ...) AND (artist IN ...) AND (album_id IN ...)
 *   matchAny = true:             (genre IN ...) OR  (artist IN ...) OR  (album_id IN ...)
 *
 * Two rules that are easy to get wrong and are the reason this is not inlined:
 *
 *  - An EMPTY field contributes NO clause, so it never restricts anything. In the OR case
 *    that matters twice over: an empty field must not contribute a false-y term that
 *    makes the whole disjunction depend on the others, and if EVERY field is empty the
 *    result must be "everything", not "nothing".
 *  - `duration_seconds IS NOT NULL` is unconditional and non-negotiable. A track with no
 *    duration cannot be counted toward a target, so it is never a candidate -- and this
 *    predicate is what lets idx_mus_tracks_magic_candidates serve the query.
 *
 * COLLATE NOCASE on genre and artist matches how the browse views derived those groups
 * (mus_tracks' genre and artist indexes are both NOCASE), so a criterion picked from a
 * genre list is guaranteed to match the tracks that list counted.
 */
function buildCandidateFilter(criteria: MagicCriteria): {
  where: string;
  parameters: unknown[];
} {
  const clauses: string[] = ["t.duration_seconds IS NOT NULL"];
  const parameters: unknown[] = [];

  if (criteria.streamableOnly) clauses.push("t.is_streamable = 1");

  const selectors: string[] = [];
  if (criteria.genres.length > 0) {
    selectors.push(`t.genre COLLATE NOCASE IN ${placeholders(criteria.genres.length)}`);
    parameters.push(...criteria.genres);
  }
  if (criteria.artists.length > 0) {
    selectors.push(`t.artist COLLATE NOCASE IN ${placeholders(criteria.artists.length)}`);
    parameters.push(...criteria.artists);
  }
  if (criteria.albumIds.length > 0) {
    selectors.push(`t.album_id IN ${placeholders(criteria.albumIds.length)}`);
    parameters.push(...criteria.albumIds);
  }
  // Folders are the one field that cannot be an IN list: a folder criterion matches a
  // PREFIX, not a value, so each picked folder contributes its own LIKE and they are
  // OR-ed together -- which is the same "OR within a field" rule the other three follow,
  // just spelled out because SQL has no IN for prefixes. The group is parenthesised so it
  // survives being AND-ed with the other selectors below.
  if (criteria.folders.length > 0) {
    const likes = criteria.folders.map(() => `t.relative_path LIKE ? COLLATE NOCASE`);
    selectors.push(`(${likes.join(" OR ")})`);
    parameters.push(...criteria.folders.map((folder) => folderLikePattern(folder)));
  }

  if (selectors.length > 0) {
    // Parenthesised as a group so an OR-joined selection cannot escape the mandatory
    // duration and streamable clauses above -- `a AND b OR c` would otherwise let c
    // through on its own.
    const joined = selectors.join(criteria.matchAny ? " OR " : " AND ");
    clauses.push(`(${joined})`);
  }

  return { where: `WHERE ${clauses.join(" AND ")}`, parameters };
}

/**
 * Eligible tracks for a criteria set, read straight from the catalog.
 *
 * Separate from SqliteMagicListRepository because they answer to different ports: this one
 * only reads `mus_tracks` / `mus_albums`, and keeping it apart is what lets a test fake the
 * candidate set without faking saved-list storage too.
 */
export class SqliteMagicCandidateSource implements MagicCandidateSource {
  constructor(private readonly db: Database.Database) {}

  listCandidates(criteria: MagicCriteria): Track[] {
    const { where, parameters } = buildCandidateFilter(criteria);
    // No LIMIT and no ORDER BY RANDOM(): the shuffle must see every candidate, and the
    // number of rows needed is not knowable in SQL because it depends on the durations.
    // Ordered by id so the set handed to the shuffle is deterministic -- the randomness
    // belongs to the injected rng, which is what makes generation reproducible in a test.
    const rows = this.db
      .prepare(`SELECT ${TRACK_COLUMNS} FROM mus_tracks t ${where} ORDER BY t.id`)
      .all(...parameters) as TrackRow[];
    return rows.map(toTrack);
  }

  countCandidates(criteria: MagicCriteria): number {
    const { where, parameters } = buildCandidateFilter(criteria);
    const row = this.db
      .prepare(`SELECT COUNT(*) AS total FROM mus_tracks t ${where}`)
      .get(...parameters) as { total: number };
    return row.total;
  }

  /**
   * Genres, with the count of tracks each could actually contribute.
   *
   * Counting only duration-tagged, streamable tracks -- not every track with that genre --
   * so the number beside a picker option is the number the generator can really draw on.
   * A genre showing "40 tracks" that yields 3 candidates would make a thin playlist look
   * like a bug.
   */
  listGenreOptions(): MagicPickerOption[] {
    const rows = this.db
      .prepare(
        `SELECT genre AS value, COUNT(*) AS track_count
         FROM mus_tracks
         WHERE duration_seconds IS NOT NULL AND is_streamable = 1
         GROUP BY genre COLLATE NOCASE
         ORDER BY genre = '', track_count DESC, genre COLLATE NOCASE`,
      )
      .all() as { value: string; track_count: number }[];

    return rows.map((row) => ({
      value: row.value,
      label: row.value === "" ? "No genre" : row.value,
      trackCount: row.track_count,
    }));
  }

  listArtistOptions(): MagicPickerOption[] {
    const rows = this.db
      .prepare(
        `SELECT artist AS value, COUNT(*) AS track_count
         FROM mus_tracks
         WHERE duration_seconds IS NOT NULL AND is_streamable = 1
         GROUP BY artist COLLATE NOCASE
         ORDER BY artist = '', artist COLLATE NOCASE`,
      )
      .all() as { value: string; track_count: number }[];

    return rows.map((row) => ({
      value: row.value,
      label: row.value === "" ? "Unknown artist" : row.value,
      trackCount: row.track_count,
    }));
  }

  /**
   * Albums, keyed by id.
   *
   * Grouped from `mus_tracks` rather than read from `mus_albums`, for the same reason as
   * above: `mus_albums.track_count` counts every track including the unplayable and
   * untagged ones, which is not what the generator can use. Tracks with no album_id are
   * excluded -- there is no id to store as a criterion.
   *
   * Note the absence of cover_image in the column list: mus_albums holds a BLOB, and
   * coding-guide.md forbids SELECT * there.
   */
  listAlbumOptions(): MagicAlbumOption[] {
    const rows = this.db
      .prepare(
        `SELECT a.id AS album_id, a.name AS label, a.album_artist, COUNT(t.id) AS track_count
         FROM mus_albums a
         JOIN mus_tracks t ON t.album_id = a.id
         WHERE t.duration_seconds IS NOT NULL AND t.is_streamable = 1
         GROUP BY a.id
         ORDER BY a.album_artist COLLATE NOCASE, a.name COLLATE NOCASE`,
      )
      .all() as { album_id: number; label: string; album_artist: string; track_count: number }[];

    return rows.map((row) => ({
      albumId: row.album_id,
      label: row.label.trim() === "" ? "Untitled album" : row.label,
      albumArtist: row.album_artist,
      trackCount: row.track_count,
    }));
  }

  /**
   * One level of the folder tree, derived from the CATALOG rather than the filesystem.
   *
   * The same choice `MusicRepository.listFolderChildren` makes, for the same two reasons:
   * the tree then shows only folders that hold something a listener can actually play, and
   * it needs no NAS round-trip -- which matters when the NAS is asleep.
   *
   * Restricted to duration-tagged, streamable tracks, unlike the Library's version. That
   * is the rule every option list in this class follows: a folder offered as a criterion
   * must be one the generator can really draw from, and a folder showing 40 tracks that
   * yields 3 candidates would make a thin playlist look like a bug. The consequence is
   * that a folder holding nothing but unplayable files does not appear here at all, which
   * is correct -- ticking it could only ever select nothing.
   *
   * Grouped in JS rather than SQL, again mirroring `listFolderChildren`: picking out "the
   * path segment at depth N" needs nested instr/substr arithmetic that is unreadable, and
   * this reads one subtree's paths rather than the whole library.
   */
  listFolderOptions(parentPath: string): MagicFolderOption[] {
    const prefix = parentPath === "" ? "" : `${parentPath.replace(/\/+$/, "")}/`;
    const depth = prefix === "" ? 0 : prefix.split("/").length - 1;

    const rows = this.db
      .prepare(
        `SELECT relative_path FROM mus_tracks
         WHERE duration_seconds IS NOT NULL AND is_streamable = 1
           AND (@prefix = '' OR relative_path LIKE @like COLLATE NOCASE)`,
      )
      .all({ prefix, like: `${prefix}%` }) as { relative_path: string }[];

    const children = new Map<string, { direct: number; total: number; hasChildren: boolean }>();

    for (const row of rows) {
      const segments = row.relative_path.split("/");
      // A file sitting directly in the parent has exactly depth+1 segments (the filename),
      // so it names no child folder and is skipped.
      if (segments.length <= depth + 1) continue;

      const name = segments[depth];
      if (name === undefined || name === "") continue;
      const entry = children.get(name) ?? { direct: 0, total: 0, hasChildren: false };
      entry.total += 1;
      // depth+2 segments means the file is directly inside this child; more means the
      // child has folders of its own, which is what makes the row drillable.
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
}

/** Saved Magic Playlists and the sets they generated. */
export class SqliteMagicListRepository implements MagicListRepository {
  constructor(private readonly db: Database.Database) {}

  createMagicList(list: { name: string; description: string; criteria: MagicCriteria }): number {
    const row = this.db
      .prepare(
        `INSERT INTO mus_magic_list
           (name, description, target_seconds, genres_json, artists_json, album_ids_json,
            folders_json, match_any, streamable_only)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING id`,
      )
      .get(
        list.name,
        list.description,
        list.criteria.targetSeconds,
        JSON.stringify(list.criteria.genres),
        JSON.stringify(list.criteria.artists),
        JSON.stringify(list.criteria.albumIds),
        JSON.stringify(list.criteria.folders),
        list.criteria.matchAny ? 1 : 0,
        list.criteria.streamableOnly ? 1 : 0,
      ) as { id: number };
    return row.id;
  }

  updateMagicList(
    id: number,
    list: { name: string; description: string; criteria: MagicCriteria },
  ): void {
    this.db
      .prepare(
        `UPDATE mus_magic_list
         SET name = ?, description = ?, target_seconds = ?, genres_json = ?,
             artists_json = ?, album_ids_json = ?, folders_json = ?, match_any = ?,
             streamable_only = ?
         WHERE id = ?`,
      )
      .run(
        list.name,
        list.description,
        list.criteria.targetSeconds,
        JSON.stringify(list.criteria.genres),
        JSON.stringify(list.criteria.artists),
        JSON.stringify(list.criteria.albumIds),
        JSON.stringify(list.criteria.folders),
        list.criteria.matchAny ? 1 : 0,
        list.criteria.streamableOnly ? 1 : 0,
        id,
      );
  }

  deleteMagicList(id: number): void {
    // Both statements in one transaction so a list can never lose its criteria while
    // keeping orphaned track rows. No music file is touched.
    const remove = this.db.transaction((magicListId: number) => {
      this.db.prepare(`DELETE FROM mus_magic_list_tracks WHERE magic_list_id = ?`).run(magicListId);
      this.db.prepare(`DELETE FROM mus_magic_list WHERE id = ?`).run(magicListId);
    });
    remove(id);
  }

  getMagicList(id: number): MagicList | undefined {
    const row = this.db.prepare(`SELECT * FROM mus_magic_list WHERE id = ?`).get(id) as
      | MagicListRow
      | undefined;
    return row === undefined ? undefined : toMagicList(row);
  }

  listMagicLists(): MagicListSummary[] {
    // The track count is an INNER JOIN through mus_tracks on purpose: it must report what
    // the list can actually play, and a stored entry whose file has gone from disk cannot.
    // The same rule listGeneratedTracks applies, so the number and the list agree.
    const rows = this.db
      .prepare(
        `SELECT m.id, m.name, m.description, m.target_seconds, m.last_generated_at, m.updated_at,
                (SELECT COUNT(*)
                   FROM mus_magic_list_tracks mt
                   JOIN mus_tracks t ON t.id = mt.track_id
                  WHERE mt.magic_list_id = m.id) AS track_count
         FROM mus_magic_list m
         ORDER BY m.updated_at DESC, m.id DESC`,
      )
      .all() as {
      id: number;
      name: string;
      description: string;
      target_seconds: number;
      last_generated_at: string | null;
      updated_at: string;
      track_count: number;
    }[];

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      targetSeconds: row.target_seconds,
      trackCount: row.track_count,
      lastGeneratedAt: row.last_generated_at ?? undefined,
      updatedAt: row.updated_at,
    }));
  }

  saveGeneratedTracks(id: number, trackIds: readonly number[]): void {
    // Wholesale replacement in one transaction -- see migrations/0057 for why a regenerate
    // is a delete-insert rather than a diff. The timestamp is stamped in the same
    // transaction so a list can never show tracks from one draw and a time from another.
    const replace = this.db.transaction((magicListId: number, ids: readonly number[]) => {
      this.db.prepare(`DELETE FROM mus_magic_list_tracks WHERE magic_list_id = ?`).run(magicListId);

      const insert = this.db.prepare(
        `INSERT INTO mus_magic_list_tracks (magic_list_id, track_id, position) VALUES (?, ?, ?)`,
      );
      ids.forEach((trackId, index) => insert.run(magicListId, trackId, index));

      this.db
        .prepare(`UPDATE mus_magic_list SET last_generated_at = datetime('now') WHERE id = ?`)
        .run(magicListId);
    });
    replace(id, trackIds);
  }

  listGeneratedTracks(id: number): Track[] {
    // An INNER JOIN, which is what silently drops entries whose track has been pruned from
    // the catalog -- a saved list shrinks rather than erroring (migrations/0057).
    const rows = this.db
      .prepare(
        `SELECT ${TRACK_COLUMNS}
         FROM mus_magic_list_tracks mt
         JOIN mus_tracks t ON t.id = mt.track_id
         WHERE mt.magic_list_id = ?
         ORDER BY mt.position, mt.id`,
      )
      .all(id) as TrackRow[];
    return rows.map(toTrack);
  }
}
