import { describe, expect, it } from "vitest";
import { parseIcsDateTime, parseIcsEvents } from "./ics-parse";

// Wraps VEVENT bodies in the VCALENDAR envelope a real export carries, with CRLF
// line endings — which is what the spec mandates and what Google actually writes.
function icsFile(...blocks: string[]): string {
  return [
    "BEGIN:VCALENDAR",
    "PRODID:-//Google Inc//Google Calendar 70.9054//EN",
    "VERSION:2.0",
    "X-WR-CALNAME:Family",
    ...blocks.flatMap((block) => block.split("\n")),
    "END:VCALENDAR",
  ].join("\r\n");
}

describe("parseIcsDateTime", () => {
  it("reads an all-day DATE value", () => {
    expect(parseIcsDateTime("20260911")).toEqual({
      date: "2026-09-11",
      time: "",
      isAllDay: true,
    });
  });

  it("reads a local date-time, dropping seconds", () => {
    expect(parseIcsDateTime("20260911T180000")).toEqual({
      date: "2026-09-11",
      time: "18:00",
      isAllDay: false,
    });
  });

  // The wall-clock time in the file is the time the reader wrote on their
  // calendar. Converting it would turn a 6pm practice into a 22:00 entry.
  it("takes a TZID date-time at face value rather than converting it", () => {
    expect(parseIcsDateTime("20260911T180000", { TZID: "America/New_York" })).toEqual({
      date: "2026-09-11",
      time: "18:00",
      isAllDay: false,
    });
  });

  it("converts a UTC date-time into local time", () => {
    // Asserted against the platform's own conversion, so the test is correct in
    // whatever zone it runs in — pinning an expected string would make it pass
    // only on the machine it was written on.
    const expected = new Date(Date.UTC(2026, 8, 11, 22, 30));
    const result = parseIcsDateTime("20260911T223000Z");

    expect(result).toBeDefined();
    expect(result?.time).toBe(
      `${String(expected.getHours()).padStart(2, "0")}:${String(expected.getMinutes()).padStart(2, "0")}`,
    );
    expect(result?.isAllDay).toBe(false);
  });

  it("honours VALUE=DATE over a timed-looking value", () => {
    expect(parseIcsDateTime("20260911T000000", { VALUE: "DATE" })).toEqual({
      date: "2026-09-11",
      time: "",
      isAllDay: true,
    });
  });

  it("accepts a date-time without seconds", () => {
    expect(parseIcsDateTime("20260911T1800")).toEqual({
      date: "2026-09-11",
      time: "18:00",
      isAllDay: false,
    });
  });

  it("returns undefined for an unparseable value", () => {
    expect(parseIcsDateTime("September 11, 2026")).toBeUndefined();
    expect(parseIcsDateTime("")).toBeUndefined();
    expect(parseIcsDateTime("2026-09-11")).toBeUndefined();
  });
});

describe("parseIcsEvents", () => {
  it("reads the fields a journal entry is built from", () => {
    const { events, skippedCount } = parseIcsEvents(
      icsFile(
        [
          "BEGIN:VEVENT",
          "UID:abc123@google.com",
          "DTSTART;TZID=America/New_York:20260911T180000",
          "DTEND;TZID=America/New_York:20260911T193000",
          "SUMMARY:Skylar swim practice",
          "LOCATION:MCCC",
          "DESCRIPTION:Bring a towel",
          "END:VEVENT",
        ].join("\n"),
      ),
    );

    expect(skippedCount).toBe(0);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      uid: "abc123@google.com",
      summary: "Skylar swim practice",
      location: "MCCC",
      description: "Bring a towel",
      date: "2026-09-11",
      time: "18:00",
      isAllDay: false,
      endTime: "19:30",
      isRecurring: false,
      calendarName: "Family",
    });
  });

  it("unfolds a description split across continuation lines", () => {
    const { events } = parseIcsEvents(
      icsFile(
        [
          "BEGIN:VEVENT",
          "UID:folded@google.com",
          "DTSTART:20260911",
          "SUMMARY:Folded",
          "DESCRIPTION:This description is long enough that Google split it across",
          "  several lines and the parser has to put it back together again.",
          "END:VEVENT",
        ].join("\n"),
      ),
    );

    expect(events[0].description).toBe(
      "This description is long enough that Google split it across several lines and the parser has to put it back together again.",
    );
  });

  it("unescapes newlines, commas and semicolons in text", () => {
    const { events } = parseIcsEvents(
      icsFile(
        [
          "BEGIN:VEVENT",
          "UID:escaped@google.com",
          "DTSTART:20260911",
          "SUMMARY:Dinner\\, then a movie",
          "DESCRIPTION:Line one\\nLine two\\; and a semicolon",
          "END:VEVENT",
        ].join("\n"),
      ),
    );

    expect(events[0].summary).toBe("Dinner, then a movie");
    expect(events[0].description).toBe("Line one\nLine two; and a semicolon");
  });

  // `\\n` is a literal backslash followed by n, not a newline. A chained
  // .replace() implementation gets this wrong.
  it("treats an escaped backslash as literal, not as the start of an escape", () => {
    const { events } = parseIcsEvents(
      icsFile(
        ["BEGIN:VEVENT", "UID:bs@google.com", "DTSTART:20260911", "SUMMARY:C:\\\\nested", "END:VEVENT"].join("\n"),
      ),
    );

    expect(events[0].summary).toBe("C:\\nested");
  });

  it("keeps colons in a value, splitting only on the first one", () => {
    const { events } = parseIcsEvents(
      icsFile(
        [
          "BEGIN:VEVENT",
          "UID:colon@google.com",
          "DTSTART:20260911",
          "SUMMARY:Standup: 15 minutes",
          "DESCRIPTION:Join at https://example.com/room?id=7",
          "END:VEVENT",
        ].join("\n"),
      ),
    );

    expect(events[0].summary).toBe("Standup: 15 minutes");
    expect(events[0].description).toBe("Join at https://example.com/room?id=7");
  });

  it("reads an all-day event as a date with no time", () => {
    const { events } = parseIcsEvents(
      icsFile(
        [
          "BEGIN:VEVENT",
          "UID:allday@google.com",
          "DTSTART;VALUE=DATE:20260911",
          "DTEND;VALUE=DATE:20260912",
          "SUMMARY:School holiday",
          "END:VEVENT",
        ].join("\n"),
      ),
    );

    expect(events[0]).toMatchObject({ date: "2026-09-11", time: "", isAllDay: true });
  });

  it("flags a recurring event without expanding it", () => {
    const { events } = parseIcsEvents(
      icsFile(
        [
          "BEGIN:VEVENT",
          "UID:weekly@google.com",
          "DTSTART;TZID=America/New_York:20260911T180000",
          "RRULE:FREQ=WEEKLY;BYDAY=FR;COUNT=52",
          "SUMMARY:Swim practice",
          "END:VEVENT",
        ].join("\n"),
      ),
    );

    expect(events).toHaveLength(1);
    expect(events[0].isRecurring).toBe(true);
    expect(events[0].date).toBe("2026-09-11");
  });

  // A VALARM nests inside a VEVENT and carries its own DESCRIPTION. Reading it
  // would overwrite the event's with "This is an event reminder".
  it("ignores properties inside a nested VALARM", () => {
    const { events } = parseIcsEvents(
      icsFile(
        [
          "BEGIN:VEVENT",
          "UID:alarm@google.com",
          "DTSTART:20260911",
          "SUMMARY:With a reminder",
          "DESCRIPTION:The real description",
          "BEGIN:VALARM",
          "ACTION:DISPLAY",
          "DESCRIPTION:This is an event reminder",
          "TRIGGER:-PT30M",
          "END:VALARM",
          "END:VEVENT",
        ].join("\n"),
      ),
    );

    expect(events).toHaveLength(1);
    expect(events[0].description).toBe("The real description");
  });

  it("skips a VEVENT with no usable start, keeping the rest of the file", () => {
    const { events, skippedCount } = parseIcsEvents(
      icsFile(
        ["BEGIN:VEVENT", "UID:broken@google.com", "SUMMARY:No start at all", "END:VEVENT"].join("\n"),
        ["BEGIN:VEVENT", "UID:fine@google.com", "DTSTART:20260911", "SUMMARY:Fine", "END:VEVENT"].join("\n"),
      ),
    );

    expect(skippedCount).toBe(1);
    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe("Fine");
  });

  it("reads several events in file order", () => {
    const { events } = parseIcsEvents(
      icsFile(
        ["BEGIN:VEVENT", "UID:one@g", "DTSTART:20260911", "SUMMARY:First", "END:VEVENT"].join("\n"),
        ["BEGIN:VEVENT", "UID:two@g", "DTSTART:20260912", "SUMMARY:Second", "END:VEVENT"].join("\n"),
        ["BEGIN:VEVENT", "UID:three@g", "DTSTART:20260913", "SUMMARY:Third", "END:VEVENT"].join("\n"),
      ),
    );

    expect(events.map((event) => event.summary)).toEqual(["First", "Second", "Third"]);
  });

  it("defaults missing optional fields to empty strings", () => {
    const { events } = parseIcsEvents(
      icsFile(["BEGIN:VEVENT", "DTSTART:20260911", "END:VEVENT"].join("\n")),
    );

    expect(events[0]).toMatchObject({
      uid: "",
      summary: "",
      description: "",
      location: "",
      endDate: "",
      endTime: "",
    });
  });

  // Verified against a real 800-event Google Calendar export (Sept 2026).
  //
  // Google folds at a fixed ~75 octets, blind to word boundaries, so a fold can
  // land either mid-word or exactly on a word-separating space:
  //
  //   "...$400. Inclu" + " des 2 games"   -> "Includes 2 games"    (strip is right)
  //   "...Aunt Helen was" + " living in"  -> "Aunt Helen wasliving" (strip welds)
  //
  // The two are byte-identical in shape, so no parser can tell them apart, and
  // RFC 5545 mandates removing exactly one leading WSP. Strict spec unfolding
  // produces the same welding, so this is the source file being lossy at the
  // fold rather than a defect here.
  //
  // Pinned deliberately: "fixing" the weld by keeping the space would corrupt
  // every mid-word fold, which is the far more common case.
  it("strips exactly one leading space when unfolding, even if that welds two words", () => {
    const { events } = parseIcsEvents(
      icsFile(
        [
          "BEGIN:VEVENT",
          "UID:fold@google.com",
          "DTSTART;VALUE=DATE:20250704",
          "SUMMARY:Mid-word and mid-space folds",
          "DESCRIPTION:Bought a console for $400. Inclu",
          " des 2 games. Aunt Helen was",
          " living here.",
          "END:VEVENT",
        ].join("\n"),
      ),
    );

    // The mid-word fold rejoins correctly...
    expect(events[0].description).toContain("Includes 2 games.");
    // ...and the mid-space one welds, which is what the source file encodes.
    expect(events[0].description).toContain("wasliving here.");
  });

  // A continuation beginning with TWO spaces keeps the second one: only the
  // first is the fold marker. Real exports rely on this for indented list items.
  it("keeps the second space when a continuation starts with two", () => {
    const { events } = parseIcsEvents(
      icsFile(
        [
          "BEGIN:VEVENT",
          "UID:two@google.com",
          "DTSTART;VALUE=DATE:20250704",
          "SUMMARY:Two spaces",
          "DESCRIPTION:We went to the park",
          "  playground and had fun.",
          "END:VEVENT",
        ].join("\n"),
      ),
    );

    expect(events[0].description).toBe("We went to the park playground and had fun.");
  });

  it("accepts bare LF line endings", () => {
    const { events } = parseIcsEvents(
      "BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:lf@g\nDTSTART:20260911\nSUMMARY:Unix\nEND:VEVENT\nEND:VCALENDAR",
    );

    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe("Unix");
  });

  it("returns nothing for a file with no events", () => {
    expect(parseIcsEvents(icsFile())).toEqual({ events: [], skippedCount: 0 });
    expect(parseIcsEvents("")).toEqual({ events: [], skippedCount: 0 });
    expect(parseIcsEvents("not an ics file at all")).toEqual({ events: [], skippedCount: 0 });
  });

  it("ignores a VTODO block", () => {
    const { events } = parseIcsEvents(
      icsFile(
        ["BEGIN:VTODO", "UID:todo@g", "DTSTART:20260911", "SUMMARY:A task", "END:VTODO"].join("\n"),
        ["BEGIN:VEVENT", "UID:event@g", "DTSTART:20260912", "SUMMARY:An event", "END:VEVENT"].join("\n"),
      ),
    );

    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe("An event");
  });
});
