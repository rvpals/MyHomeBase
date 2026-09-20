import { describe, expect, it } from "vitest";
import type {
  ForeignDatabaseReader,
  SqliteFileStore,
  UploadedDatabaseRepository,
  UploadedDatabaseWriteData,
} from "./ports";
import { UploadTooLargeError, formatCap } from "./errors";
import { DEFAULT_MAX_UPLOAD_BYTES, TABLE_PAGE_LIMIT, readTableSchema } from "./schema";
import {
  deleteRows,
  deleteUploadedDatabase,
  listTablesIn,
  listUploadedDatabases,
  readTableRows,
  uploadDatabase,
  uploadDatabaseStream,
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
    async saveStream(stream, _originalFileName, maxBytes) {
      counter += 1;
      const storedFileName = `stored-${counter}.db`;

      // Mirrors the real store: accumulate, and fail the moment the cap is
      // passed rather than after the whole stream has been read.
      // Nothing is recorded in `saved` until the whole stream is accepted,
      // which is the fake's stand-in for the real store removing its partial
      // file on the way out.
      const chunks: Uint8Array[] = [];
      let byteSize = 0;
      for await (const chunk of streamChunks(stream)) {
        byteSize += chunk.byteLength;
        if (byteSize > maxBytes) throw new UploadTooLargeError(maxBytes);
        chunks.push(chunk);
      }
      if (byteSize === 0) throw new Error("That file is empty.");

      const joined = new Uint8Array(byteSize);
      let offset = 0;
      for (const chunk of chunks) {
        joined.set(chunk, offset);
        offset += chunk.byteLength;
      }
      saved.set(storedFileName, joined);
      return { storedFileName, byteSize };
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

/** Reads a web ReadableStream as an async iterable, which Node's does not do. */
async function* streamChunks(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

/** A stream of the given chunks, standing in for an uploaded file. */
function streamOf(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
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

  // A real Uint8Array (the schema checks the type) reporting an over-cap
  // length, rather than a genuinely gigabyte-sized buffer: the cap is 1 GB,
  // and allocating that to prove a comparison works would make the suite slow
  // and memory-hungry for nothing.
  it("rejects a file over the size cap", async () => {
    const overCap = new Uint8Array(1);
    Object.defineProperty(overCap, "byteLength", { value: DEFAULT_MAX_UPLOAD_BYTES + 1 });

    await expect(
      uploadDatabase(
        { originalFileName: "huge.db", bytes: overCap, uploadedByUserId: 7 },
        makeDeps(),
      ),
    ).rejects.toThrow(/larger than/);
  });

  // The whole point of making the cap a setting: the configured number is
  // what applies, not the shipped default.
  it("enforces a configured cap smaller than the default", async () => {
    const repo = fakeRepo();
    const tenBytes = 10;

    await expect(
      uploadDatabase(
        { originalFileName: "small.db", bytes: new Uint8Array(11), uploadedByUserId: 7 },
        makeDeps({ repo }),
        tenBytes,
      ),
    ).rejects.toThrow(/larger than/);

    expect(repo.rows).toHaveLength(0);
  });

  it("accepts a file within a configured cap", async () => {
    const created = await uploadDatabase(
      { originalFileName: "small.db", bytes: new Uint8Array(8), uploadedByUserId: 7 },
      makeDeps(),
      10,
    );

    expect(created.byteSize).toBe(8);
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

describe("formatCap", () => {
  // The cap is built into user-facing copy in three places, so it has to read
  // the way a person would say it. Printing a gigabyte cap as "1024 MB" is the
  // drift this exists to prevent.
  it("reads a gigabyte-scale cap in GB", () => {
    expect(formatCap(1024 * 1024 * 1024)).toBe("1 GB");
    expect(formatCap(2 * 1024 * 1024 * 1024)).toBe("2 GB");
  });

  it("keeps a fraction where a whole number would be wrong", () => {
    expect(formatCap(1536 * 1024 * 1024)).toBe("1.5 GB");
  });

  it("reads a smaller cap in MB", () => {
    expect(formatCap(50 * 1024 * 1024)).toBe("50 MB");
    expect(formatCap(4 * 1024 * 1024)).toBe("4 MB");
  });

  it("matches the shipped default cap", () => {
    expect(formatCap(DEFAULT_MAX_UPLOAD_BYTES)).toBe("1 GB");
  });
});

describe("uploadDatabaseStream", () => {
  it("streams the file to the store and records it", async () => {
    const repo = fakeRepo();
    const fileStore = fakeFileStore();

    const created = await uploadDatabaseStream(
      {
        originalFileName: "chinook.db",
        stream: streamOf(new Uint8Array([1, 2]), new Uint8Array([3])),
        uploadedByUserId: 7,
      },
      makeDeps({ repo, fileStore }),
    );

    // The size is what actually arrived, not anything the caller claimed.
    expect(created.byteSize).toBe(3);
    expect(repo.rows).toHaveLength(1);
  });

  // The name is checked before a byte is written, so a bad extension never
  // reaches the disk at all.
  it("rejects a non-SQLite extension without writing anything", async () => {
    const fileStore = fakeFileStore();

    await expect(
      uploadDatabaseStream(
        { originalFileName: "notes.csv", stream: streamOf(new Uint8Array([1])), uploadedByUserId: 7 },
        makeDeps({ fileStore }),
      ),
    ).rejects.toThrow(/Only \.db/);

    expect(fileStore.saved.size).toBe(0);
  });

  // The store is handed a small cap rather than the real 1 GB one, so the
  // abort path is exercised without allocating a gigabyte. What matters is
  // that the limit is applied mid-stream and nothing is recorded.
  it("rejects a stream that exceeds the cap", async () => {
    const repo = fakeRepo();
    const fileStore = fakeFileStore();
    const tinyCap = 4;

    await expect(
      fileStore.saveStream(
        streamOf(new Uint8Array(3), new Uint8Array(3)),
        "huge.db",
        tinyCap,
      ),
    ).rejects.toThrow(UploadTooLargeError);

    expect(repo.rows).toHaveLength(0);
    expect(fileStore.saved.size).toBe(0);
  });

  it("rejects an empty stream", async () => {
    await expect(
      uploadDatabaseStream(
        { originalFileName: "empty.db", stream: streamOf(), uploadedByUserId: 7 },
        makeDeps(),
      ),
    ).rejects.toThrow(/empty/);
  });

  it("removes the stored file and records nothing when it is not really SQLite", async () => {
    const repo = fakeRepo();
    const fileStore = fakeFileStore();
    const reader = fakeReader({ isSqliteFile: async () => false });

    await expect(
      uploadDatabaseStream(
        {
          originalFileName: "not-really.db",
          stream: streamOf(new Uint8Array([1])),
          uploadedByUserId: 7,
        },
        makeDeps({ repo, fileStore, reader }),
      ),
    ).rejects.toThrow(/not a SQLite database/);

    expect(repo.rows).toHaveLength(0);
    expect(fileStore.removed).toHaveLength(1);
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
