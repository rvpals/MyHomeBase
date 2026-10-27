// Turns pasted rich text into markup that is safe to store and re-render.
//
// ## Why an allowlist, not a strip-the-bad-parts pass
//
// The same argument `lib/icons/sanitize-svg.ts` makes, and it applies harder here.
// A blocklist has to anticipate every vector: `<script>`, but also `onload=` on any
// element, `javascript:` in an `href`, `<iframe>`, `<object>`, `<form>` posting
// somewhere, CSS `expression()` in a `style`. Miss one and it ships. An allowlist
// inverts the default: unknown element, unknown attribute — dropped. Vectors in
// future HTML features are excluded for free because they were never named.
//
// This matters more for clips than for icons because of where the input comes from.
// An icon is uploaded by an admin who chose the file. A clip is **pasted from an
// email**, which is the single most likely way for hostile markup to reach this app:
// the sender chose that content, not the reader. So this is a real hostile-input
// boundary, unlike `lib/journal-reports/sanitize.ts`, which says plainly that it is
// defence-in-depth over an author's own template. Do not use that one for paste.
//
// ## Why not DOMPurify
//
// It needs a DOM. `src/lib/` is plain TypeScript that has to run under the CLI and
// under Vitest with no browser, which is the same constraint that produced the
// hand-rolled SVG sanitizer. Adding jsdom to the server for this would be a large
// dependency for one feature. The regex pass below is the proportionate tool, and
// the allowlist is what makes it defensible: it fails closed.
//
// ## What survives
//
// Enough to keep a pasted email readable: headings, paragraphs, lists, tables, bold
// and italic, blockquotes, links and images. Everything structural about the sender's
// layout — their fonts, their colours, their widths — is dropped. That is deliberate
// rather than a limitation: a clip should read as part of this app, in this app's
// theme, and `design.md` is explicit that colours and fonts are theme tokens and not
// literal values pasted in from somewhere else.

/** What a sanitise pass produced, and what it had to remove. */
export interface SanitizeHtmlResult {
  /** The cleaned markup, safe to store and to render. */
  html: string;
  /**
   * One line per kind of removal, empty when nothing was stripped. Shown to the
   * reader after a paste so a vanished table is explained rather than mysterious.
   */
  removed: string[];
}

/**
 * Elements kept, by what they do.
 *
 * `table` and friends are the reason this module exists — a pasted email's table is
 * usually the part worth keeping, and it is also the first thing a naive
 * "strip all tags" pass destroys.
 */
const ALLOWED_ELEMENTS = new Set([
  // Block text
  "p", "br", "hr", "div",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "blockquote", "pre", "code",
  // Lists
  "ul", "ol", "li",
  // Tables
  "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption",
  // Inline
  "b", "strong", "i", "em", "u", "s", "strike", "sub", "sup", "span", "mark", "small",
  // Links and images
  "a", "img",
]);

/**
 * Elements removed **with their contents**.
 *
 * Dropping only the tags would leave a script body or a stylesheet as visible page
 * text, which is both ugly and, for `<style>`, still able to restyle the page when
 * re-rendered. `<form>`, `<input>` and `<button>` are here because a pasted phishing
 * email carries a working form, and a form inside this app's origin is worse than one
 * in a mail client.
 */
const CODE_ELEMENTS = [
  "script", "style", "iframe", "object", "embed", "applet", "noscript",
  "form", "input", "button", "select", "textarea", "link", "meta", "base", "title", "svg",
];

/**
 * Attributes kept, per element where it matters.
 *
 * `style` is **not** here, and that is the single biggest decision in this file.
 * A pasted email is mostly inline `style`, so keeping it would preserve the sender's
 * look — at the cost of letting arbitrary CSS into this app's pages (`position:fixed`
 * over the nav, `background:url(...)` phoning home, colours that vanish in dark mode).
 * Dropping it is what makes a clip render in this app's theme instead of the sender's.
 *
 * `colspan`/`rowspan` are kept because without them a merged-cell table re-renders
 * as a visibly wrong grid, which is worse than not keeping the table at all.
 */
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(["href", "title"]),
  img: new Set(["src", "alt", "width", "height"]),
  td: new Set(["colspan", "rowspan"]),
  th: new Set(["colspan", "rowspan", "scope"]),
  ol: new Set(["start"]),
};

/**
 * URL schemes an `href` may use.
 *
 * `mailto:` is allowed because a pasted email is full of them and they are the whole
 * point of pasting one. `data:` is refused outright — `data:text/html` is a script
 * vector, and a legitimate pasted image does not travel this path: images are
 * extracted to their own rows and rewritten to `/api/clips/images/...` before this
 * sanitizer ever sees them.
 */
const SAFE_URL = /^(https?:\/\/|mailto:|\/)/i;

/**
 * The allowlist for an element that keeps no attributes.
 *
 * A shared frozen empty set rather than `{}` per call: it lets `sanitizeAttributes`
 * treat "no attributes allowed" and "these attributes allowed" as one path, so the
 * reporting scan runs for every element instead of only the five with entries above.
 */
const EMPTY_ATTRS: ReadonlySet<string> = new Set<string>();

/** Drops an element and everything inside it. */
function removeElementTree(source: string, tag: string): { html: string; hit: boolean } {
  const paired = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi");
  const unpaired = new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi");
  const before = source;
  const html = source.replace(paired, "").replace(unpaired, "");
  return { html, hit: html !== before };
}

function sanitizeAttributes(tag: string, rawAttrs: string, removed: Set<string>): string {
  // NOT an early return for an element with no allowlist entry.
  //
  // Most allowed elements -- `p`, `div`, `span`, every heading -- keep no attributes
  // at all, so returning here was the common path, not the rare one. The scan below
  // is what *reports* a dropped `style` or `onclick`, and skipping it meant the
  // markup was correctly stripped while `removed` came back empty: the reader was
  // told nothing had been removed from the very paste most likely to carry it.
  //
  // The security outcome was never affected -- nothing was kept either way. What was
  // broken was the explanation, which is this module's other job.
  const allowed = ALLOWED_ATTRS[tag] ?? EMPTY_ATTRS;

  const kept: string[] = [];
  const attr = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/g;

  let match: RegExpExecArray | null;
  while ((match = attr.exec(rawAttrs)) !== null) {
    const name = match[1].toLowerCase();
    const value = (match[3] ?? match[4] ?? "").trim();

    if (name.startsWith("on")) {
      removed.add("inline event handlers (onclick, onerror, …)");
      continue;
    }
    if (name === "style") {
      removed.add("inline styles — a clip renders in this app's theme");
      continue;
    }
    if (!allowed.has(name)) continue;
    // A value carrying a raw angle bracket can reopen tag parsing downstream.
    if (/[<>]/.test(value)) continue;

    if ((name === "href" || name === "src") && !SAFE_URL.test(value)) {
      removed.add("links and images using an unsafe URL scheme");
      continue;
    }

    kept.push(`${name}="${value.replace(/"/g, "&quot;")}"`);
  }

  // Every surviving link leaves this app, so it opens in a new tab and is denied
  // access to the opener. `noreferrer` as well as `noopener` because a clip may hold
  // a tracking URL from an email and there is no reason to hand it a referrer.
  if (tag === "a" && kept.some((a) => a.startsWith("href="))) {
    kept.push('target="_blank"', 'rel="noopener noreferrer"');
  }

  return kept.length ? ` ${kept.join(" ")}` : "";
}

/**
 * Reduces pasted markup to what a clip may store.
 *
 * Unknown elements are dropped **tag-and-all, keeping their children** — so a
 * `<font>` wrapper or one of Word's `<o:p>` oddities loses itself rather than
 * deleting the text inside it. That is the opposite of how `CODE_ELEMENTS` are
 * handled, and the difference is the whole point: a wrapper's contents are the
 * reader's text, a script's contents are code.
 */
export function sanitizeClipHtml(source: string): SanitizeHtmlResult {
  const removed = new Set<string>();
  let html = source;

  // Comments first: a comment can contain a stray `-->` that reopens parsing, and
  // stripping them before the element pass means no tag hides inside one. Word and
  // Outlook both paste large conditional-comment blocks, so this is a normal path.
  html = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
  html = html.replace(/<!DOCTYPE[^>]*>/gi, "");

  for (const tag of CODE_ELEMENTS) {
    const result = removeElementTree(html, tag);
    html = result.html;
    if (result.hit) {
      removed.add(
        tag === "style"
          ? "stylesheets"
          : tag === "form" || tag === "input" || tag === "button"
            ? "forms and their controls"
            : `<${tag}> blocks`,
      );
    }
  }

  html = html.replace(
    /<\/?([a-zA-Z][-a-zA-Z0-9:]*)((?:[^>"']|"[^"]*"|'[^']*')*)\/?>/g,
    (whole: string, rawName: string, rawAttrs: string) => {
      const name = rawName.toLowerCase();
      if (!ALLOWED_ELEMENTS.has(name)) return "";
      if (whole.startsWith("</")) return `</${name}>`;
      const attrs = sanitizeAttributes(name, rawAttrs, removed);

      // An `<img>` whose `src` did not survive is dropped rather than emitted bare.
      // This is the common Outlook case, not an edge one: an inline image is pasted
      // as `src="cid:image001.png@01D9"`, a reference into the MIME message that is
      // not on the clipboard at all and that nothing here can resolve. Left in place
      // it renders as a broken-image icon in every clip; removed, the text around it
      // reads cleanly and `removed` already tells the reader an image was dropped.
      if (name === "img" && !attrs.includes("src=")) return "";

      // Rebuilt without the self-closing slash in every case: `<br/>` and `<br>` are
      // the same node in HTML5, and emitting one form keeps the stored markup uniform.
      return `<${name}${attrs}>`;
    },
  );

  return { html: html.trim(), removed: [...removed] };
}

/**
 * Plain text from sanitized markup, for a list excerpt and for search.
 *
 * Block-level tags become a space rather than nothing, so "…end of a row</td><td>next…"
 * does not read as "rownext". Runs of whitespace then collapse, which also disposes of
 * the indentation a pasted email arrives with.
 */
export function clipHtmlToText(html: string): string {
  return html
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/td|\/th)\b[^>]*>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * How long an excerpt runs before it is cut, when no length is asked for.
 *
 * Kept as the fallback for callers that do not carry the reader's preference — the
 * journal's clip badge, the CLI's one-line listing. The board and the list both pass
 * the configured length instead; see `src/lib/clips/settings.ts`.
 */
export const CLIP_EXCERPT_LENGTH = 200;

/**
 * A card's text: plain text, cut on a word boundary where one is near.
 *
 * `maxLength` is the reader's configured excerpt length. A non-positive or absent
 * value falls back to the default rather than returning nothing — an excerpt of zero
 * characters is never what a caller meant, and a blank card is a worse answer than a
 * default-length one.
 */
export function buildClipExcerpt(html: string, maxLength = CLIP_EXCERPT_LENGTH): string {
  const limit = maxLength > 0 ? Math.floor(maxLength) : CLIP_EXCERPT_LENGTH;
  const text = clipHtmlToText(html);
  if (text.length <= limit) return text;

  const cut = text.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  // Only honour a word boundary in the last fifth, so a long unbroken string — a URL,
  // a base64 fragment — is not cut back to almost nothing chasing a space.
  const body = lastSpace > limit * 0.8 ? cut.slice(0, lastSpace) : cut;
  return `${body.trimEnd()}…`;
}
