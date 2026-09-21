import { DEFAULT_DELIMITER } from "./delimiter";
import type {
  CsvFileStore,
  CsvTableStore,
  UploadedCsvFileRepository,
  UploadedCsvFileWriteData,
} from "./ports";
import type { CsvBrowsedPage, CsvCellChanges, UploadedCsvFile } from "./types";

// Hand-written in-memory implementations of this module's three ports, used by
// the unit tests. Fakes rather than mocks, per ARCHITECTURE.md: they are
// readable, shared across the module's tests, and don't couple a test to the
// order the use-case happens to call things in.
//
// They live in the module rather than in a test file because more than one
// test file uses them, and a fake that drifts from its port is a compile error
// here rather than a puzzling failure at the call site.

/** The metadata rows, in memory. */
export class FakeUploadedCsvFileRepository implements UploadedCsvFileRepository {
  private readonly files = new Map<number, UploadedCsvFile>();
  private nextId = 1;

  list(): UploadedCsvFile[] {
    return [...this.files.values()].sort((left, right) => right.id - left.id);
  }

  getById(id: number): UploadedCsvFile | undefined {
    return this.files.get(id);
  }

  create(input: UploadedCsvFileWriteData): UploadedCsvFile {
    const created: UploadedCsvFile = {
      id: this.nextId++,
      ...input,
      uploadedByName: input.uploadedByUserId === null ? null : "Test Reader",
      uploadedAt: "2026-09-20 12:00:00",
    };
    this.files.set(created.id, created);
    return created;
  }

  updateRowCount(id: number, rowCount: number): void {
    const existing = this.files.get(id);
    if (existing) this.files.set(id, { ...existing, rowCount });
  }

  delete(id: number): boolean {
    return this.files.delete(id);
  }
}

/** The uploaded text and the sidecars, as strings in a map. */
export class FakeCsvFileStore implements CsvFileStore {
  /** Stored name -> contents. A sidecar's entry is a marker, not real bytes. */
  readonly files = new Map<string, string>();
  private nextName = 1;

  async saveStream(
    stream: ReadableStream<Uint8Array>,
    _originalFileName: string,
    maxBytes: number,
  ): Promise<{ storedFileName: string; byteSize: number }> {
    const chunks: Uint8Array[] = [];
    let byteSize = 0;

    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      byteSize += value.byteLength;
      if (byteSize > maxBytes) throw new Error(`Over the ${maxBytes} byte limit.`);
      chunks.push(value);
    }

    if (byteSize === 0) throw new Error("That file is empty.");

    const storedFileName = `stored-${this.nextName++}.csv`;
    this.files.set(storedFileName, Buffer.concat(chunks).toString("utf8"));
    return { storedFileName, byteSize };
  }

  async saveText(text: string, _originalFileName: string): Promise<string> {
    const storedFileName = `stored-${this.nextName++}.csv`;
    this.files.set(storedFileName, text);
    return storedFileName;
  }

  async readText(storedFileName: string): Promise<string> {
    const text = this.files.get(storedFileName);
    if (text === undefined) throw new Error(`No stored file called ${storedFileName}.`);
    return text;
  }

  pathFor(storedFileName: string): string {
    return storedFileName;
  }

  async exists(storedFileName: string): Promise<boolean> {
    return this.files.has(storedFileName);
  }

  async remove(storedFileName: string): Promise<void> {
    this.files.delete(storedFileName);
  }

  tableNameFor(_originalFileName: string): string {
    return `sidecar-${this.nextName++}.sqlite`;
  }
}

/**
 * The sidecars' rows, in memory.
 *
 * Rowids are assigned the way SQLite assigns them — one up from the highest
 * ever used, never reused after a delete — because that property is exactly
 * what the use-cases rely on to address a row.
 */
export class FakeCsvTableStore implements CsvTableStore {
  private readonly tables = new Map<string, Map<number, (string | null)[]>>();
  private readonly nextRowIds = new Map<string, number>();

  /** Registers a sidecar in the paired file store, so `exists` answers true. */
  create(sidecarPath: string, _columnNames: string[], rows: string[][]): number {
    const table = new Map<number, (string | null)[]>();
    let nextRowId = 1;
    for (const row of rows) table.set(nextRowId++, [...row]);

    this.tables.set(sidecarPath, table);
    this.nextRowIds.set(sidecarPath, nextRowId);
    return rows.length;
  }

  read(
    sidecarPath: string,
    columnNames: string[],
    limit: number,
    offset: number,
  ): CsvBrowsedPage {
    const table = this.tableAt(sidecarPath);
    const ordered = [...table.entries()].sort(([left], [right]) => left - right);
    const window = ordered.slice(offset, offset + limit);

    return {
      fileId: 0,
      columns: columnNames,
      rows: window.map(([rowId, cells]) => ({
        rowId,
        cells: columnNames.map((_unused, index) => cells[index] ?? null),
      })),
      totalRows: ordered.length,
      returnedRows: window.length,
      offset,
    };
  }

  *readAll(sidecarPath: string, columnNames: string[]): Generator<(string | null)[]> {
    const table = this.tableAt(sidecarPath);
    const ordered = [...table.entries()].sort(([left], [right]) => left - right);
    for (const [, cells] of ordered) {
      yield columnNames.map((_unused, index) => cells[index] ?? null);
    }
  }

  update(
    sidecarPath: string,
    columnNames: string[],
    rowIds: number[],
    changes: CsvCellChanges,
  ): number {
    const table = this.tableAt(sidecarPath);

    let updated = 0;
    for (const rowId of rowIds) {
      const cells = table.get(rowId);
      if (!cells) continue;

      const next = [...cells];
      for (const [name, value] of Object.entries(changes)) {
        const index = columnNames.indexOf(name);
        if (index === -1) continue;
        next[index] = value;
      }
      table.set(rowId, next);
      updated++;
    }

    return updated;
  }

  deleteRows(sidecarPath: string, rowIds: number[]): number {
    const table = this.tableAt(sidecarPath);
    let deleted = 0;
    for (const rowId of rowIds) if (table.delete(rowId)) deleted++;
    return deleted;
  }

  countRows(sidecarPath: string): number {
    return this.tableAt(sidecarPath).size;
  }

  private tableAt(sidecarPath: string): Map<number, (string | null)[]> {
    const table = this.tables.get(sidecarPath);
    if (!table) throw new Error(`No sidecar at ${sidecarPath}.`);
    return table;
  }
}

/**
 * The three fakes, wired together the way `wiring.ts` wires the real ones.
 *
 * The table store's `create` also registers the sidecar with the file store,
 * because the real one creates a file on disk and `resolveFile` checks for it.
 * Without that every read after an import would report "no longer on disk".
 */
export function makeFakeDeps(): {
  repo: FakeUploadedCsvFileRepository;
  fileStore: FakeCsvFileStore;
  tableStore: CsvTableStore;
} {
  const repo = new FakeUploadedCsvFileRepository();
  const fileStore = new FakeCsvFileStore();
  const inner = new FakeCsvTableStore();

  const tableStore: CsvTableStore = {
    create(sidecarPath, columnNames, rows) {
      fileStore.files.set(sidecarPath, "");
      return inner.create(sidecarPath, columnNames, rows);
    },
    read: (...args) => inner.read(...args),
    readAll: (...args) => inner.readAll(...args),
    update: (...args) => inner.update(...args),
    deleteRows: (...args) => inner.deleteRows(...args),
    countRows: (...args) => inner.countRows(...args),
  };

  return { repo, fileStore, tableStore };
}

/** A default delimiter re-export, so tests needn't reach into `delimiter.ts`. */
export { DEFAULT_DELIMITER };
