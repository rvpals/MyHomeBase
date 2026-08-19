import type { MusicExtension } from "./formats";

// Domain types for the Music Library. No zod, no SQL — schema.ts validates
// boundary input, repository.ts talks to SQLite.

/** What the filesystem knows about a file, without opening it. */
export interface TrackFileFacts {
  /** Relative to MYHOMEBASE_MUSIC_ROOT, forward slashes, no leading slash. */
  relativePath: string;
  fileSize: number;
  /** ISO 8601. */
  fileMtime: string;
}

export interface Track {
  id: number;
  relativePath: string;
  fileName: string;
  /** '' when the file carries no title tag — read `displayTitle` instead. */
  title: string;
  /** Falls back to the filename, so a list never shows a blank row. */
  displayTitle: string;
  artist: string;
  album: string;
  albumArtist: string;
  genre: string;
  releaseYear?: number;
  trackNumber?: number;
  discNumber?: number;
  durationSeconds?: number;
  extension: MusicExtension;
  mimeType: string;
  fileSize: number;
  fileMtime: string;
  /** False for formats no browser can decode (ape, wma) — the UI greys out play. */
  isStreamable: boolean;
  hasCueSheet: boolean;
  albumId?: number;
  /** How many times playback has been STARTED for this track (see migrations/0056). */
  playCount: number;
  lastPlayedAt?: string;
}

/** What the scanner writes for one file. */
export interface TrackUpsert {
  relativePath: string;
  fileName: string;
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  genre: string;
  releaseYear?: number;
  trackNumber?: number;
  discNumber?: number;
  durationSeconds?: number;
  extension: MusicExtension;
  mimeType: string;
  fileSize: number;
  fileMtime: string;
  isStreamable: boolean;
  hasCueSheet: boolean;
  albumId?: number;
}

export interface Album {
  id: number;
  name: string;
  albumArtist: string;
  genre: string;
  releaseYear?: number;
  trackCount: number;
  /** Presence, never the bytes — see coding-guide.md on per-row images. */
  hasCoverImage: boolean;
}

export interface AlbumCover {
  data: Buffer;
  mimeType: string;
}

/** One immediate sub-folder in the scan screen's picker. */
export interface FolderNode {
  name: string;
  /** Relative to the music root. */
  relativePath: string;
  /** Whether it contains sub-folders, so the picker knows it can expand. */
  hasChildren: boolean;
}

export type ScanStatus = "running" | "completed" | "failed" | "cancelled";

/** The counters a scan updates as it works. */
export interface ScanRunProgress {
  filesSeen: number;
  tracksAdded: number;
  tracksUpdated: number;
  filesSkipped: number;
  filesFailed: number;
  /** The file being read right now, relative to the root. */
  currentPath: string;
  lastError?: string;
}

export interface ScanRun {
  id: number;
  /** '' means the whole library. */
  rootFolder: string;
  extensions: MusicExtension[];
  status: ScanStatus;
  /** 0 while phase one is still counting — the bar shows indeterminate. */
  filesTotal: number;
  filesSeen: number;
  tracksAdded: number;
  tracksUpdated: number;
  filesSkipped: number;
  filesFailed: number;
  lastError: string;
  currentPath: string;
  startedAt: string;
  finishedAt?: string;
  updatedAt: string;
}

/**
 * Percent complete, 0–100, or `undefined` while the total is still unknown.
 *
 * Domain logic rather than something the progress bar computes, so the web view and
 * the CLI report the same number and neither divides by zero. Clamped because a
 * folder can gain files between the counting phase and the reading phase, which
 * would otherwise show 103%.
 */
export function scanProgressPercent(run: ScanRun): number | undefined {
  if (run.filesTotal <= 0) return undefined;
  const percent = Math.round((run.filesSeen / run.filesTotal) * 100);
  return Math.min(100, Math.max(0, percent));
}

/** Whether a scan row is genuinely still running, as opposed to abandoned. */
export function isScanRunStale(run: ScanRun, now: Date, staleAfterSeconds = 120): boolean {
  if (run.status !== "running") return false;
  const updated = Date.parse(`${run.updatedAt.replace(" ", "T")}Z`);
  if (Number.isNaN(updated)) return false;
  return now.getTime() - updated > staleAfterSeconds * 1000;
}

export interface TrackSearchQuery {
  search?: string;
  albumId?: number;
  /** Exact artist match, for the Artists view. '' selects the untagged group. */
  artist?: string;
  /** Exact genre match. '' selects tracks with no genre. */
  genre?: string;
  /** Exact year. `null` selects tracks whose year is unknown. */
  releaseYear?: number | null;
  /** Restrict to a folder subtree, matching how the scan screen groups things. */
  folder?: string;
  streamableOnly?: boolean;
  limit: number;
  offset: number;
}
