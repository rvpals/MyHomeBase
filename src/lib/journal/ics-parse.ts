// An iCalendar (.ics) parser, scoped to what a Google Calendar export holds and
// what a journal entry needs: VEVENT blocks with a start, a summary, a
// description, a location and a UID.
//
// Hand-written rather than a dependency. The whole format-specific burden is
// line-unfolding, property-parameter splitting, text unescaping and three
// date-time shapes -- all of which are testable in a few dozen assertions, and
// none of which is worth a transitive dependency tree in an app that reads a
// file the user exported by hand.
//
// Deliberately NOT implemented: RRULE expansion. A recurring series exports as
// one VEVENT, so it imports as one entry -- the series' first occurrence. See
// `isRecurring`, which flags it so the UI can say so out loud rather than
// leaving the reader to wonder where the other 51 practices went.

import type { IcsEvent } from "./types";

/**
 * Unfolds RFC 5545 line folding.
 *
 * A long property is split across lines, with every continuation beginning with
 * a single space or tab that is NOT part of the value. Google folds aggressively
 * -- a paragraph of DESCRIPTION arrives as a dozen lines -- so getting this
 * wrong truncates content rather than failing loudly.
 *
 * CRLF, bare LF and bare CR are all accepted: the spec says CRLF, real files
 * disagree, and a file that round-tripped through a text editor may hold either.
 */
function unfoldLines(text: string): string[] {
  const rawLines = text.split(/\r\n|\n|\r/);
  const lines: string[] = [];

  for (const raw of rawLines) {
    if (raw.startsWith(" ") || raw.startsWith("\t")) {
      // A continuation with nothing to continue is junk, not the start of a
      // property -- dropping it beats emitting a nameless line.
      if (lines.length === 0) continue;
      lines[lines.length - 1] += raw.slice(1);
      continue;
    }
    lines.push(raw);
  }

  return lines;
}

/**
 * Unescapes an iCalendar TEXT value: `\n`/`\N` are real newlines, and `\, \; \\`
 * are literal characters.
 *
 * The backslash is consumed left to right in one pass so that `\\n` yields a
 * literal backslash followed by the letter n -- not a newline. A chain of
 * `.replace()` calls gets that case wrong, which matters because Windows paths
 * and emoticons in a calendar description really do contain backslashes.
 */
function unescapeText(value: string): string {
  let result = "";
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (char !== "\\") {
      result += char;
      continue;
    }

    const next = value[i + 1];
    if (next === undefined) {
      // Trailing lone backslash -- keep it rather than swallow it.
      result += "\\";
      break;
    }

    switch (next) {
      case "n":
      case "N":
        result += "\n";
        break;
      case "\\":
      case ",":
      case ";":
        result += next;
        break;
      default:
        // Not a defined escape. Preserve both characters: the value is more
        // useful intact than silently altered.
        result += "\\" + next;
        break;
    }
    i += 1;
  }
  return result;
}

interface ParsedLine {
  /** Upper-cased property name, e.g. "DTSTART". */
  name: string;
  /** Parameters by upper-cased key, e.g. { TZID: "America/New_York" }. */
  params: Record<string, string>;
  /** The raw value, still escaped. */
  value: string;
}

/**
 * Splits one unfolded line into name, parameters and value.
 *
 * The value is everything after the FIRST colon, because a DESCRIPTION or a
 * URL legitimately contains colons. Parameters are separated by `;` before that
 * colon -- but a quoted parameter value may itself contain both `;` and `:`,
 * so the split scans character by character tracking quotes rather than calling
 * `.split(";")`.
 */
function parseLine(line: string): ParsedLine | undefined {
  let colonIndex = -1;
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === ":" && !inQuotes) {
      colonIndex = i;
      break;
    }
  }

  if (colonIndex === -1) return undefined;

  const namePart = line.slice(0, colonIndex);
  const value = line.slice(colonIndex + 1);

  // Same quote-aware scan for the parameter separator.
  const segments: string[] = [];
  let current = "";
  inQuotes = false;
  for (const char of namePart) {
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === ";" && !inQuotes) {
      segments.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  segments.push(current);

  const name = (segments.shift() ?? "").trim().toUpperCase();
  if (name === "") return undefined;

  const params: Record<string, string> = {};
  for (const segment of segments) {
    const equals = segment.indexOf("=");
    if (equals === -1) continue;
    params[segment.slice(0, equals).trim().toUpperCase()] = segment.slice(equals + 1).trim();
  }

  return { name, params, value };
}

/** Two digits, for building date and time strings. */
function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export interface IcsDateTime {
  /** YYYY-MM-DD. */
  date: string;
  /** HH:MM, or "" for an all-day (DATE-valued) event. */
  time: string;
  /** True when the property carried VALUE=DATE or a bare YYYYMMDD. */
  isAllDay: boolean;
}

/**
 * Parses DTSTART/DTEND in the three forms a Google export uses.
 *
 * - `YYYYMMDD` (all-day) -> date, no time.
 * - `YYYYMMDDTHHMMSS` (floating, or with a TZID parameter) -> taken at face
 *   value. A TZID is deliberately NOT converted: the wall-clock time in the
 *   file is the time the reader wrote on their calendar, and it is the time they
 *   expect to see on the journal entry. Converting "6:00 PM practice" into the
 *   app server's zone is how a 6pm event becomes a 22:00 entry.
 * - `YYYYMMDDTHHMMSSZ` (UTC) -> converted to local time, because here the file
 *   is explicit that the wall-clock reading is NOT the local one.
 *
 * Seconds are dropped: the journal stores HH:MM (0027), and normalizeEntryTime
 * would drop them anyway.
 */
export function parseIcsDateTime(value: string, params: Record<string, string> = {}): IcsDateTime | undefined {
  const raw = value.trim();

  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
  if (dateOnly) {
    return {
      date: `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`,
      time: "",
      isAllDay: true,
    };
  }

  const dateTime = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(raw);
  if (!dateTime) return undefined;

  const [, year, month, day, hour, minute, , zulu] = dateTime;

  // VALUE=DATE on a timed-looking value is contradictory; trust the parameter,
  // since that is what the writer declared the value to be.
  if ((params.VALUE ?? "").toUpperCase() === "DATE") {
    return { date: `${year}-${month}-${day}`, time: "", isAllDay: true };
  }

  if (zulu) {
    // Shift into the running process's zone. `new Date(Date.UTC(...))` then
    // reading the local getters is the whole conversion -- no zone table needed,
    // because the platform already has one.
    const instant = new Date(
      Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)),
    );
    return {
      date: `${instant.getFullYear()}-${pad2(instant.getMonth() + 1)}-${pad2(instant.getDate())}`,
      time: `${pad2(instant.getHours())}:${pad2(instant.getMinutes())}`,
      isAllDay: false,
    };
  }

  return {
    date: `${year}-${month}-${day}`,
    time: `${hour}:${minute}`,
    isAllDay: false,
  };
}

/**
 * Parses an .ics file into the events a journal entry can be built from.
 *
 * Best-effort by design, mirroring the CSV importer: a VEVENT that can't yield a
 * date is skipped rather than aborting the file, because one malformed block in
 * a multi-year export must not cost the reader every other event in it. The
 * count of what was dropped is returned so the UI can say so.
 *
 * Only VEVENT is read. VTODO, VJOURNAL, VALARM and VTIMEZONE are stepped over --
 * VALARM matters especially, since it nests inside a VEVENT and carries its own
 * DESCRIPTION that would otherwise overwrite the event's.
 */
export function parseIcsEvents(fileText: string): { events: IcsEvent[]; skippedCount: number } {
  const lines = unfoldLines(fileText);
  const events: IcsEvent[] = [];
  let skippedCount = 0;

  // The block we're inside, if any. `nestingDepth` tracks components opened
  // within a VEVENT (VALARM) so their properties are ignored.
  let current: Partial<Record<string, ParsedLine>> | undefined;
  let nestingDepth = 0;
  let calendarName = "";

  for (const line of lines) {
    const parsed = parseLine(line);
    if (!parsed) continue;

    if (parsed.name === "BEGIN") {
      const component = parsed.value.trim().toUpperCase();
      if (component === "VEVENT" && current === undefined) {
        current = {};
        nestingDepth = 0;
        continue;
      }
      if (current !== undefined) nestingDepth += 1;
      continue;
    }

    if (parsed.name === "END") {
      const component = parsed.value.trim().toUpperCase();
      if (component === "VEVENT" && current !== undefined && nestingDepth === 0) {
        const event = buildEvent(current, calendarName);
        if (event) events.push(event);
        else skippedCount += 1;
        current = undefined;
        continue;
      }
      if (current !== undefined && nestingDepth > 0) nestingDepth -= 1;
      continue;
    }

    // Outside any VEVENT: the only thing worth keeping is the calendar's name,
    // which the filter UI offers as a facet. Google writes X-WR-CALNAME.
    if (current === undefined) {
      if (parsed.name === "X-WR-CALNAME") calendarName = unescapeText(parsed.value).trim();
      continue;
    }

    // Inside a nested component (VALARM) -- not the event's own properties.
    if (nestingDepth > 0) continue;

    // First occurrence wins. A well-formed VEVENT carries each of these once;
    // where one repeats, the first is as good a choice as any and beats letting
    // a later duplicate silently replace a good value.
    if (current[parsed.name] === undefined) current[parsed.name] = parsed;
  }

  return { events, skippedCount };
}

/** Turns one VEVENT's collected properties into an IcsEvent, or undefined if undatable. */
function buildEvent(
  properties: Partial<Record<string, ParsedLine>>,
  calendarName: string,
): IcsEvent | undefined {
  const dtStart = properties.DTSTART;
  if (!dtStart) return undefined;

  const start = parseIcsDateTime(dtStart.value, dtStart.params);
  if (!start) return undefined;

  const dtEnd = properties.DTEND;
  const end = dtEnd ? parseIcsDateTime(dtEnd.value, dtEnd.params) : undefined;

  const summary = unescapeText(properties.SUMMARY?.value ?? "").trim();
  const description = unescapeText(properties.DESCRIPTION?.value ?? "").trim();
  const location = unescapeText(properties.LOCATION?.value ?? "").trim();
  const uid = (properties.UID?.value ?? "").trim();

  return {
    uid,
    summary,
    description,
    location,
    date: start.date,
    time: start.time,
    isAllDay: start.isAllDay,
    endDate: end?.date ?? "",
    endTime: end?.time ?? "",
    isRecurring: properties.RRULE !== undefined,
    calendarName,
  };
}
