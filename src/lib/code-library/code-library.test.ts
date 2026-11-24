import { describe, expect, it } from "vitest";
import {
  SnippetNotFoundError,
  createSnippet,
  deleteSnippetCategory,
  emptyRecycleBin,
  encryptSnippet,
  getSnippet,
  listSnippets,
  openSnippet,
  recycleSnippet,
  restoreRecycledSnippet,
  saveSnippetTag,
  setSnippetColor,
  setSnippetPinned,
  updateSnippet,
} from "./code-library";
import type { CodeLibraryRepository } from "./ports";
import { buildSnippetPreview, countSnippetLines } from "./repository";
import { toSnippetLanguage } from "./schema";
import type { Snippet, SnippetFilterInput, SnippetSummary } from "./index";

/**
 * A fake repository that records what it was asked for.
 *
 * The use-cases in item 1 are thin — parse, delegate — so what is actually worth
 * asserting is that the *parsed* filter reaches the repository, which a fake can
 * show and a real database cannot.
 */
function stored(over: Partial<Snippet> = {}): Snippet {
  return {
    id: 1,
    title: "One",
    code: "x",
    language: "ts",
    categories: [],
    tags: [],
    isPinned: false,
    color: "",
    sourceUrl: "",
    notes: "",
    isEncrypted: false,
    titleEncrypted: "",
    codeEncrypted: "",
    passwordHint: "",
    createdBy: null,
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

function fakeRepo(snippets: SnippetSummary[] = []) {
  const calls: { filter: SnippetFilterInput; previewLines: number }[] = [];
  const writes: {
    created: unknown[];
    updated: unknown[];
    pinned: unknown[];
    coloured: unknown[];
    sealed: unknown[];
    unsealed: unknown[];
    recycled: number[];
    taxonomy: unknown[];
    deleted: string[];
  } = {
    created: [],
    updated: [],
    pinned: [],
    coloured: [],
    sealed: [],
    unsealed: [],
    recycled: [],
    taxonomy: [],
    deleted: [],
  };

  const repo: CodeLibraryRepository = {
    listSnippets(filter, previewLines) {
      calls.push({ filter, previewLines });
      return snippets;
    },
    getSnippetById(id) {
      return id === 1 ? stored() : undefined;
    },
    createSnippet(input, createdBy) {
      writes.created.push({ input, createdBy });
      return stored({ ...input, id: 2 });
    },
    updateSnippet(input) {
      writes.updated.push(input);
      // Only id 1 exists, mirroring `getSnippetById` — an edit to anything else
      // is the "deleted in another tab" case.
      return input.id === 1 ? stored({ ...input }) : undefined;
    },
    setSnippetPinned(input) {
      writes.pinned.push(input);
      return input.id === 1;
    },
    setSnippetColor(input) {
      writes.coloured.push(input);
      return input.id === 1;
    },
    sealSnippet(id, titleEncrypted, codeEncrypted, passwordHint) {
      writes.sealed.push({ id, titleEncrypted, codeEncrypted, passwordHint });
      return id === 1;
    },
    unsealSnippet(id, title, code) {
      writes.unsealed.push({ id, title, code });
      return id === 1;
    },
    recycleSnippet(id) {
      writes.recycled.push(id);
      return id === 1;
    },
    listRecycledSnippets: () => [],
    restoreRecycledSnippet: (recycledId) => (recycledId === 1 ? 1 : undefined),
    purgeRecycledSnippet: (recycledId) => recycledId === 1,
    emptyRecycleBin: () => 3,
    listCategories: () => [],
    listTags: () => [],
    saveCategory: (input) => void writes.taxonomy.push(input),
    saveTag: (input) => void writes.taxonomy.push(input),
    deleteCategory: (name) => void writes.deleted.push(name),
    deleteTag: (name) => void writes.deleted.push(name),
  };

  return { repo, calls, writes };
}

describe("listSnippets", () => {
  it("fills in the defaults when handed nothing", () => {
    const { repo, calls } = fakeRepo();

    listSnippets(repo);

    // The forgiving-filter rule: a caller with no params still produces a complete,
    // valid filter rather than `undefined` reaching the SQL.
    expect(calls[0].filter).toEqual({
      search: "",
      language: "",
      categories: [],
      tags: [],
    });
    expect(calls[0].previewLines).toBe(6);
  });

  it("passes a partial filter through, trimmed", () => {
    const { repo, calls } = fakeRepo();

    listSnippets(repo, { search: "  select  " });

    expect(calls[0].filter).toEqual({
      search: "select",
      language: "",
      categories: [],
      tags: [],
    });
  });

  it("keeps an unknown language in the filter so it matches nothing", () => {
    const { repo, calls } = fakeRepo();

    // A hand-edited or stale URL. It must narrow the list to nothing, NOT fold to
    // `text` (which would show every plain-text snippet) and NOT throw.
    listSnippets(repo, { language: "cobol" });

    expect(calls[0].filter.language).toBe("cobol");
  });

  it("refuses a filter whose field is the wrong type", () => {
    const { repo } = fakeRepo();

    // The failure path: zod is the boundary, so a number where a string belongs is
    // a thrown parse error rather than something that reaches the SQL.
    expect(() => listSnippets(repo, { search: 7 as unknown as string })).toThrow();
  });
});

describe("getSnippet", () => {
  it("returns the snippet when the id exists", () => {
    const { repo } = fakeRepo();
    expect(getSnippet(repo, 1)?.title).toBe("One");
  });

  it("returns undefined for an id that does not, rather than throwing", () => {
    const { repo } = fakeRepo();
    // The caller decides what missing means — a 404 in a route, a message in the CLI.
    expect(getSnippet(repo, 999)).toBeUndefined();
  });
});

describe("createSnippet", () => {
  it("stores the code byte for byte, indentation and all", () => {
    const { repo, writes } = fakeRepo();
    // Leading indentation on the first line and a trailing newline: both are the
    // kind of thing a `.trim()` would quietly eat, and both have to survive.
    const code = "    return 1\n";

    createSnippet(repo, { title: "frag", code, language: "python" }, 7);

    expect((writes.created[0] as { input: { code: string } }).input.code).toBe(code);
  });

  it("defaults the language rather than requiring one", () => {
    const { repo, writes } = fakeRepo();

    createSnippet(repo, { code: "x" } as never, null);

    const written = writes.created[0] as { input: { language: string; title: string } };
    expect(written.input.language).toBe("text");
    expect(written.input.title).toBe("");
  });

  it("passes the author through as attribution", () => {
    const { repo, writes } = fakeRepo();

    createSnippet(repo, { title: "", code: "x", language: "ts" }, 7);

    expect((writes.created[0] as { createdBy: number | null }).createdBy).toBe(7);
  });

  it("refuses a body that is only whitespace", () => {
    const { repo } = fakeRepo();
    // Whitespace-only is not a snippet. Note the *test* trims while the stored
    // value does not — that split is the point of `snippetCodeSchema`.
    expect(() => createSnippet(repo, { title: "", code: "  \n\t ", language: "ts" }, null)).toThrow();
  });

  it("refuses a language that is not on the list", () => {
    const { repo } = fakeRepo();
    expect(() =>
      createSnippet(repo, { title: "", code: "x", language: "cobol" } as never, null),
    ).toThrow();
  });

  it("refuses a title over the cap", () => {
    const { repo } = fakeRepo();
    expect(() =>
      createSnippet(repo, { title: "x".repeat(201), code: "y", language: "ts" }, null),
    ).toThrow();
  });
});

describe("updateSnippet", () => {
  it("returns the stored snippet when the id exists", () => {
    const { repo } = fakeRepo();

    const saved = updateSnippet(repo, { id: 1, title: "Two", code: "y", language: "sql" });

    expect(saved.title).toBe("Two");
    expect(saved.language).toBe("sql");
  });

  it("throws SnippetNotFoundError when the snippet has gone", () => {
    const { repo } = fakeRepo();
    // Deleted in another tab. A save that silently did nothing would be worse.
    expect(() => updateSnippet(repo, { id: 99, title: "", code: "y", language: "ts" })).toThrow(
      SnippetNotFoundError,
    );
  });

  it("refuses an id that is not a positive integer", () => {
    const { repo } = fakeRepo();
    expect(() => updateSnippet(repo, { id: 0, title: "", code: "y", language: "ts" })).toThrow();
  });
});

describe("toSnippetLanguage", () => {
  it("accepts a language on the list", () => {
    expect(toSnippetLanguage("python")).toBe("python");
  });

  it("degrades an unknown stored value to text instead of throwing", () => {
    // A row written when the list held a language since removed must still read.
    expect(toSnippetLanguage("cobol")).toBe("text");
    expect(toSnippetLanguage("")).toBe("text");
  });
});

describe("buildSnippetPreview", () => {
  it("returns a short snippet unchanged, with no ellipsis", () => {
    expect(buildSnippetPreview("a\nb", 6)).toBe("a\nb");
  });

  it("cuts on a line boundary and marks that there is more", () => {
    const code = "1\n2\n3\n4\n5\n6\n7\n8";
    expect(buildSnippetPreview(code, 3)).toBe("1\n2\n3\n…");
  });

  it("preserves indentation verbatim", () => {
    // The whole reason the body is plain TEXT. If this ever collapses, the module
    // has regressed to the problem it was built to avoid.
    const code = "def f():\n    return 1";
    expect(buildSnippetPreview(code, 6)).toBe("def f():\n    return 1");
  });
});

describe("taxonomy on a filter", () => {
  it("defaults both lists to empty so an unfiltered list asks for everything", () => {
    const { repo, calls } = fakeRepo();

    listSnippets(repo);

    expect(calls[0].filter.categories).toEqual([]);
    expect(calls[0].filter.tags).toEqual([]);
  });

  it("passes several names through, which the repository reads as AND", () => {
    const { repo, calls } = fakeRepo();

    listSnippets(repo, { tags: ["postgres", "docker"] });

    expect(calls[0].filter.tags).toEqual(["postgres", "docker"]);
  });
});

describe("taxonomy on a snippet", () => {
  it("drops blanks and case-insensitive duplicates from a label list", () => {
    const { repo, writes } = fakeRepo();

    // What a comma-separated box produces in practice: a stray comma, a repeat,
    // and a repeat in different case.
    createSnippet(
      repo,
      { title: "", code: "x", language: "sql", tags: ["sql", "", "  ", "SQL", "postgres"] },
      null,
    );

    const written = writes.created[0] as { input: { tags: string[] } };
    // The first spelling wins — the reader's own capitalisation is kept, which is
    // why the unique index is COLLATE NOCASE rather than the column.
    expect(written.input.tags).toEqual(["sql", "postgres"]);
  });

  it("trims a label but keeps its casing", () => {
    const { repo, writes } = fakeRepo();

    createSnippet(repo, { title: "", code: "x", language: "ts", categories: ["  Query  "] }, null);

    const written = writes.created[0] as { input: { categories: string[] } };
    expect(written.input.categories).toEqual(["Query"]);
  });

  it("refuses more labels than the cap allows", () => {
    const { repo } = fakeRepo();
    const tooMany = Array.from({ length: 21 }, (_, index) => `t${index}`);

    expect(() =>
      createSnippet(repo, { title: "", code: "x", language: "ts", tags: tooMany }, null),
    ).toThrow();
  });
});

describe("setSnippetPinned", () => {
  it("passes the pin through for a snippet that exists", () => {
    const { repo, writes } = fakeRepo();

    setSnippetPinned(repo, { id: 1, isPinned: true });

    expect(writes.pinned[0]).toEqual({ id: 1, isPinned: true });
  });

  it("throws when the snippet has gone", () => {
    const { repo } = fakeRepo();
    expect(() => setSnippetPinned(repo, { id: 99, isPinned: true })).toThrow(
      SnippetNotFoundError,
    );
  });
});

describe("setSnippetColor", () => {
  it("accepts a key from the shared palette", () => {
    const { repo, writes } = fakeRepo();

    setSnippetColor(repo, { id: 1, color: "ocean" });

    expect(writes.coloured[0]).toEqual({ id: 1, color: "ocean" });
  });

  it("accepts the empty string, which clears the tint", () => {
    const { repo, writes } = fakeRepo();

    setSnippetColor(repo, { id: 1, color: "" });

    expect(writes.coloured[0]).toEqual({ id: 1, color: "" });
  });

  it("refuses a colour outside the palette", () => {
    const { repo } = fakeRepo();
    // The keys are persisted, so the schema refusing an unknown one is what
    // stops a hex or a typo reaching the column.
    expect(() =>
      setSnippetColor(repo, { id: 1, color: "#ff0000" as never }),
    ).toThrow();
  });
});

describe("encryptSnippet", () => {
  it("seals title and body as separate blobs", () => {
    const { repo, writes } = fakeRepo();

    encryptSnippet(repo, { id: 1, password: "correct horse", passwordHint: "the usual" });

    const sealed = writes.sealed[0] as { titleEncrypted: string; codeEncrypted: string };
    // Separate blobs, each with its own salt and IV — never one key, two
    // plaintexts, one IV. Different ciphertext for different inputs is the
    // observable part of that.
    expect(sealed.titleEncrypted).not.toBe(sealed.codeEncrypted);
    expect(sealed.titleEncrypted).toMatch(/^v1:/);
    expect(sealed.codeEncrypted).toMatch(/^v1:/);
  });

  it("refuses a hint that contains the password", () => {
    const { repo } = fakeRepo();
    // The obvious mistake, and the only one a schema can catch.
    expect(() =>
      encryptSnippet(repo, { id: 1, password: "hunter2", passwordHint: "it is hunter2" }),
    ).toThrow();
  });

  it("refuses a hint containing the password in another case", () => {
    const { repo } = fakeRepo();
    expect(() =>
      encryptSnippet(repo, { id: 1, password: "Hunter2", passwordHint: "HUNTER2 again" }),
    ).toThrow();
  });

  it("refuses an empty password", () => {
    const { repo } = fakeRepo();
    expect(() => encryptSnippet(repo, { id: 1, password: "", passwordHint: "" })).toThrow();
  });

  it("throws for a snippet that does not exist", () => {
    const { repo } = fakeRepo();
    expect(() =>
      encryptSnippet(repo, { id: 99, password: "x", passwordHint: "" }),
    ).toThrow(SnippetNotFoundError);
  });
});

describe("openSnippet", () => {
  it("returns the plaintext of an unsealed snippet untouched", () => {
    const { repo } = fakeRepo();
    expect(openSnippet(repo, { id: 1, password: "anything" })).toEqual({
      title: "One",
      code: "x",
    });
  });

  it("throws for a snippet that does not exist", () => {
    const { repo } = fakeRepo();
    expect(() => openSnippet(repo, { id: 99, password: "x" })).toThrow(SnippetNotFoundError);
  });
});

describe("the recycle bin", () => {
  it("recycles a snippet rather than destroying it", () => {
    const { repo, writes } = fakeRepo();

    recycleSnippet(repo, 1);

    expect(writes.recycled).toEqual([1]);
  });

  it("throws when recycling a snippet that has gone", () => {
    const { repo } = fakeRepo();
    expect(() => recycleSnippet(repo, 99)).toThrow(SnippetNotFoundError);
  });

  it("returns the id a restored snippet came back as", () => {
    const { repo } = fakeRepo();
    // Usually the original id — that is the point of aiming at it.
    expect(restoreRecycledSnippet(repo, 1)).toBe(1);
  });

  it("throws restoring a bin row that is not there", () => {
    const { repo } = fakeRepo();
    expect(() => restoreRecycledSnippet(repo, 99)).toThrow(SnippetNotFoundError);
  });

  it("reports how many snippets emptying the bin destroyed", () => {
    const { repo } = fakeRepo();
    expect(emptyRecycleBin(repo)).toBe(3);
  });
});

describe("source URL", () => {
  it("accepts an http(s) link", () => {
    const { repo, writes } = fakeRepo();

    createSnippet(
      repo,
      { title: "", code: "x", language: "ts", sourceUrl: "https://example.com/a" },
      null,
    );

    const written = writes.created[0] as { input: { sourceUrl: string } };
    expect(written.input.sourceUrl).toBe("https://example.com/a");
  });

  it("refuses a javascript: URL", () => {
    const { repo } = fakeRepo();
    // The field is rendered as a link, so this would be a script vector in the
    // app's own origin — the same check `sanitizeClipHtml` makes on an href.
    expect(() =>
      createSnippet(
        repo,
        { title: "", code: "x", language: "ts", sourceUrl: "javascript:alert(1)" },
        null,
      ),
    ).toThrow();
  });

  it("allows it to be blank", () => {
    const { repo, writes } = fakeRepo();
    createSnippet(repo, { title: "", code: "x", language: "ts" } as never, null);
    const written = writes.created[0] as { input: { sourceUrl: string } };
    expect(written.input.sourceUrl).toBe("");
  });
});

describe("taxonomy management", () => {
  it("carries the previous name so a rename can rewrite the pairings", () => {
    const { repo, writes } = fakeRepo();

    saveSnippetTag(repo, { name: "postgres", description: "", previousName: "pg" });

    expect(writes.taxonomy[0]).toEqual({
      name: "postgres",
      description: "",
      previousName: "pg",
    });
  });

  it("refuses a blank name", () => {
    const { repo } = fakeRepo();
    // It reaches a `DELETE … WHERE name = ?`; a blank would be a no-op that
    // reported success.
    expect(() => deleteSnippetCategory(repo, "   ")).toThrow();
  });
});

describe("the list projection", () => {
  it("carries the whole body alongside the cut preview", () => {
    // The card renders `preview` and the Copy button writes `code`. If these ever
    // collapse into one field, one of those two is silently wrong — a card
    // showing the whole file, or a Copy that writes six lines and an ellipsis.
    const code = "1\n2\n3\n4\n5\n6\n7\n8";
    const { repo } = fakeRepo([
      {
        id: 1,
        title: "",
        preview: buildSnippetPreview(code, 3),
        code,
        language: "ts",
        lineCount: countSnippetLines(code),
        categories: [],
        tags: [],
        isPinned: false,
        color: "",
        sourceUrl: "",
        notes: "",
        isEncrypted: false,
        passwordHint: "",
        createdBy: null,
        createdAt: "",
        updatedAt: "",
      },
    ]);

    const [row] = listSnippets(repo);

    expect(row.code).toBe(code);
    expect(row.preview).not.toBe(row.code);
    expect(row.preview.endsWith("…")).toBe(true);
    // The count describes the snippet, not the preview — it is what the Copy
    // button's tooltip promises.
    expect(row.lineCount).toBe(8);
  });
});

describe("countSnippetLines", () => {
  it("counts the lines of the whole body", () => {
    expect(countSnippetLines("a\nb\nc")).toBe(3);
  });

  it("reports an empty snippet as zero lines, not one", () => {
    // `"".split("\n")` is `[""]`, so the naive count says 1 — which reads as a bug
    // on a card showing an empty snippet.
    expect(countSnippetLines("")).toBe(0);
  });
});
