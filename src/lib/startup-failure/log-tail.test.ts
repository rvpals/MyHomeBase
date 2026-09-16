import { describe, expect, it } from "vitest";
import {
  LOG_TAIL_LINES,
  UNKNOWN_SIGNATURE,
  classifyFailure,
  isTransient,
  tailLines,
} from "./log-tail";

describe("tailLines", () => {
  it("returns every line when the log is shorter than the limit", () => {
    const tail = tailLines("one\ntwo\nthree", 100);
    expect(tail.lines).toEqual(["one", "two", "three"]);
    expect(tail.truncated).toBe(false);
    expect(tail.totalLines).toBe(3);
  });

  it("keeps the LAST lines, not the first, and flags the truncation", () => {
    // The whole point of a tail: a startup crash is at the END of the log.
    const raw = Array.from({ length: 10 }, (_, index) => `line ${index + 1}`).join("\n");
    const tail = tailLines(raw, 3);
    expect(tail.lines).toEqual(["line 8", "line 9", "line 10"]);
    expect(tail.truncated).toBe(true);
    expect(tail.totalLines).toBe(10);
  });

  it("does not count the trailing newline as a final empty line", () => {
    // Every append ends with one, so counting it would show a blank row on every page.
    const tail = tailLines("one\ntwo\n");
    expect(tail.lines).toEqual(["one", "two"]);
    expect(tail.totalLines).toBe(2);
  });

  it("treats an empty log as no lines at all", () => {
    expect(tailLines("")).toEqual({ lines: [], truncated: false, totalLines: 0 });
  });

  it("treats a whitespace-only log as no lines at all", () => {
    expect(tailLines("\n\n  \n").lines).toEqual([]);
  });

  it("normalises CRLF, since start.sh and Node both append here", () => {
    expect(tailLines("one\r\ntwo").lines).toEqual(["one", "two"]);
  });

  it("returns nothing for a zero limit rather than the whole log", () => {
    // Guards the slice(-0) trap, which would return every line.
    const tail = tailLines("one\ntwo\nthree", 0);
    expect(tail.lines).toEqual([]);
    expect(tail.totalLines).toBe(3);
  });

  it("defaults to 100 lines", () => {
    const raw = Array.from({ length: 250 }, (_, index) => `line ${index}`).join("\n");
    expect(tailLines(raw).lines).toHaveLength(LOG_TAIL_LINES);
  });

  it("preserves blank lines inside the tail", () => {
    // A stack trace's own blank separators are meaningful; collapsing them would
    // silently reflow the very output the page exists to show.
    expect(tailLines("one\n\ntwo").lines).toEqual(["one", "", "two"]);
  });
});

describe("classifyFailure", () => {
  it("recognises a Node ABI mismatch", () => {
    const tail = tailLines(
      "Error: The module was compiled against a different Node.js version using\n" +
        "NODE_MODULE_VERSION 115. This version of Node.js requires NODE_MODULE_VERSION 127.",
    );
    const diagnosis = classifyFailure(tail);
    expect(diagnosis.cause).toBe("node-abi-mismatch");
    expect(diagnosis.remedy).toMatch(/NAS_NODE_ABI/);
  });

  it("recognises a port collision", () => {
    expect(classifyFailure(tailLines("Error: listen EADDRINUSE: 0.0.0.0:3000")).cause).toBe(
      "port-in-use",
    );
  });

  it("recognises an unopenable database", () => {
    expect(
      classifyFailure(tailLines("SqliteError: SQLITE_CANTOPEN: unable to open database file"))
        .cause,
    ).toBe("database-unreachable");
  });

  it("recognises a missing native module", () => {
    expect(classifyFailure(tailLines("Error: Cannot find module 'better-sqlite3'")).cause).toBe(
      "missing-native-module",
    );
  });

  it("recognises a missing build", () => {
    expect(classifyFailure(tailLines("Error: Cannot find module '/volume1/app/x/server.js'")).cause)
      .toBe("missing-build");
  });

  it("recognises the migration guard start.sh writes", () => {
    expect(
      classifyFailure(tailLines("2026-09-15 08:00:00 MIGRATION FAILED — not starting the app"))
        .cause,
    ).toBe("migration-failed");
  });

  it("prefers the ABI mismatch when a dlopen failure reports it too", () => {
    // Both patterns match this text; the ABI one is the actionable diagnosis, so
    // ordering in SIGNATURES has to put it first.
    const tail = tailLines(
      "ERR_DLOPEN_FAILED: ... compiled against a different Node.js version using NODE_MODULE_VERSION 115",
    );
    expect(classifyFailure(tail).cause).toBe("node-abi-mismatch");
  });

  it("falls back to unknown rather than guessing", () => {
    expect(classifyFailure(tailLines("something nobody has seen before"))).toEqual(
      UNKNOWN_SIGNATURE,
    );
  });

  it("returns the unknown signature for an empty log", () => {
    expect(classifyFailure(tailLines("")).cause).toBe("unknown");
  });

  it("never leaks the matching regex into the result", () => {
    // The result is rendered into a page; a stray RegExp would serialise as noise.
    expect(Object.keys(classifyFailure(tailLines("EADDRINUSE"))).sort()).toEqual([
      "cause",
      "headline",
      "remedy",
    ]);
  });
});

describe("isTransient", () => {
  it("calls a port collision transient", () => {
    expect(isTransient("port-in-use")).toBe(true);
  });

  it("does not call an ABI mismatch transient — retrying never fixes it", () => {
    expect(isTransient("node-abi-mismatch")).toBe(false);
    expect(isTransient("unknown")).toBe(false);
  });
});
