// The one place that decides what an audio file *is*: its mime type, and whether
// a browser can actually play it.
//
// Every other file defers to this. `mus_tracks.is_streamable` is denormalized from
// `isStreamable` at scan time so a browse query can grey out the play button
// without re-deriving these rules per row.

/** An audio extension the scanner recognises, lowercase and without the dot. */
export const MUSIC_EXTENSIONS = [
  "mp3",
  "flac",
  "ogg",
  "m4a",
  "wav",
  "aac",
  "opus",
  "ape",
  "wma",
] as const;

export type MusicExtension = (typeof MUSIC_EXTENSIONS)[number];

export interface MusicFormat {
  extension: MusicExtension;
  /** What the streaming route sets as Content-Type. */
  mimeType: string;
  /**
   * Whether a browser can play these bytes as-is.
   *
   * False is not a judgement about quality — it means there is no HTML5 decoder,
   * so an <audio> element will refuse the file however it is served. Playing one
   * would require transcoding on the server, which this module deliberately does
   * not do (see migrations/0052_create_music_library.md).
   */
  isStreamable: boolean;
  isLossless: boolean;
  /** Shown in the configuration screen next to the toggle. */
  label: string;
}

/**
 * The format table.
 *
 * `ape` (Monkey's Audio) and `wma` are catalogued but never playable: no browser
 * implements either, and none is going to. Everything else here has broad support —
 * FLAC is the only one with a caveat, being unplayable in Safari before 11.
 */
export const MUSIC_FORMATS: Record<MusicExtension, MusicFormat> = {
  mp3: { extension: "mp3", mimeType: "audio/mpeg", isStreamable: true, isLossless: false, label: "MP3" },
  flac: { extension: "flac", mimeType: "audio/flac", isStreamable: true, isLossless: true, label: "FLAC" },
  ogg: { extension: "ogg", mimeType: "audio/ogg", isStreamable: true, isLossless: false, label: "Ogg Vorbis" },
  m4a: { extension: "m4a", mimeType: "audio/mp4", isStreamable: true, isLossless: false, label: "M4A / AAC" },
  wav: { extension: "wav", mimeType: "audio/wav", isStreamable: true, isLossless: true, label: "WAV" },
  aac: { extension: "aac", mimeType: "audio/aac", isStreamable: true, isLossless: false, label: "AAC" },
  opus: { extension: "opus", mimeType: "audio/opus", isStreamable: true, isLossless: false, label: "Opus" },
  ape: { extension: "ape", mimeType: "audio/x-ape", isStreamable: false, isLossless: true, label: "APE (Monkey's Audio)" },
  wma: { extension: "wma", mimeType: "audio/x-ms-wma", isStreamable: false, isLossless: false, label: "WMA" },
};

/**
 * The extension of a path, lowercased and without the dot — `''` when there isn't one.
 *
 * Hand-rolled rather than using `node:path`: this file is pure so it can be unit
 * tested without a filesystem, and nothing under src/lib may assume a platform.
 * A leading dot is not an extension (`.hidden` has none), and only the last dot
 * counts (`song.remastered.flac` is flac).
 */
export function extensionOf(filePath: string): string {
  const fileName = filePath.split(/[\/]/).pop() ?? "";
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot <= 0) return "";
  return fileName.slice(lastDot + 1).toLowerCase();
}

/** Whether the scanner recognises this extension as audio at all. */
export function isMusicExtension(extension: string): extension is MusicExtension {
  return Object.hasOwn(MUSIC_FORMATS, extension.toLowerCase());
}

/** The format for a path, or `undefined` when it isn't a recognised audio file. */
export function formatOf(filePath: string): MusicFormat | undefined {
  const extension = extensionOf(filePath);
  return isMusicExtension(extension) ? MUSIC_FORMATS[extension] : undefined;
}

/**
 * The extensions a fresh install scans: the two that make up 95% of this library
 * and are both universally playable. Anything else is opt-in from Configuration,
 * so the unplayable formats are not even recorded unless asked for.
 */
export const DEFAULT_SCAN_EXTENSIONS: MusicExtension[] = ["mp3", "flac"];

/** Every extension a browser can play, for the "select all playable" shortcut. */
export const STREAMABLE_EXTENSIONS: MusicExtension[] = MUSIC_EXTENSIONS.filter(
  (extension) => MUSIC_FORMATS[extension].isStreamable,
);
