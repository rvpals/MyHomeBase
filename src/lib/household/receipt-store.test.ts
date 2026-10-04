import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveInside } from "./receipt-store";

// Only the path guard is unit-tested: the Node store's other methods are thin `fs`
// calls, which per ARCHITECTURE.md are integration territory, not unit tests.

describe("resolveInside", () => {
  const root = path.resolve("/receipts");

  it("resolves a year path inside the folder", () => {
    expect(resolveInside(root, "2026/a.jpg")).toBe(path.join(root, "2026", "a.jpg"));
  });

  it("refuses a path that climbs out of the folder", () => {
    expect(() => resolveInside(root, "../etc/passwd")).toThrow("outside the receipt folder");
    expect(() => resolveInside(root, "2026/../../x")).toThrow("outside the receipt folder");
  });

  it("refuses an absolute path elsewhere", () => {
    expect(() => resolveInside(root, path.resolve("/somewhere/else.jpg"))).toThrow("outside");
  });

  it("refuses a sibling folder that merely shares the prefix", () => {
    expect(() => resolveInside(root, "../receipts-old/a.jpg")).toThrow("outside");
  });

  it("refuses when no folder is set", () => {
    expect(() => resolveInside("  ", "2026/a.jpg")).toThrow("No receipt folder");
  });
});
