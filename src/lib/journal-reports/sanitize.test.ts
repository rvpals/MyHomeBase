import { describe, expect, it } from "vitest";
import { needsSanitizing, sanitizeReportHtml } from "./sanitize";

describe("sanitizeReportHtml", () => {
  it("leaves ordinary template markup alone", () => {
    const html = '<h1>{{stat.reportName}}</h1>\n<table><tr><td>{{title}}</td></tr></table>';
    const result = sanitizeReportHtml(html);
    expect(result.html).toBe(html);
    expect(result.removed).toEqual([]);
  });

  it("removes a script block with its contents", () => {
    // Dropping only the tags would leave the script body as visible page text.
    const result = sanitizeReportHtml('<p>Hi</p><script>alert("x")</script><p>Bye</p>');
    expect(result.html).toBe("<p>Hi</p><p>Bye</p>");
    expect(result.html).not.toContain("alert");
    expect(result.removed).toContain("<script> blocks");
  });

  it("removes a multi-line script, which is what a pasted-in one looks like", () => {
    const result = sanitizeReportHtml("<script>\n  var a = 1;\n  track(a);\n</script><p>Hi</p>");
    expect(result.html).toBe("<p>Hi</p>");
    expect(result.html).not.toContain("track");
  });

  it("removes style, iframe, object and embed", () => {
    expect(sanitizeReportHtml("<style>body{display:none}</style>").html).toBe("");
    expect(sanitizeReportHtml('<iframe src="http://x"></iframe>').html).toBe("");
    expect(sanitizeReportHtml("<object data='x'></object>").html).toBe("");
    expect(sanitizeReportHtml("<embed src='x'>").html).toBe("");
  });

  it("strips an inline event handler but keeps the element", () => {
    const result = sanitizeReportHtml('<p onclick="steal()">{{title}}</p>');
    expect(result.html).toBe("<p>{{title}}</p>");
    expect(result.removed).toContain("inline event handlers (onclick, onerror, …)");
  });

  it("strips a handler whether it is double-quoted, single-quoted or bare", () => {
    expect(sanitizeReportHtml('<img onerror="x()">').html).not.toContain("onerror");
    expect(sanitizeReportHtml("<img onerror='x()'>").html).not.toContain("onerror");
    expect(sanitizeReportHtml("<img onerror=x()>").html).not.toContain("onerror");
  });

  it("does not mistake ordinary words for handlers", () => {
    // The attribute must follow whitespace and end in `=`, so prose is safe.
    const html = "<p>Coming soon, one day</p>";
    expect(sanitizeReportHtml(html).html).toBe(html);
  });

  it("defuses a javascript: URL but keeps the link's shape", () => {
    const result = sanitizeReportHtml('<a href="javascript:steal()">Click</a>');
    expect(result.html).toBe('<a href="#">Click</a>');
    expect(result.removed).toContain("javascript: and data: URLs");
  });

  it("defuses a data: URL", () => {
    const result = sanitizeReportHtml('<a href="data:text/html,<script>x</script>">x</a>');
    expect(result.html).toContain('href="#"');
  });

  it("leaves a normal link and image alone", () => {
    const html = '<a href="https://example.com">x</a><img src="/logo.png">';
    expect(sanitizeReportHtml(html).html).toBe(html);
  });

  it("reports every kind of removal it made", () => {
    const result = sanitizeReportHtml('<script>a</script><p onclick="b">c</p>');
    expect(result.removed).toHaveLength(2);
  });
});

describe("needsSanitizing", () => {
  it("is false for clean markup and true for anything stripped", () => {
    expect(needsSanitizing("<p>{{title}}</p>")).toBe(false);
    expect(needsSanitizing("<script>x</script>")).toBe(true);
    expect(needsSanitizing('<p onclick="x">y</p>')).toBe(true);
  });
});
