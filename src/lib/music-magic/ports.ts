import type { Track } from "@/lib/music";
import type { MagicCriteria, MagicList, MagicListSummary } from "./types";

/**
 * Where the generator gets its eligible tracks.
 *
 * Its own port rather than a method on `MusicRepository`, for two reasons. The candidate
 * query belongs to THIS module's domain -- it encodes the AND/OR semantics and the
 * duration rule from migrations/0057, neither of which the catalog cares about -- and a
 * fake implementation of one method is what lets the selection algorithm be tested
 * against a hand-written list of tracks with no database at all.
 */
export interface MagicCandidateSource {
  /**
   * Every track matching the criteria that could go in a timed playlist.
   *
   * Contract, relied on by `selectTracksForTarget` and NOT re-checked there:
   *
   *  - Only tracks with a known `durationSeconds`. A NULL duration cannot be counted
   *    toward a target, so such a track is not a candidate at all (migrations/0057).
   *  - `streamableOnly` is honoured when set.
   *  - An EMPTY criteria list means "no restriction on that field", never "match
   *    nothing".
   *
   * Returns the whole matching set, unshuffled and unlimited. That is deliberate: the
   * shuffle must see every candidate or the "random" playlist would be random only
   * within whatever arbitrary window SQL handed back, and `ORDER BY RANDOM() LIMIT n`
   * cannot be used because the row count needed depends on the durations, which are not
   * known until the rows are read. The set is bounded in practice by the catalog (~20k
   * rows of metadata), and `countCandidates` exists for the cases that only need the
   * number.
   */
  listCandidates(criteria: MagicCriteria): Track[];

  /** How many tracks the criteria match, without materialising them. For the live preview. */
  countCandidates(criteria: MagicCriteria): number;

  /** Distinct genres with track counts, for the genre picker. */
  listGenreOptions(): MagicPickerOption[];

  /** Distinct artists with track counts, for the artist picker. */
  listArtistOptions(): MagicPickerOption[];

  /** Albums with track counts, for the album picker. Keyed by id, not name. */
  listAlbumOptions(): MagicAlbumOption[];

  /**
   * The folders directly inside `parentPath`, for one level of the folder picker.
   *
   * ONE LEVEL AT A TIME, unlike the other three option lists, which return everything.
   * The difference is not an inconsistency: genres and artists are a flat few thousand
   * rows that the picker filters in the browser, whereas the folder tree is walked, and
   * shipping every folder in the library so the client can rebuild a hierarchy from path
   * strings would send far more than the handful any one screen shows. It also mirrors
   * `MusicRepository.listFolderChildren`, which the Library's Folder Hierarchy view
   * already drives the same way.
   *
   * `parentPath` is '' for the top level. Counts follow the same rule as every other
   * option list here -- only duration-tagged, streamable tracks -- so the number beside a
   * folder is what the generator could really draw from it, and `totalTrackCount` counts
   * the whole subtree because that is what ticking the folder would select.
   */
  listFolderOptions(parentPath: string): MagicFolderOption[];
}

/**
 * One choice in a criteria picker.
 *
 * `value` is what gets stored and matched -- '' for the untagged group, which is a real
 * choice here. `label` is never blank, so a picker row always has something to click.
 */
export interface MagicPickerOption {
  value: string;
  label: string;
  trackCount: number;
}

/** An album choice. Separate shape because its value is a number, not a name. */
export interface MagicAlbumOption {
  albumId: number;
  label: string;
  albumArtist: string;
  trackCount: number;
}

/**
 * A folder choice: one node of the tree the picker walks.
 *
 * `relativePath` is what gets stored as the criterion; `name` is its last segment, which
 * is all the picker has room to show. Two counts, and the picker needs both:
 *
 *  - `trackCount` -- tracks sitting DIRECTLY in this folder.
 *  - `totalTrackCount` -- tracks anywhere in its subtree, which is what ticking it
 *    actually selects (migrations/0060). For a folder holding only sub-folders the first
 *    is 0 and the second is the interesting number, so showing only `trackCount` would
 *    label most of the tree "0" and make it look unpickable.
 *
 * `hasChildren` is what tells the picker whether the row can be drilled into, rather than
 * having it discover an empty level after a round-trip.
 */
export interface MagicFolderOption {
  relativePath: string;
  name: string;
  trackCount: number;
  totalTrackCount: number;
  hasChildren: boolean;
}

/** Saved Magic Playlists: their criteria, and the set each last generated. */
export interface MagicListRepository {
  /**
   * Saves a new list. Rejects a duplicate name via the unique index rather than
   * silently making a twin -- the use-case turns that into a readable message.
   */
  createMagicList(list: {
    name: string;
    description: string;
    criteria: MagicCriteria;
  }): number;

  /** Replaces a saved list's name, description and criteria. Does not touch its tracks. */
  updateMagicList(
    id: number,
    list: { name: string; description: string; criteria: MagicCriteria },
  ): void;

  /** Deletes the list and its stored tracks. No track row and no music file is touched. */
  deleteMagicList(id: number): void;

  getMagicList(id: number): MagicList | undefined;

  listMagicLists(): MagicListSummary[];

  /**
   * Stores a generated set as this list's tracks, replacing whatever was there, and
   * stamps `last_generated_at`.
   *
   * Wholesale replacement in one transaction -- a regenerate is a fresh draw with no
   * relationship to its predecessor, so there is no diff worth computing
   * (migrations/0057).
   */
  saveGeneratedTracks(id: number, trackIds: readonly number[]): void;

  /**
   * The tracks stored for a list, in order.
   *
   * Silently DROPS entries whose track no longer exists: a scan prunes files that have
   * vanished from disk and this table is not cascaded, so a saved list shrinks rather
   * than erroring. The criteria are the durable thing.
   */
  listGeneratedTracks(id: number): Track[];
}
