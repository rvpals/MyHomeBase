import { describe, expect, it } from "vitest";
import {
  SPLASH_DEVICES,
  listSplashImages,
  splashImageFileName,
  splashMediaQuery,
} from "./splash";

describe("splashImageFileName", () => {
  it("encodes size, dpr and orientation", () => {
    expect(splashImageFileName({ width: 440, height: 956, dpr: 3 }, "portrait")).toBe(
      "splash-440x956@3x-portrait.png",
    );
  });

  it("keeps the logical size when landscape, so the name matches the device not the image", () => {
    expect(splashImageFileName({ width: 440, height: 956, dpr: 3 }, "landscape")).toBe(
      "splash-440x956@3x-landscape.png",
    );
  });
});

describe("splashMediaQuery", () => {
  it("pins device size, pixel ratio and orientation", () => {
    expect(splashMediaQuery({ width: 375, height: 667, dpr: 2 }, "portrait")).toBe(
      "(device-width: 375px) and (device-height: 667px) and " +
        "(-webkit-device-pixel-ratio: 2) and (orientation: portrait)",
    );
  });
});

describe("listSplashImages", () => {
  it("emits both orientations per device", () => {
    const images = listSplashImages([{ width: 390, height: 844, dpr: 3 }]);
    expect(images).toEqual([
      {
        href: "/splash/splash-390x844@3x-portrait.png",
        media: splashMediaQuery({ width: 390, height: 844, dpr: 3 }, "portrait"),
      },
      {
        href: "/splash/splash-390x844@3x-landscape.png",
        media: splashMediaQuery({ width: 390, height: 844, dpr: 3 }, "landscape"),
      },
    ]);
  });

  it("covers every configured device by default", () => {
    expect(listSplashImages()).toHaveLength(SPLASH_DEVICES.length * 2);
  });

  it("produces a unique media query per image, since a duplicate would make iOS pick arbitrarily", () => {
    const media = listSplashImages().map((image) => image.media);
    expect(new Set(media).size).toBe(media.length);
  });

  it("returns nothing for an empty device list", () => {
    expect(listSplashImages([])).toEqual([]);
  });
});
