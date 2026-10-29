import { describe, expect, it } from "vitest";
import {
  DOCUMENT_SETTING_KEYS,
  describeDocumentRootCheck,
  resolveDocumentLimits,
  resolveDocumentSettings,
} from "./settings";
import {
  DEFAULT_DOCUMENT_MAX_FILES,
  DEFAULT_DOCUMENT_MAX_FILE_BYTES,
  DOCUMENT_MAX_FILES_CEILING,
  DOCUMENT_MAX_FILE_BYTES_CEILING,
  formatBytes,
} from "./schema";

/** The `sys_module_settings` rows, as the resolver receives them. */
function rows(values: Record<string, string>): { key: string; value: string }[] {
  return Object.entries(values).map(([key, value]) => ({ key, value }));
}

describe("resolveDocumentSettings", () => {
  it("reads the folder", () => {
    expect(resolveDocumentSettings([{ key: "document_root", value: "//NAS/docs" }])).toEqual({
      documentRoot: "//NAS/docs",
    });
  });

  it("trims a stray space from a deploy script", () => {
    expect(
      resolveDocumentSettings([{ key: "document_root", value: "  //NAS/docs  " }]).documentRoot,
    ).toBe("//NAS/docs");
  });

  it("is blank, not undefined, when unset", () => {
    expect(resolveDocumentSettings([]).documentRoot).toBe("");
  });
});

describe("resolveDocumentLimits", () => {
  it("uses the configured values", () => {
    const limits = resolveDocumentLimits(
      rows({
        [DOCUMENT_SETTING_KEYS.maxFileBytes]: "1048576",
        [DOCUMENT_SETTING_KEYS.maxFilesPerDocument]: "5",
      }),
    );
    expect(limits).toEqual({ maxFileBytes: 1_048_576, maxFilesPerDocument: 5 });
  });

  it("falls back to the defaults when nothing is set", () => {
    expect(resolveDocumentLimits([])).toEqual({
      maxFileBytes: DEFAULT_DOCUMENT_MAX_FILE_BYTES,
      maxFilesPerDocument: DEFAULT_DOCUMENT_MAX_FILES,
    });
  });

  it("falls back rather than throwing on a value edited by hand into nonsense", () => {
    // A settings row can outlive the thing it names and can be hand-edited, so
    // parsing is forgiving by design — `modules.md` requires it.
    for (const bad of ["", "   ", "lots", "-5", "0", "3.5", "NaN"]) {
      const limits = resolveDocumentLimits(
        rows({ [DOCUMENT_SETTING_KEYS.maxFilesPerDocument]: bad }),
      );
      expect(limits.maxFilesPerDocument).toBe(DEFAULT_DOCUMENT_MAX_FILES);
    }
  });

  it("clamps an over-large value rather than rejecting it", () => {
    const limits = resolveDocumentLimits(
      rows({
        [DOCUMENT_SETTING_KEYS.maxFileBytes]: String(DOCUMENT_MAX_FILE_BYTES_CEILING * 10),
        [DOCUMENT_SETTING_KEYS.maxFilesPerDocument]: String(DOCUMENT_MAX_FILES_CEILING + 1),
      }),
    );
    expect(limits.maxFileBytes).toBe(DOCUMENT_MAX_FILE_BYTES_CEILING);
    expect(limits.maxFilesPerDocument).toBe(DOCUMENT_MAX_FILES_CEILING);
  });
});

describe("describeDocumentRootCheck", () => {
  it("says what each failure means in words a screen can show", () => {
    expect(describeDocumentRootCheck({ kind: "ok", path: "/d" })).toMatch(/can write/i);
    expect(describeDocumentRootCheck({ kind: "not-configured" })).toMatch(/no document folder/i);
    expect(describeDocumentRootCheck({ kind: "missing", path: "/d" })).toMatch(/no folder at/i);
    expect(describeDocumentRootCheck({ kind: "not-a-directory", path: "/d" })).toMatch(/is a file/i);
    expect(
      describeDocumentRootCheck({ kind: "not-writable", path: "/d", reason: "EACCES" }),
    ).toMatch(/cannot write/i);
  });
});

describe("formatBytes", () => {
  it("reads the way a person would write it", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(25 * 1024 * 1024)).toBe("25 MB");
    expect(formatBytes(1536)).toBe("1.5 KB");
  });

  it("drops a trailing .0", () => {
    expect(formatBytes(2 * 1024 * 1024)).toBe("2 MB");
  });
});
