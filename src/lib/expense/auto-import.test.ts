import { describe, expect, it } from "vitest";
import type { CsvImportMappingRepository, NamedMapping } from "@/lib/csv-import";
import { accountNameFromFolderName, findMappingForAccount, runAutoImport } from "./auto-import";
import type { CsvFolderPort } from "./csv-folder";
import {
  EXPENSE_SETTING_KEYS,
  expenseSettingsToEntries,
  isAutoImportConfigured,
  isAutoImportEnabled,
  resolveExpenseSettings,
  shouldRunNow,
} from "./settings";
import type { ExpenseSettings } from "./settings";
import type { ModuleSetting } from "@/lib/module-settings";
import { SqliteExpenseRepository } from "./repository";
import type { ExpenseRepository } from "./ports";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import path from "node:path";

function setting(key: string, value: string): ModuleSetting {
  return { id: 1, moduleId: 5, key, value };
}

describe("resolveExpenseSettings", () => {
  it("defaults to disabled when nothing is set", () => {
    const settings = resolveExpenseSettings([]);
    expect(settings).toEqual({
      autoImportEnabled: true,
      autoImportPath: "",
      autoImportIntervalMinutes: 0,
    });
    // The switch defaults on, but with no folder or interval nothing runs.
    expect(isAutoImportEnabled(settings)).toBe(false);
  });

  it("reads a configured path and interval", () => {
    const settings = resolveExpenseSettings([
      setting(EXPENSE_SETTING_KEYS.autoImportPath, "/volume1/statements"),
      setting(EXPENSE_SETTING_KEYS.autoImportIntervalMinutes, "30"),
    ]);
    expect(settings).toEqual({
      autoImportEnabled: true,
      autoImportPath: "/volume1/statements",
      autoImportIntervalMinutes: 30,
    });
    expect(isAutoImportEnabled(settings)).toBe(true);
  });

  it("stays disabled when only one half is configured", () => {
    const pathOnly = resolveExpenseSettings([
      setting(EXPENSE_SETTING_KEYS.autoImportPath, "/volume1/statements"),
    ]);
    expect(isAutoImportEnabled(pathOnly)).toBe(false);

    const intervalOnly = resolveExpenseSettings([
      setting(EXPENSE_SETTING_KEYS.autoImportIntervalMinutes, "15"),
    ]);
    expect(isAutoImportEnabled(intervalOnly)).toBe(false);
  });

  it("treats a zero, negative or unparseable interval as disabled", () => {
    for (const raw of ["0", "-5", "soon"]) {
      const settings = resolveExpenseSettings([
        setting(EXPENSE_SETTING_KEYS.autoImportPath, "/x"),
        setting(EXPENSE_SETTING_KEYS.autoImportIntervalMinutes, raw),
      ]);
      expect(settings.autoImportIntervalMinutes).toBe(0);
    }
  });

  it("round-trips through the serializer", () => {
    for (const autoImportEnabled of [true, false]) {
      const original: ExpenseSettings = {
        autoImportEnabled,
        autoImportPath: "/volume1/statements",
        autoImportIntervalMinutes: 45,
      };
      const rebuilt = resolveExpenseSettings(
        expenseSettingsToEntries(original).map((entry, index) => ({
          id: index + 1,
          moduleId: 5,
          key: entry.key,
          value: entry.value,
        })),
      );
      expect(rebuilt).toEqual(original);
    }
  });

  it("omits a blank path, since module-setting values must be non-empty", () => {
    const entries = expenseSettingsToEntries({
      autoImportEnabled: true,
      autoImportPath: "",
      autoImportIntervalMinutes: 5,
    });
    expect(entries.every((entry) => entry.value !== "")).toBe(true);
    expect(entries.some((entry) => entry.key === EXPENSE_SETTING_KEYS.autoImportPath)).toBe(false);
  });
});

describe("the automatic-import switch", () => {
  const configured = [
    setting(EXPENSE_SETTING_KEYS.autoImportPath, "/volume1/statements"),
    setting(EXPENSE_SETTING_KEYS.autoImportIntervalMinutes, "30"),
  ];

  it("holds the background service off while the switch is off", () => {
    const settings = resolveExpenseSettings([
      ...configured,
      setting(EXPENSE_SETTING_KEYS.autoImportEnabled, "false"),
    ]);
    expect(settings.autoImportEnabled).toBe(false);
    expect(isAutoImportEnabled(settings)).toBe(false);
    // Still configured, so a manual "Run import now" is allowed.
    expect(isAutoImportConfigured(settings)).toBe(true);
  });

  it("runs the background service when the switch is on and it's configured", () => {
    const settings = resolveExpenseSettings([
      ...configured,
      setting(EXPENSE_SETTING_KEYS.autoImportEnabled, "true"),
    ]);
    expect(isAutoImportEnabled(settings)).toBe(true);
  });

  it("stays off when switched on but not configured", () => {
    const settings = resolveExpenseSettings([
      setting(EXPENSE_SETTING_KEYS.autoImportEnabled, "true"),
    ]);
    expect(isAutoImportConfigured(settings)).toBe(false);
    expect(isAutoImportEnabled(settings)).toBe(false);
  });

  it("treats a missing row as on, so an existing setup keeps importing", () => {
    expect(resolveExpenseSettings(configured).autoImportEnabled).toBe(true);
    expect(isAutoImportEnabled(resolveExpenseSettings(configured))).toBe(true);
  });

  it("reads the stored value case-insensitively, and anything else as off", () => {
    const enabledOf = (raw: string) =>
      resolveExpenseSettings([setting(EXPENSE_SETTING_KEYS.autoImportEnabled, raw)])
        .autoImportEnabled;
    expect(enabledOf("TRUE")).toBe(true);
    expect(enabledOf(" true ")).toBe(true);
    expect(enabledOf("false")).toBe(false);
    expect(enabledOf("1")).toBe(false);
    expect(enabledOf("yes")).toBe(false);
  });
});

describe("shouldRunNow", () => {
  const minute = 60_000;

  it("runs on the first tick after startup", () => {
    expect(shouldRunNow(undefined, 30, 1_000_000)).toBe(true);
  });

  it("waits until the interval has elapsed", () => {
    const lastRun = 1_000_000;
    expect(shouldRunNow(lastRun, 30, lastRun + 29 * minute)).toBe(false);
    expect(shouldRunNow(lastRun, 30, lastRun + 30 * minute)).toBe(true);
  });

  it("never runs when the interval is zero", () => {
    expect(shouldRunNow(undefined, 0, Date.now())).toBe(false);
  });
});

describe("accountNameFromFolderName", () => {
  it("takes the sub-folder name as the account name", () => {
    expect(accountNameFromFolderName("Visa Gold")).toBe("Visa Gold");
    expect(accountNameFromFolderName("  Amex  ")).toBe("Amex");
  });
});

describe("findMappingForAccount", () => {
  const mapping = (id: number, name: string): NamedMapping => ({
    id,
    name,
    importType: "Expense",
    columnMapping: {},
    fieldOptions: {},
    createdAt: "",
    updatedAt: "",
  });

  it("matches a mapping by name, ignoring case", () => {
    const found = findMappingForAccount("visa gold", [mapping(1, "Visa Gold"), mapping(2, "Amex")]);
    expect(found?.id).toBe(1);
  });

  it("falls back to the only mapping when there's just one", () => {
    expect(findMappingForAccount("Anything", [mapping(1, "Chase")])?.id).toBe(1);
  });

  it("returns nothing when several mappings exist and none match", () => {
    expect(findMappingForAccount("Nope", [mapping(1, "Chase"), mapping(2, "Amex")])).toBeUndefined();
  });
});

// --- runAutoImport, against a real (in-memory) database ----------------------

/**
 * An in-memory folder tree, so the flow is exercised without touching a disk.
 * Keys are full paths joined with "/", e.g. "/watch/Visa Gold/jan.csv".
 */
function fakeFolder(
  files: Record<string, string>,
  options: { rootExists?: boolean } = {},
): CsvFolderPort & { files: Record<string, string> } {
  const state = { ...files };
  const rootExists = options.rootExists ?? true;

  const parentOf = (fullPath: string) => fullPath.slice(0, fullPath.lastIndexOf("/"));
  const nameOf = (fullPath: string) => fullPath.slice(fullPath.lastIndexOf("/") + 1);

  return {
    files: state,
    directoryExists: (directory) => rootExists && directory === "/watch",
    listSubdirectoryNames: (directory) => {
      const prefix = `${directory}/`;
      const names = new Set<string>();
      for (const fullPath of Object.keys(state)) {
        if (!fullPath.startsWith(prefix)) continue;
        const rest = fullPath.slice(prefix.length);
        const slash = rest.indexOf("/");
        if (slash > 0) names.add(rest.slice(0, slash)); // a directory level exists
      }
      return [...names].sort();
    },
    listCsvFileNames: (directory) =>
      Object.keys(state)
        .filter((fullPath) => parentOf(fullPath) === directory)
        .map(nameOf)
        .filter((name) => name.toLowerCase().endsWith(".csv"))
        .sort(),
    readFileText: (directory, fileName) => {
      const text = state[`${directory}/${fileName}`];
      if (text === undefined) throw new Error(`No such file: ${directory}/${fileName}`);
      return text;
    },
    renameFile: (directory, fromName, toName) => {
      state[`${directory}/${toName}`] = state[`${directory}/${fromName}`];
      delete state[`${directory}/${fromName}`];
    },
    joinPath: (...segments) => segments.join("/"),
  };
}

function fakeMappingRepo(mappings: NamedMapping[]): CsvImportMappingRepository {
  return {
    getCurrentMapping: () => undefined,
    saveCurrentMapping: () => {},
    listNamedMappings: (importType) => mappings.filter((m) => m.importType === importType),
    getNamedMappingById: (id) => mappings.find((m) => m.id === id),
    createNamedMapping: () => {
      throw new Error("not used");
    },
    updateNamedMapping: () => {
      throw new Error("not used");
    },
    deleteNamedMapping: () => {},
  };
}

/**
 * A real repository over an in-memory SQLite, built from the actual migrations
 * so the SQL is exercised for real. List every migration that touches an exp_
 * table — a new one that isn't added here will fail loudly with "no such
 * column", which is the right way to find out.
 */
const EXPENSE_MIGRATIONS = [
  "0029_create_expense_tables.sql",
  "0031_add_card_image_to_expense_accounts.sql",
  "0032_post_import_processing.sql",
  "0034_add_icon_image_to_expense_categories.sql",
];

function memoryExpenseRepo(): { repo: ExpenseRepository; db: Database.Database } {
  const db = new Database(":memory:");
  for (const fileName of EXPENSE_MIGRATIONS) {
    db.exec(readFileSync(path.join(process.cwd(), "migrations", fileName), "utf8"));
  }
  return { repo: new SqliteExpenseRepository(db), db };
}

const CHASE_MAPPING: NamedMapping = {
  id: 1,
  name: "Visa Gold",
  importType: "Expense",
  columnMapping: { "0": "transactionDate", "1": "transactionDescription", "2": "amount" },
  fieldOptions: { "0": { dateFormat: "MM/DD/YYYY" } },
  createdAt: "",
  updatedAt: "",
};

const STATEMENT = `Date,Description,Amount
07/15/2026,AMAZON MKTPL*2X4Y9,20.33
07/16/2026,LOCAL BAKERY,7.50`;

const ENABLED: ExpenseSettings = {
  autoImportEnabled: true,
  autoImportPath: "/watch",
  autoImportIntervalMinutes: 30,
};

const FIXED_NOW = () => new Date(2026, 7, 2, 14, 5, 1); // 2026-08-02 14:05:01 local

describe("runAutoImport", () => {
  it("does nothing when auto-import isn't configured", () => {
    const { repo } = memoryExpenseRepo();
    const summary = runAutoImport(
      { autoImportEnabled: true, autoImportPath: "", autoImportIntervalMinutes: 0 },
      {
        expenseRepo: repo,
        mappingRepo: fakeMappingRepo([]),
        folder: fakeFolder({}),
        createdByUserId: 1,
      },
    );
    expect(summary.ran).toBe(false);
    expect(summary.reason).toMatch(/not configured/);
  });

  it("still runs with the background switch off — that only gates the scheduler", () => {
    const { repo } = memoryExpenseRepo();
    repo.createAccount({ name: "Visa Gold", description: "", creditLineCents: 0 });
    const folder = fakeFolder({ "/watch/Visa Gold/statement.csv": STATEMENT });

    const summary = runAutoImport(
      { ...ENABLED, autoImportEnabled: false },
      {
        expenseRepo: repo,
        mappingRepo: fakeMappingRepo([CHASE_MAPPING]),
        folder,
        createdByUserId: 1,
        now: FIXED_NOW,
      },
    );

    expect(summary.ran).toBe(true);
    expect(repo.listTransactions()).toHaveLength(2);
  });

  it("reports a missing folder rather than throwing", () => {
    const { repo } = memoryExpenseRepo();
    const summary = runAutoImport(ENABLED, {
      expenseRepo: repo,
      mappingRepo: fakeMappingRepo([]),
      folder: fakeFolder({}, { rootExists: false }),
      createdByUserId: 1,
    });
    expect(summary.ran).toBe(false);
    expect(summary.reason).toMatch(/Folder not found/);
  });

  it("imports a statement into the card its sub-folder names, then renames it", () => {
    const { repo } = memoryExpenseRepo();
    repo.createAccount({ name: "Visa Gold", description: "", creditLineCents: 0 });
    // The file itself can be named anything — the folder identifies the card.
    const folder = fakeFolder({ "/watch/Visa Gold/statement-jan.csv": STATEMENT });

    const summary = runAutoImport(ENABLED, {
      expenseRepo: repo,
      mappingRepo: fakeMappingRepo([CHASE_MAPPING]),
      folder,
      createdByUserId: 7,
      now: FIXED_NOW,
    });

    expect(summary.ran).toBe(true);
    expect(summary.files).toHaveLength(1);
    expect(summary.files[0]).toMatchObject({
      cardFolder: "Visa Gold",
      fileName: "statement-jan.csv",
      status: "imported",
      importedCount: 2,
    });

    // Renamed out of the *.csv scan, in place, keeping the original content.
    expect(summary.files[0].renamedTo).toBe("statement-jan_20260802-140501.backup");
    expect(folder.files["/watch/Visa Gold/statement-jan.csv"]).toBeUndefined();
    expect(folder.files["/watch/Visa Gold/statement-jan_20260802-140501.backup"]).toBe(STATEMENT);

    const transactions = repo.listTransactions();
    expect(transactions).toHaveLength(2);
    expect(transactions.every((t) => t.createdByUserId === 7)).toBe(true);
  });

  it("imports several files from one card folder", () => {
    const { repo } = memoryExpenseRepo();
    repo.createAccount({ name: "Visa Gold", description: "", creditLineCents: 0 });
    const folder = fakeFolder({
      "/watch/Visa Gold/jan.csv": STATEMENT,
      "/watch/Visa Gold/feb.csv": `Date,Description,Amount\n08/01/2026,COSTCO WHSE #1234,88.10`,
    });

    const summary = runAutoImport(ENABLED, {
      expenseRepo: repo,
      mappingRepo: fakeMappingRepo([CHASE_MAPPING]),
      folder,
      createdByUserId: 1,
      now: FIXED_NOW,
    });

    expect(summary.files).toHaveLength(2);
    expect(summary.files.every((file) => file.status === "imported")).toBe(true);
    expect(repo.listTransactions()).toHaveLength(3);
  });

  it("routes each card folder to its own account", () => {
    const { repo } = memoryExpenseRepo();
    const visa = repo.createAccount({ name: "Visa Gold", description: "", creditLineCents: 0 });
    const amex = repo.createAccount({ name: "Amex", description: "", creditLineCents: 0 });
    const amexMapping: NamedMapping = { ...CHASE_MAPPING, id: 2, name: "Amex" };

    runAutoImport(ENABLED, {
      expenseRepo: repo,
      mappingRepo: fakeMappingRepo([CHASE_MAPPING, amexMapping]),
      folder: fakeFolder({
        "/watch/Visa Gold/a.csv": STATEMENT,
        "/watch/Amex/b.csv": `Date,Description,Amount\n08/01/2026,SHELL OIL,40.00`,
      }),
      createdByUserId: 1,
      now: FIXED_NOW,
    });

    expect(repo.listTransactions({ accountId: visa.id })).toHaveLength(2);
    expect(repo.listTransactions({ accountId: amex.id })).toHaveLength(1);
  });

  it("applies the fuzzy rules during the import", () => {
    const { repo } = memoryExpenseRepo();
    repo.createAccount({ name: "Visa Gold", description: "", creditLineCents: 0 });
    repo.createRule({
      pattern: "AMAZON*",
      priority: 0,
      isEnabled: true,
      actions: [
        { fieldName: "categoryName", fieldValue: "online-purchase" },
        { fieldName: "status", fieldValue: "reconciled" },
      ],
    });

    const summary = runAutoImport(ENABLED, {
      expenseRepo: repo,
      mappingRepo: fakeMappingRepo([CHASE_MAPPING]),
      folder: fakeFolder({ "/watch/Visa Gold/jan.csv": STATEMENT }),
      createdByUserId: 1,
      now: FIXED_NOW,
    });

    expect(summary.files[0].categorisedCount).toBe(1);
    const amazon = repo
      .listTransactions()
      .find((t) => t.transactionDescription.startsWith("AMAZON"));
    expect(amazon).toMatchObject({ categoryName: "online-purchase", status: "reconciled" });
  });

  it("renames to .failed when no account matches the sub-folder name", () => {
    const { repo } = memoryExpenseRepo();
    const folder = fakeFolder({ "/watch/Unknown Card/jan.csv": STATEMENT });

    const summary = runAutoImport(ENABLED, {
      expenseRepo: repo,
      mappingRepo: fakeMappingRepo([CHASE_MAPPING]),
      folder,
      createdByUserId: 1,
      now: FIXED_NOW,
    });

    expect(summary.files[0]).toMatchObject({ cardFolder: "Unknown Card", status: "failed" });
    expect(summary.files[0].detail).toMatch(/No credit-card account named "Unknown Card"/);
    // Moved aside so it isn't retried every tick forever.
    expect(folder.files["/watch/Unknown Card/jan_20260802-140501.failed"]).toBe(STATEMENT);
  });

  it("reports a CSV left at the top level instead of ignoring it", () => {
    const { repo } = memoryExpenseRepo();
    const summary = runAutoImport(ENABLED, {
      expenseRepo: repo,
      mappingRepo: fakeMappingRepo([CHASE_MAPPING]),
      folder: fakeFolder({ "/watch/loose.csv": STATEMENT }),
      createdByUserId: 1,
      now: FIXED_NOW,
    });

    expect(summary.files[0]).toMatchObject({ fileName: "loose.csv", status: "failed" });
    expect(summary.files[0].detail).toMatch(/card sub-folder/);
  });

  it("keeps going when one card folder fails and another succeeds", () => {
    const { repo } = memoryExpenseRepo();
    repo.createAccount({ name: "Visa Gold", description: "", creditLineCents: 0 });
    const folder = fakeFolder({
      "/watch/Visa Gold/jan.csv": STATEMENT,
      "/watch/Ghost Card/jan.csv": STATEMENT,
    });

    const summary = runAutoImport(ENABLED, {
      expenseRepo: repo,
      mappingRepo: fakeMappingRepo([CHASE_MAPPING]),
      folder,
      createdByUserId: 1,
      now: FIXED_NOW,
    });

    expect(summary.files.map((file) => file.status).sort()).toEqual(["failed", "imported"]);
    expect(repo.listTransactions()).toHaveLength(2);
  });

  it("skips rows already imported when the same statement reappears", () => {
    const { repo } = memoryExpenseRepo();
    repo.createAccount({ name: "Visa Gold", description: "", creditLineCents: 0 });
    const dependencies = {
      expenseRepo: repo,
      mappingRepo: fakeMappingRepo([CHASE_MAPPING]),
      createdByUserId: 1,
      now: FIXED_NOW,
    };

    runAutoImport(ENABLED, {
      ...dependencies,
      folder: fakeFolder({ "/watch/Visa Gold/jan.csv": STATEMENT }),
    });
    const second = runAutoImport(ENABLED, {
      ...dependencies,
      folder: fakeFolder({ "/watch/Visa Gold/jan-again.csv": STATEMENT }),
    });

    expect(second.files[0].importedCount).toBe(0);
    expect(second.files[0].duplicateCount).toBe(2);
    expect(repo.listTransactions()).toHaveLength(2); // not doubled
  });

  it("ignores files in a card folder that aren't .csv", () => {
    const { repo } = memoryExpenseRepo();
    repo.createAccount({ name: "Visa Gold", description: "", creditLineCents: 0 });
    const folder = fakeFolder({
      "/watch/Visa Gold/jan_20260101-000000.backup": STATEMENT,
    });

    const summary = runAutoImport(ENABLED, {
      expenseRepo: repo,
      mappingRepo: fakeMappingRepo([CHASE_MAPPING]),
      folder,
      createdByUserId: 1,
      now: FIXED_NOW,
    });

    expect(summary.files).toHaveLength(0);
    expect(repo.listTransactions()).toHaveLength(0);
  });
});
