import { describe, expect, it } from "vitest";
import {
  DOCUMENT_SETTING_KEYS,
  describeDocumentRootCheck,
  resolveDocumentLimits,
  resolveDocumentSettings,
  setKeywordIgnored,
} from "./settings";
import type { ModuleSetting, ModuleSettingsRepository } from "@/lib/module-settings";
import type { Module, ModuleRepository } from "@/lib/modules";
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
      ignoredKeywords: [],
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

  it("reads the ignored keywords, normalizing a hand-edited row", () => {
    // Odd casing, stray spacing, a duplicate and a blank entry — everything a row
    // someone edited by hand in the SQLite browser could carry.
    expect(
      resolveDocumentSettings([
        { key: "ignored_keywords", value: " Huang ,invoice,,INVOICE,statement" },
      ]).ignoredKeywords,
    ).toEqual(["huang", "invoice", "statement"]);
  });

  it("drops an ignored entry that could never have been a keyword", () => {
    // `2024` and `an` can never come out of the tokenizer, so a row holding them is
    // storing something that would match nothing. Dropped rather than kept, so the
    // list the screen shows is the list that is actually in force.
    expect(
      resolveDocumentSettings([{ key: "ignored_keywords", value: "2024,an,lease" }])
        .ignoredKeywords,
    ).toEqual(["lease"]);
  });

  it("is an empty list, not undefined, when no words are ignored", () => {
    expect(resolveDocumentSettings([]).ignoredKeywords).toEqual([]);
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

/**
 * The two ports `setKeywordIgnored` needs, backed by one array of rows.
 *
 * `replaceForModule` is the only write on the settings port — both
 * `saveModuleSettingsPartial` and `removeModuleSetting` funnel through it — so storing
 * what it was handed is enough to assert on what was actually written, including the
 * deletion case.
 */
function settingsFakes(seed: Record<string, string> = {}) {
  const MODULE_ID = 13;
  let stored: ModuleSetting[] = Object.entries(seed).map(([key, value], index) => ({
    id: index + 1,
    moduleId: MODULE_ID,
    key,
    value,
  }));

  const moduleRepo = {
    getModuleBySlug: (slug: string) =>
      slug === "documents" ? ({ id: MODULE_ID, slug } as Module) : undefined,
  } as ModuleRepository;

  const settingsRepo: ModuleSettingsRepository = {
    listByModuleId: () => stored.map((row) => ({ ...row })),
    listAll: () => stored.map((row) => ({ ...row })),
    replaceForModule: (_moduleId, entries) => {
      stored = entries.map((entry, index) => ({
        id: index + 1,
        moduleId: MODULE_ID,
        key: entry.key,
        value: entry.value,
        description: entry.description,
      }));
    },
  };

  return {
    moduleRepo,
    settingsRepo,
    storedValue: () =>
      stored.find((row) => row.key === DOCUMENT_SETTING_KEYS.ignoredKeywords)?.value,
    allKeys: () => stored.map((row) => row.key),
  };
}

describe("setKeywordIgnored", () => {
  it("adds a word and returns the stored list", () => {
    const { moduleRepo, settingsRepo, storedValue } = settingsFakes();

    expect(setKeywordIgnored(moduleRepo, settingsRepo, "allstate", true)).toEqual(["allstate"]);
    expect(storedValue()).toBe("allstate");
  });

  it("normalizes before storing, so the ranker can actually match it", () => {
    const { moduleRepo, settingsRepo, storedValue } = settingsFakes();

    // "Beach " stored verbatim would look right in the list and silently never match
    // a token — the most confusing way for this to fail.
    expect(setKeywordIgnored(moduleRepo, settingsRepo, "  ALLSTATE  ", true)).toEqual([
      "allstate",
    ]);
    expect(storedValue()).toBe("allstate");
  });

  it("does not add the same word twice", () => {
    const { moduleRepo, settingsRepo, storedValue } = settingsFakes({
      ignored_keywords: "allstate",
    });

    expect(setKeywordIgnored(moduleRepo, settingsRepo, "allstate", true)).toEqual(["allstate"]);
    expect(storedValue()).toBe("allstate");
  });

  it("appends to an existing list, keeping order", () => {
    const { moduleRepo, settingsRepo, storedValue } = settingsFakes({
      ignored_keywords: "huang,invoice",
    });

    expect(setKeywordIgnored(moduleRepo, settingsRepo, "statement", true)).toEqual([
      "huang",
      "invoice",
      "statement",
    ]);
    expect(storedValue()).toBe("huang,invoice,statement");
  });

  it("removes a word", () => {
    const { moduleRepo, settingsRepo, storedValue } = settingsFakes({
      ignored_keywords: "huang,invoice",
    });

    expect(setKeywordIgnored(moduleRepo, settingsRepo, "huang", false)).toEqual(["invoice"]);
    expect(storedValue()).toBe("invoice");
  });

  it("removes the row rather than storing a blank when the last word goes", () => {
    const { moduleRepo, settingsRepo, allKeys } = settingsFakes({
      ignored_keywords: "huang",
    });

    // Module-setting values must be non-empty, so the empty list has to be expressed
    // as a deletion rather than as "".
    expect(setKeywordIgnored(moduleRepo, settingsRepo, "huang", false)).toEqual([]);
    expect(allKeys()).not.toContain(DOCUMENT_SETTING_KEYS.ignoredKeywords);
  });

  it("leaves other settings untouched", () => {
    const { moduleRepo, settingsRepo, allKeys } = settingsFakes({
      document_root: "//NAS/docs",
      ignored_keywords: "huang",
    });

    // The partial save, not the whole-module one: dismissing a word must not drop the
    // configured folder.
    setKeywordIgnored(moduleRepo, settingsRepo, "invoice", true);
    expect(allKeys()).toContain(DOCUMENT_SETTING_KEYS.documentRoot);

    setKeywordIgnored(moduleRepo, settingsRepo, "huang", false);
    setKeywordIgnored(moduleRepo, settingsRepo, "invoice", false);
    expect(allKeys()).toContain(DOCUMENT_SETTING_KEYS.documentRoot);
  });

  it("restoring a word that was never ignored is not an error", () => {
    const { moduleRepo, settingsRepo } = settingsFakes({ ignored_keywords: "huang" });

    // A double-click must not report a failure: the end state is what was asked for.
    expect(setKeywordIgnored(moduleRepo, settingsRepo, "invoice", false)).toEqual(["huang"]);
  });

  it("refuses a word that could never have been ranked", () => {
    const { moduleRepo, settingsRepo } = settingsFakes();

    // Nothing the tokenizer emits looks like these, so storing one would be storing a
    // rule that can never fire.
    expect(() => setKeywordIgnored(moduleRepo, settingsRepo, "2024", true)).toThrow(/isn't a word/i);
    expect(() => setKeywordIgnored(moduleRepo, settingsRepo, "an", true)).toThrow(/isn't a word/i);
    expect(() => setKeywordIgnored(moduleRepo, settingsRepo, "   ", true)).toThrow(/isn't a word/i);
  });

  it("fails loudly when the module is not registered", () => {
    const { settingsRepo } = settingsFakes();
    const missing = { getModuleBySlug: () => undefined } as unknown as ModuleRepository;

    expect(() => setKeywordIgnored(missing, settingsRepo, "allstate", true)).toThrow(
      /not registered/i,
    );
  });
});
