import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_DEFINITIONS,
  clearWordDefinitionCache,
  htmlToText,
  lookupWordDefinition,
  parseWiktionaryDefinitions,
  type DefinitionFetch,
} from "./word-definitions";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const QI_BODY = {
  en: [
    {
      partOfSpeech: "Noun",
      language: "English",
      definitions: [
        { definition: 'The circulating <a href="/wiki/life_force">life force</a> in Chinese philosophy.' },
        { definition: "" },
      ],
    },
  ],
  zh: [{ partOfSpeech: "Noun", definitions: [{ definition: "not English" }] }],
};

describe("lookupWordDefinition", () => {
  beforeEach(() => clearWordDefinitionCache());

  it("returns English meanings as plain text, lower-casing the request", async () => {
    const fetchImpl = vi.fn<DefinitionFetch>().mockResolvedValue(jsonResponse(QI_BODY));
    const result = await lookupWordDefinition({ word: "QI" }, fetchImpl);
    expect(result).toEqual({
      status: "found",
      word: "QI",
      entries: [{ partOfSpeech: "Noun", definition: "The circulating life force in Chinese philosophy." }],
    });
    expect(fetchImpl.mock.calls[0][0]).toBe("https://en.wiktionary.org/api/rest_v1/page/definition/qi");
  });

  it("reports not-found on a 404", async () => {
    const fetchImpl = vi.fn<DefinitionFetch>().mockResolvedValue(new Response("", { status: 404 }));
    expect(await lookupWordDefinition({ word: "zzxq" }, fetchImpl)).toEqual({ status: "not-found", word: "ZZXQ" });
  });

  it("reports not-found when the page has no English meaning", async () => {
    const fetchImpl = vi.fn<DefinitionFetch>().mockResolvedValue(jsonResponse({ zh: QI_BODY.zh }));
    expect((await lookupWordDefinition({ word: "xu" }, fetchImpl)).status).toBe("not-found");
  });

  it("caches answers so a second tap does not call the service", async () => {
    const fetchImpl = vi.fn<DefinitionFetch>().mockResolvedValue(jsonResponse(QI_BODY));
    await lookupWordDefinition({ word: "qi" }, fetchImpl);
    await lookupWordDefinition({ word: "QI" }, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns an error on a network failure and does not cache it", async () => {
    const fetchImpl = vi
      .fn<DefinitionFetch>()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(jsonResponse(QI_BODY));
    expect((await lookupWordDefinition({ word: "qi" }, fetchImpl)).status).toBe("error");
    expect((await lookupWordDefinition({ word: "qi" }, fetchImpl)).status).toBe("found");
  });

  it("returns an error on a server error", async () => {
    const fetchImpl = vi.fn<DefinitionFetch>().mockResolvedValue(new Response("", { status: 503 }));
    expect((await lookupWordDefinition({ word: "qi" }, fetchImpl)).status).toBe("error");
  });

  it("rejects anything that is not a 2–15 letter word without calling the service", async () => {
    const fetchImpl = vi.fn<DefinitionFetch>();
    for (const word of ["a", "qi/../x", "ab1", "abcdefghijklmnop"]) {
      expect((await lookupWordDefinition({ word }, fetchImpl)).status).toBe("error");
    }
    expect((await lookupWordDefinition("qi", fetchImpl)).status).toBe("error");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("parseWiktionaryDefinitions", () => {
  it("stops at MAX_DEFINITIONS across parts of speech", () => {
    const many = { definitions: Array.from({ length: 5 }, (_, i) => ({ definition: `meaning ${i}` })) };
    const entries = parseWiktionaryDefinitions({ en: [{ partOfSpeech: "Verb", ...many }, many] });
    expect(entries).toHaveLength(MAX_DEFINITIONS);
  });

  it("returns nothing for a malformed body", () => {
    expect(parseWiktionaryDefinitions(null)).toEqual([]);
    expect(parseWiktionaryDefinitions({ en: "nope" })).toEqual([]);
  });
});

describe("htmlToText", () => {
  it("strips tags and decodes entities", () => {
    expect(htmlToText("<i>rock &amp; roll</i>&#39;s &#x41;  <b>x</b>")).toBe("rock & roll's A x");
  });
});
