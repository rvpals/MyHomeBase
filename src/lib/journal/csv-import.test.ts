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
    listEntriesInDateRange: (startDate, endDate) =>
      entries.filter((entry) => entry.date >= startDate && entry.date <= endDate),
    searchEntries: () => {
      throw new Error("not used");
    },
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
    // Mirrors the SQL in repository.ts: exact date and time, title trimmed on
    // both sides, case significant.
    countEntriesMatching: (key) =>
      entries.filter(
        (entry) =>
          entry.date === key.date &&
          entry.time === key.time &&
          entry.title.trim() === key.title.trim(),
      ).length,
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
    findEntries: () => {
      throw new Error("not used");
    },
    listFilters: () => {
      throw new Error("not used");
    },
    getFilterById: () => {
      throw new Error("not used");
    },
    saveFilter: () => {
      throw new Error("not used");
    },
    deleteFilter: () => {
      throw new Error("not used");
    },
    getCategoryIcon: () => {
      throw new Error("not used");
    },
    setCategoryIcon: () => {
      throw new Error("not used");
    },
    listTags: () => [...tags],
    getTagByName: (name) => tags.find((tag) => tag.name === name),
    upsertTag: () => {
      throw new Error("not used");
    },
    getTagIcon: () => {
      throw new Error("not used");
    },
    setTagIcon: () => {
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
    listTopTags: () => {
      throw new Error("not used");
    },
    listTopCategories: () => {
      throw new Error("not used");
    },
    // Prefill templates are covered in prefill.test.ts; the importer never
    // touches them, so these only satisfy the port.
    listPrefillTemplates: () => {
      throw new Error("not used");
    },
    getPrefillTemplateById: () => {
      throw new Error("not used");
    },
    getPrefillTemplateByName: () => {
      throw new Error("not used");
    },
    savePrefillTemplate: () => {
      throw new Error("not used");
    },
    deletePrefillTemplate: () => {
      throw new Error("not used");
    },
    setPrefillTemplateEnabled: () => {
      throw new Error("not used");
    },
    listDistinctFieldValues: () => {
      throw new Error("not used");
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

  // Duplicate detection matches on date + time + title. Content is deliberately
  // NOT part of the key, and the check counts rather than tests a boolean so a
  // file may legitimately hold several rows sharing one key.
  describe("duplicate detection", () => {
    // One row: 4/27/26, 13:45, title "A title".
    const row = (title: string, content = "Body", time = "13:45") =>
      `"4/27/26","${time}","FAMILY","Trip","","","","${title}","${content}"`;

    it("re-importing the same file imports nothing the second time", () => {
      const csv = `${HEADER}\n${row("A title")}\n${row("Another")}`;
      const repo = fakeRepo();

      const first = importJournalCsv(repo, csv, MAPPING, OPTIONS);
      const second = importJournalCsv(repo, csv, MAPPING, OPTIONS);

      expect(first).toMatchObject({ importedCount: 2, skippedCount: 0 });
      expect(second).toMatchObject({ importedCount: 0, skippedCount: 2 });
      expect(repo.listEntries()).toHaveLength(2);
    });

    it("names the reason so a skip is never a mystery", () => {
      const csv = `${HEADER}\n${row("A title")}`;
      const repo = fakeRepo();

      importJournalCsv(repo, csv, MAPPING, OPTIONS);
      const summary = importJournalCsv(repo, csv, MAPPING, OPTIONS);

      expect(summary.results).toEqual([
        { rowNumber: 2, status: "skipped", reason: "Duplicate of an existing entry" },
      ]);
    });

    // The reason countEntriesMatching returns a count and not a boolean: three
    // rows sharing a key are three legitimate entries, and a re-import of the
    // same file must still add none of them.
    it("imports every copy of a repeated key, then none on re-import", () => {
      const csv = `${HEADER}\n${row("Gym")}\n${row("Gym")}\n${row("Gym")}`;
      const repo = fakeRepo();

      const first = importJournalCsv(repo, csv, MAPPING, OPTIONS);
      const second = importJournalCsv(repo, csv, MAPPING, OPTIONS);

      expect(first).toMatchObject({ importedCount: 3, skippedCount: 0 });
      expect(second).toMatchObject({ importedCount: 0, skippedCount: 3 });
      expect(repo.listEntries()).toHaveLength(3);
    });

    it("imports the shortfall when the file holds more copies than are stored", () => {
      const repo = fakeRepo();
      importJournalCsv(repo, `${HEADER}\n${row("Gym")}`, MAPPING, OPTIONS);

      // The file now has two copies; one is already stored, so one is new.
      const summary = importJournalCsv(
        repo,
        `${HEADER}\n${row("Gym")}\n${row("Gym")}`,
        MAPPING,
        OPTIONS,
      );

      expect(summary).toMatchObject({ importedCount: 1, skippedCount: 1 });
      expect(repo.listEntries()).toHaveLength(2);
    });

    it("treats a different title as a different entry", () => {
      const repo = fakeRepo();
      importJournalCsv(repo, `${HEADER}\n${row("Morning")}`, MAPPING, OPTIONS);

      const summary = importJournalCsv(repo, `${HEADER}\n${row("Evening")}`, MAPPING, OPTIONS);

      expect(summary).toMatchObject({ importedCount: 1, skippedCount: 0 });
    });

    it("treats a different time as a different entry", () => {
      const repo = fakeRepo();
      importJournalCsv(repo, `${HEADER}\n${row("Gym", "Body", "07:00")}`, MAPPING, OPTIONS);

      const summary = importJournalCsv(
        repo,
        `${HEADER}\n${row("Gym", "Body", "19:00")}`,
        MAPPING,
        OPTIONS,
      );

      expect(summary).toMatchObject({ importedCount: 1, skippedCount: 0 });
    });

    // The deliberate consequence of excluding content from the key: an edited
    // body does not import a second copy, and does not overwrite the stored one.
    it("skips a row whose content changed but whose date, time and title did not", () => {
      const repo = fakeRepo();
      importJournalCsv(repo, `${HEADER}\n${row("Gym", "Ran 5k")}`, MAPPING, OPTIONS);

      const summary = importJournalCsv(repo, `${HEADER}\n${row("Gym", "Ran 10k")}`, MAPPING, OPTIONS);

      expect(summary).toMatchObject({ importedCount: 0, skippedCount: 1 });
      expect(repo.listEntries()).toHaveLength(1);
      expect(repo.listEntries()[0].content).toBe("Ran 5k"); // never overwritten
    });

    it("matches a title that differs only by surrounding whitespace", () => {
      const repo = fakeRepo();
      importJournalCsv(repo, `${HEADER}\n${row("Gym")}`, MAPPING, OPTIONS);

      const summary = importJournalCsv(repo, `${HEADER}\n${row("  Gym  ")}`, MAPPING, OPTIONS);

      expect(summary).toMatchObject({ importedCount: 0, skippedCount: 1 });
    });

    it("treats a title differing only in case as a different entry", () => {
      const repo = fakeRepo();
      importJournalCsv(repo, `${HEADER}\n${row("Gym")}`, MAPPING, OPTIONS);

      const summary = importJournalCsv(repo, `${HEADER}\n${row("gym")}`, MAPPING, OPTIONS);

      expect(summary).toMatchObject({ importedCount: 1, skippedCount: 0 });
    });

    // Untimed AND untitled rows share one key, which is exactly the case a
    // boolean check would have collapsed to a single entry.
    it("handles untimed, untitled rows by count", () => {
      const untitled = `"4/27/26","","FAMILY","Trip","","","","",""`;
      const repo = fakeRepo();

      const first = importJournalCsv(repo, `${HEADER}\n${untitled}\n${untitled}`, MAPPING, OPTIONS);
      const second = importJournalCsv(repo, `${HEADER}\n${untitled}\n${untitled}`, MAPPING, OPTIONS);

      expect(first).toMatchObject({ importedCount: 2, skippedCount: 0 });
      expect(second).toMatchObject({ importedCount: 0, skippedCount: 2 });
    });

    it("imports duplicates anyway when skipDuplicates is false", () => {
      const csv = `${HEADER}\n${row("A title")}`;
      const repo = fakeRepo();

      importJournalCsv(repo, csv, MAPPING, OPTIONS);
      const summary = importJournalCsv(repo, csv, MAPPING, OPTIONS, { skipDuplicates: false });

      expect(summary).toMatchObject({ importedCount: 1, skippedCount: 0 });
      expect(repo.listEntries()).toHaveLength(2);
    });

    it("still records a genuinely bad row as skipped while deduping", () => {
      const repo = fakeRepo();
      importJournalCsv(repo, `${HEADER}\n${row("Gym")}`, MAPPING, OPTIONS);

      const summary = importJournalCsv(
        repo,
        `${HEADER}\n${row("Gym")}\n"not a date","","","","","","","Bad",""`,
        MAPPING,
        OPTIONS,
      );

      expect(summary.importedCount).toBe(0);
      expect(summary.skippedCount).toBe(2);
      expect(summary.results.map((result) => result.reason)).toEqual([
        "Duplicate of an existing entry",
        expect.stringContaining("date"),
      ]);
    });
  });
});
