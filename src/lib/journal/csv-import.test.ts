import { describe, expect, it } from "vitest";
import { importJournalCsv } from "./csv-import";
import type { JournalRepository } from "./ports";
import type { EntryLocation, JournalCategory, JournalEntry, JournalTag } from "./types";

// Minimal in-memory JournalRepository — enough for createEntry (which the
// importer drives) and for reading entries back to assert on parsed fields.
function fakeRepo(): JournalRepository {
  let entries: JournalEntry[] = [];
  const categories: JournalCategory[] = [];
  const tags: JournalTag[] = [];
  let nextEntryId = 1;
  let nextLocationId = 1;
  const now = "2026-01-01T00:00:00.000Z";

  return {
    listEntries: () => [...entries],
    listRecentEntries: (limit) => [...entries].slice(0, limit),
    listEntriesByMonthDay: (monthDay) => entries.filter((entry) => entry.date.slice(5) === monthDay),
    getEntryById: (id) => entries.find((entry) => entry.id === id),
    getEntryNeighbors: () => ({}),
    createEntry(input) {
      const id = nextEntryId++;
      const locations: EntryLocation[] = input.locations.map((location, index) => ({
        id: nextLocationId++,
        entryId: id,
        latitude: location.latitude,
        longitude: location.longitude,
        locationName: location.locationName,
        sortOrder: index,
      }));
      const entry: JournalEntry = {
        id,
        date: input.date,
        time: input.time,
        title: input.title,
        content: input.content,
        placeName: input.placeName,
        weather: input.weather,
        isPinned: input.isPinned,
        isLocked: input.isLocked,
        categories: [...input.categories],
        tags: [...input.tags],
        locations,
        createdAt: now,
        updatedAt: now,
      };
      entries.push(entry);
      return entry;
    },
    updateEntry: () => {
      throw new Error("not used");
    },
    deleteEntry(id) {
      entries = entries.filter((entry) => entry.id !== id);
    },
    setEntryPinned: () => {
      throw new Error("not used");
    },
    setEntryLocked: () => {
      throw new Error("not used");
    },
    listCategories: () => [...categories],
    getCategoryByName: (name) => categories.find((category) => category.name === name),
    upsertCategory: () => {
      throw new Error("not used");
    },
    deleteCategory: () => {
      throw new Error("not used");
    },
    listTags: () => [...tags],
    getTagByName: (name) => tags.find((tag) => tag.name === name),
    upsertTag: () => {
      throw new Error("not used");
    },
    deleteTag: () => {
      throw new Error("not used");
    },
    registerCategoriesIfMissing(names) {
      for (const name of names) {
        if (!categories.some((category) => category.name === name)) {
          categories.push({ name, description: "", createdAt: now, updatedAt: now });
        }
      }
    },
    registerTagsIfMissing(names) {
      for (const name of names) {
        if (!tags.some((tag) => tag.name === name)) {
          tags.push({ name, description: "", createdAt: now, updatedAt: now });
        }
      }
    },
  };
}

// Mirrors the real export's column order.
const HEADER = "Date,Time,Category,Tags,Places,Place name,People,Title,Content";
const MAPPING = {
  "0": "date",
  "1": "time",
  "2": "categories",
  "3": "tags",
  "4": "locations",
  "5": "placeName",
  "6": "tags", // People also feeds tags
  "7": "title",
  "8": "content",
};
const OPTIONS = {
  "0": { dateFormat: "M/D/YY" },
  "2": { delimiter: "," }, // categories are comma-separated
  "3": { delimiter: " " }, // tags are space-separated
  "6": { delimiter: "," }, // people are comma-separated
};

describe("importJournalCsv", () => {
  it("imports a row applying every field rule", () => {
    const csv =
      `${HEADER}\n` +
      `"4/27/26","13:45:00","FAMILY, MEDICAL","Shufen Medical","40.34,-74.46, 41.0,-75.0","Dr Office","Liang, Ting","A title","Line one\nLine two"`;
    const repo = fakeRepo();

    const summary = importJournalCsv(repo, csv, MAPPING, OPTIONS);

    expect(summary.importedCount).toBe(1);
    expect(summary.skippedCount).toBe(0);

    const [entry] = repo.listEntries();
    expect(entry.date).toBe("2026-04-27"); // M/D/YY -> ISO
    expect(entry.time).toBe("13:45:00"); // kept for fidelity
    expect(entry.categories).toEqual(["FAMILY", "MEDICAL"]); // comma split
    // Tags (space split) merged with People (comma split), de-duped by createEntry.
    expect(entry.tags).toEqual(["Shufen", "Medical", "Liang", "Ting"]);
    expect(entry.placeName).toBe("Dr Office");
    expect(entry.locations).toHaveLength(2); // two lat,lng pairs
    expect(entry.locations[0]).toMatchObject({ latitude: 40.34, longitude: -74.46 });
    expect(entry.content).toContain("Line one\nLine two"); // multi-line content preserved
  });

  it("is best-effort: it imports good rows and records bad ones", () => {
    const csv =
      `${HEADER}\n` +
      `"4/27/26","","FAMILY","Trip","","","","Good row",""\n` +
      `"not a date","","FAMILY","Trip","","","","Bad date",""`;
    const repo = fakeRepo();

    const summary = importJournalCsv(repo, csv, MAPPING, OPTIONS);

    expect(summary.importedCount).toBe(1);
    expect(summary.skippedCount).toBe(1);
    expect(summary.results.find((result) => result.status === "skipped")?.rowNumber).toBe(3);
  });

  it("skips fully-blank lines without counting them as failures", () => {
    const csv = `${HEADER}\n` + `"4/27/26","","FAMILY","Trip","","","","Row","",\n` + `\n`;
    const repo = fakeRepo();

    const summary = importJournalCsv(repo, csv, MAPPING, OPTIONS);

    expect(summary.importedCount).toBe(1);
    expect(summary.skippedCount).toBe(0);
  });
});
