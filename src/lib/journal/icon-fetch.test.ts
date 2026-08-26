import { afterEach, describe, expect, it, vi } from "vitest";
import { isSafeGeneratedIconSvg } from "./generated-icons";
import { buildFetchedIconSvg, extractIconBody, fetchIconSvg } from "./icon-fetch";

/** What the Iconify API actually returns, shape-for-shape. */
const ICONIFY_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24">' +
  '<path fill="currentColor" d="M12 4a4 4 0 0 1 4 4"/></svg>';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("extractIconBody", () => {
  it("lifts the shapes out and substitutes the colour for currentColor", () => {
    const body = extractIconBody(ICONIFY_SVG, "hsl(1 2% 3%)");
    expect(body).toBe('<path fill="hsl(1 2% 3%)" d="M12 4a4 4 0 0 1 4 4"/>');
  });

  it("keeps every shape of a multi-element icon", () => {
    const svg = `<svg viewBox="0 0 24 24"><circle cx="1" cy="2" r="3"/><path d="M0 0"/></svg>`;
    const body = extractIconBody(svg, "red");
    expect(body).toBe('<circle cx="1" cy="2" r="3"/><path d="M0 0"/>');
  });

  it("refuses markup that isn't a flat list of shapes", () => {
    const cases = [
      `<svg viewBox="0 0 24 24"><style>*{fill:red}</style></svg>`,
      `<svg viewBox="0 0 24 24"><use href="#x"/></svg>`,
      `<svg viewBox="0 0 24 24"><image src="x.png"/></svg>`,
      `<svg viewBox="0 0 24 24"><path onload="alert(1)" d="M0 0"/></svg>`,
      `<svg viewBox="0 0 24 24"><path style="fill:url(#x)" d="M0 0"/></svg>`,
      `<svg viewBox="0 0 24 24"><linearGradient id="g"/></svg>`,
      `<svg viewBox="0 0 24 24">bare text</svg>`,
      `<svg viewBox="0 0 24 24"></svg>`,
      "not an svg at all",
    ];
    for (const svg of cases) {
      expect(extractIconBody(svg, "red"), svg).toBeUndefined();
    }
  });
});

describe("buildFetchedIconSvg", () => {
  it("mounts the icon on the tile and passes the safety guard", () => {
    const svg = buildFetchedIconSvg("Dentist", ICONIFY_SVG);
    expect(svg).toBeDefined();
    expect(isSafeGeneratedIconSvg(svg!)).toBe(true);
  });

  it("drops the 1em sizing and currentColor that break a standalone img", () => {
    const svg = buildFetchedIconSvg("Dentist", ICONIFY_SVG)!;
    expect(svg).not.toContain("1em");
    expect(svg).not.toContain("currentColor");
    expect(svg).toContain('viewBox="0 0 64 64"');
  });

  it("tints by name, so two names differ and one name is stable", () => {
    const a = buildFetchedIconSvg("Dentist", ICONIFY_SVG)!;
    const b = buildFetchedIconSvg("Mortgage", ICONIFY_SVG)!;
    expect(a).not.toBe(b);
    expect(buildFetchedIconSvg("Dentist", ICONIFY_SVG)).toBe(a);
  });

  it("returns undefined for markup it can't rewrite", () => {
    expect(buildFetchedIconSvg("Dentist", "<svg><script/></svg>")).toBeUndefined();
  });
});

describe("fetchIconSvg", () => {
  it("returns the fetched icon when the name maps and the API answers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: async () => ICONIFY_SVG }),
    );
    const result = await fetchIconSvg("Dentist");
    expect(result.iconId).toBe("mdi:tooth-outline");
    expect(isSafeGeneratedIconSvg(result.svg)).toBe(true);
  });

  it("falls back to a locally drawn icon when the network fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const result = await fetchIconSvg("Dentist");
    expect(result.iconId).toBeUndefined();
    expect(isSafeGeneratedIconSvg(result.svg)).toBe(true);
  });

  it("falls back on a non-ok response and on the API's 200-with-404 body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, text: async () => "" }));
    expect((await fetchIconSvg("Dentist")).iconId).toBeUndefined();

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => "404" }));
    expect((await fetchIconSvg("Dentist")).iconId).toBeUndefined();
  });

  it("does not call the API for a name that maps to nothing", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const result = await fetchIconSvg("zzzz qqqq");
    expect(spy).not.toHaveBeenCalled();
    expect(isSafeGeneratedIconSvg(result.svg)).toBe(true);
  });

  it("rejects an oversized response rather than storing it", async () => {
    const huge = `<svg viewBox="0 0 24 24"><path d="${"M".repeat(100_000)}"/></svg>`;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => huge }));
    expect((await fetchIconSvg("Dentist")).iconId).toBeUndefined();
  });

  it("rejects an empty name", async () => {
    await expect(fetchIconSvg("  ")).rejects.toThrow(/empty name/);
  });
});
