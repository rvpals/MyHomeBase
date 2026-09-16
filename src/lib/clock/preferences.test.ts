import { describe, expect, it } from "vitest";
import {
  CLOCK_FACE_OPTIONS,
  defaultClockFaceOptions,
  isClockFace,
  resolveClockFaceOptions,
} from "./preferences";

describe("CLOCK_FACE_OPTIONS", () => {
  it("offers both faces, with no duplicates", () => {
    const values = CLOCK_FACE_OPTIONS.map((option) => option.value);
    expect(values).toEqual(["digital", "analog"]);
    expect(new Set(values).size).toBe(values.length);
  });

  it("guards a stored face", () => {
    expect(isClockFace("analog")).toBe(true);
    expect(isClockFace("sundial")).toBe(false);
  });
});

describe("resolveClockFaceOptions", () => {
  it("defaults to digital with everything shown", () => {
    // What the home screen looked like before the setting existed, so a reader who
    // never opens the preference sees no change.
    expect(resolveClockFaceOptions({})).toEqual({
      face: "digital",
      showDate: true,
      showWeather: true,
      showWeekday: true,
    });
  });

  it("reads a stored face", () => {
    expect(resolveClockFaceOptions({ face: "analog" }).face).toBe("analog");
  });

  it("clamps a retired face back to the default", () => {
    expect(resolveClockFaceOptions({ face: "sundial" }).face).toBe("digital");
  });

  it("treats \"0\" as off", () => {
    const options = resolveClockFaceOptions({
      showDate: "0",
      showWeather: "0",
      showWeekday: "0",
    });
    expect(options).toMatchObject({ showDate: false, showWeather: false, showWeekday: false });
  });

  it("treats \"1\" as on", () => {
    expect(resolveClockFaceOptions({ showDate: "1" }).showDate).toBe(true);
  });

  it("reads an unrecognised flag as on, showing more rather than less", () => {
    expect(resolveClockFaceOptions({ showWeather: "yes" }).showWeather).toBe(true);
    expect(resolveClockFaceOptions({ showWeather: "" }).showWeather).toBe(true);
  });

  it("tolerates whitespace around an off flag", () => {
    expect(resolveClockFaceOptions({ showDate: " 0 " }).showDate).toBe(false);
  });

  it("resolves each toggle independently", () => {
    const options = resolveClockFaceOptions({ showDate: "0", showWeekday: "1" });
    expect(options.showDate).toBe(false);
    expect(options.showWeekday).toBe(true);
    expect(options.showWeather).toBe(true);
  });
});

describe("defaultClockFaceOptions", () => {
  it("matches resolving nothing", () => {
    expect(defaultClockFaceOptions()).toEqual(resolveClockFaceOptions({}));
  });
});
