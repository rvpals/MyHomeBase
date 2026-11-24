import { describe, expect, it } from "vitest";
import { highlightCode, type CodeToken } from "./highlight";
import { SNIPPET_LANGUAGES, type SnippetLanguage } from "./schema";

/** What the renderer will put on screen, reassembled. */
function rendered(tokens: CodeToken[]): string {
  return tokens.map((token) => token.text).join("");
}

function kindsOf(tokens: CodeToken[], kind: string): string[] {
  return tokens.filter((token) => token.kind === kind).map((token) => token.text);
}

/**
 * Inputs that between them hit every branch: each comment style, each quote
 * style, escapes, an unterminated comment and an unterminated string, a number
 * that is really part of a name, and a body that is nothing but whitespace.
 */
const FIXTURES: [SnippetLanguage, string][] = [
  ["ts", "const x = 1; // note\nfunction f(a: string) { return `a${a}`; }"],
  ["ts", "/* unterminated"],
  ["ts", 'const s = "he said \\"hi\\"";'],
  ["python", "def f(x):\n    # comment with 'quote\n    return 'it\\'s'"],
  ["sql", "SELECT a FROM t -- note\nWHERE b = 'x' /* block */ AND c > 1"],
  ["bash", "echo \"$HOME\" # comment"],
  ["powershell", "<# block #>\nfunction Get-Thing { param($a) }"],
  ["json", '{"a": 1, "b": [true, null]}'],
  ["yaml", "key: value # note\nlist:\n  - true"],
  ["html", "<!-- c --><p class=\"x\">hi</p>"],
  ["css", ".a { color: red; /* c */ }"],
  ["text", "just some words"],
  ["ts", "   \n\t  "],
  ["ts", ""],
  ["ts", "utf8 and 0xFF and 3.14"],
  ["ts", 'const unterminated = "oops'],
];

describe("highlightCode", () => {
  // THE load-bearing test. The renderer puts these tokens straight into the DOM,
  // so anything dropped or duplicated here is a snippet shown wrong — in the one
  // module whose whole promise is that what comes out is what went in.
  it.each(FIXTURES)("reproduces the input exactly for %s", (language, code) => {
    expect(rendered(highlightCode(code, language))).toBe(code);
  });

  it("reproduces the input for every language on the list", () => {
    // Catches a language added to SNIPPET_LANGUAGES whose grammar breaks the
    // invariant, and one added with no grammar at all (which must degrade to
    // plain rather than throw).
    const sample = "a = 1 // 'two' /* three */\n#four\n";
    for (const language of SNIPPET_LANGUAGES) {
      expect(rendered(highlightCode(sample, language)), language).toBe(sample);
    }
  });

  it("returns no tokens for an empty body", () => {
    expect(highlightCode("", "ts")).toEqual([]);
  });

  it("leaves an unknown or plain language entirely unmarked", () => {
    const tokens = highlightCode("select * from t", "text");
    expect(tokens).toEqual([{ kind: "plain", text: "select * from t" }]);
  });

  it("marks keywords, strings, numbers and comments in TypeScript", () => {
    const tokens = highlightCode('const n = 42; // why\nreturn "s";', "ts");

    expect(kindsOf(tokens, "keyword")).toEqual(["const", "return"]);
    expect(kindsOf(tokens, "number")).toEqual(["42"]);
    expect(kindsOf(tokens, "string")).toEqual(['"s"']);
    expect(kindsOf(tokens, "comment")).toEqual(["// why"]);
  });

  it("matches SQL keywords whatever their case", () => {
    // The keyword list is upper-case; a snippet written in lower case has to
    // highlight too, or half the SQL anyone pastes comes out plain.
    const tokens = highlightCode("select a from t where b = 1", "sql");
    expect(kindsOf(tokens, "keyword")).toEqual(["select", "from", "where"]);
  });

  it("does not treat a comment marker inside a string as a comment", () => {
    const tokens = highlightCode("x = '# not a comment'", "python");
    expect(kindsOf(tokens, "comment")).toEqual([]);
    expect(kindsOf(tokens, "string")).toEqual(["'# not a comment'"]);
  });

  it("does not treat a quote inside a comment as a string", () => {
    const tokens = highlightCode("// it's fine", "ts");
    expect(kindsOf(tokens, "string")).toEqual([]);
    expect(kindsOf(tokens, "comment")).toEqual(["// it's fine"]);
  });

  it("honours a backslash escape where the language has them", () => {
    const tokens = highlightCode('"a\\"b" x', "ts");
    expect(kindsOf(tokens, "string")).toEqual(['"a\\"b"']);
  });

  it("does not honour escapes in SQL, where a backslash is not one", () => {
    // SQL escapes a quote by doubling it, so treating `\` as an escape would
    // swallow the rest of the statement into one string.
    const tokens = highlightCode("'a\\' , 'b'", "sql");
    expect(kindsOf(tokens, "string")).toEqual(["'a\\'", "'b'"]);
  });

  it("marks a name followed by a bracket as an entity, and others as plain", () => {
    const tokens = highlightCode("doThing(other)", "ts");
    expect(kindsOf(tokens, "entity")).toEqual(["doThing"]);
    expect(kindsOf(tokens, "plain")).toContain("other");
  });

  it("does not read the tail of an identifier as a number", () => {
    const tokens = highlightCode("utf8", "ts");
    expect(kindsOf(tokens, "number")).toEqual([]);
  });

  it("runs an unterminated string to the end rather than losing it", () => {
    const code = 'const s = "oops';
    const tokens = highlightCode(code, "ts");
    expect(rendered(tokens)).toBe(code);
    expect(kindsOf(tokens, "string")).toEqual(['"oops']);
  });

  it("runs an unterminated block comment to the end rather than losing it", () => {
    const code = "/* oops\nmore";
    const tokens = highlightCode(code, "ts");
    expect(rendered(tokens)).toBe(code);
    expect(kindsOf(tokens, "comment")).toEqual([code]);
  });

  it("preserves indentation and blank lines", () => {
    // The module's central promise, asserted at the display layer too.
    const code = "def f():\n\n    return 1\n";
    expect(rendered(highlightCode(code, "python"))).toBe(code);
  });
});
