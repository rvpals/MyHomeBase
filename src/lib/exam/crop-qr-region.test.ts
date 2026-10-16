import { describe, expect, it } from "vitest";

import { QR_CROP_PADDING, cropQrRegion, type RawBitmap } from "./detect-marks";
import { QR_SIZE, buildQrLayout, qrHeightFraction } from "./sheet-layout";

function blankBitmap(width: number, height: number): RawBitmap {
  const data = new Uint8Array(width * height * 4).fill(255);
  return { data, width, height };
}

function setPixel(bitmap: RawBitmap, x: number, y: number, grey: number): void {
  if (x < 0 || y < 0 || x >= bitmap.width || y >= bitmap.height) return;
  const offset = (Math.floor(y) * bitmap.width + Math.floor(x)) * 4;
  bitmap.data[offset] = grey;
  bitmap.data[offset + 1] = grey;
  bitmap.data[offset + 2] = grey;
  bitmap.data[offset + 3] = 255;
}

const WIDTH = 850;
const HEIGHT = 1100;
const identityX = (fraction: number) => fraction * WIDTH;
const identityY = (fraction: number) => fraction * HEIGHT;

describe("cropQrRegion", () => {
  it("returns a region covering the QR box plus padding", () => {
    const bitmap = blankBitmap(WIDTH, HEIGHT);
    const region = cropQrRegion(bitmap, 0.2, identityX, identityY);

    expect(region).toBeDefined();
    // At least the code itself, and no wider than the code plus full padding.
    //
    // Not an exact width: the QR sits 51px from the page edge while the padding
    // wants 67px, so the crop clamps on the left. That clamp is correct -- there is
    // no more page to take -- and asserting symmetric padding only encoded an
    // assumption that was never guaranteed.
    const codeWidth = QR_SIZE * WIDTH;
    const maxWidth = codeWidth * (1 + QR_CROP_PADDING * 2);
    expect(region!.width).toBeGreaterThanOrEqual(Math.floor(codeWidth));
    expect(region!.width).toBeLessThanOrEqual(Math.ceil(maxWidth) + 2);
  });

  it("produces a buffer sized exactly for RGBA", () => {
    const bitmap = blankBitmap(WIDTH, HEIGHT);
    const region = cropQrRegion(bitmap, 0.2, identityX, identityY)!;

    expect(region.data.length).toBe(region.width * region.height * 4);
  });

  it("copies the right pixels, not a shifted window", () => {
    // The whole guarantee of this function: the pixel the printer put at the QR
    // box's top-left must be the pixel the decoder sees near its crop's top-left.
    // A stride bug shows up here as white where the mark should be.
    const bitmap = blankBitmap(WIDTH, HEIGHT);
    const { box } = buildQrLayout(0.2);

    const markX = Math.floor(identityX(box.left));
    const markY = Math.floor(identityY(box.top));
    setPixel(bitmap, markX, markY, 0);

    const region = cropQrRegion(bitmap, 0.2, identityX, identityY)!;

    let darkest = 255;
    let foundAt = { x: -1, y: -1 };
    for (let y = 0; y < region.height; y += 1) {
      for (let x = 0; x < region.width; x += 1) {
        const value = region.data[(y * region.width + x) * 4];
        if (value < darkest) {
          darkest = value;
          foundAt = { x, y };
        }
      }
    }

    expect(darkest).toBe(0);

    // It should sit one padding-width in from the crop's edge, not at 0,0.
    // Inside the crop and away from its edges -- the exact offset depends on whether
    // the padding clamped against the page edge, which is not what this test is for.
    expect(foundAt.x).toBeGreaterThan(0);
    expect(foundAt.y).toBeGreaterThan(0);
    expect(foundAt.x).toBeLessThan(region.width - 1);
    expect(foundAt.y).toBeLessThan(region.height - 1);
  });

  it("clamps to the image instead of reading out of bounds", () => {
    // A QR box near the very top of the page: the padding would run negative.
    const bitmap = blankBitmap(WIDTH, HEIGHT);
    const region = cropQrRegion(bitmap, 0.001, identityX, identityY);

    expect(region).toBeDefined();
    expect(region!.data.length).toBe(region!.width * region!.height * 4);
  });

  it("returns undefined when the box falls entirely off the page", () => {
    const bitmap = blankBitmap(WIDTH, HEIGHT);
    expect(cropQrRegion(bitmap, 5, identityX, identityY)).toBeUndefined();
  });

  it("is square on paper, accounting for the page aspect ratio", () => {
    // The trap the corner fiducials fell into: a width fraction and a height
    // fraction are not the same distance. On an 8.5x11 page at 850x1100 the BOX must
    // come out square in PIXELS.
    //
    // Measured on the box rather than the crop, because the crop clamps at the page
    // edge and a clamped crop is legitimately not square.
    const { box } = buildQrLayout(0.2);
    const boxWidth = (box.right - box.left) * WIDTH;
    const boxHeight = (box.bottom - box.top) * HEIGHT;

    expect(Math.abs(boxWidth - boxHeight)).toBeLessThanOrEqual(2);
  });

  it("still covers the code when the header estimate is off", () => {
    // The bug this guards: `qrTop` derived the code position from `HEADER_BASE`,
    // which is deliberately padded upward because over-reserving space only wastes
    // paper. Padding is right for reserving and wrong for locating -- it put the
    // crop 38px low, clipped 16px off an 89px code, and took both upper finder
    // patterns with it. jsQR needs three, so the decode failed on every sheet and
    // grading silently fell back to file-name matching. Nothing looked broken.
    const bitmap = blankBitmap(WIDTH, HEIGHT);
    // NOTE: 0.162 mirrors what `qrTop()` returns
    // (HEADER_TOP_OFFSET 0.025 + HEADER_BASE_MEASURED 0.115 + QR_CAPTION_HEIGHT 0.022).
    // It is a COPY, because that function lives in a .tsx under src/app/ and src/lib/
    // may not import it. So this test proves the padding is wide enough; it does NOT
    // prove the app passes the right number -- that is exactly the gap that let the
    // original bug through a green suite. If `qrTop` changes, change this too.
    const assumed = 0.162;

    // The crop built from the assumed position must still contain the code even
    // when the truth is off by +/-0.02 of page height -- 22px here, far more than
    // the header estimate has ever been out.
    //
    // 0.197 was in this list while the code was 0.105 wide. At 0.06 the padding
    // scales down with it and 0.035 of error no longer fits: a smaller code has a
    // smaller error budget, which is the real cost of shrinking it. Measured budget
    // at 0.06 with 0.75 padding is 0.0348.
    for (const actual of [0.142, 0.152, 0.162, 0.172, 0.182]) {
      const region = cropQrRegion(bitmap, assumed, identityX, identityY)!;
      const { box } = buildQrLayout(assumed);
      const padY = (box.bottom - box.top) * QR_CROP_PADDING;

      const cropTop = (box.top - padY) * HEIGHT;
      const cropBottom = (box.bottom + padY) * HEIGHT;
      const realTop = actual * HEIGHT;
      const realBottom = (actual + qrHeightFraction()) * HEIGHT;

      expect(region).toBeDefined();
      expect(realTop).toBeGreaterThanOrEqual(cropTop);
      expect(realBottom).toBeLessThanOrEqual(cropBottom);
    }
  });

  it("does not reach down into the answer grid", () => {
    // The reason the crop exists at all: the grid carries four solid black corner
    // fiducials, which look enough like finder patterns to send jsQR hunting.
    const { box } = buildQrLayout(0.162);
    const padY = (box.bottom - box.top) * QR_CROP_PADDING;

    // The grid starts around 0.458 on a sheet with the QR switched on.
    expect(box.bottom + padY).toBeLessThan(0.458);
  });
});
