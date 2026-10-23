// Back up and restore the My Journal module's *metadata* — the things a reader
// assembles by hand and would hate to rebuild: the managed category and tag
// lists with their icons, the prefill templates, the saved entry filters, and
// the module preferences.
//
// Entries are deliberately NOT in here. They already have a CSV import/export
// path (./csv-import.ts) that understands duplicates and overwriting, and
// folding them in would mean one file with two very different merge rules.
// This is the configuration around the entries, not the entries.
//
// Pure over the repository: every function takes data (or a repo) and returns
// data. Icon bytes cross the boundary as base64 because the bundle is one JSON
// file the reader can email themselves — see `JournalMetadataIcon`.

import { z } from "zod";
import { decodeImageUpload, IMAGE_UPLOAD_MIME_TYPES } from "@/lib/shared/image-upload";
import type { JournalRepository } from "./ports";
import {
  journalFilterSchema,
  journalPrefillFieldValueSchema,
  MAX_JOURNAL_ICON_BYTES,
} from "./schema";
import type { JournalPreferences } from "./types";

/**
 * What a bundle claims to be. Checked on import so that dropping the wrong JSON
 * file on the restore dropzone fails with "that isn't a journal metadata backup"
 * rather than with a wall of zod field errors.
 */
export const JOURNAL_METADATA_FORMAT = "myhomebase.journal.metadata";

/**
 * Bumped only when the shape changes in a way an older reader can't understand.
 * The importer accepts any version it knows; adding an *optional* field does not
 * need a bump, because an old file simply omits it.
 */
export const JOURNAL_METADATA_FORMAT_VERSION = 1;

// --- The file's shape --------------------------------------------------------

/**
 * One icon, inline.
 *
 * Base64 rather than a side-car file: the whole point of this feature is a
 * single file that round-trips, and a zip would need a library on both ends plus
 * a rule for what to do when the manifest and the folder disagree. The ~33% size
 * cost is real but small in absolute terms — these are 128 KB-capped icons.
 */
const metadataIconSchema = z.object({
  mimeType: z.enum(IMAGE_UPLOAD_MIME_TYPES),
  base64: z.string().min(1),
});

export type JournalMetadataIcon = z.infer<typeof metadataIconSchema>;

/**
 * A category or a tag. The two managed lists are the same shape, so they share
 * one schema — as they already do in `schema.ts`, where `upsertTagSchema` is
 * literally `upsertCategorySchema`.
 *
 * `icon` is `null` for "this one has no icon", which is distinct from a missing
 * key only in intent; both restore as "no icon". Ids and timestamps are absent
 * on purpose: they're install-local, and everything here is keyed by name, which
 * is what the tables already treat as unique.
 */
const metadataTaxonomySchema = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  icon: metadataIconSchema.nullish(),
});

export type JournalMetadataTaxonomy = z.infer<typeof metadataTaxonomySchema>;

const metadataTemplateSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  isEnabled: z.boolean().default(true),
  fields: z.array(journalPrefillFieldValueSchema).default([]),
});

const metadataFilterSchema = z.object({
  name: z.string().min(1),
  // Both default to '' so a bundle exported before migration 0152 still restores
  // — it simply has no category or description to carry, which is the same state
  // a filter saved back then was in. The format version is deliberately not
  // bumped for this: an older reader ignores two unknown string fields, and a
  // newer reader defaults them, so both directions already work.
  category: z.string().trim().default(""),
  description: z.string().trim().default(""),
  filter: journalFilterSchema,
});

/**
 * The preferences, as exported.
 *
 * `photoRoot` is included so a backup is a complete record of what the module
 * looked like — but `applyMetadataImport` never writes it. It's a per-install
 * absolute path (a UNC path from Windows in dev, `/volume1/...` on the NAS), and
 * restoring one machine's value onto the other silently breaks the entry
 * viewer's photo card. See `JournalPreferences.photoRoot` for why it's a setting
 * rather than an env var in the first place.
 */
const metadataPreferencesSchema = z.object({
  defaultLocation: z
    .object({
      latitude: z.number(),
      longitude: z.number(),
      name: z.string().default(""),
    })
    .nullish(),
  temperatureUnit: z.enum(["celsius", "fahrenheit"]),
  /** Exported for the record; ignored on restore. */
  photoRoot: z.string().default(""),
  /**
   * Defaulted rather than required, so a bundle written before this preference
   * existed is still a legal file and restores at the 20px floor. Kept in step
   * with `JournalHandwritingSize` — the enum is the closed set the read path
   * clamps to.
   */
  handwritingSize: z.enum(["xl", "2xl", "3xl", "4xl"]).default("xl"),
  /**
   * Defaulted for the same reason as the size above: a bundle written before
   * this preference existed is still a legal file, and restores with the review
   * off — which is what the module does when the setting has never been saved.
   */
  reviewBeforeCalendarImport: z.boolean().default(false),
  /**
   * The two Topics settings, defaulted for the same reason as everything above:
   * a bundle written before Topics existed is still a legal file and restores
   * with body matching off and the standard fortnight gap — exactly what the
   * module does when neither setting has ever been saved.
   *
   * They travel because they are reading preferences rather than machine facts,
   * the same test `handwritingSize` passes and `contentTextureId` fails.
   */
  topicMatchBody: z.boolean().default(false),
  topicEpisodeGapDays: z.number().int().min(1).max(365).default(14),
  /**
   * Nullable and defaulted for the same reason as the two above. `null` means
   * "follow the theme's ink", which is what an older bundle restores to.
   *
   * There is deliberately NO `contentTextureId` beside this, and no
   * `contentTextureOpacity` either. The pointer is a row id in *this* install's
   * app texture library, and the library is not part of a journal metadata
   * backup — restoring it on another machine would point the Content field at
   * an unrelated picture, or at nothing. The strength goes with it, because it
   * only means something alongside a picture: restoring a strength for a
   * texture that didn't travel would tune nothing. Same rule the photo root
   * follows — machine facts don't travel, reading preferences do.
   */
  contentTextColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Expected a #RRGGBB colour.")
    .nullish(),
  /**
   * The Content field's face and size with Handwriting off.
   *
   * These travel, where the texture settings above do not, by the rule this
   * schema already follows: a face and a size are reading preferences about
   * one field, like the handwriting size, while a texture pointer is a row id
   * in one install's library. Nothing about a font is machine-specific — all
   * seven faces ship with the app.
   *
   * The face is an open string here rather than a `z.enum` of `FONT_KEYS`: a
   * bundle naming a face this build doesn't load must still be a legal file,
   * and `resolveJournalPreferences` already discards an unrecognised key on
   * read. Validating it twice would turn a restorable backup into a parse
   * error over a font.
   */
  contentFont: z.string().nullish(),
  /**
   * Defaulted like `handwritingSize` above, and for the same reason: a bundle
   * written before this preference existed is still a legal file and restores
   * at 14px, which is what the field used then.
   *
   * Required on `z.output` — a defaulted field is always present once parsed —
   * so a hand-written bundle object in a test carries it even though a JSON
   * backup on disk need not.
   */
  contentFontSize: z.enum(["sm", "base", "lg", "xl", "2xl"]).default("sm"),
});

/**
 * The whole file.
 *
 * Every list defaults to empty, so a hand-trimmed backup holding only, say,
 * categories is still a legal bundle and restores just those. `preferences` is
 * optional for the same reason.
 */
export const journalMetadataBundleSchema = z.object({
  format: z.literal(JOURNAL_METADATA_FORMAT, {
    message: "That file isn't a My Journal metadata backup.",
  }),
  version: z
    .number()
    .int()
    .positive()
    .max(JOURNAL_METADATA_FORMAT_VERSION, {
      message: "That backup was made by a newer version of MyHomeBase.",
    }),
  /** When the export ran, ISO-8601. Display only — nothing branches on it. */
  exportedAt: z.string().default(""),
  categories: z.array(metadataTaxonomySchema).default([]),
  tags: z.array(metadataTaxonomySchema).default([]),
  templates: z.array(metadataTemplateSchema).default([]),
  filters: z.array(metadataFilterSchema).default([]),
  preferences: metadataPreferencesSchema.nullish(),
});

export type JournalMetadataBundle = z.output<typeof journalMetadataBundleSchema>;

/**
 * Parses untrusted text (an uploaded file) into a bundle.
 *
 * Strict, unlike `parseStoredJournalFilter` and friends — those tolerate rot
 * because the alternative is a 500 on a screen the reader can still otherwise
 * use. Here the input is a file someone just chose, and silently restoring three
 * of their forty tags because the rest didn't parse is worse than refusing the
 * file and saying why.
 */
export function parseMetadataBundle(fileText: string): JournalMetadataBundle {
  let raw: unknown;
  try {
    raw = JSON.parse(fileText);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  return journalMetadataBundleSchema.parse(raw);
}

// --- Export ------------------------------------------------------------------

/** `journal-metadata-YYYY-MM-DD.json`, matching `favPhotoArchiveName`'s style. */
export function metadataExportFileName(today: Date): string {
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `journal-metadata-${year}-${month}-${day}.json`;
}

/**
 * Reads every piece of journal metadata into one bundle.
 *
 * Icons are fetched one at a time via `getCategoryIcon`/`getTagIcon` — the list
 * calls deliberately don't carry bytes (see `JournalCategory.iconMimeType`), and
 * this is the one caller that wants them all. That's N+1 queries against a table
 * of at most a few hundred rows, on an explicit button press; a bulk read would
 * be a new repository method existing only for this.
 *
 * `preferences` is passed in rather than read here because they live in
 * sys_module_settings, not the jrn_ tables, and this module has no business
 * knowing the journal's module id.
 */
export function buildMetadataBundle(
  repo: JournalRepository,
  preferences: JournalPreferences,
  now: Date = new Date(),
): JournalMetadataBundle {
  const categories = repo.listCategories().map((category) => ({
    name: category.name,
    description: category.description,
    icon: toMetadataIcon(category.iconMimeType ? repo.getCategoryIcon(category.name) : undefined),
  }));

  const tags = repo.listTags().map((tag) => ({
    name: tag.name,
    description: tag.description,
    icon: toMetadataIcon(tag.iconMimeType ? repo.getTagIcon(tag.name) : undefined),
  }));

  const templates = repo.listPrefillTemplates().map((template) => ({
    name: template.name,
    description: template.description,
    isEnabled: template.isEnabled,
    fields: template.fields,
  }));

  const filters = repo.listFilters().map((saved) => ({
    name: saved.name,
    category: saved.category,
    description: saved.description,
    filter: saved.filter,
  }));

  return {
    format: JOURNAL_METADATA_FORMAT,
    version: JOURNAL_METADATA_FORMAT_VERSION,
    exportedAt: now.toISOString(),
    categories,
    tags,
    templates,
    filters,
    preferences: {
      defaultLocation: preferences.defaultLocation,
      temperatureUnit: preferences.temperatureUnit,
      photoRoot: preferences.photoRoot,
      handwritingSize: preferences.handwritingSize,
      reviewBeforeCalendarImport: preferences.reviewBeforeCalendarImport,
      topicMatchBody: preferences.topicMatchBody,
      topicEpisodeGapDays: preferences.topicEpisodeGapDays,
      contentTextColor: preferences.contentTextColor,
      contentFont: preferences.contentFont,
      contentFontSize: preferences.contentFontSize,
    },
  };
}

/** Icon bytes → the bundle's inline form. `undefined` becomes `null`. */
function toMetadataIcon(
  icon: { data: Buffer; mimeType: string } | undefined,
): JournalMetadataIcon | null {
  if (!icon) return null;
  // The stored mime type came through `decodeImageUpload` on the way in, so it is
  // already one of the allowed four. Narrowed rather than re-validated, because a
  // row that somehow holds something else should not fail the whole backup.
  const mimeType = IMAGE_UPLOAD_MIME_TYPES.find((allowed) => allowed === icon.mimeType);
  if (!mimeType) return null;
  return { mimeType, base64: icon.data.toString("base64") };
}

/** Serializes a bundle to the bytes the download route returns. */
export function serializeMetadataBundle(bundle: JournalMetadataBundle): string {
  // Indented: the file is meant to be readable and diffable, and gzip over the
  // wire makes the whitespace close to free.
  return JSON.stringify(bundle, null, 2);
}

// --- Restore -----------------------------------------------------------------

/** What restoring one named thing will do to what's already stored. */
export type JournalMetadataAction = "create" | "update";

/** One row of the restore plan, as listed in the confirmation dialog. */
export interface JournalMetadataPlanRow {
  kind: "category" | "tag" | "template" | "filter";
  name: string;
  action: JournalMetadataAction;
  /** True when this row will replace an icon the stored item already has. */
  replacesIcon?: boolean;
}

/**
 * What a restore would do, without writing anything.
 *
 * Mirrors `JournalImportPlan`'s counts so the Meta Data screen's confirmation
 * dialog can reuse the shape the CSV import's dialog already uses. There is no
 * `skipCount`: the merge rule is "file wins, nothing deleted", so every row in
 * the file is either a create or an update — nothing is passed over.
 */
export interface JournalMetadataPlan {
  rows: JournalMetadataPlanRow[];
  createCount: number;
  updateCount: number;
  /** How many updates replace an existing icon — the one destructive-ish bit. */
  iconReplaceCount: number;
  /** True when the bundle carries preferences that will be applied. */
  appliesPreferences: boolean;
  /**
   * True when the bundle carries a non-empty `photoRoot` that will be ignored.
   * Surfaced so the dialog can say so rather than leaving the reader to wonder
   * why their photo path didn't come across.
   */
  skipsPhotoRoot: boolean;
}

/**
 * Works out what `applyMetadataImport` would change.
 *
 * Both functions derive their decisions from the same lookups, so the list shown
 * in the dialog cannot drift from what the restore then does — the same reason
 * `walkJournalCsv` backs both the CSV plan and the CSV import.
 */
export function planMetadataImport(
  repo: JournalRepository,
  bundle: JournalMetadataBundle,
): JournalMetadataPlan {
  const rows: JournalMetadataPlanRow[] = [];

  for (const category of bundle.categories) {
    const stored = repo.getCategoryByName(category.name);
    rows.push({
      kind: "category",
      name: category.name,
      action: stored ? "update" : "create",
      replacesIcon: Boolean(stored?.iconMimeType && category.icon),
    });
  }

  for (const tag of bundle.tags) {
    const stored = repo.getTagByName(tag.name);
    rows.push({
      kind: "tag",
      name: tag.name,
      action: stored ? "update" : "create",
      replacesIcon: Boolean(stored?.iconMimeType && tag.icon),
    });
  }

  for (const template of bundle.templates) {
    rows.push({
      kind: "template",
      name: template.name,
      action: repo.getPrefillTemplateByName(template.name) ? "update" : "create",
    });
  }

  // Filters have no get-by-name on the repository (`saveFilter` is an upsert on a
  // UNIQUE name), so the stored list is read once and matched here rather than
  // adding a method used only by this plan.
  const storedFilterNames = new Set(repo.listFilters().map((saved) => saved.name));
  for (const filter of bundle.filters) {
    rows.push({
      kind: "filter",
      name: filter.name,
      action: storedFilterNames.has(filter.name) ? "update" : "create",
    });
  }

  return {
    rows,
    createCount: rows.filter((row) => row.action === "create").length,
    updateCount: rows.filter((row) => row.action === "update").length,
    iconReplaceCount: rows.filter((row) => row.replacesIcon).length,
    appliesPreferences: Boolean(bundle.preferences),
    skipsPhotoRoot: (bundle.preferences?.photoRoot ?? "").trim() !== "",
  };
}

/**
 * The preference entries a restore should write, or `[]` when the bundle has
 * none.
 *
 * Returned for the caller to hand to `saveModuleSettingsPartial` rather than
 * written here, because settings live outside the journal repository. Partial on
 * purpose: it leaves the stored `photo_root` row untouched, which is exactly the
 * "exported but never applied" rule, with no need to read the old value first.
 *
 * A cleared default location writes nothing rather than removing the stored one.
 * Restoring is additive everywhere else, and "the backup had no default
 * location" is far more likely to mean the reader never set one than to mean
 * they want this machine's cleared.
 */
export function metadataPreferenceEntries(
  bundle: JournalMetadataBundle,
): { key: string; value: string }[] {
  const preferences = bundle.preferences;
  if (!preferences) return [];

  // Annotated, not inferred: `temperatureUnit` is a literal union, so an inferred
  // array type would narrow `value` to "celsius" | "fahrenheit" and reject every
  // `String(...)` pushed below.
  const entries: { key: string; value: string }[] = [
    { key: "temperature_unit", value: preferences.temperatureUnit },
    // Restored like the unit, not skipped like the photo root: the photo root is
    // machine-specific (a NAS volume path means nothing on a Windows box), while
    // a type size is a reading preference that travels with the journal. The
    // schema defaults it, so a pre-existing bundle restores the floor.
    { key: "handwriting_size", value: preferences.handwritingSize },
    // Travels with the journal for the same reason the size does — it is a
    // working preference, not a machine fact. Written at both values so a
    // restore can turn it back off; see `journalPreferencesToEntries`.
    {
      key: "review_before_calendar_import",
      value: preferences.reviewBeforeCalendarImport ? "true" : "false",
    },
    // Both written at every value, for the same reason the review flag is: a
    // restore has to be able to turn body matching back off and to put the
    // episode gap back to the default, not merely to raise them.
    { key: "topic_match_body", value: preferences.topicMatchBody ? "true" : "false" },
    { key: "topic_episode_gap_days", value: String(preferences.topicEpisodeGapDays) },
  ];

  // Omitted when unset rather than written blank -- the settings schema rejects
  // an empty value, and an absent row is what "use the theme's ink" means. So a
  // bundle with no colour leaves this machine's own choice alone, which is the
  // additive rule the rest of this function follows.
  if (preferences.contentTextColor) {
    entries.push({ key: "content_text_color", value: preferences.contentTextColor });
  }

  // The size is always written -- it has no "unset" member, and the schema
  // defaults it, so a bundle predating this preference restores 14px. The face
  // is omitted when unset, like the colour: an absent row means "follow the
  // theme", and a blank value is rejected.
  entries.push({ key: "content_font_size", value: preferences.contentFontSize });
  if (preferences.contentFont) {
    entries.push({ key: "content_font", value: preferences.contentFont });
  }

  const location = preferences.defaultLocation;
  if (location) {
    entries.push(
      { key: "default_latitude", value: String(location.latitude) },
      { key: "default_longitude", value: String(location.longitude) },
    );
    // Same rule as `journalPreferencesToEntries`: the settings schema rejects an
    // empty value, so a blank name is omitted rather than stored as "".
    if (location.name.trim() !== "") {
      entries.push({ key: "default_location_name", value: location.name.trim() });
    }
  }

  return entries;
}

/** What a restore actually changed. */
export interface JournalMetadataRestoreSummary {
  categoryCount: number;
  tagCount: number;
  templateCount: number;
  filterCount: number;
  iconCount: number;
  /** Preference entries the caller still needs to persist. Possibly empty. */
  preferenceEntries: { key: string; value: string }[];
}

/**
 * Writes a bundle into the journal: "file wins, nothing deleted".
 *
 * An existing category or tag keeps its entry links but takes the file's
 * description and icon. A name the file doesn't mention is left completely
 * alone — this restores a backup over the top of whatever is there, it does not
 * make the module identical to the backup. Deleting the difference would detach
 * categories from every entry that used them, which is not what a button called
 * "restore" should be able to do.
 *
 * Each item is written on its own rather than in one big transaction. The
 * repository's upserts are individually atomic, and a bundle of a few hundred
 * small writes that fails halfway leaves a partial restore the reader can simply
 * run again — the merge is idempotent, so re-running finishes the job.
 */
export function applyMetadataImport(
  repo: JournalRepository,
  bundle: JournalMetadataBundle,
): JournalMetadataRestoreSummary {
  let iconCount = 0;

  for (const category of bundle.categories) {
    repo.upsertCategory({ name: category.name, description: category.description });
    if (category.icon) {
      repo.setCategoryIcon(category.name, decodeMetadataIcon(category.icon, category.name));
      iconCount += 1;
    }
  }

  for (const tag of bundle.tags) {
    repo.upsertTag({ name: tag.name, description: tag.description });
    if (tag.icon) {
      repo.setTagIcon(tag.name, decodeMetadataIcon(tag.icon, tag.name));
      iconCount += 1;
    }
  }

  for (const template of bundle.templates) {
    // Carry the stored id so an existing name is updated rather than colliding
    // with the table's UNIQUE (name).
    const stored = repo.getPrefillTemplateByName(template.name);
    repo.savePrefillTemplate({
      id: stored?.id,
      name: template.name,
      description: template.description,
      isEnabled: template.isEnabled,
      fields: template.fields,
    });
  }

  for (const filter of bundle.filters) {
    // `saveFilter` is itself an upsert by name, so no id is needed. The category
    // and description ride along: a restore that dropped them would quietly
    // un-file every filter it touched.
    repo.saveFilter({
      name: filter.name,
      category: filter.category,
      description: filter.description,
      filter: filter.filter,
    });
  }

  return {
    categoryCount: bundle.categories.length,
    tagCount: bundle.tags.length,
    templateCount: bundle.templates.length,
    filterCount: bundle.filters.length,
    iconCount,
    preferenceEntries: metadataPreferenceEntries(bundle),
  };
}

/**
 * Decodes one inline icon back to bytes, through the same gate an uploaded file
 * goes through.
 *
 * Re-validated rather than trusted: a metadata bundle is a text file a reader can
 * edit, and these bytes end up in a BLOB this app serves back from its own
 * origin. `decodeImageUpload` is what enforces the PNG/JPEG/WebP/GIF allowlist
 * (no SVG — it can carry script) and the size cap. The name is folded into the
 * error so a 400 names the tag that broke, not just "an image".
 */
function decodeMetadataIcon(icon: JournalMetadataIcon, name: string) {
  try {
    return decodeImageUpload(
      { mimeType: icon.mimeType, base64Data: icon.base64 },
      MAX_JOURNAL_ICON_BYTES,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : "it could not be read";
    throw new Error(`The icon for "${name}" was rejected — ${reason}`);
  }
}
