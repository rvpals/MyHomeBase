import { describe, expect, it } from "vitest";
import {
  correctionForWidth,
  resolveViewport,
  viewportForWidth,
  viewportFromUserAgent,
} from "./viewport";
import { VIEWPORT_BREAKPOINT_PX } from "./types";

describe("viewportForWidth", () => {
  it("splits at the breakpoint, with the boundary itself counting as full", () => {
    expect(viewportForWidth(VIEWPORT_BREAKPOINT_PX - 1)).toBe("compact");
    expect(viewportForWidth(VIEWPORT_BREAKPOINT_PX)).toBe("full");
  });

  it("classifies real devices the way a reader would expect", () => {
    expect(viewportForWidth(390)).toBe("compact"); // iPhone 13
    expect(viewportForWidth(810)).toBe("compact"); // iPad portrait
    expect(viewportForWidth(1180)).toBe("full"); // iPad landscape
    expect(viewportForWidth(1440)).toBe("full"); // laptop
  });
});

describe("viewportFromUserAgent", () => {
  it("treats phones and tablets as compact", () => {
    expect(viewportFromUserAgent("mobile")).toBe("compact");
    expect(viewportFromUserAgent("tablet")).toBe("compact");
  });

  it("treats an absent device type as full", () => {
    // Next reports `undefined` for desktop browsers — and, notably, for iPadOS
    // Safari, which claims to be a Mac. That wrong guess is the width
    // corrector's job, not this function's.
    expect(viewportFromUserAgent(undefined)).toBe("full");
  });
});

describe("resolveViewport", () => {
  it("prefers a stored value over the User-Agent", () => {
    expect(resolveViewport({ cookieValue: "full", deviceType: "mobile" })).toBe("full");
    expect(resolveViewport({ cookieValue: "compact", deviceType: undefined })).toBe("compact");
  });

  it("falls back to the User-Agent when nothing is stored", () => {
    expect(resolveViewport({ deviceType: "mobile" })).toBe("compact");
    expect(resolveViewport({ deviceType: undefined })).toBe("full");
  });

  it("treats a junk cookie as absent rather than failing the page", () => {
    // The cookie is user-editable; a bad value should cost a slightly wrong
    // first paint, not a 500 on every route.
    expect(resolveViewport({ cookieValue: "phone", deviceType: "mobile" })).toBe("compact");
    expect(resolveViewport({ cookieValue: "", deviceType: undefined })).toBe("full");
    expect(resolveViewport({ cookieValue: "<script>", deviceType: undefined })).toBe("full");
  });
});

describe("correctionForWidth", () => {
  it("says nothing when the server already got it right", () => {
    expect(correctionForWidth({ current: "compact", width: 390, pinned: false })).toBeUndefined();
    expect(correctionForWidth({ current: "full", width: 1440, pinned: false })).toBeUndefined();
  });

  it("corrects an iPad that the User-Agent reported as a Mac", () => {
    // UA said desktop → served "full"; the measurement says 810px.
    expect(correctionForWidth({ current: "full", width: 810, pinned: false })).toBe("compact");
  });

  it("corrects a phone in desktop-request mode back to compact", () => {
    expect(correctionForWidth({ current: "full", width: 390, pinned: false })).toBe("compact");
  });

  it("corrects a tablet in landscape up to full", () => {
    expect(correctionForWidth({ current: "compact", width: 1180, pinned: false })).toBe("full");
  });

  it("never overrules a hand-picked layout", () => {
    // Someone on a phone who asked for the full layout means it. Silently
    // flipping back would make the toggle look broken.
    expect(correctionForWidth({ current: "full", width: 390, pinned: true })).toBeUndefined();
    expect(correctionForWidth({ current: "compact", width: 1920, pinned: true })).toBeUndefined();
  });
});
