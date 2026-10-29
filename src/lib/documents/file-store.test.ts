import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveInside } from "./file-store";

// `resolveInside` is the guard that stands between a stored or crafted `relative_path`
// and the rest of the share. Every method on the store goes through it, so these are
// the tests that matter most in this module.

const ROOT = path.resolve("/share/documents");

describe("resolveInside", () => {
  it("resolves an ordinary path inside the root", () => {
    expect(resolveInside(ROOT, "doc_17/lease.pdf")).toBe(
      path.join(ROOT, "doc_17", "lease.pdf"),
    );
  });

  it("allows the root itself", () => {
    expect(resolveInside(ROOT, "")).toBe(ROOT);
  });

  it("refuses a path that climbs out of the root", () => {
    expect(() => resolveInside(ROOT, "../secrets.txt")).toThrow(/outside/i);
    expect(() => resolveInside(ROOT, "doc_17/../../secrets.txt")).toThrow(/outside/i);
  });

  it("refuses an absolute path", () => {
    expect(() => resolveInside(ROOT, path.resolve("/etc/passwd"))).toThrow(/outside/i);
  });

  it("refuses a sibling folder that merely shares the root's prefix", () => {
    // `/share/documents-backup` starts with `/share/documents` as a string but is not
    // inside it — the separator check is what catches this.
    expect(() => resolveInside(ROOT, "../documents-backup/x.pdf")).toThrow(/outside/i);
  });

  it("refuses when no root is configured", () => {
    expect(() => resolveInside("", "a.pdf")).toThrow(/no document folder is set/i);
    expect(() => resolveInside("   ", "a.pdf")).toThrow(/no document folder is set/i);
  });
});
