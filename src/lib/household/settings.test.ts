import { describe, expect, it } from "vitest";
import type { ModuleSettingsRepository } from "@/lib/module-settings";
import type { ModuleRepository } from "@/lib/modules";
import type { FolderListing, ReceiptFileStore, ReceiptRootCheck } from "./receipt-store";
import {
  HOUSEHOLD_SETTING_KEYS,
  describeReceiptRootCheck,
  getHouseholdSettings,
  resolveHouseholdSettings,
  setHsaReceiptRoot,
} from "./settings";

interface Row {
  key: string;
  value: string;
  description?: string;
}

/**
 * Fakes for the two platform repositories. The settings port is small enough to fake
 * whole. The module repository is large and only `getModuleBySlug` is reached, so that
 * one is cast — a call to anything else fails loudly as "not a function".
 */
function fakes(hasModule = true) {
  let rows: Row[] = [];
  const list = () => rows.map((row, index) => ({ id: index + 1, moduleId: 11, ...row }));
  const settingsRepo: ModuleSettingsRepository = {
    listByModuleId: list,
    listAll: list,
    replaceForModule: (_moduleId, entries) => {
      rows = entries.map((entry) => ({ ...entry }));
    },
  };
  const moduleRepo = {
    getModuleBySlug: (slug: string) => (hasModule && slug === "household" ? { id: 11, slug } : undefined),
  } as unknown as ModuleRepository;
  return { settingsRepo, moduleRepo, rows: () => rows };
}

function storeReturning(check: ReceiptRootCheck): ReceiptFileStore {
  return {
    checkRoot: async () => check,
    listFolders: async (): Promise<FolderListing> => ({ path: "/", parent: null, folders: [] }),
  } as unknown as ReceiptFileStore;
}

describe("resolveHouseholdSettings", () => {
  it("defaults the receipt folder to unset", () => {
    expect(resolveHouseholdSettings([])).toEqual({ hsaReceiptRoot: "" });
  });

  it("reads and trims the stored folder", () => {
    expect(
      resolveHouseholdSettings([{ key: HOUSEHOLD_SETTING_KEYS.hsaReceiptRoot, value: " /volume1/HSA " }]),
    ).toEqual({ hsaReceiptRoot: "/volume1/HSA" });
  });
});

describe("setHsaReceiptRoot", () => {
  it("saves a folder the server can write to", async () => {
    const { settingsRepo, moduleRepo } = fakes();
    const saved = await setHsaReceiptRoot(
      moduleRepo,
      settingsRepo,
      storeReturning({ kind: "ok", path: "/volume1/HSA" }),
      "  /volume1/HSA  ",
    );
    expect(saved.hsaReceiptRoot).toBe("/volume1/HSA");
    expect(getHouseholdSettings(moduleRepo, settingsRepo).hsaReceiptRoot).toBe("/volume1/HSA");
  });

  it("refuses a folder the server cannot write to, and saves nothing", async () => {
    const { settingsRepo, moduleRepo, rows } = fakes();
    await expect(
      setHsaReceiptRoot(
        moduleRepo,
        settingsRepo,
        storeReturning({ kind: "not-writable", path: "/x", reason: "EACCES" }),
        "/x",
      ),
    ).rejects.toThrow("cannot write to /x");
    expect(rows()).toHaveLength(0);
  });

  it("clears the setting with a blank path", async () => {
    const { settingsRepo, moduleRepo } = fakes();
    const ok = storeReturning({ kind: "ok", path: "/a" });
    await setHsaReceiptRoot(moduleRepo, settingsRepo, ok, "/a");
    const cleared = await setHsaReceiptRoot(moduleRepo, settingsRepo, ok, "   ");
    expect(cleared.hsaReceiptRoot).toBe("");
  });

  it("throws when the module is not registered", async () => {
    const { settingsRepo, moduleRepo } = fakes(false);
    await expect(
      setHsaReceiptRoot(moduleRepo, settingsRepo, storeReturning({ kind: "ok", path: "/a" }), "/a"),
    ).rejects.toThrow("not registered");
  });
});

describe("describeReceiptRootCheck", () => {
  it("names the problem for each failure", () => {
    expect(describeReceiptRootCheck({ kind: "missing", path: "/a" })).toContain("no folder at /a");
    expect(describeReceiptRootCheck({ kind: "not-a-directory", path: "/a" })).toContain("a file");
    expect(describeReceiptRootCheck({ kind: "not-configured" })).toContain("No receipt folder");
  });
});
