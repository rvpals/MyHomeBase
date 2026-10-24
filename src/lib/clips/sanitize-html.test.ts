import { describe, expect, it } from "vitest";
import {
  buildClipExcerpt,
  clipHtmlToText,
  CLIP_EXCERPT_LENGTH,
  sanitizeClipHtml,
} from "./sanitize-html";

describe("sanitizeClipHtml — what it keeps", () => {
  it("keeps the formatting a pasted email is worth keeping for", () => {
    const { html } = sanitizeClipHtml(
      "<p>Hello <strong>Min</strong>, see <em>below</em>.</p><ul><li>One</li><li>Two</li></ul>",
    );
    expect(html).toBe(
      "<p>Hello <strong>Min</strong>, see <em>below</em>.</p><ul><li>One</li><li>Two</li></ul>",
    );
  });

  it("keeps a table whole, including merged cells", () => {
    const source =
      '<table><thead><tr><th scope="col">Item</th><th>Cost</th></tr></thead>' +
      '<tbody><tr><td colspan="2">Nothing yet</td></tr></tbody></table>';
    const { html } = sanitizeClipHtml(source);
    expect(html).toContain("<table>");
    expect(html).toContain('<th scope="col">');
    expect(html).toContain('<td colspan="2">');
    expect(html).toContain("</table>");
  });

  it("keeps headings, blockquotes and code", () => {
    const { html } = sanitizeClipHtml(
      "<h2>Subject</h2><blockquote>Quoted reply</blockquote><pre><code>npm run dev</code></pre>",
    );
    expect(html).toContain("<h2>Subject</h2>");
    expect(html).toContain("<blockquote>Quoted reply</blockquote>");
    expect(html).toContain("<code>npm run dev</code>");
  });

  it("keeps an http link and a mailto link", () => {
    const { html } = sanitizeClipHtml(
      '<a href="https://example.com">site</a> <a href="mailto:a@b.com">mail</a>',
    );
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('href="mailto:a@b.com"');
  });

  it("keeps an image that already points at the app's own route", () => {
    const { html } = sanitizeClipHtml('<img src="/api/clips/images/12" alt="Chart">');
    expect(html).toContain('src="/api/clips/images/12"');
    expect(html).toContain('alt="Chart"');
  });
});

describe("sanitizeClipHtml — what it removes", () => {
  it("removes a script and its body, not just the tags", () => {
    const { html, removed } = sanitizeClipHtml("<p>Hi</p><script>steal()</script>");
    expect(html).toBe("<p>Hi</p>");
    expect(html).not.toContain("steal");
    expect(removed).toContain("<script> blocks");
  });

  it("removes a stylesheet and its body", () => {
    const { html, removed } = sanitizeClipHtml("<style>body{display:none}</style><p>Hi</p>");
    expect(html).toBe("<p>Hi</p>");
    expect(html).not.toContain("display:none");
    expect(removed).toContain("stylesheets");
  });

  it("removes inline event handlers", () => {
    const { html, removed } = sanitizeClipHtml('<p onclick="steal()">Hi</p>');
    expect(html).toBe("<p>Hi</p>");
    expect(removed).toContain("inline event handlers (onclick, onerror, …)");
  });

  it("removes an onerror handler smuggled on an image", () => {
    const { html } = sanitizeClipHtml('<img src="/api/clips/images/1" onerror="steal()">');
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("steal");
  });

  it("removes inline styles so the clip renders in this app's theme", () => {
    const { html, removed } = sanitizeClipHtml(
      '<p style="position:fixed;color:#ff0000">Hi</p>',
    );
    expect(html).toBe("<p>Hi</p>");
    expect(removed).toContain("inline styles — a clip renders in this app's theme");
  });

  it("refuses a javascript: link", () => {
    const { html, removed } = sanitizeClipHtml('<a href="javascript:steal()">click</a>');
    expect(html).not.toContain("javascript:");
    expect(html).toContain("click");
    expect(removed).toContain("links and images using an unsafe URL scheme");
  });

  it("refuses a data:text/html image source", () => {
    const { html } = sanitizeClipHtml('<img src="data:text/html;base64,PHNjcmlwdD4=">');
    expect(html).not.toContain("data:");
  });

  it("drops an Outlook cid: image rather than leaving a broken one", () => {
    // The common case, not an edge one: Outlook pastes inline images as a `cid:`
    // reference into the MIME message, which is not on the clipboard. Emitting a
    // bare <img> would show a broken-image icon in the clip forever.
    const { html, removed } = sanitizeClipHtml('<p>Hi</p><img src="cid:image001.png@01D9">');
    expect(html).toBe("<p>Hi</p>");
    expect(removed).toContain("links and images using an unsafe URL scheme");
  });

  it("keeps an img that has no src at all out of the output", () => {
    expect(sanitizeClipHtml('<img alt="nothing">').html).toBe("");
  });

  it("removes a phishing form and its controls", () => {
    const { html, removed } = sanitizeClipHtml(
      '<form action="https://evil.test"><input name="password"><button>Go</button></form><p>Hi</p>',
    );
    expect(html).toBe("<p>Hi</p>");
    expect(html).not.toContain("evil.test");
    expect(removed).toContain("forms and their controls");
  });

  it("removes an iframe", () => {
    const { html } = sanitizeClipHtml('<iframe src="https://evil.test"></iframe><p>Hi</p>');
    expect(html).toBe("<p>Hi</p>");
  });

  it("drops an unknown wrapper but keeps the text inside it", () => {
    const { html } = sanitizeClipHtml("<font face=Arial>Important text</font>");
    expect(html).toBe("Important text");
  });

  it("strips Word's conditional comments without eating the content after them", () => {
    const { html } = sanitizeClipHtml(
      "<!--[if gte mso 9]><xml>junk</xml><![endif]--><p>Real content</p>",
    );
    expect(html).toContain("Real content");
    expect(html).not.toContain("junk");
  });

  it("does not let a tag hide inside a comment", () => {
    const { html } = sanitizeClipHtml("<!-- <script>steal()</script> --><p>Hi</p>");
    expect(html).toBe("<p>Hi</p>");
    expect(html).not.toContain("steal");
  });

  it("gives an external link a safe target and rel", () => {
    const { html } = sanitizeClipHtml('<a href="https://example.com">site</a>');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("reports nothing removed for already-clean markup", () => {
    const { removed } = sanitizeClipHtml("<p>Just text</p>");
    expect(removed).toEqual([]);
  });

  it("returns empty for empty input rather than throwing", () => {
    expect(sanitizeClipHtml("").html).toBe("");
  });
});

describe("clipHtmlToText", () => {
  it("separates table cells with a space instead of running them together", () => {
    expect(clipHtmlToText("<tr><td>end of row</td><td>next</td></tr>")).toBe("end of row next");
  });

  it("separates block elements", () => {
    expect(clipHtmlToText("<p>One</p><p>Two</p>")).toBe("One Two");
  });

  it("decodes the entities a paste actually carries", () => {
    expect(clipHtmlToText("<p>Tom&nbsp;&amp;&nbsp;Jerry</p>")).toBe("Tom & Jerry");
  });

  it("collapses the indentation a pasted email arrives with", () => {
    expect(clipHtmlToText("<p>One</p>\n\n   <p>Two</p>")).toBe("One Two");
  });
});

describe("buildClipExcerpt", () => {
  it("returns short text unchanged and unellipsised", () => {
    expect(buildClipExcerpt("<p>Short note</p>")).toBe("Short note");
  });

  it("cuts long text and marks it as cut", () => {
    const excerpt = buildClipExcerpt(`<p>${"word ".repeat(200)}</p>`);
    expect(excerpt.endsWith("…")).toBe(true);
    expect(excerpt.length).toBeLessThanOrEqual(CLIP_EXCERPT_LENGTH + 1);
  });

  it("does not cut an unbroken string back to almost nothing chasing a space", () => {
    // One long token with a space very early: honouring that space would leave "a…".
    const excerpt = buildClipExcerpt(`<p>a ${"x".repeat(400)}</p>`);
    expect(excerpt.length).toBeGreaterThan(CLIP_EXCERPT_LENGTH * 0.9);
  });
});
