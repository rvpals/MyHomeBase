import { z } from "zod";
import { LIBRARY_VIEWS } from "./browse";
import { MUSIC_EXTENSIONS } from "./formats";

// Zod schemas for everything that crosses a boundary into this module -- a server
// action, a route param, a CLI argument. The presentation layers validate with these
// rather than trusting their input, per ARCHITECTURE.md.

/**
 * A relative folder inside the music root.
 *
 * The traversal rules themselves live in paths.ts and are applied again before any
 * file is opened; this is the boundary check that keeps an obviously bad value from
 * getting as far as the use-case. Belt and braces on purpose -- the cost of a
 * duplicated check is nothing next to the cost of reading an arbitrary file.
 */
export const musicFolderSchema = z
  .string()
  .max(1024)
  .refine((value) => !value.includes(".."), { message: "A folder path may not contain '..'." })
  .refine((value) => !value.includes("\u0000"), { message: "A folder path may not contain NUL." })
  .refine((value) => !/^([a-zA-Z]:|[/\\])/.test(value), {
    message: "A folder must be relative to the music root, not an absolute path.",
  });

export const musicExtensionSchema = z.enum(MUSIC_EXTENSIONS);

/** Starting a scan: which folder, and which formats to accept. */
export const startScanSchema = z.object({
  /** '' means the whole library. */
  folder: musicFolderSchema.default(""),
  /**
   * Non-empty on purpose: an empty allowlist would make the scan a silent no-op,
   * which is indistinguishable from a broken scanner.
   */
  extensions: z.array(musicExtensionSchema).min(1, "Choose at least one file format."),
});
export type StartScanInput = z.infer<typeof startScanSchema>;

/** Saving the module's configuration. */
export const musicSettingsSchema = z.object({
  scanExtensions: z.array(musicExtensionSchema).min(1, "Choose at least one file format."),
  skipUnstreamable: z.boolean(),
});
export type MusicSettingsInput = z.infer<typeof musicSettingsSchema>;

/** Browsing the library. Limit is capped: 20k rows must never be sent to a browser. */
export const trackSearchSchema = z.object({
  search: z.string().trim().max(200).optional(),
  albumId: z.coerce.number().int().positive().optional(),
  folder: musicFolderSchema.optional(),
  streamableOnly: z.boolean().default(false),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type TrackSearchInput = z.infer<typeof trackSearchSchema>;

/** A track id arriving from a route param or a form field. */
export const trackIdSchema = z.coerce.number().int().positive();

/** Asking for lyrics. `force` re-fetches something already cached. */
export const fetchLyricsSchema = z.object({
  trackId: trackIdSchema,
  force: z.boolean().default(false),
});
export type FetchLyricsInput = z.infer<typeof fetchLyricsSchema>;

/** Which of the eight Library views a request is for. */
export const libraryViewSchema = z.enum(LIBRARY_VIEWS);

/** Paging shared by the grouping views. Limits are capped: 20k rows never reach a browser. */
export const browsePageSchema = z.object({
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type BrowsePageInput = z.infer<typeof browsePageSchema>;

/** Creating or renaming a playlist. */
export const playlistWriteSchema = z.object({
  name: z.string().trim().min(1, "A playlist needs a name.").max(120),
  description: z.string().trim().max(500).default(""),
});
export type PlaylistWriteInput = z.infer<typeof playlistWriteSchema>;

export const playlistIdSchema = z.coerce.number().int().positive();

/** Adding tracks to a playlist. */
export const addToPlaylistSchema = z.object({
  playlistId: playlistIdSchema,
  trackIds: z.array(trackIdSchema).min(1, "Choose at least one track."),
});
export type AddToPlaylistInput = z.infer<typeof addToPlaylistSchema>;

/** Reordering. The full ordered list of entry ids, not a from/to pair -- positions are
 *  rewritten wholesale, which is simpler than reasoning about a single move. */
export const reorderPlaylistSchema = z.object({
  playlistId: playlistIdSchema,
  orderedPlaylistTrackIds: z.array(z.coerce.number().int().positive()),
});
export type ReorderPlaylistInput = z.infer<typeof reorderPlaylistSchema>;
