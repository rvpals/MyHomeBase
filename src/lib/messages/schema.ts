import { z } from "zod";

/**
 * The boundary for the message queue. Both adapters — the web actions and the
 * CLI — parse their raw input through these, so neither can file a message the
 * other couldn't.
 */

/** A title has to say something; an empty queue row would be unreadable. */
export const MESSAGE_TITLE_MAX = 200;

/**
 * Every slug that may own a message, plus `system` for the app's own producers.
 *
 * A FIXED LIST, not a lookup against `sys_modules`. Migration 0142 records why:
 * a message outlives the thing that wrote it, so the column is not a foreign
 * key, and validating against the live table would both add a second repository
 * to `createMessage` and orphan history when a module is deleted.
 *
 * The cost is explicit: **a newly created module cannot file a message until its
 * slug is added here.** That is one line, and `modules.md` step 7 names it.
 *
 * Mirrors `DEFAULT_MODULES` in `lib/modules/defaults.ts` — keep both in sync.
 */
export const MESSAGE_MODULES = [
  "investments",
  "journal",
  "csv-analysis",
  "expense",
  "classroom",
  "music-library",
  "games",
  "picture-gallery",
  "tools",
  "household",
  // Not a module. The app itself: scheduled jobs, the CLI, anything owned by
  // Admin rather than by a module. Spelled out rather than left blank so the
  // grid can filter on it like any other value.
  "system",
] as const;

export const messageModuleSchema = z.enum(MESSAGE_MODULES);

/** The slug of the module that owns a message's producer. */
export type MessageModule = (typeof MESSAGE_MODULES)[number];

/** What a pre-0142 row carries, and what it is read as. See migration 0142. */
export const LEGACY_MESSAGE_MODULE = "system" satisfies MessageModule;

export const systemMessageSchema = z.object({
  id: z.number().int().positive(),
  createdAt: z.string().min(1),
  // Absent rather than null: the domain type says `readAt?: string`, and the
  // repository maps SQLite's NULL to undefined so nothing downstream has to
  // handle both spellings of "not read".
  readAt: z.string().min(1).optional(),
  title: z.string().min(1),
  body: z.string(),
  source: z.string(),
  module: messageModuleSchema,
  isLocked: z.boolean(),
});

/**
 * What a writer supplies. `createdAt` and `readAt` are deliberately absent —
 * the database stamps the first and only the reader sets the second, so
 * accepting either here would let a caller file a message that was already read,
 * or one dated last year.
 */
export const createMessageSchema = z.object({
  title: z.string().trim().min(1, "A message needs a title.").max(MESSAGE_TITLE_MAX),
  // Blank is allowed: a title-only message is a legitimate one-liner, and the
  // column defaults to '' for exactly that. Not trimmed to empty and rejected.
  body: z.string().default(""),
  source: z.string().trim().default(""),
  // Defaulted, not required, so the CLI and any one-off caller need not name a
  // module. `isLocked` is deliberately absent: a message is filed unlocked and
  // locked afterwards by an admin, so accepting it here would let a producer
  // file something nobody can delete.
  module: messageModuleSchema.default("system"),
});

/**
 * What a caller supplies — the **input** shape, so `body` and `source` may be
 * omitted and the schema's defaults fill them in. `z.input`, not `z.infer`:
 * `z.infer` is the *output* type, where both are required, which would force
 * every caller to pass `body: ""` to get the default it already declares.
 * Same convention as `CreateEntryInput` in `lib/journal`.
 */
export type CreateMessageInput = z.input<typeof createMessageSchema>;

/** The validated shape, after defaults. What the repository is handed. */
export type CreateMessage = z.output<typeof createMessageSchema>;

/** Which half of the queue to list. */
export const messageReadStateSchema = z.enum(["unread", "read"]);

export const markMessagesReadSchema = z.object({
  // Non-empty: "mark nothing as read" is a caller bug, not a no-op worth
  // silently accepting. The bulk action never sends an empty selection.
  messageIds: z.array(z.number().int().positive()).min(1, "Pick at least one message."),
});

export type MarkMessagesReadInput = z.infer<typeof markMessagesReadSchema>;

/** How many rows a bulk delete may touch in one call. */
export const MAX_BULK_IDS = 1000;

/**
 * Ids for a bulk delete. Bounded, deduped, and required to be non-empty so an
 * accidental "delete nothing" is an explicit error rather than a silent success.
 *
 * Same shape as `site-visits` and `auth-events` use for their admin grids — this
 * screen is the third of the same kind, and they should fail identically.
 */
export const deleteMessagesSchema = z
  .array(z.number().int().positive())
  .min(1, "Select at least one message.")
  .max(MAX_BULK_IDS)
  .transform((ids) => [...new Set(ids)]);

/**
 * Guards the purge. A floor of 1 day stops a mistyped window wiping the queue
 * outright, and the ceiling matches the two sibling logs' retention schemas.
 *
 * Note this is *not* a scheduled retention window: nothing prunes the queue on a
 * timer. It is the age an admin picks on the screen, one purge at a time.
 */
export const messageRetentionDaysSchema = z.number().int().min(1).max(3650);

/**
 * Ids to lock or unlock, and which way.
 *
 * Bounded and deduped like `deleteMessagesSchema`, and non-empty for the same
 * reason: "lock nothing" is an admin pressing a button with no selection, which
 * has to reach them rather than succeeding silently.
 *
 * `locked` is explicit rather than a toggle. A toggle over a mixed selection —
 * some locked, some not — has no honest meaning: it would invert each row
 * independently and leave the admin with the same mixture they started from.
 * Two buttons, each stating the end state, is what the screen offers.
 */
export const setMessagesLockedSchema = z.object({
  messageIds: z
    .array(z.number().int().positive())
    .min(1, "Select at least one message.")
    .max(MAX_BULK_IDS)
    .transform((ids) => [...new Set(ids)]),
  locked: z.boolean(),
});

export type SetMessagesLockedInput = z.input<typeof setMessagesLockedSchema>;
