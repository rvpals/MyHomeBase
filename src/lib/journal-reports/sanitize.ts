// Strips the actively dangerous constructs from a stored HTML template.
//
// The template is author-written and rendered with dangerouslySetInnerHTML, so
// this is defence in depth rather than a sanitiser for hostile input: in a
// single-user home app the author and the reader are the same person. What it
// actually prevents is a template pasted in from a web page carrying a tracking
// script or an onerror handler into a screen that then runs it on every print.
//
// NOT DOMPurify: that needs a DOM, and `src/lib/` is plain TypeScript that has
// to run under the CLI and Vitest with no browser. A regex pass over a template
// the author wrote is the proportionate tool here, and saying so is better than
// implying this is a hostile-input boundary.
//
// Substituted VALUES are escaped separately in render.ts. That is the part that
// handles real data (an entry title containing `<script>`), and it is escaping
// rather than stripping, so no entry text is ever altered by it.

/** What a sanitise pass removed, so the editor can tell the author. */
export interface SanitizeResult {
  html: string;
  /** One line per kind of removal, empty when nothing was stripped. */
  removed: string[];
}

/**
 * Element names whose content is code, not markup. Removed with their contents —
 * dropping only the tags would leave the script body as visible page text.
 */
const CODE_ELEMENTS = ["script", "style", "iframe", "object", "embed", "applet", "noscript"] as const;

export function sanitizeReportHtml(html: string): SanitizeResult {
  const removed: string[] = [];
  let out = html;

  for (const element of CODE_ELEMENTS) {
    // Paired form, contents included. `[\s\S]` rather than `.` so it spans
    // newlines, which a pasted-in script almost always does.
    const paired = new RegExp(`<${element}\\b[\\s\\S]*?<\\/${element}\\s*>`, "gi");
    if (paired.test(out)) {
      out = out.replace(paired, "");
      removed.push(`<${element}> blocks`);
    }
    // Unpaired/self-closing form, which the paired pattern above misses.
    const unpaired = new RegExp(`<\\/?${element}\\b[^>]*>`, "gi");
    if (unpaired.test(out)) {
      out = out.replace(unpaired, "");
      if (!removed.includes(`<${element}> blocks`)) removed.push(`<${element}> tags`);
    }
  }

  // Inline event handlers: onclick, onerror, onload, and the rest. Matched in
  // quoted and unquoted forms, and only when the attribute name follows
  // whitespace — so a word like "soon" inside text can't be mistaken for one.
  const handler = /\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
  if (handler.test(out)) {
    out = out.replace(handler, "");
    removed.push("inline event handlers (onclick, onerror, …)");
  }

  // `javascript:` and `data:text/html` URLs in href/src. The scheme is stripped
  // to `#` rather than the whole attribute, so the element keeps its shape and
  // the author can see what was defused.
  const scheme = /\b(href|src|action|formaction)\s*=\s*(?:"\s*(?:javascript|data)\s*:[^"]*"|'\s*(?:javascript|data)\s*:[^']*'|(?:javascript|data)\s*:[^\s>]*)/gi;
  if (scheme.test(out)) {
    out = out.replace(scheme, '$1="#"');
    removed.push("javascript: and data: URLs");
  }

  return { html: out, removed };
}

/** True when the template would be changed by a sanitise pass. */
export function needsSanitizing(html: string): boolean {
  return sanitizeReportHtml(html).removed.length > 0;
}
