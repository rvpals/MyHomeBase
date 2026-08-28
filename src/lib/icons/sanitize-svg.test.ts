import { describe, expect, it } from "vitest";
import { sanitizeSvg } from "./sanitize-svg";

describe("sanitizeSvg", () => {
  it("keeps drawing elements and their geometry", () => {
    const result = sanitizeSvg(
      `<svg viewBox="0 0 32 32"><path d="M4 4h8v8z" fill="currentColor"/><circle cx="16" cy="16" r="5"/></svg>`,
    );

    expect(result.body).toContain(`d="M4 4h8v8z"`);
    expect(result.body).toContain(`cx="16"`);
    expect(result.width).toBe(32);
    expect(result.height).toBe(32);
  });

  it("reads the drawing size from viewBox in preference to width/height", () => {
    // A glyph drawn on a 24-unit grid but *displayed* at 512px: honouring width/height
    // here would frame the art 20x too large and render it as a speck.
    const result = sanitizeSvg(`<svg width="512" height="512" viewBox="0 0 24 24"><path d="M0 0h1v1z"/></svg>`);
    expect(result.width).toBe(24);
    expect(result.height).toBe(24);
  });

  it("falls back to width/height, then to a 24 box", () => {
    expect(sanitizeSvg(`<svg width="48" height="48"><path d="M0 0h1v1z"/></svg>`).width).toBe(48);
    expect(sanitizeSvg(`<svg><path d="M0 0h1v1z"/></svg>`).width).toBe(24);
  });

  describe("hostile input", () => {
    it("drops a script element and its contents", () => {
      const result = sanitizeSvg(
        `<svg viewBox="0 0 24 24"><script>alert(1)</script><path d="M0 0h1v1z"/></svg>`,
      );
      expect(result.body).not.toContain("script");
      expect(result.body).not.toContain("alert");
      expect(result.body).toContain(`d="M0 0h1v1z"`);
    });

    it("drops event-handler attributes but keeps the element", () => {
      const result = sanitizeSvg(
        `<svg viewBox="0 0 24 24"><path d="M0 0h1v1z" onload="alert(1)" onclick="steal()"/></svg>`,
      );
      expect(result.body).not.toContain("onload");
      expect(result.body).not.toContain("onclick");
      expect(result.body).not.toContain("alert");
      expect(result.body).toContain(`d="M0 0h1v1z"`);
    });

    it("drops <a> and <use>, which are what make href dangerous", () => {
      const result = sanitizeSvg(
        `<svg viewBox="0 0 24 24"><a href="javascript:alert(1)"><path d="M0 0h1v1z"/></a><use xlink:href="http://evil/x.svg#a"/><rect x="1" y="1" width="2" height="2"/></svg>`,
      );
      expect(result.body).not.toContain("javascript:");
      expect(result.body).not.toContain("xlink");
      expect(result.body).not.toContain("evil");
      expect(result.body).toContain("rect");
    });

    it("drops <foreignObject>, which can smuggle HTML", () => {
      const result = sanitizeSvg(
        `<svg viewBox="0 0 24 24"><foreignObject><body><img src=x onerror="alert(1)"></body></foreignObject><path d="M0 0h1v1z"/></svg>`,
      );
      expect(result.body).not.toContain("onerror");
      expect(result.body).not.toContain("img");
      expect(result.body).toContain("path");
    });

    it("drops <style>, whose url() can reach off-origin", () => {
      const result = sanitizeSvg(
        `<svg viewBox="0 0 24 24"><style>@import url(http://evil/x.css);</style><path d="M0 0h1v1z"/></svg>`,
      );
      expect(result.body).not.toContain("@import");
      expect(result.body).not.toContain("evil");
    });

    it("strips a comment that could reopen parsing", () => {
      const result = sanitizeSvg(
        `<svg viewBox="0 0 24 24"><!-- --><script>alert(1)</script> --><path d="M0 0h1v1z"/></svg>`,
      );
      expect(result.body).not.toContain("alert");
      expect(result.body).not.toContain("script");
    });

    it("refuses an off-origin url() in a paint attribute but allows a local gradient ref", () => {
      const external = sanitizeSvg(
        `<svg viewBox="0 0 24 24"><path d="M0 0h1v1z" fill="url(http://evil/x#a)"/></svg>`,
      );
      expect(external.body).not.toContain("evil");

      const local = sanitizeSvg(
        `<svg viewBox="0 0 24 24"><defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs><path d="M0 0h1v1z" fill="url(#g)"/></svg>`,
      );
      expect(local.body).toContain(`fill="url(#g)"`);
    });

    it("unwraps an unknown element without losing the artwork inside it", () => {
      const result = sanitizeSvg(
        `<svg viewBox="0 0 24 24"><madeup><path d="M0 0h1v1z"/></madeup></svg>`,
      );
      expect(result.body).not.toContain("madeup");
      expect(result.body).toContain(`d="M0 0h1v1z"`);
    });
  });

  describe("rejections", () => {
    it("refuses an empty file", () => {
      expect(() => sanitizeSvg("   ")).toThrow(/empty/i);
    });

    it("refuses a file that isn't an SVG", () => {
      expect(() => sanitizeSvg("PNG\r\n\n binary")).toThrow(/doesn't look like an SVG/i);
    });

    it("refuses an SVG with no closing tag", () => {
      expect(() => sanitizeSvg(`<svg viewBox="0 0 24 24"><path d="M0 0h1v1z"/>`)).toThrow(
        /closing tag/i,
      );
    });

    it("refuses an SVG that has nothing drawable left after cleaning", () => {
      expect(() => sanitizeSvg(`<svg viewBox="0 0 24 24"><script>alert(1)</script></svg>`)).toThrow(
        /no drawable shapes/i,
      );
    });
  });
});
