import { describe, expect, it } from "vitest";
import {
  applyMetadataImport,
  buildMetadataBundle,
  JOURNAL_METADATA_FORMAT,
  JOURNAL_METADATA_FORMAT_VERSION,
  journalMetadataBundleSchema,
  metadataExportFileName,
  metadataPreferenceEntries,
  parseMetadataBundle,
  planMetadataImport,
  serializeMetadataBundle,
  type JournalMetadataBundle,
} from "./metadata-export";
import type { JournalRepository } from "./ports";
import type {
  JournalCategory,
  JournalPreferences,
  JournalPrefillTemplate,
  JournalTag,
  JournalTaxonomyIcon,
  SavedJournalFilter,
} from "./types";
import type { DecodedImage } from "@/lib/shared/image-upload";

// Hand-written in-memory fake covering only the slice of the port the metadata
// backup touches: the two managed taxonomy lists with their icon blobs, the
// template table, and the saved filters. Everything else is left off the object,
// so a use-case that quietly reaches for an entry query fails loudly rather than
// passing against a stub that returns [].
function fakeRepo(seed?: {
  categories?: { name: string; description?: string; icon?: DecodedImage }[];
  tags?: { name: string; description?: string; icon?: DecodedImage }[];
  templates?: { name: string; description?: string; isEnabled?: boolean }[];
  filters?: string[];
}) {
  const now = "2026-01-01T00:00:00.000Z";

  const categories = new Map<string, JournalCategory>();
  const categoryIcons = new Map<string, JournalTaxonomyIcon>();
  const tags = new Map<string, JournalTag>();
  const tagIcons = new Map<string, JournalTaxonomyIcon>();
  let templates: JournalPrefillTemplate[] = [];
  let filters: SavedJournalFilter[] = [];
  let nextId = 1;

  for (const category of seed?.categories ?? []) {
    categories.set(category.name, {
      name: category.name,
      description: category.description ?? "",
      iconMimeType: category.icon?.mimeType,
      createdAt: now,
      updatedAt: now,
    });
    if (category.icon) categoryIcons.set(category.name, category.icon);
  }
  for (const tag of seed?.tags ?? []) {
    tags.set(tag.name, {
      name: tag.name,
      description: tag.description ?? "",
      iconMimeType: tag.icon?.mimeType,
      createdAt: now,
      updatedAt: now,
    });
    if (tag.icon) tagIcons.set(tag.name, tag.icon);
  }
  for (const template of seed?.templates ?? []) {
    templates.push({
      id: nextId++,
      name: template.name,
      description: template.description ?? "",
      isEnabled: template.isEnabled ?? true,
      fields: [],
      createdAt: now,
      updatedAt: now,
    });
  }
  for (const name of seed?.filters ?? []) {
    filters.push({
      id: nextId++,
      name,
      category: "",
      description: "",
      filter: { join: "AND", groups: [] },
      createdAt: now,
      updatedAt: now,
    });
  }

  const repo = {
    listCategories: () => [...categories.values()],
    getCategoryByName: (name: string) => categories.get(name),
    getCategoryIcon: (name: string) => categoryIcons.get(name),
    upsertCategory(input: { name: string; description: string }) {
      const existing = categories.get(input.name);
      const row: JournalCategory = {
        name: input.name,
        description: input.description,
        // An upsert edits the description; it never touches the icon.
        iconMimeType: existing?.iconMimeType,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      categories.set(input.name, row);
      return row;
    },
    setCategoryIcon(name: string, icon: DecodedImage | undefined) {
      const row = categories.get(name);
      if (!row) throw new Error(`no such category: ${name}`);
      if (icon) {
        categoryIcons.set(name, icon);
        categories.set(name, { ...row, iconMimeType: icon.mimeType });
      } else {
        categoryIcons.delete(name);
        categories.set(name, { ...row, iconMimeType: undefined });
      }
    },

    listTags: () => [...tags.values()],
    getTagByName: (name: string) => tags.get(name),
    getTagIcon: (name: string) => tagIcons.get(name),
    upsertTag(input: { name: string; description: string }) {
      const existing = tags.get(input.name);
      const row: JournalTag = {
        name: input.name,
        description: input.description,
        iconMimeType: existing?.iconMimeType,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      tags.set(input.name, row);
      return row;
    },
    setTagIcon(name: string, icon: DecodedImage | undefined) {
      const row = tags.get(name);
      if (!row) throw new Error(`no such tag: ${name}`);
      if (icon) {
        tagIcons.set(name, icon);
        tags.set(name, { ...row, iconMimeType: icon.mimeType });
      } else {
        tagIcons.delete(name);
        tags.set(name, { ...row, iconMimeType: undefined });
      }
    },

    listPrefillTemplates: () => [...templates],
    getPrefillTemplateByName: (name: string) => templates.find((t) => t.name === name),
    savePrefillTemplate(input: {
      id?: number;
      name: string;
      description: string;
      isEnabled: boolean;
      fields: JournalPrefillTemplate["fields"];
    }) {
      const row: JournalPrefillTemplate = {
        id: input.id ?? nextId++,
        name: input.name,
        description: input.description,
        isEnabled: input.isEnabled,
        fields: input.fields,
        createdAt: now,
        updatedAt: now,
      };
      templates = [...templates.filter((t) => t.id !== row.id), row];
      return row;
    },

    listFilters: () => [...filters],
    saveFilter(input: {
      name: string;
      category: string;
      description: string;
      filter: SavedJournalFilter["filter"];
    }) {
      // UNIQUE (name) — an upsert, matching migration 0043.
      const existing = filters.find((f) => f.name === input.name);
      const row: SavedJournalFilter = {
        id: existing?.id ?? nextId++,
        name: input.name,
        category: input.category,
        description: input.description,
        filter: input.filter,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      filters = [...filters.filter((f) => f.id !== row.id), row];
      return row;
    },
  } as unknown as JournalRepository;

  return repo;
}

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02]);

const PREFERENCES: JournalPreferences = {
  defaultLocation: { latitude: 40.7128, longitude: -74.006, name: "New York" },
  temperatureUnit: "celsius",
  photoRoot: "//NAS_DS223/photos",
  // Not the default, so the export assertion below proves the value is carried
  // rather than being supplied by the schema's fallback.
  handwritingSize: "2xl",
  // Likewise not the default.
  reviewBeforeCalendarImport: true,
  topicMatchBody: false,
  topicEpisodeGapDays: 14,
  excludedWords: [],
  topWordLimit: 10,
  // Set, and deliberately not null, so the export assertion proves the colour
  // is carried. The texture pointer stays null: it is machine-specific and is
  // not part of a metadata bundle at all.
  contentTextColor: "#1A2B3C",
  contentTextureId: null,
  // Neither the pointer nor its strength is part of a bundle: the strength
  // only means anything alongside a picture, and the picture doesn't travel.
  contentTextureOpacity: 0.1,
  // These DO travel, unlike the texture settings above: a face and a size are
  // reading preferences, not machine facts. Non-default so the export
  // assertion proves they are carried rather than defaulted.
  contentFont: "inter",
  contentFontSize: "lg",
};

function bundleOf(overrides: Partial<JournalMetadataBundle> = {}): JournalMetadataBundle {
  return {
    format: JOURNAL_METADATA_FORMAT,
    version: JOURNAL_METADATA_FORMAT_VERSION,
    exportedAt: "2026-09-02T00:00:00.000Z",
    categories: [],
    tags: [],
    templates: [],
    filters: [],
    preferences: null,
    ...overrides,
  };
}

describe("metadataExportFileName", () => {
  it("names the file after the local date", () => {
    expect(metadataExportFileName(new Date(2026, 8, 2))).toBe("journal-metadata-2026-09-02.json");
  });

  it("pads single-digit months and days", () => {
    expect(metadataExportFileName(new Date(2026, 0, 5))).toBe("journal-metadata-2026-01-05.json");
  });
});

describe("buildMetadataBundle", () => {
  it("collects categories, tags, templates, filters and preferences", () => {
    const repo = fakeRepo({
      categories: [{ name: "Travel", description: "Trips" }],
      tags: [{ name: "family" }],
      templates: [{ name: "Morning", description: "Daily", isEnabled: false }],
      filters: ["Pinned only"],
    });

    const bundle = buildMetadataBundle(repo, PREFERENCES, new Date("2026-09-02T10:00:00.000Z"));

    expect(bundle.format).toBe(JOURNAL_METADATA_FORMAT);
    expect(bundle.version).toBe(JOURNAL_METADATA_FORMAT_VERSION);
    expect(bundle.exportedAt).toBe("2026-09-02T10:00:00.000Z");
    expect(bundle.categories).toEqual([
      { name: "Travel", description: "Trips", icon: null },
    ]);
    expect(bundle.tags).toEqual([{ name: "family", description: "", icon: null }]);
    expect(bundle.templates).toEqual([
      { name: "Morning", description: "Daily", isEnabled: false, fields: [] },
    ]);
    expect(bundle.filters).toEqual([
      { name: "Pinned only", category: "", description: "", filter: { join: "AND", groups: [] } },
    ]);
    expect(bundle.preferences).toEqual({
      defaultLocation: { latitude: 40.7128, longitude: -74.006, name: "New York" },
      temperatureUnit: "celsius",
      photoRoot: "//NAS_DS223/photos",
      handwritingSize: "2xl",
      reviewBeforeCalendarImport: true,
      topicMatchBody: false,
      topicEpisodeGapDays: 14,
      contentTextColor: "#1A2B3C",
      contentFont: "inter",
      contentFontSize: "lg",
    });
  });

  it("carries icon bytes as base64", () => {
    const repo = fakeRepo({
      categories: [{ name: "Travel", icon: { data: PNG_BYTES, mimeType: "image/png" } }],
    });

    const bundle = buildMetadataBundle(repo, PREFERENCES);

    expect(bundle.categories[0].icon).toEqual({
      mimeType: "image/png",
      base64: PNG_BYTES.toString("base64"),
    });
  });

  it("reports no icon for an item that has none", () => {
    const repo = fakeRepo({ tags: [{ name: "work" }] });
    expect(buildMetadataBundle(repo, PREFERENCES).tags[0].icon).toBeNull();
  });
});

describe("parseMetadataBundle", () => {
  it("round-trips a serialized bundle", () => {
    const repo = fakeRepo({
      categories: [{ name: "Travel", icon: { data: PNG_BYTES, mimeType: "image/png" } }],
      tags: [{ name: "family", description: "kin" }],
    });

    const bundle = buildMetadataBundle(repo, PREFERENCES);
    const reparsed = parseMetadataBundle(serializeMetadataBundle(bundle));

    expect(reparsed).toEqual(bundle);
  });

  it("rejects text that isn't JSON", () => {
    expect(() => parseMetadataBundle("not json at all")).toThrow(/isn't valid JSON/);
  });

  it("rejects a JSON file that isn't a journal metadata backup", () => {
    expect(() => parseMetadataBundle(JSON.stringify({ hello: "world" }))).toThrow();
  });

  it("rejects a bundle from a newer format version", () => {
    const text = JSON.stringify(
      bundleOf({ version: JOURNAL_METADATA_FORMAT_VERSION + 1 }),
    );
    expect(() => parseMetadataBundle(text)).toThrow(/newer version/);
  });

  it("defaults the lists so a partial backup is still legal", () => {
    const text = JSON.stringify({
      format: JOURNAL_METADATA_FORMAT,
      version: JOURNAL_METADATA_FORMAT_VERSION,
      categories: [{ name: "Travel" }],
    });

    const bundle = parseMetadataBundle(text);

    expect(bundle.categories).toEqual([{ name: "Travel", description: "" }]);
    expect(bundle.tags).toEqual([]);
    expect(bundle.templates).toEqual([]);
    expect(bundle.filters).toEqual([]);
  });
});

describe("planMetadataImport", () => {
  it("splits names into creates and updates", () => {
    const repo = fakeRepo({
      categories: [{ name: "Travel" }],
      tags: [{ name: "family" }],
      templates: [{ name: "Morning" }],
      filters: ["Pinned only"],
    });

    const plan = planMetadataImport(
      repo,
      bundleOf({
        categories: [
          { name: "Travel", description: "Trips" },
          { name: "Food", description: "" },
        ],
        tags: [{ name: "family", description: "" }],
        templates: [
          { name: "Morning", description: "", isEnabled: true, fields: [] },
          { name: "Evening", description: "", isEnabled: true, fields: [] },
        ],
        filters: [
          { name: "Pinned only", category: "", description: "", filter: { join: "AND", groups: [] } },
        ],
      }),
    );

    expect(plan.createCount).toBe(2); // Food, Evening
    expect(plan.updateCount).toBe(4); // Travel, family, Morning, Pinned only
    expect(plan.rows).toHaveLength(6);
    expect(plan.rows.find((row) => row.name === "Food")?.action).toBe("create");
    expect(plan.rows.find((row) => row.name === "Travel")?.action).toBe("update");
  });

  it("counts icons the restore would replace", () => {
    const repo = fakeRepo({
      categories: [{ name: "Travel", icon: { data: PNG_BYTES, mimeType: "image/png" } }],
      tags: [{ name: "family" }], // no stored icon — not a replacement
    });

    const plan = planMetadataImport(
      repo,
      bundleOf({
        categories: [
          {
            name: "Travel",
            description: "",
            icon: { mimeType: "image/png", base64: PNG_BYTES.toString("base64") },
          },
        ],
        tags: [
          {
            name: "family",
            description: "",
            icon: { mimeType: "image/png", base64: PNG_BYTES.toString("base64") },
          },
        ],
      }),
    );

    expect(plan.iconReplaceCount).toBe(1);
    expect(plan.rows.find((row) => row.name === "Travel")?.replacesIcon).toBe(true);
    expect(plan.rows.find((row) => row.name === "family")?.replacesIcon).toBe(false);
  });

  it("flags that a bundle's photoRoot will be ignored", () => {
    const withRoot = planMetadataImport(
      fakeRepo(),
      bundleOf({
        preferences: {
          defaultLocation: null,
          temperatureUnit: "celsius",
          photoRoot: "//NAS_DS223/photos",
          handwritingSize: "xl",
          reviewBeforeCalendarImport: false,
          topicMatchBody: false,
          topicEpisodeGapDays: 14,
          contentFontSize: "sm",
        },
      }),
    );
    expect(withRoot.appliesPreferences).toBe(true);
    expect(withRoot.skipsPhotoRoot).toBe(true);

    const withoutRoot = planMetadataImport(
      fakeRepo(),
      bundleOf({
        preferences: {
          defaultLocation: null,
          temperatureUnit: "celsius",
          photoRoot: "",
          handwritingSize: "xl",
          reviewBeforeCalendarImport: false,
          topicMatchBody: false,
          topicEpisodeGapDays: 14,
          contentFontSize: "sm",
        },
      }),
    );
    expect(withoutRoot.skipsPhotoRoot).toBe(false);
  });

  it("reports nothing to do for a bundle with no preferences", () => {
    const plan = planMetadataImport(fakeRepo(), bundleOf());
    expect(plan.rows).toEqual([]);
    expect(plan.appliesPreferences).toBe(false);
  });
});

describe("applyMetadataImport", () => {
  it("creates names the journal doesn't have", () => {
    const repo = fakeRepo();

    const summary = applyMetadataImport(
      repo,
      bundleOf({
        categories: [{ name: "Food", description: "Meals out" }],
        tags: [{ name: "family", description: "" }],
      }),
    );

    expect(summary.categoryCount).toBe(1);
    expect(summary.tagCount).toBe(1);
    expect(repo.getCategoryByName("Food")?.description).toBe("Meals out");
    expect(repo.getTagByName("family")).toBeDefined();
  });

  it("overwrites an existing description from the file", () => {
    const repo = fakeRepo({ categories: [{ name: "Travel", description: "old" }] });

    applyMetadataImport(
      repo,
      bundleOf({ categories: [{ name: "Travel", description: "new" }] }),
    );

    expect(repo.getCategoryByName("Travel")?.description).toBe("new");
  });

  it("restores icon bytes byte-for-byte", () => {
    const repo = fakeRepo({ categories: [{ name: "Travel" }] });

    const summary = applyMetadataImport(
      repo,
      bundleOf({
        categories: [
          {
            name: "Travel",
            description: "",
            icon: { mimeType: "image/png", base64: PNG_BYTES.toString("base64") },
          },
        ],
      }),
    );

    expect(summary.iconCount).toBe(1);
    const restored = repo.getCategoryIcon("Travel");
    expect(restored?.mimeType).toBe("image/png");
    expect(Buffer.compare(restored!.data, PNG_BYTES)).toBe(0);
  });

  it("leaves a stored icon alone when the file has none for that name", () => {
    const repo = fakeRepo({
      tags: [{ name: "family", icon: { data: PNG_BYTES, mimeType: "image/png" } }],
    });

    applyMetadataImport(repo, bundleOf({ tags: [{ name: "family", description: "kin" }] }));

    expect(repo.getTagIcon("family")).toBeDefined();
    expect(repo.getTagByName("family")?.description).toBe("kin");
  });

  it("never deletes a name the file doesn't mention", () => {
    const repo = fakeRepo({
      categories: [{ name: "Travel" }, { name: "Keep me" }],
    });

    applyMetadataImport(repo, bundleOf({ categories: [{ name: "Travel", description: "" }] }));

    expect(repo.getCategoryByName("Keep me")).toBeDefined();
  });

  it("updates an existing template in place rather than duplicating it", () => {
    const repo = fakeRepo({ templates: [{ name: "Morning", description: "old" }] });

    applyMetadataImport(
      repo,
      bundleOf({
        templates: [{ name: "Morning", description: "new", isEnabled: false, fields: [] }],
      }),
    );

    const stored = repo.listPrefillTemplates();
    expect(stored).toHaveLength(1);
    expect(stored[0].description).toBe("new");
    expect(stored[0].isEnabled).toBe(false);
  });

  it("upserts a saved filter by name", () => {
    const repo = fakeRepo({ filters: ["Pinned only"] });

    applyMetadataImport(
      repo,
      bundleOf({
        filters: [
          {
            name: "Pinned only",
            // Non-blank so the restore assertion below proves these ride along
            // rather than being silently dropped — which is what the import did
            // before migration 0152 added them.
            category: "CAR",
            description: "Only the pinned ones.",
            filter: {
              join: "AND",
              groups: [
                { join: "AND", conditions: [{ field: "isPinned", operator: "is", value: "true" }] },
              ],
            },
          },
          { name: "Locked", category: "", description: "", filter: { join: "AND", groups: [] } },
        ],
      }),
    );

    const stored = repo.listFilters();
    expect(stored).toHaveLength(2);
    const pinned = stored.find((f) => f.name === "Pinned only");
    expect(pinned?.filter.groups).toHaveLength(1);
    // A restore that dropped these would un-file every filter it touched.
    expect(pinned?.category).toBe("CAR");
    expect(pinned?.description).toBe("Only the pinned ones.");
  });

  it("rejects an icon that busts the size cap, naming the item", () => {
    const repo = fakeRepo();
    const huge = Buffer.alloc(200 * 1024, 1).toString("base64");

    expect(() =>
      applyMetadataImport(
        repo,
        bundleOf({
          categories: [
            { name: "Travel", description: "", icon: { mimeType: "image/png", base64: huge } },
          ],
        }),
      ),
    ).toThrow(/"Travel"/);
  });

  it("round-trips a whole journal's metadata through export and restore", () => {
    const source = fakeRepo({
      categories: [
        { name: "Travel", description: "Trips", icon: { data: PNG_BYTES, mimeType: "image/png" } },
        { name: "Food" },
      ],
      tags: [{ name: "family", description: "kin" }],
      templates: [{ name: "Morning", isEnabled: false }],
      filters: ["Pinned only"],
    });
    const target = fakeRepo();

    const text = serializeMetadataBundle(buildMetadataBundle(source, PREFERENCES));
    applyMetadataImport(target, parseMetadataBundle(text));

    expect(buildMetadataBundle(target, PREFERENCES).categories).toEqual(
      buildMetadataBundle(source, PREFERENCES).categories,
    );
    expect(target.listTags().map((tag) => tag.name)).toEqual(["family"]);
    expect(target.listPrefillTemplates()[0].isEnabled).toBe(false);
    expect(target.listFilters().map((f) => f.name)).toEqual(["Pinned only"]);
  });
});

describe("metadataPreferenceEntries", () => {
  it("returns nothing for a bundle with no preferences", () => {
    expect(metadataPreferenceEntries(bundleOf())).toEqual([]);
  });

  it("never emits photo_root, even when the bundle carries one", () => {
    const entries = metadataPreferenceEntries(
      bundleOf({
        preferences: {
          defaultLocation: null,
          temperatureUnit: "celsius",
          photoRoot: "//NAS_DS223/photos",
          handwritingSize: "xl",
          reviewBeforeCalendarImport: false,
          topicMatchBody: false,
          topicEpisodeGapDays: 14,
          contentFontSize: "sm",
        },
      }),
    );

    expect(entries.map((entry) => entry.key)).not.toContain("photo_root");
    // The handwriting size *is* restored, unlike the photo root: a NAS volume path
    // means nothing on another machine, while a type size travels with the journal.
    expect(entries).toEqual([
      { key: "temperature_unit", value: "celsius" },
      { key: "handwriting_size", value: "xl" },
      { key: "review_before_calendar_import", value: "false" },
      // Always written, and defaulted by the schema — so a bundle predating
      // this preference restores 14px, which is what the field used then.
      { key: "content_font_size", value: "sm" },
    ]);
  });

  it("restores a non-default handwriting size", () => {
    const entries = metadataPreferenceEntries(
      bundleOf({
        preferences: {
          defaultLocation: null,
          temperatureUnit: "celsius",
          photoRoot: "",
          handwritingSize: "4xl",
          reviewBeforeCalendarImport: false,
          topicMatchBody: false,
          topicEpisodeGapDays: 14,
          contentFontSize: "sm",
        },
      }),
    );
    expect(entries).toContainEqual({ key: "handwriting_size", value: "4xl" });
  });

  it("restores the floor for a bundle written before the size existed", () => {
    // The compatibility path: an older backup has no `handwritingSize` at all, and
    // the schema's default is what keeps it a legal file rather than a parse error.
    const parsed = journalMetadataBundleSchema.parse({
      format: JOURNAL_METADATA_FORMAT,
      version: JOURNAL_METADATA_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      preferences: { defaultLocation: null, temperatureUnit: "celsius", photoRoot: "" },
    });
    expect(parsed.preferences?.handwritingSize).toBe("xl");
    expect(metadataPreferenceEntries(parsed)).toContainEqual({
      key: "handwriting_size",
      value: "xl",
    });
  });

  it("emits the default location when the bundle has one", () => {
    const entries = metadataPreferenceEntries(bundleOf({ preferences: PREFERENCES }));

    expect(entries).toEqual([
      { key: "temperature_unit", value: "celsius" },
      { key: "handwriting_size", value: "2xl" },
      { key: "review_before_calendar_import", value: "true" },
      { key: "content_text_color", value: "#1A2B3C" },
      { key: "content_font_size", value: "lg" },
      { key: "content_font", value: "inter" },
      { key: "default_latitude", value: "40.7128" },
      { key: "default_longitude", value: "-74.006" },
      { key: "default_location_name", value: "New York" },
    ]);
  });

  it("restores the content text colour, but never the texture pointer", () => {
    const entries = metadataPreferenceEntries(
      bundleOf({
        preferences: {
          defaultLocation: null,
          temperatureUnit: "celsius",
          photoRoot: "",
          handwritingSize: "xl",
          reviewBeforeCalendarImport: false,
          topicMatchBody: false,
          topicEpisodeGapDays: 14,
          contentTextColor: "#ABCDEF",
          contentFontSize: "sm",
        },
      }),
    );

    // The colour travels: it is a reading preference, like the size.
    expect(entries).toContainEqual({ key: "content_text_color", value: "#ABCDEF" });
    // The pointer does not, and there is no bundle field for it to come from —
    // it is a row id in *this* install's texture library, so restoring it
    // elsewhere would select an unrelated picture. Same rule as the photo root.
    expect(entries.map((entry) => entry.key)).not.toContain("content_texture_id");
    // Nor its strength, which only means something alongside a picture.
    expect(entries.map((entry) => entry.key)).not.toContain("content_texture_opacity");
    // The font size DOES travel, which is the contrast that makes the rule
    // legible: a size is a reading preference, a texture pointer is a row id.
    expect(entries.map((entry) => entry.key)).toContain("content_font_size");
  });

  it("restores a content face, and tolerates one this build does not load", () => {
    const parsed = journalMetadataBundleSchema.parse({
      format: JOURNAL_METADATA_FORMAT,
      version: JOURNAL_METADATA_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      preferences: {
        defaultLocation: null,
        temperatureUnit: "celsius",
        photoRoot: "",
        // Not a face this build loads. The bundle must still PARSE — a backup
        // is not worth rejecting over a font — and the read path discards the
        // key, so the field falls back to the theme.
        contentFont: "some-face-from-a-newer-build",
      },
    });
    expect(parsed.preferences?.contentFont).toBe("some-face-from-a-newer-build");
    expect(metadataPreferenceEntries(parsed)).toContainEqual({
      key: "content_font",
      value: "some-face-from-a-newer-build",
    });
    // That the stored row then resolves to the theme rather than a broken
    // family is `preferences.test.ts`'s to prove — see "falls back to the
    // theme for a face this build does not load".
  });

  it("omits the colour row when the bundle has none, rather than writing a blank", () => {
    // A bundle written before the colour existed. The schema has to accept it,
    // and the restore has to leave this machine's own choice alone rather than
    // clearing it — the additive rule the rest of the restore follows.
    const parsed = journalMetadataBundleSchema.parse({
      format: JOURNAL_METADATA_FORMAT,
      version: JOURNAL_METADATA_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      preferences: { defaultLocation: null, temperatureUnit: "celsius", photoRoot: "" },
    });
    const entries = metadataPreferenceEntries(parsed);
    expect(entries.map((entry) => entry.key)).not.toContain("content_text_color");
    expect(entries.every((entry) => entry.value !== "")).toBe(true);
  });

  it("rejects a bundle whose content colour is not #RRGGBB", () => {
    // The value reaches the DOM as a CSS colour, so a hand-edited bundle must
    // fail the parse rather than restore something nobody chose.
    expect(() =>
      journalMetadataBundleSchema.parse({
        format: JOURNAL_METADATA_FORMAT,
        version: JOURNAL_METADATA_FORMAT_VERSION,
        exportedAt: new Date().toISOString(),
        preferences: {
          defaultLocation: null,
          temperatureUnit: "celsius",
          photoRoot: "",
          contentTextColor: "red",
        },
      }),
    ).toThrow();
  });

  it("omits a blank location name rather than storing an empty value", () => {
    const entries = metadataPreferenceEntries(
      bundleOf({
        preferences: {
          defaultLocation: { latitude: 1, longitude: 2, name: "   " },
          temperatureUnit: "fahrenheit",
          photoRoot: "",
          handwritingSize: "xl",
          reviewBeforeCalendarImport: false,
          topicMatchBody: false,
          topicEpisodeGapDays: 14,
          contentFontSize: "sm",
        },
      }),
    );

    expect(entries.map((entry) => entry.key)).not.toContain("default_location_name");
  });
});
