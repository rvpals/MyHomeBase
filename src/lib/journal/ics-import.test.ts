import { describe, expect, it } from "vitest";
import {
  ICS_SOURCE,
  emptyIcsFilter,
  emptyIcsPresets,
  filterIcsEvents,
  icsEventToEntryInput,
  importIcsEvents,
  planIcsImport,
  readIcsFile,
  splitExternalContent,
} from "./ics-import";
import { createEntry, listEntries, setLocked } from "./journal";
import type { JournalRepository } from "./ports";
import type { EntryWriteData } from "./schema";
import type { IcsEvent, JournalEntry } from "./types";

// The port methods this importer actually reaches. Naming them explicitly is
// what keeps parameter types inferred inside the fake — a bare object literal
// cast to JournalRepository at the end would leave every `(id, input)`
// implicitly `any`, and a typo in the fake would then pass the typecheck.
type ImporterRepo = Pick<
  JournalRepository,
  | "listEntries"
  | "getEntryById"
  | "createEntry"
  | "updateEntry"
  | "findEntryIdsBySource"
  | "setEntryLocked"
  | "registerCategoriesIfMissing"
  | "registerTagsIfMissing"
>;

// A minimal in-memory repository — only the entry operations the importer
// touches. Narrower than journal.test.ts's fake on purpose: the parts this
// importer never calls would be dead weight here.
function fakeRepo(): JournalRepository {
  let entries: JournalEntry[] = [];
  let nextId = 1;

  function assemble(id: number, input: EntryWriteData): JournalEntry {
    return {
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
      // Assigned ids and sort order, as the real repository does from array
      // position — the merge hands locations back as inputs, and a fake that
      // dropped them couldn't show them surviving a refresh.
      locations: input.locations.map((location, index) => ({
        id: index + 1,
        entryId: id,
        latitude: location.latitude,
        longitude: location.longitude,
        locationName: location.locationName ?? "",
        sortOrder: index,
      })),
      source: input.source,
      externalId: input.externalId,
      externalContent: input.externalContent,
      createdAt: "2026-09-11 00:00:00",
      updatedAt: "2026-09-11 00:00:00",
    };
  }

  const repo: ImporterRepo = {
    listEntries: () => [...entries],
    getEntryById: (id) => entries.find((entry) => entry.id === id),
    createEntry(input) {
      const entry = assemble(nextId++, input);
      entries.push(entry);
      return entry;
    },
    updateEntry(id, input) {
      const existing = entries.find((entry) => entry.id === id);
      if (!existing) throw new Error(`Entry ${id} not found.`);
      const updated = { ...assemble(id, input), createdAt: existing.createdAt };
      entries = entries.map((entry) => (entry.id === id ? updated : entry));
      return updated;
    },
    findEntryIdsBySource: (source, externalId) =>
      externalId.trim() === "" ? []
      : entries
          .filter((entry) => entry.source === source && entry.externalId === externalId.trim())
          .map((entry) => entry.id)
          .sort((a, b) => a - b),
    setEntryLocked(id, isLocked) {
      const existing = entries.find((entry) => entry.id === id);
      if (!existing) throw new Error(`Entry ${id} not found.`);
      existing.isLocked = isLocked;
      return existing;
    },
    registerCategoriesIfMissing: () => {},
    registerTagsIfMissing: () => {},
  };

  // The cast is confined to this one line, after the literal has been checked
  // against the port's real signatures above.
  return repo as JournalRepository;
}

function event(overrides: Partial<IcsEvent> = {}): IcsEvent {
  return {
    uid: "uid-1@google.com",
    summary: "Skylar swim practice",
    description: "",
    location: "MCCC",
    date: "2026-09-11",
    time: "18:00",
    isAllDay: false,
    endDate: "2026-09-11",
    endTime: "19:30",
    isRecurring: false,
    calendarName: "Family",
    ...overrides,
  };
}

describe("filterIcsEvents", () => {
  const events = [
    event({ uid: "a", summary: "Swim practice", date: "2026-09-01" }),
    event({ uid: "b", summary: "Dentist", date: "2026-09-15" }),
    event({ uid: "c", summary: "Swim meet", date: "2026-10-01", isAllDay: true, time: "" }),
    event({ uid: "d", summary: "", date: "2026-09-20" }),
  ];

  it("returns every event for an empty filter", () => {
    expect(filterIcsEvents(events, emptyIcsFilter())).toHaveLength(4);
  });

  it("narrows to an inclusive date range", () => {
    const result = filterIcsEvents(events, { fromDate: "2026-09-15", toDate: "2026-10-01" });
    expect(result.map((item) => item.uid)).toEqual(["b", "c", "d"]);
  });

  it("treats the bounds as inclusive at both ends", () => {
    const result = filterIcsEvents(events, { fromDate: "2026-09-01", toDate: "2026-09-01" });
    expect(result.map((item) => item.uid)).toEqual(["a"]);
  });

  it("matches a summary substring case-insensitively", () => {
    const result = filterIcsEvents(events, { summaryContains: "swim" });
    expect(result.map((item) => item.uid)).toEqual(["a", "c"]);
  });

  it("excludes a summary substring", () => {
    const result = filterIcsEvents(events, { summaryExcludes: "dentist" });
    expect(result.map((item) => item.uid)).toEqual(["a", "c", "d"]);
  });

  it("drops untitled events when a summary is required", () => {
    const result = filterIcsEvents(events, { requireSummary: true });
    expect(result.map((item) => item.uid)).toEqual(["a", "b", "c"]);
  });

  it("drops all-day events when they are excluded", () => {
    const result = filterIcsEvents(events, { includeAllDay: false });
    expect(result.map((item) => item.uid)).toEqual(["a", "b", "d"]);
  });

  it("combines conditions with AND", () => {
    const result = filterIcsEvents(events, {
      fromDate: "2026-09-01",
      toDate: "2026-09-30",
      summaryContains: "swim",
    });
    expect(result.map((item) => item.uid)).toEqual(["a"]);
  });

  it("returns nothing when no event matches", () => {
    expect(filterIcsEvents(events, { summaryContains: "yoga" })).toEqual([]);
  });
});

describe("icsEventToEntryInput", () => {
  it("maps the calendar fields onto entry fields", () => {
    const input = icsEventToEntryInput(event({ description: "Bring a towel" }), emptyIcsPresets());

    expect(input).toMatchObject({
      date: "2026-09-11",
      time: "18:00",
      title: "Skylar swim practice",
      content: "Bring a towel",
      placeName: "MCCC",
      source: ICS_SOURCE,
      externalId: "uid-1@google.com",
    });
  });

  it("applies preset categories and tags", () => {
    const input = icsEventToEntryInput(event(), {
      categories: ["Log"],
      tags: ["Skylar", "swimming"],
    });

    expect(input.categories).toEqual(["Log"]);
    expect(input.tags).toEqual(["Skylar", "swimming"]);
  });

  it("lets a preset place override the event's location", () => {
    const input = icsEventToEntryInput(event(), {
      categories: [],
      tags: [],
      placeName: "Mercer County Community College",
    });

    expect(input.placeName).toBe("Mercer County Community College");
  });

  it("keeps the event's location when the preset place is blank", () => {
    const input = icsEventToEntryInput(event(), { categories: [], tags: [], placeName: "   " });
    expect(input.placeName).toBe("MCCC");
  });

  it("puts a note prefix above the event's description", () => {
    const input = icsEventToEntryInput(event({ description: "Bring a towel" }), {
      categories: [],
      tags: [],
      notePrefix: "Imported from Family calendar",
    });

    expect(input.content).toBe("Imported from Family calendar\n\nBring a towel");
  });

  it("uses the note prefix alone when the event has no description", () => {
    const input = icsEventToEntryInput(event({ description: "" }), {
      categories: [],
      tags: [],
      notePrefix: "Logged",
    });

    expect(input.content).toBe("Logged");
  });
});

describe("planIcsImport", () => {
  it("plans a create for every unseen event", () => {
    const plan = planIcsImport(fakeRepo(), [event({ uid: "a" }), event({ uid: "b" })]);

    expect(plan.createCount).toBe(2);
    expect(plan.updateCount).toBe(0);
    expect(plan.skipCount).toBe(0);
  });

  it("writes nothing", () => {
    const repo = fakeRepo();
    planIcsImport(repo, [event()]);
    expect(listEntries(repo)).toEqual([]);
  });

  it("plans an update for an event already imported", () => {
    const repo = fakeRepo();
    importIcsEvents(repo, [event({ uid: "a" })]);

    const plan = planIcsImport(repo, [event({ uid: "a" })]);

    expect(plan.updateCount).toBe(1);
    expect(plan.createCount).toBe(0);
    expect(plan.rows[0].entryId).toBe(1);
  });

  it("skips an event the reader did not select", () => {
    const plan = planIcsImport(
      fakeRepo(),
      [event({ uid: "a" }), event({ uid: "b" })],
      emptyIcsPresets(),
      [0],
    );

    expect(plan.createCount).toBe(1);
    expect(plan.skipCount).toBe(1);
    expect(plan.rows[1].blockedReason).toBe("Not selected");
  });

  it("skips a locked entry rather than overwriting it", () => {
    const repo = fakeRepo();
    importIcsEvents(repo, [event({ uid: "a" })]);
    setLocked(repo, 1, true);

    const plan = planIcsImport(repo, [event({ uid: "a" })]);

    expect(plan.skipCount).toBe(1);
    expect(plan.rows[0].blockedReason).toContain("Locked");
  });

  it("skips a second event sharing a UID within one file", () => {
    const plan = planIcsImport(fakeRepo(), [
      event({ uid: "same", summary: "First" }),
      event({ uid: "same", summary: "A recurrence exception" }),
    ]);

    expect(plan.createCount).toBe(1);
    expect(plan.skipCount).toBe(1);
    expect(plan.rows[1].blockedReason).toContain("shares its UID");
  });

  it("skips an event with no usable date", () => {
    const plan = planIcsImport(fakeRepo(), [event({ date: "" })]);

    expect(plan.skipCount).toBe(1);
    expect(plan.rows[0].blockedReason).toContain("no usable start date");
  });
});

describe("importIcsEvents", () => {
  it("creates an entry per event", () => {
    const repo = fakeRepo();
    const summary = importIcsEvents(repo, [event({ uid: "a" }), event({ uid: "b" })]);

    expect(summary.importedCount).toBe(2);
    expect(listEntries(repo)).toHaveLength(2);
  });

  it("stamps every imported entry with its source and UID", () => {
    const repo = fakeRepo();
    importIcsEvents(repo, [event({ uid: "abc@google.com" })]);

    const [entry] = listEntries(repo);
    expect(entry.source).toBe(ICS_SOURCE);
    expect(entry.externalId).toBe("abc@google.com");
  });

  it("applies the presets to each imported entry", () => {
    const repo = fakeRepo();
    importIcsEvents(repo, [event()], { categories: ["Log"], tags: ["Skylar"] });

    const [entry] = listEntries(repo);
    expect(entry.categories).toEqual(["Log"]);
    expect(entry.tags).toEqual(["Skylar"]);
  });

  // The whole point of external_id: re-importing the same export must not
  // double the journal.
  it("is idempotent — re-importing the same file adds nothing", () => {
    const repo = fakeRepo();
    const events = [event({ uid: "a" }), event({ uid: "b" })];

    importIcsEvents(repo, events);
    const second = importIcsEvents(repo, events);

    expect(second.importedCount).toBe(0);
    expect(second.updatedCount).toBe(2);
    expect(listEntries(repo)).toHaveLength(2);
  });

  it("refreshes a renamed or rescheduled event in place", () => {
    const repo = fakeRepo();
    importIcsEvents(repo, [event({ uid: "a", summary: "Swim practice", time: "18:00" })]);

    importIcsEvents(repo, [
      event({ uid: "a", summary: "Skylar swim practice", time: "18:30" }),
    ]);

    const entries = listEntries(repo);
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe("Skylar swim practice");
    expect(entries[0].time).toBe("18:30");
  });

  // No UID means no identity to match on, so it imports but can't be tracked.
  it("imports an event without a UID, and does so again on re-import", () => {
    const repo = fakeRepo();
    importIcsEvents(repo, [event({ uid: "" })]);
    importIcsEvents(repo, [event({ uid: "" })]);

    expect(listEntries(repo)).toHaveLength(2);
  });

  it("imports only the selected events", () => {
    const repo = fakeRepo();
    const summary = importIcsEvents(
      repo,
      [event({ uid: "a" }), event({ uid: "b" }), event({ uid: "c" })],
      emptyIcsPresets(),
      [0, 2],
    );

    expect(summary.importedCount).toBe(2);
    expect(summary.skippedCount).toBe(1);
    expect(listEntries(repo).map((entry) => entry.externalId)).toEqual(["a", "c"]);
  });

  it("leaves a locked entry untouched", () => {
    const repo = fakeRepo();
    importIcsEvents(repo, [event({ uid: "a", summary: "Original" })]);
    setLocked(repo, 1, true);

    const summary = importIcsEvents(repo, [event({ uid: "a", summary: "Changed" })]);

    expect(summary.skippedCount).toBe(1);
    expect(listEntries(repo)[0].title).toBe("Original");
  });

  it("records a failing event without aborting the rest", () => {
    const repo = fakeRepo();
    // An invalid date fails createEntrySchema, so this one event throws while
    // the others around it still import.
    const summary = importIcsEvents(repo, [
      event({ uid: "a" }),
      event({ uid: "bad", date: "11/09/2026" }),
      event({ uid: "c" }),
    ]);

    expect(summary.importedCount).toBe(2);
    expect(summary.skippedCount).toBe(1);
  });

  it("imports nothing from an empty event list", () => {
    const repo = fakeRepo();
    const summary = importIcsEvents(repo, []);

    expect(summary.importedCount).toBe(0);
    expect(listEntries(repo)).toEqual([]);
  });

  it("does not collide with a hand-written entry carrying no external id", () => {
    const repo = fakeRepo();
    createEntry(repo, { date: "2026-09-11", title: "Written by hand" });

    importIcsEvents(repo, [event({ uid: "a" })]);

    expect(listEntries(repo)).toHaveLength(2);
  });
});

describe("readIcsFile", () => {
  const file = [
    "BEGIN:VCALENDAR",
    "X-WR-CALNAME:Family",
    "BEGIN:VEVENT",
    "UID:a@google.com",
    "DTSTART:20260911",
    "SUMMARY:Swim practice",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:b@google.com",
    "DTSTART:20261225",
    "SUMMARY:Christmas",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  it("parses and reports the totals", () => {
    const result = readIcsFile(file);

    expect(result.totalCount).toBe(2);
    expect(result.events).toHaveLength(2);
    expect(result.skippedCount).toBe(0);
    expect(result.calendarName).toBe("Family");
  });

  it("applies the filter while reporting the unfiltered total", () => {
    const result = readIcsFile(file, { summaryContains: "swim" });

    expect(result.totalCount).toBe(2);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].summary).toBe("Swim practice");
  });
});

describe("splitExternalContent", () => {
  it("treats everything as the reader's when nothing external is remembered", () => {
    // The pre-0089 entry. Reading it the other way would delete exactly the
    // notes the column exists to protect, on the very first refresh.
    // `known: false` is what stops the caller prepending the calendar's text on
    // top of content that may already hold a copy of it.
    expect(splitExternalContent("Skylar got a PB!", "")).toEqual({
      local: "Skylar got a PB!",
      known: false,
    });
  });

  it("returns nothing local when the content is only the calendar's text", () => {
    expect(splitExternalContent("Bring a towel", "Bring a towel")).toEqual({
      local: "",
      known: true,
    });
  });

  it("strips the calendar's text and the joining blank line", () => {
    expect(splitExternalContent("Bring a towel\n\nSkylar got a PB!", "Bring a towel")).toEqual({
      local: "Skylar got a PB!",
      known: true,
    });
  });

  it("keeps the reader's multi-paragraph note intact", () => {
    expect(splitExternalContent("Desc\n\nFirst para.\n\nSecond para.", "Desc")).toEqual({
      local: "First para.\n\nSecond para.",
      known: true,
    });
  });

  // The reader edited the calendar's half too, so the importer can't tell which
  // words were once its own. Their version wins whole, and is left alone.
  it("keeps the whole content when the remembered text no longer matches", () => {
    expect(splitExternalContent("I rewrote this entirely", "Bring a towel")).toEqual({
      local: "I rewrote this entirely",
      known: false,
    });
  });

  it("handles an empty content", () => {
    // "" doesn't start with the remembered text, so the split isn't known — but
    // there is nothing to lose either way.
    expect(splitExternalContent("", "Bring a towel")).toEqual({ local: "", known: false });
    expect(splitExternalContent("", "")).toEqual({ local: "", known: false });
  });
});

describe("importIcsEvents — keeping the reader's own fields", () => {
  /**
   * Imports one event, then edits the stored entry the way a reader would.
   *
   * The edit goes through the repository directly: what this suite tests is what
   * a *re-import* does to an already-edited entry, not the editing itself.
   */
  function importThenEdit(
    repo: JournalRepository,
    first: IcsEvent,
    edit: (entry: JournalEntry) => Partial<JournalEntry>,
  ): void {
    importIcsEvents(repo, [first], { categories: ["Log"], tags: [] });
    const [stored] = listEntries(repo);
    const patch = edit(stored);
    repo.updateEntry(stored.id, {
      date: patch.date ?? stored.date,
      time: patch.time ?? stored.time,
      title: patch.title ?? stored.title,
      content: patch.content ?? stored.content,
      placeName: patch.placeName ?? stored.placeName,
      weather: patch.weather ?? stored.weather,
      isPinned: patch.isPinned ?? stored.isPinned,
      isLocked: patch.isLocked ?? stored.isLocked,
      categories: patch.categories ?? stored.categories,
      tags: patch.tags ?? stored.tags,
      locations: (patch.locations ?? stored.locations).map((location) => ({
        latitude: location.latitude,
        longitude: location.longitude,
        locationName: location.locationName,
      })),
      source: stored.source,
      externalId: stored.externalId,
      externalContent: stored.externalContent,
    });
  }

  it("keeps a note typed under the calendar's description", () => {
    const repo = fakeRepo();
    importThenEdit(repo, event({ uid: "a", description: "Bring a towel" }), (stored) => ({
      content: `${stored.content}\n\nSkylar got a PB!`,
    }));

    importIcsEvents(repo, [event({ uid: "a", description: "Bring a towel" })], {
      categories: ["Log"],
      tags: [],
    });

    expect(listEntries(repo)[0].content).toBe("Bring a towel\n\nSkylar got a PB!");
  });

  it("updates the calendar's half while keeping the reader's", () => {
    const repo = fakeRepo();
    importThenEdit(repo, event({ uid: "a", description: "Bring a towel" }), (stored) => ({
      content: `${stored.content}\n\nSkylar got a PB!`,
    }));

    importIcsEvents(repo, [event({ uid: "a", description: "Bring a towel and goggles" })], {
      categories: ["Log"],
      tags: [],
    });

    expect(listEntries(repo)[0].content).toBe("Bring a towel and goggles\n\nSkylar got a PB!");
  });

  it("still overwrites the fields the calendar owns", () => {
    const repo = fakeRepo();
    importThenEdit(repo, event({ uid: "a" }), (stored) => ({
      content: `${stored.content}\n\nmy note`,
    }));

    importIcsEvents(
      repo,
      [event({ uid: "a", summary: "Renamed practice", time: "19:00", location: "Pool B" })],
      { categories: ["Log"], tags: [] },
    );

    const [entry] = listEntries(repo);
    expect(entry.title).toBe("Renamed practice");
    expect(entry.time).toBe("19:00");
    expect(entry.placeName).toBe("Pool B");
  });

  it("keeps a tag the reader added by hand, and re-adds the presets", () => {
    const repo = fakeRepo();
    importThenEdit(repo, event({ uid: "a" }), (stored) => ({
      tags: [...stored.tags, "personal-best"],
    }));

    importIcsEvents(repo, [event({ uid: "a" })], { categories: ["Log"], tags: ["swimming"] });

    const [entry] = listEntries(repo);
    expect(entry.tags).toContain("personal-best");
    expect(entry.tags).toContain("swimming");
    expect(entry.categories).toContain("Log");
  });

  it("does not duplicate a tag that is both stored and a preset", () => {
    const repo = fakeRepo();
    importIcsEvents(repo, [event({ uid: "a" })], { categories: ["Log"], tags: ["swimming"] });
    importIcsEvents(repo, [event({ uid: "a" })], { categories: ["Log"], tags: ["swimming"] });

    const [entry] = listEntries(repo);
    expect(entry.tags).toEqual(["swimming"]);
    expect(entry.categories).toEqual(["Log"]);
  });

  it("keeps the reader's pin", () => {
    const repo = fakeRepo();
    importThenEdit(repo, event({ uid: "a" }), () => ({ isPinned: true }));

    importIcsEvents(repo, [event({ uid: "a" })], { categories: ["Log"], tags: [] });

    expect(listEntries(repo)[0].isPinned).toBe(true);
  });

  it("keeps the reader's GPS locations", () => {
    const repo = fakeRepo();
    importThenEdit(repo, event({ uid: "a" }), () => ({
      locations: [
        {
          id: 1,
          entryId: 1,
          latitude: 40.28,
          longitude: -74.68,
          locationName: "MCCC",
          sortOrder: 0,
        },
      ],
    }));

    importIcsEvents(repo, [event({ uid: "a" })], { categories: ["Log"], tags: [] });

    expect(listEntries(repo)[0].locations).toHaveLength(1);
  });

  // An entry imported before 0089 has no remembered external text, so the whole
  // of its content is read as the reader's and survives its first refresh.
  it("keeps the whole content of an entry imported before the column existed", () => {
    const repo = fakeRepo();
    importIcsEvents(repo, [event({ uid: "a", description: "Bring a towel" })]);
    const [stored] = listEntries(repo);
    repo.updateEntry(stored.id, {
      date: stored.date,
      time: stored.time,
      title: stored.title,
      content: "Bring a towel\n\nmy irreplaceable note",
      placeName: stored.placeName,
      isPinned: stored.isPinned,
      isLocked: stored.isLocked,
      categories: stored.categories,
      tags: stored.tags,
      locations: [],
      source: stored.source,
      externalId: stored.externalId,
      // The pre-0089 row: content present, nothing remembered.
      externalContent: "",
    });

    importIcsEvents(repo, [event({ uid: "a", description: "Bring a towel" })]);

    expect(listEntries(repo)[0].content).toBe("Bring a towel\n\nmy irreplaceable note");
  });

  it("replaces the whole entry when the option is off", () => {
    const repo = fakeRepo();
    importThenEdit(repo, event({ uid: "a", description: "Bring a towel" }), (stored) => ({
      content: `${stored.content}\n\nSkylar got a PB!`,
      isPinned: true,
      tags: ["personal-best"],
    }));

    importIcsEvents(repo, [event({ uid: "a", description: "Bring a towel" })], {
      categories: ["Log"],
      tags: [],
      preserveLocalEdits: false,
    });

    const [entry] = listEntries(repo);
    expect(entry.content).toBe("Bring a towel");
    expect(entry.isPinned).toBe(false);
    expect(entry.tags).toEqual([]);
  });

  it("records the calendar's text so the next refresh can split again", () => {
    const repo = fakeRepo();
    importIcsEvents(repo, [event({ uid: "a", description: "Bring a towel" })]);

    expect(listEntries(repo)[0].externalContent).toBe("Bring a towel");
  });

  it("survives three rounds of refresh without accumulating copies", () => {
    const repo = fakeRepo();
    importThenEdit(repo, event({ uid: "a", description: "Desc v1" }), (stored) => ({
      content: `${stored.content}\n\nmy note`,
    }));

    importIcsEvents(repo, [event({ uid: "a", description: "Desc v2" })]);
    importIcsEvents(repo, [event({ uid: "a", description: "Desc v3" })]);

    const [entry] = listEntries(repo);
    expect(entry.content).toBe("Desc v3\n\nmy note");
    expect(listEntries(repo)).toHaveLength(1);
  });

  // The prefix is part of what the importer wrote, so it is replaced along with
  // the rest of the external half rather than being mistaken for the reader's.
  it("includes the note prefix in what it remembers as the calendar's half", () => {
    const repo = fakeRepo();
    importThenEdit(repo, event({ uid: "a", description: "Bring a towel" }), (stored) => ({
      content: `${stored.content}\n\nmy note`,
    }));

    importIcsEvents(repo, [event({ uid: "a", description: "Bring a towel" })], {
      categories: [],
      tags: [],
      notePrefix: "From Family calendar",
    });

    const [entry] = listEntries(repo);
    expect(entry.content).toBe("From Family calendar\n\nBring a towel\n\nmy note");
  });
});
