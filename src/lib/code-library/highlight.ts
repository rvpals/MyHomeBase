// A small syntax tokenizer: code in, labelled spans out.
//
// ## Why hand-rolled and not Prism
//
// Two reasons, and the second is the one that mattered.
//
// First, this repo already makes this call twice — `lib/clips/sanitize-html.ts`
// and `lib/icons/sanitize-svg.ts` are both hand-rolled rather than pulling in
// DOMPurify, because `src/lib/` is plain TypeScript that has to run under the CLI
// and under Vitest with no browser. The same constraint applies here, and a
// tokenizer that runs server-side means highlighting is plain server-rendered
// markup: no client island, no hydration, and no fighting a contentEditable.
//
// Second, at the time this was written `npm install` could not add a dependency
// to this project at all — `package.json` pins `@types/node@^20` while
// `vitest@^5` requires `^22 || >=24`, so every install fails ERESOLVE. That is a
// pre-existing conflict and nothing to do with highlighting, but it did decide
// this file's existence.
//
// ## What this is not
//
// It is not a parser and it will never match a real grammar. It knows comments,
// strings, numbers, a keyword list per language, and a name followed by `(`. That
// covers what makes a snippet *scannable*, which is the job. It will mislabel
// things a parser would get right — a `#` inside a Python string is handled, a
// regex literal containing a quote is not. The invariant below is what keeps
// those mistakes cosmetic.
//
// ## The invariant
//
// **Concatenating every token's text must reproduce the input exactly.** The
// renderer puts these straight into the DOM, so anything this drops or duplicates
// is a snippet displayed wrong — in a module whose entire promise is that what
// comes out is what went in. The test asserts it over every fixture.

import type { SnippetLanguage } from "./schema";

export type CodeTokenKind =
  | "keyword"
  | "string"
  | "number"
  | "comment"
  | "entity"
  | "punctuation"
  | "plain";

export interface CodeToken {
  kind: CodeTokenKind;
  text: string;
}

interface Grammar {
  /** Markers that start a comment running to end of line. */
  lineComment: string[];
  /** Paired delimiters for a comment spanning lines, if the language has one. */
  blockComment?: { open: string; close: string };
  /** Characters that open and close a string. A backslash escapes inside one. */
  quotes: string[];
  /** Whether a backslash escapes the next character inside a string. */
  escapes: boolean;
  keywords: Set<string>;
}

const C_LIKE_PUNCTUATION = "{}()[];:,.<>=+-*/%!&|^~?";

function keywords(list: string): Set<string> {
  return new Set(list.split(" "));
}

/**
 * One grammar per language on `SNIPPET_LANGUAGES`, minus `text`.
 *
 * A language with no entry here renders as plain — which is what `text` wants
 * anyway, and what a language added to the list but not to this map degrades to.
 * That degradation is deliberate: an unhighlighted snippet is readable, and a
 * thrown error in a render path is not.
 */
const GRAMMARS: Partial<Record<SnippetLanguage, Grammar>> = {
  ts: {
    lineComment: ["//"],
    blockComment: { open: "/*", close: "*/" },
    quotes: ['"', "'", "`"],
    escapes: true,
    keywords: keywords(
      "abstract any as async await boolean break case catch class const continue declare default delete do else enum export extends false finally for from function get if implements import in instanceof interface keyof let new null number of private protected public readonly return satisfies set static string super switch this throw true try type typeof undefined unknown var void while yield",
    ),
  },
  js: {
    lineComment: ["//"],
    blockComment: { open: "/*", close: "*/" },
    quotes: ['"', "'", "`"],
    escapes: true,
    keywords: keywords(
      "async await break case catch class const continue default delete do else export extends false finally for from function if import in instanceof let new null of return super switch this throw true try typeof undefined var void while yield",
    ),
  },
  python: {
    lineComment: ["#"],
    quotes: ['"', "'"],
    escapes: true,
    keywords: keywords(
      "and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield",
    ),
  },
  sql: {
    lineComment: ["--"],
    blockComment: { open: "/*", close: "*/" },
    quotes: ["'", '"'],
    escapes: false,
    keywords: keywords(
      "ADD ALL ALTER AND AS ASC BETWEEN BY CASE CAST COLLATE COLUMN CONFLICT CREATE CROSS DEFAULT DELETE DESC DISTINCT DROP ELSE END EXISTS FOREIGN FROM FULL GROUP HAVING IF IN INDEX INNER INSERT INTO IS JOIN KEY LEFT LIKE LIMIT NOT NULL OFFSET ON OR ORDER OUTER PRIMARY REFERENCES RETURNING RIGHT SELECT SET TABLE THEN UNION UNIQUE UPDATE USING VALUES VIEW WHEN WHERE WITH",
    ),
  },
  bash: {
    lineComment: ["#"],
    quotes: ['"', "'"],
    escapes: true,
    keywords: keywords(
      "case do done elif else esac export fi for function if in local return then until while echo cd set unset source alias",
    ),
  },
  powershell: {
    lineComment: ["#"],
    blockComment: { open: "<#", close: "#>" },
    quotes: ['"', "'"],
    escapes: false,
    keywords: keywords(
      "begin break catch continue do dynamicparam else elseif end exit filter finally for foreach function if in param process return switch throw trap try until while",
    ),
  },
  json: {
    lineComment: [],
    quotes: ['"'],
    escapes: true,
    keywords: keywords("true false null"),
  },
  yaml: {
    lineComment: ["#"],
    quotes: ['"', "'"],
    escapes: true,
    keywords: keywords("true false null yes no on off"),
  },
  html: {
    lineComment: [],
    blockComment: { open: "<!--", close: "-->" },
    quotes: ['"', "'"],
    escapes: false,
    keywords: keywords(""),
  },
  css: {
    lineComment: [],
    blockComment: { open: "/*", close: "*/" },
    quotes: ['"', "'"],
    escapes: false,
    keywords: keywords(""),
  },
};

const IDENTIFIER_START = /[A-Za-z_$@-]/;
const IDENTIFIER_BODY = /[A-Za-z0-9_$@-]/;

/**
 * Splits code into labelled tokens.
 *
 * Always answers, for any input and any language — this runs in a render path.
 * An unknown language, or `text`, comes back as a single `plain` token rather
 * than throwing.
 */
export function highlightCode(code: string, language: SnippetLanguage): CodeToken[] {
  const grammar = GRAMMARS[language];
  if (!grammar || code === "") {
    return code === "" ? [] : [{ kind: "plain", text: code }];
  }

  const tokens: CodeToken[] = [];
  // Plain text accumulates here and is flushed whenever something else starts,
  // so a run of ordinary characters is one token rather than one per character.
  let plain = "";

  const flush = () => {
    if (plain !== "") {
      tokens.push({ kind: "plain", text: plain });
      plain = "";
    }
  };

  const push = (kind: CodeTokenKind, text: string) => {
    flush();
    tokens.push({ kind, text });
  };

  let index = 0;

  while (index < code.length) {
    const rest = code.slice(index);

    // Block comment first: `/*` would otherwise be read as punctuation.
    if (grammar.blockComment && rest.startsWith(grammar.blockComment.open)) {
      const closeAt = code.indexOf(grammar.blockComment.close, index + grammar.blockComment.open.length);
      // An unterminated comment runs to the end of the snippet, which is what an
      // editor shows and keeps the invariant: everything is still emitted.
      const end = closeAt === -1 ? code.length : closeAt + grammar.blockComment.close.length;
      push("comment", code.slice(index, end));
      index = end;
      continue;
    }

    const lineMarker = grammar.lineComment.find((marker) => rest.startsWith(marker));
    if (lineMarker) {
      const newlineAt = code.indexOf("\n", index);
      const end = newlineAt === -1 ? code.length : newlineAt;
      push("comment", code.slice(index, end));
      index = end;
      continue;
    }

    const char = code[index];

    if (grammar.quotes.includes(char)) {
      let cursor = index + 1;
      while (cursor < code.length) {
        if (grammar.escapes && code[cursor] === "\\") {
          cursor += 2;
          continue;
        }
        if (code[cursor] === char) {
          cursor += 1;
          break;
        }
        cursor += 1;
      }
      // `Math.min` because an escape at the very end can step past the end.
      const end = Math.min(cursor, code.length);
      push("string", code.slice(index, end));
      index = end;
      continue;
    }

    // A number, but not the tail of an identifier like `utf8`.
    if (/[0-9]/.test(char) && (index === 0 || !IDENTIFIER_BODY.test(code[index - 1]))) {
      let cursor = index;
      while (cursor < code.length && /[0-9a-fA-FxX._]/.test(code[cursor])) cursor += 1;
      push("number", code.slice(index, cursor));
      index = cursor;
      continue;
    }

    if (IDENTIFIER_START.test(char)) {
      let cursor = index;
      while (cursor < code.length && IDENTIFIER_BODY.test(code[cursor])) cursor += 1;
      const word = code.slice(index, cursor);

      if (grammar.keywords.has(word) || grammar.keywords.has(word.toUpperCase())) {
        push("keyword", word);
      } else if (code[cursor] === "(") {
        // A name immediately followed by `(` — a call or a declaration. Crude,
        // and right often enough to be worth the two characters it costs.
        push("entity", word);
      } else {
        plain += word;
      }

      index = cursor;
      continue;
    }

    if (C_LIKE_PUNCTUATION.includes(char)) {
      push("punctuation", char);
      index += 1;
      continue;
    }

    plain += char;
    index += 1;
  }

  flush();
  return tokens;
}
