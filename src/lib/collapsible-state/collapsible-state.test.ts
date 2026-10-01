import { describe, expect, it } from "vitest";
import {
  cardStateStorageKey,
  parseCardStates,
  resolveCardOpen,
  withCardState,
} from "./collapsible-state";

describe("cardStateStorageKey", () => {
  it("namespaces the route", () => {
    expect(cardStateStorageKey("/modules/expense")).toBe("myhomebase:cards:/modules/expense");
  });

  it("keeps two routes apart", () => {
    expect(cardStateStorageKey("/a")).not.toBe(cardStateStorageKey("/b"));
  });
});

describe("parseCardStates", () => {
  it("reads a stored map", () => {
    expect(parseCardStates('{"0":true,"2":false}')).toEqual({ "0": true, "2": false });
  });

  it("treats a missing entry as nothing saved", () => {
    expect(parseCardStates(null)).toEqual({});
  });

  it("falls back to nothing saved on malformed JSON", () => {
    expect(parseCardStates("{not json")).toEqual({});
  });

  it("rejects a non-object payload", () => {
    expect(parseCardStates('"open"')).toEqual({});
    expect(parseCardStates("[true,false]")).toEqual({});
  });

  it("drops non-boolean values but keeps the rest", () => {
    expect(parseCardStates('{"0":true,"1":"yes","2":false}')).toEqual({ "0": true, "2": false });
  });
});

describe("withCardState", () => {
  it("writes a card's state without touching its siblings", () => {
    expect(withCardState({ "0": true }, 1, false)).toEqual({ "0": true, "1": false });
  });

  it("overwrites the same ordinal", () => {
    expect(withCardState({ "0": true }, 0, false)).toEqual({ "0": false });
  });

  it("does not mutate the input", () => {
    const before = { "0": true };
    withCardState(before, 1, true);
    expect(before).toEqual({ "0": true });
  });
});

describe("resolveCardOpen", () => {
  it("uses defaultOpen when nothing is stored", () => {
    expect(resolveCardOpen({}, 0, true)).toBe(true);
    expect(resolveCardOpen({}, 0, false)).toBe(false);
  });

  // The case a truthiness bug would break: `states[n] || defaultOpen` would
  // reopen every card the reader had deliberately collapsed.
  it("lets a stored false beat defaultOpen true", () => {
    expect(resolveCardOpen({ "0": false }, 0, true)).toBe(false);
  });

  it("lets a stored true beat defaultOpen false", () => {
    expect(resolveCardOpen({ "0": true }, 0, false)).toBe(true);
  });

  it("only reads its own ordinal", () => {
    expect(resolveCardOpen({ "1": false }, 0, true)).toBe(true);
  });
});
