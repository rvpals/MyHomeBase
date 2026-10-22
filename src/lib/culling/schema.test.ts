import { describe, expect, it } from "vitest";
import { MAX_CULL_CEILING } from "./config";
import { cullRequestSchema } from "./schema";

describe("cullRequestSchema", () => {
  it("accepts a folder and a list of names", () => {
    const parsed = cullRequestSchema.safeParse({
      folder: "2019/2019-06",
      names: ["IMG_0001.jpg", "IMG_0002.jpg"],
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a folder name containing spaces, which the archive is full of", () => {
    const parsed = cullRequestSchema.safeParse({
      folder: "2019/2019-06-09 Von Thun Farm",
      names: ["IMG_0001.jpg"],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a folder that escapes the archive root", () => {
    const parsed = cullRequestSchema.safeParse({
      folder: "../../etc",
      names: ["passwd.jpg"],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an absolute folder", () => {
    expect(
      cullRequestSchema.safeParse({ folder: "/etc", names: ["a.jpg"] }).success,
    ).toBe(false);
  });

  it("rejects an empty folder", () => {
    expect(cullRequestSchema.safeParse({ folder: "", names: ["a.jpg"] }).success).toBe(false);
  });

  it("rejects a name carrying a path separator", () => {
    const parsed = cullRequestSchema.safeParse({
      folder: "2019/2019-06",
      names: ["../2020/secret.jpg"],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a name carrying a backslash", () => {
    const parsed = cullRequestSchema.safeParse({
      folder: "2019/2019-06",
      names: ["..\\secret.jpg"],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a name containing a NUL byte", () => {
    const parsed = cullRequestSchema.safeParse({
      folder: "2019/2019-06",
      names: ["a.jpg\0.txt"],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a dot-dot name", () => {
    expect(
      cullRequestSchema.safeParse({ folder: "2019/2019-06", names: [".."] }).success,
    ).toBe(false);
  });

  it("rejects an empty photo list", () => {
    expect(cullRequestSchema.safeParse({ folder: "2019/2019-06", names: [] }).success).toBe(
      false,
    );
  });

  it("accepts a list exactly at the ceiling", () => {
    const names = Array.from({ length: MAX_CULL_CEILING }, (_, index) => `IMG_${index}.jpg`);
    expect(cullRequestSchema.safeParse({ folder: "2019/2019-06", names }).success).toBe(true);
  });

  it("rejects a list one over the ceiling", () => {
    const names = Array.from({ length: MAX_CULL_CEILING + 1 }, (_, index) => `IMG_${index}.jpg`);
    expect(cullRequestSchema.safeParse({ folder: "2019/2019-06", names }).success).toBe(false);
  });
});
