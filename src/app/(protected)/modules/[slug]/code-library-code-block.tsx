// A snippet, highlighted.
//
// A **server** component with no "use client": the tokenizer is plain TypeScript
// in `src/lib/`, so the colouring happens during the server render and the page
// ships markup rather than a highlighter. That is the payoff for not taking a
// browser-side dependency — there is no hydration here, no flash of unhighlighted
// code, and nothing to load before a snippet is readable.
//
// Not registered in `components.md` and not in `src/components/`: it reads a
// Code Library domain type and knows this module's CSS class. If a second module
// ever wants it, that is the moment to generalise it — `components.md` says to
// ask then, not to guess now.

import { highlightCode, type SnippetLanguage } from "@/lib/code-library";

export function CodeLibraryCodeBlock({
  code,
  language,
  className = "",
}: {
  code: string;
  language: SnippetLanguage;
  className?: string;
}) {
  const tokens = highlightCode(code, language);

  return (
    // `code-block` is what globals.css paints with the derived `--code-*` tokens.
    // `overflow-x-auto` keeps a long line scrolling inside its own box instead of
    // forcing the page wide, which is design.md's rule for any wide content.
    <pre
      className={`code-block overflow-x-auto rounded-md bg-paper p-3 font-mono text-xs text-ink ${className}`}
    >
      {/* Each token is a React child, so React escapes it — a snippet containing
          `<script>` renders as those characters. This file must never reach for
          `dangerouslySetInnerHTML`; the tokenizer returns text, deliberately, so
          that it cannot. */}
      {tokens.map((token, index) =>
        token.kind === "plain" ? (
          // A plain run needs no element at all. Fewer spans on a long snippet.
          token.text
        ) : (
          <span
            // Index as key: this list is derived from one string and is never
            // reordered or edited in place, so position IS identity here.
            key={index}
            className={`tok-${token.kind}`}
          >
            {token.text}
          </span>
        ),
      )}
    </pre>
  );
}
