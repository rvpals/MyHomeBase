import { describe, expect, it } from "vitest";
import {
  SAME_DATE_EXCERPT_WORDS,
  countSameDateEntries,
  findSameDateGroups,
  mergeEntryDraft,
  toSameDateRows,
} from "./same-date";
import type { JournalEntry } from "./types";

function entry(overrides: Partial<JournalEntry> & { id: number }): JournalEntry {
  return {
    date: "2026-01-01",
    time: "",
    title: "Untitled",
    content: "",
    placeName: "",
    isPinned: false,
    isLocked: false,
    categories: [],
    tags: [],
    locations: [],
    source: "",
    externalId: "",
    externalContent: "",
    createdAt: "2026-01-01 08:00:00",
    updatedAt: "2026-01-01 08:00:00",
    ...overrides,
  };
}

describe("findSameDateGroups", () => {
  it("groups entries sharing a date regardless of title or time", () => {
    const groups = findSameDateGroups([
      entry({ id: 1, date: "2026-03-14", time: "09:00", title: "Morning run" }),
      entry({ id: 2, date: "2026-03-14", time: "21:30", title: "Dinner with Anna" }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].date).toBe("2026-03-14");
    expect(groups[0].entries.map((item) => item.id)).toEqual([1, 2]);
  });

  it("drops a date carrying only one entry", () => {
    const groups = findSameDateGroups([
      entry({ id: 1, date: "2026-03-14" }),
      entry({ id: 2, date: "2026-03-15" }),
    ]);

    expect(groups).toEqual([]);
  });

  it("keeps untitled entries — the opposite of findDuplicateGroups", () => {
    // The load-bearing difference from duplicates.ts. An untitled entry sitting
    // on a crowded date is the best merge candidate on the screen, so it must
    // not be filtered out the way the title-keyed grouping filters it.
    const groups = findSameDateGroups([
      entry({ id: 1, date: "2026-03-14", time: "08:00", title: "" }),
      entry({ id: 2, date: "2026-03-14", time: "09:00", title: "   " }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].entries.map((item) => item.id)).toEqual([1, 2]);
  });

  it("orders entries within a date by time, then by id when the time ties", () => {
    const groups = findSameDateGroups([
      entry({ id: 7, date: "2026-03-14", time: "21:30" }),
      entry({ id: 3, date: "2026-03-14", time: "09:00" }),
      entry({ id: 2, date: "2026-03-14", time: "09:00" }),
    ]);

    expect(groups[0].entries.map((item) => item.id)).toEqual([2, 3, 7]);
  });

  it("sorts an entry with no time first, so the day still reads in order", () => {
    const groups = findSameDateGroups([
      entry({ id: 1, date: "2026-03-14", time: "09:00" }),
      entry({ id: 2, date: "2026-03-14", time: "" }),
    ]);

    expect(groups[0].entries.map((item) => item.id)).toEqual([2, 1]);
  });

  it("returns groups newest date first", () => {
    const groups = findSameDateGroups([
      entry({ id: 1, date: "2025-01-02" }),
      entry({ id: 2, date: "2025-01-02" }),
      entry({ id: 3, date: "2026-07-09" }),
      entry({ id: 4, date: "2026-07-09" }),
    ]);

    expect(groups.map((group) => group.date)).toEqual(["2026-07-09", "2025-01-02"]);
  });

  it("cuts each entry's excerpt to the word limit and marks the cut", () => {
    const content = Array.from({ length: 140 }, (_, index) => `w${index}`).join(" ");
    const groups = findSameDateGroups([
      entry({ id: 1, date: "2026-03-14", content }),
      entry({ id: 2, date: "2026-03-14", content: "short one" }),
    ]);

    const [long, short] = groups[0].entries;
    expect(long.excerpt.endsWith("…")).toBe(true);
    expect(long.excerpt.replace("…", "").split(" ")).toHaveLength(SAME_DATE_EXCERPT_WORDS);
    expect(short.excerpt).toBe("short one");
  });

  it("flags which entries are Log entries, for the list's badge", () => {
    // Carried on the row because the view never sees `categories` — only these
    // trimmed fields cross to the client.
    const groups = findSameDateGroups([
      entry({ id: 1, date: "2026-03-14", time: "09:00", categories: ["Log"] }),
      entry({ id: 2, date: "2026-03-14", time: "12:00", categories: ["FAMILY"] }),
      entry({ id: 3, date: "2026-03-14", time: "18:00", categories: ["Travel", "log"] }),
      entry({ id: 4, date: "2026-03-14", time: "21:00", categories: [] }),
    ]);

    expect(groups[0].entries.map((item) => item.isLog)).toEqual([true, false, true, false]);
  });

  it("returns nothing for an empty journal", () => {
    expect(findSameDateGroups([])).toEqual([]);
  });
});

describe("findSameDateGroups with logOnly", () => {
  // The Log category is what makes an entry a logged activity — see
  // LOG_CATEGORY_NAME and isLogEntry.
  const log = (overrides: Partial<JournalEntry> & { id: number }) =>
    entry({ categories: ["Log"], ...overrides });

  it("keeps a date whose Log entries number two or more", () => {
    const groups = findSameDateGroups(
      [
        log({ id: 1, date: "2026-03-14", time: "09:00" }),
        log({ id: 2, date: "2026-03-14", time: "12:00" }),
      ],
      { logOnly: true },
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].entries.map((item) => item.id)).toEqual([1, 2]);
  });

  it("drops the non-Log entries from a mixed date", () => {
    const groups = findSameDateGroups(
      [
        log({ id: 1, date: "2026-03-14", time: "09:00" }),
        entry({ id: 2, date: "2026-03-14", time: "12:00", categories: ["FAMILY"] }),
        log({ id: 3, date: "2026-03-14", time: "18:00" }),
      ],
      { logOnly: true },
    );

    expect(groups[0].entries.map((item) => item.id)).toEqual([1, 3]);
  });

  it("filters before grouping, so a lone Log entry beside written ones is not a group", () => {
    // The load-bearing case for the toggle. Filtering *after* grouping would
    // leave this date in with a single member, reading "1 of 1".
    const groups = findSameDateGroups(
      [
        log({ id: 1, date: "2026-03-14", time: "09:00" }),
        entry({ id: 2, date: "2026-03-14", time: "12:00", categories: ["FAMILY"] }),
        entry({ id: 3, date: "2026-03-14", time: "18:00", categories: ["WORK"] }),
      ],
      { logOnly: true },
    );

    expect(groups).toEqual([]);
  });

  it("drops a date with no Log entries at all", () => {
    const groups = findSameDateGroups(
      [
        entry({ id: 1, date: "2026-03-14", categories: ["FAMILY"] }),
        entry({ id: 2, date: "2026-03-14", categories: ["WORK"] }),
      ],
      { logOnly: true },
    );

    expect(groups).toEqual([]);
  });

  it("matches the Log category case-insensitively", () => {
    const groups = findSameDateGroups(
      [
        entry({ id: 1, date: "2026-03-14", time: "09:00", categories: ["log"] }),
        entry({ id: 2, date: "2026-03-14", time: "12:00", categories: ["LOG"] }),
      ],
      { logOnly: true },
    );

    expect(groups).toHaveLength(1);
  });

  it("finds an entry's Log category alongside its other categories", () => {
    const groups = findSameDateGroups(
      [
        entry({ id: 1, date: "2026-03-14", time: "09:00", categories: ["Travel", "Log"] }),
        log({ id: 2, date: "2026-03-14", time: "12:00" }),
      ],
      { logOnly: true },
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].entries.map((item) => item.id)).toEqual([1, 2]);
  });

  it("behaves exactly as before when the option is off or absent", () => {
    const entries = [
      log({ id: 1, date: "2026-03-14", time: "09:00" }),
      entry({ id: 2, date: "2026-03-14", time: "12:00", categories: ["FAMILY"] }),
    ];

    expect(findSameDateGroups(entries, { logOnly: false })).toEqual(findSameDateGroups(entries));
    expect(findSameDateGroups(entries)[0].entries).toHaveLength(2);
  });
});

describe("countSameDateEntries", () => {
  it("totals the members across every group", () => {
    const groups = findSameDateGroups([
      entry({ id: 1, date: "2026-03-14" }),
      entry({ id: 2, date: "2026-03-14" }),
      entry({ id: 3, date: "2026-03-14" }),
      entry({ id: 4, date: "2026-03-15" }),
      entry({ id: 5, date: "2026-03-15" }),
    ]);

    expect(countSameDateEntries(groups)).toBe(5);
  });

  it("is zero when nothing was grouped", () => {
    expect(countSameDateEntries([])).toBe(0);
  });
});

describe("toSameDateRows", () => {
  it("flattens groups, stamping each row with its position in the day", () => {
    const groups = findSameDateGroups([
      entry({ id: 1, date: "2026-03-14", time: "09:00" }),
      entry({ id: 2, date: "2026-03-14", time: "12:00" }),
      entry({ id: 3, date: "2026-03-14", time: "21:00" }),
      entry({ id: 4, date: "2026-03-15", time: "08:00" }),
      entry({ id: 5, date: "2026-03-15", time: "10:00" }),
    ]);
    const rows = toSameDateRows(groups);

    expect(rows.map((row) => row.id)).toEqual([4, 5, 1, 2, 3]);
    expect(rows.map((row) => `${row.entryIndex}/${row.entryCount}`)).toEqual([
      "1/2",
      "2/2",
      "1/3",
      "2/3",
      "3/3",
    ]);
  });

  it("returns nothing for no groups", () => {
    expect(toSameDateRows([])).toEqual([]);
  });
});

describe("mergeEntryDraft", () => {
  it("takes the date and time of the earliest entry", () => {
    const draft = mergeEntryDraft([
      entry({ id: 2, date: "2026-03-14", time: "21:30" }),
      entry({ id: 1, date: "2026-03-14", time: "09:00" }),
    ]);

    expect(draft.date).toBe("2026-03-14");
    expect(draft.time).toBe("09:00");
  });

  it("joins the titles in reading order, skipping blanks and repeats", () => {
    const draft = mergeEntryDraft([
      entry({ id: 3, date: "2026-03-14", time: "21:00", title: "Dinner" }),
      entry({ id: 1, date: "2026-03-14", time: "09:00", title: "Morning run" }),
      entry({ id: 2, date: "2026-03-14", time: "12:00", title: "" }),
      entry({ id: 4, date: "2026-03-14", time: "22:00", title: "dinner" }),
    ]);

    expect(draft.title).toBe("Morning run / Dinner");
  });

  it("leaves the title empty when nothing had one, for the reader to type", () => {
    const draft = mergeEntryDraft([
      entry({ id: 1, date: "2026-03-14", title: "" }),
      entry({ id: 2, date: "2026-03-14", title: "  " }),
    ]);

    expect(draft.title).toBe("");
  });

  it("concatenates the content in reading order, each block headed by its source", () => {
    const draft = mergeEntryDraft([
      entry({ id: 2, date: "2026-03-14", time: "21:30", title: "Dinner", content: "Pasta." }),
      entry({ id: 1, date: "2026-03-14", time: "09:00", title: "Run", content: "Five miles." }),
    ]);

    expect(draft.content).toBe("— 09:00 · Run\nFive miles.\n\n— 21:30 · Dinner\nPasta.");
  });

  it("keeps a heading for a source with no content, rather than dropping it", () => {
    const draft = mergeEntryDraft([
      entry({ id: 1, date: "2026-03-14", time: "09:00", title: "Run", content: "Five miles." }),
      entry({ id: 2, date: "2026-03-14", time: "12:00", title: "Lunch", content: "" }),
    ]);

    expect(draft.content).toBe("— 09:00 · Run\nFive miles.\n\n— 12:00 · Lunch");
  });

  it("heads a block with whatever identity the source has", () => {
    const draft = mergeEntryDraft([
      entry({ id: 1, date: "2026-03-14", time: "", title: "No clock", content: "a" }),
      entry({ id: 2, date: "2026-03-14", time: "10:00", title: "", content: "b" }),
    ]);

    // No time -> title only; no title -> time only. Ordered time-blank first.
    expect(draft.content).toBe("— No clock\na\n\n— 10:00\nb");
  });

  it("orders blocks across dates too, when the selection spans days", () => {
    const draft = mergeEntryDraft([
      entry({ id: 2, date: "2026-03-15", time: "08:00", title: "Second", content: "b" }),
      entry({ id: 1, date: "2026-03-14", time: "22:00", title: "First", content: "a" }),
    ]);

    expect(draft.date).toBe("2026-03-14");
    expect(draft.content).toBe("— 22:00 · First\na\n\n— 08:00 · Second\nb");
  });

  it("unions the categories and tags, de-duplicating case-insensitively", () => {
    const draft = mergeEntryDraft([
      entry({
        id: 1,
        date: "2026-03-14",
        time: "09:00",
        categories: ["FAMILY", "Health"],
        tags: ["Park", "Running"],
      }),
      entry({
        id: 2,
        date: "2026-03-14",
        time: "12:00",
        categories: ["family", "Work"],
        tags: ["running", "Lunch"],
      }),
    ]);

    expect(draft.categories).toEqual(["FAMILY", "Health", "Work"]);
    expect(draft.tags).toEqual(["Park", "Running", "Lunch"]);
  });

  it("takes the first non-empty place name rather than joining them", () => {
    const draft = mergeEntryDraft([
      entry({ id: 1, date: "2026-03-14", time: "09:00", placeName: "" }),
      entry({ id: 2, date: "2026-03-14", time: "12:00", placeName: "Princeton" }),
      entry({ id: 3, date: "2026-03-14", time: "18:00", placeName: "New York" }),
    ]);

    expect(draft.placeName).toBe("Princeton");
  });

  it("returns an empty draft for an empty selection instead of throwing", () => {
    expect(mergeEntryDraft([])).toEqual({
      date: "",
      time: "",
      title: "",
      content: "",
      placeName: "",
      categories: [],
      tags: [],
    });
  });

  it("merges a single entry into an equivalent draft", () => {
    const draft = mergeEntryDraft([
      entry({
        id: 1,
        date: "2026-03-14",
        time: "09:00",
        title: "Run",
        content: "Five miles.",
        categories: ["Health"],
      }),
    ]);

    expect(draft.date).toBe("2026-03-14");
    expect(draft.title).toBe("Run");
    expect(draft.content).toBe("— 09:00 · Run\nFive miles.");
    expect(draft.categories).toEqual(["Health"]);
  });
});
