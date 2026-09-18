import { describe, expect, it } from "vitest";
import type {
  ForeignDatabaseReader,
  SqliteFileStore,
  UploadedDatabaseRepository,
  UploadedDatabaseWriteData,
} from "./ports";
import { MAX_UPLOAD_BYTES, TABLE_PAGE_LIMIT, readTableSchema } from "./schema";
import {
  deleteRows,
  deleteUploadedDatabase,
  listTablesIn,
  listUploadedDatabases,
  readTableRows,
  uploadDatabase,
  type SqliteBrowserDeps,
} from "./sqlite-browser";
import type { BrowsedPage, BrowsedTable, UploadedDatabase } from "./types";

/** An in-memory metadata repository, so the use-cases run without SQLite. */
function fakeRepo(seed: UploadedDatabase[] = []): UploadedDatabaseRepository & {
  rows: UploadedDatabase[];
} {
  const rows = [...seed];
  return {
    rows,
    list: () => [...rows],
    getById: (id) => rows.find((row) => row.id === id),
    create(input: UploadedDatabaseWriteData): UploadedDatabase {
      const created: UploadedDatabase = {
        id: rows.length + 1,
        originalFileName: input.originalFileName,
        storedFileName: input.storedFileName,
        byteSize: input.byteSize,
        uploadedByUserId: input.uploadedByUserId,
        uploadedByName: input.uploadedByUserId === null ? null : "Min",
        uploadedAt: "2026-09-17T10:00:00.000Z",
      };
      rows.push(created);
      return created;
    },
    delete(id) {
      const index = rows.findIndex((row) => row.id === id);
      if (index === -1) return false;
      rows.splice(index, 1);
      return true;
    },
  };
}

/** An in-memory file store: names are recorded, no bytes touch a disk. */
function fakeFileStore(seed: string[] = []): SqliteFileStore & {
  saved: Map<string, Uint8Array>;
  removed: string[];
} {
  const saved = new Map<string, Uint8Array>(seed.map((name) => [name, new Uint8Array([1])]));
  const removed: string[] = [];
  let counter = 0;

  return {
    saved,
    removed,
    async save(bytes) {
      counter += 1;
      const storedFileName = `stored-${counter}.db`;
      saved.set(storedFileName, bytes);
      return storedFileName;
    },
    pathFor: (storedFileName) => `/uploads/${storedFileName}`,
    async exists(storedFileName) {
      return saved.has(storedFileName);
    },
    async remove(storedFileName) {
      removed.push(storedFileName);
      saved.delete(storedFileName);
    },
  };
}

/** A fake foreign reader that records what it was asked to open. */
function fakeReader(
  overrides: Partial<ForeignDatabaseReader> = {},
): ForeignDatabaseReader & { openedPaths: string[]; deleted: number[] } {
  const openedPaths: string[] = [];
  const deleted: number[] = [];

  const base: ForeignDatabaseReader = {
    async isSqliteFile(filePath) {
      openedPaths.push(filePath);
      return true;
    },
    listTables(filePath): BrowsedTable[] {
      openedPaths.push(filePath);
      return [
        { name: "customers", rowCount: 2, columns: [], canDelete: true },
        { name: "active_view", rowCount: 1, columns: [], canDelete: false },
      ];
    },
    readTable(filePath, tableName): BrowsedPage {
      openedPaths.push(filePath);
      return {
        tableName,
        columns: ["id", "name"],
        rows: [
          { rowId: 1, cells: [1, "Ada"] },
          { rowId: 2, cells: [2, "Grace"] },
        ],
        totalRows: 2,
        returnedRows: 2,
        canDelete: true,
      };
    },
    deleteRows(filePath, _tableName, rowIds) {
      openedPaths.push(filePath);
      deleted.push(...rowIds);
      return rowIds.length;
    },
  };

  return { ...base, ...overrides, openedPaths, deleted };
}

function upload(overrides: Partial<UploadedDatabase> = {}): UploadedDatabase {
  return {
    id: 1,
    originalFileName: "chinook.db",
    storedFileName: "stored-1.db",
    byteSize: 2048,
    uploadedByUserId: 7,
    uploadedByName: "Min",
    uploadedAt: "2026-09-17T10:00:00.000Z",
    ...overrides,
  };
}

function makeDeps(overrides: Partial<SqliteBrowserDeps> = {}): SqliteBrowserDeps {
  return {
    repo: fakeRepo(),
    fileStore: fakeFileStore(),
    reader: fakeReader(),
    ...overrides,
  };
}

const validBytes = new Uint8Array([0x53, 0x51, 0x4c, 0x69]);

describe("uploadDatabase", () => {
  it("stores the bytes and records the upload", async () => {
    const repo = fakeRepo();
    const fileStore = fakeFileStore();
    const deps = makeDeps({ repo, fileStore });

    const created = await uploadDatabase(
      { originalFileName: "chinook.db", bytes: validBytes, uploadedByUserId: 7 },
      deps,
    );

    expect(created.originalFileName).toBe("chinook.db");
    expect(created.byteSize).toBe(validBytes.byteLength);
    expect(fileStore.saved.has(created.storedFileName)).toBe(true);
    expect(repo.rows).toHaveLength(1);
  });

  it("accepts an upload with no user attached", async () => {
    const created = await uploadDatabase(
      { originalFileName: "scratch.sqlite", bytes: validBytes, uploadedByUserId: null },
      makeDeps(),
    );

    expect(created.uploadedByUserId).toBeNull();
  });

  it("rejects a file whose extension is not a SQLite one", async () => {
    await expect(
      uploadDatabase(
        { originalFileName: "spreadsheet.csv", bytes: validBytes, uploadedByUserId: 7 },
        makeDeps(),
      ),
    ).rejects.toThrow(/Only \.db/);
  });

  it("rejects an empty file", async () => {
    await expect(
      uploadDatabase(
        { originalFileName: "empty.db", bytes: new Uint8Array(), uploadedByUserId: 7 },
        makeDeps(),
      ),
    ).rejects.toThrow(/empty/);
  });

  it("rejects a file over the size cap", async () => {
    await expect(
      uploadDatabase(
        {
          originalFileName: "huge.db",
          bytes: new Uint8Array(MAX_UPLOAD_BYTES + 1),
          uploadedByUserId: 7,
        },
        makeDeps(),
      ),
    ).rejects.toThrow(/larger than/);
  });

  // The header check is what stops a mis-picked file becoming a picker entry
  // that only fails when someone later clicks it.
  it("removes the stored file and records nothing when it is not really SQLite", async () => {
    const repo = fakeRepo();
    const fileStore = fakeFileStore();
    const reader = fakeReader({ isSqliteFile: async () => false });

    await expect(
      uploadDatabase(
        { originalFileName: "not-really.db", bytes: validBytes, uploadedByUserId: 7 },
        makeDeps({ repo, fileStore, reader }),
      ),
    ).rejects.toThrow(/not a SQLite database/);

    expect(repo.rows).toHaveLength(0);
    expect(fileStore.removed).toHaveLength(1);
    expect(fileStore.saved.size).toBe(0);
  });
});

describe("listUploadedDatabases", () => {
  it("returns what the repository holds", () => {
    const repo = fakeRepo([upload(), upload({ id: 2, originalFileName: "other.db" })]);
    expect(listUploadedDatabases(repo).map((row) => row.id)).toEqual([1, 2]);
  });

  it("returns nothing when none have been uploaded", () => {
    expect(listUploadedDatabases(fakeRepo())).toEqual([]);
  });
});

describe("listTablesIn", () => {
  it("lists the tables of the addressed upload", async () => {
    const deps = makeDeps({
      repo: fakeRepo([upload()]),
      fileStore: fakeFileStore(["stored-1.db"]),
    });

    const tables = await listTablesIn(1, deps);

    expect(tables.map((table) => table.name)).toEqual(["customers", "active_view"]);
  });

  it("marks a view as not deletable", async () => {
    const deps = makeDeps({
      repo: fakeRepo([upload()]),
      fileStore: fakeFileStore(["stored-1.db"]),
    });

    const tables = await listTablesIn(1, deps);

    expect(tables.find((table) => table.name === "active_view")?.canDelete).toBe(false);
  });

  it("fails clearly when the upload is not listed", async () => {
    await expect(listTablesIn(99, makeDeps())).rejects.toThrow(/no longer listed/);
  });

  // An upload root is a workspace and can legitimately be cleared.
  it("fails clearly when the file has gone from disk", async () => {
    const deps = makeDeps({ repo: fakeRepo([upload()]), fileStore: fakeFileStore([]) });

    await expect(listTablesIn(1, deps)).rejects.toThrow(/no longer on disk/);
  });
});

describe("readTableRows", () => {
  it("reads rows from the uploaded file, not the app database", async () => {
    const reader = fakeReader();
    const deps = makeDeps({
      repo: fakeRepo([upload()]),
      fileStore: fakeFileStore(["stored-1.db"]),
      reader,
    });

    const page = await readTableRows({ databaseId: 1, tableName: "customers", limit: 500 }, deps);

    expect(page.rows).toHaveLength(2);
    expect(page.rows[0].rowId).toBe(1);
    expect(reader.openedPaths).toEqual(["/uploads/stored-1.db"]);
  });

  // The schema fills the limit in, so a caller that omits it (the CLI does)
  // gets the same capped read the web app does.
  it("defaults the limit when none is given", async () => {
    const deps = makeDeps({
      repo: fakeRepo([upload()]),
      fileStore: fakeFileStore(["stored-1.db"]),
    });
    const parsed = readTableSchema.parse({ databaseId: 1, tableName: "customers" });

    expect(parsed.limit).toBe(TABLE_PAGE_LIMIT);
    await expect(readTableRows(parsed, deps)).resolves.toMatchObject({ tableName: "customers" });
  });

  it("rejects a table name that is not an identifier", async () => {
    const deps = makeDeps({
      repo: fakeRepo([upload()]),
      fileStore: fakeFileStore(["stored-1.db"]),
    });

    await expect(
      readTableRows({ databaseId: 1, tableName: "users; DROP TABLE x", limit: 10 }, deps),
    ).rejects.toThrow();
  });
});

describe("deleteRows", () => {
  it("deletes the addressed rows and reports the count", async () => {
    const reader = fakeReader();
    const deps = makeDeps({
      repo: fakeRepo([upload()]),
      fileStore: fakeFileStore(["stored-1.db"]),
      reader,
    });

    const result = await deleteRows({ databaseId: 1, tableName: "customers", rowIds: [1, 2] }, deps);

    expect(result).toEqual({ tableName: "customers", deletedCount: 2 });
    expect(reader.deleted).toEqual([1, 2]);
  });

  // A duplicate would inflate the reported count without deleting anything extra.
  it("collapses duplicate row ids before deleting", async () => {
    const reader = fakeReader();
    const deps = makeDeps({
      repo: fakeRepo([upload()]),
      fileStore: fakeFileStore(["stored-1.db"]),
      reader,
    });

    const result = await deleteRows(
      { databaseId: 1, tableName: "customers", rowIds: [1, 1, 2] },
      deps,
    );

    expect(reader.deleted).toEqual([1, 2]);
    expect(result.deletedCount).toBe(2);
  });

  it("rejects an empty selection", async () => {
    const deps = makeDeps({
      repo: fakeRepo([upload()]),
      fileStore: fakeFileStore(["stored-1.db"]),
    });

    await expect(
      deleteRows({ databaseId: 1, tableName: "customers", rowIds: [] }, deps),
    ).rejects.toThrow(/at least one row/);
  });

  it("surfaces the reader's refusal for a table with no rowids", async () => {
    const reader = fakeReader({
      deleteRows: () => {
        throw new Error('Rows in "active_view" cannot be addressed individually, so none were deleted.');
      },
    });
    const deps = makeDeps({
      repo: fakeRepo([upload()]),
      fileStore: fakeFileStore(["stored-1.db"]),
      reader,
    });

    await expect(
      deleteRows({ databaseId: 1, tableName: "active_view", rowIds: [1] }, deps),
    ).rejects.toThrow(/cannot be addressed individually/);
  });
});

describe("deleteUploadedDatabase", () => {
  it("forgets the row and removes the file", async () => {
    const repo = fakeRepo([upload()]);
    const fileStore = fakeFileStore(["stored-1.db"]);

    const removed = await deleteUploadedDatabase(1, makeDeps({ repo, fileStore }));

    expect(removed).toBe(true);
    expect(repo.rows).toHaveLength(0);
    expect(fileStore.removed).toEqual(["stored-1.db"]);
  });

  it("reports false for an upload that is not listed", async () => {
    const fileStore = fakeFileStore();

    const removed = await deleteUploadedDatabase(99, makeDeps({ fileStore }));

    expect(removed).toBe(false);
    expect(fileStore.removed).toEqual([]);
  });
});
