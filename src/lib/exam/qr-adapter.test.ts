import { describe, expect, it } from "vitest";

import { LibraryQrIdentity } from "./qr-adapter";
import { decodeStudentIdPayload, encodeStudentIdPayload } from "./qr-identity";

/**
 * The real libraries, not a fake.
 *
 * `qrcode` and `jsqr` are both pure JS and fast enough to exercise directly, and the
 * thing most worth protecting here is the *shape of the SVG they produce* — which a
 * fake would simply assert back at itself.
 */

describe("LibraryQrIdentity.encodeSvg", () => {
  it("emits an SVG with no intrinsic width or height", async () => {
    // This is the regression guard for a real printing bug.
    //
    // `qrcode` emits `<svg width="256" height="256" viewBox="0 0 21 21">`. An SVG that
    // carries its own dimensions ignores the width its container sets, so the code
    // printed at 256 CSS pixels -- about a third of the page instead of a tenth --
    // running through the header and into the answer grid.
    const svg = await new LibraryQrIdentity().encodeSvg("MHB-S:11046");

    const openingTag = svg.slice(0, svg.indexOf(">") + 1);
    expect(openingTag).not.toMatch(/\swidth="/);
    expect(openingTag).not.toMatch(/\sheight="/);
  });

  it("keeps the viewBox, which is what carries the geometry", async () => {
    // Stripping width/height is only safe because the viewBox survives. Without it
    // the element has no intrinsic ratio and collapses.
    const svg = await new LibraryQrIdentity().encodeSvg("MHB-S:11046");

    expect(svg).toMatch(/viewBox="0 0 \d+ \d+"/);
  });

  it("leaves the path data alone", async () => {
    // The strip is a regex over the opening tag. If it were applied to the whole
    // document it would eat coordinates out of the path and produce a corrupt code
    // that still looks like an SVG.
    const svg = await new LibraryQrIdentity().encodeSvg("MHB-S:11046");

    expect(svg).toContain("<path");
    expect(svg).toMatch(/stroke="#000000"/);
    expect(svg.trimEnd()).toMatch(/<\/svg>$/);
  });

  it("produces a square viewBox, so the printed code is square", async () => {
    const svg = await new LibraryQrIdentity().encodeSvg("MHB-S:11046");

    const match = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
    expect(match).not.toBeNull();
    expect(match![1]).toBe(match![2]);
  });
});

describe("LibraryQrIdentity round trip", () => {
  it("decodes a code it generated", async () => {
    // End to end through both libraries, rendered to pixels the way a scan arrives.
    // Catches a version bump that changes either side's defaults.
    const qr = new LibraryQrIdentity();
    const payload = encodeStudentIdPayload("11046")!;
    const svg = await qr.encodeSvg(payload);

    const sharp = (await import("sharp")).default;
    const rendered = await sharp(Buffer.from(svg))
      .resize(268, 268)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const text = await qr.decode({
      data: new Uint8ClampedArray(rendered.data),
      width: rendered.info.width,
      height: rendered.info.height,
    });

    expect(decodeStudentIdPayload(text)).toBe("11046");
  });

  it("returns undefined for an image with no code in it", async () => {
    // A blank crop is the ordinary case when a sheet carries no QR. It must read as
    // "nothing here", not throw.
    const blank = new Uint8ClampedArray(120 * 120 * 4).fill(255);

    const text = await new LibraryQrIdentity().decode({
      data: blank,
      width: 120,
      height: 120,
    });

    expect(text).toBeUndefined();
  });
});
