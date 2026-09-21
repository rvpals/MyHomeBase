import { describe, expect, it } from "vitest";
import {
  deleteCsvRows,
  deleteUploadedCsvFile,
  editCsvRows,
  exportCsvFileText,
  importCsvFileText,
  listUploadedCsvFiles,
  readCsvRows,
  type CsvFileBrowserDeps,
} from "./csv-file-browser";
import { makeFakeDeps } from "./fake-stores";

const SAMPLE = ["name,age,city", "Ada,36,London", "Grace,45,New York", "Alan,41,Wilmslow"].join(
  "\n",
);

/** Imports `text` and hands back the record plus the deps it landed in. */
async function importSample(text = SAMPLE, options?: { delimiter?: ","; hasHeaderRow?: boolean }) {
  const deps = makeFakeDeps() as CsvFileBrowserDeps & ReturnType<typeof makeFakeDeps>;
  const file = await importCsvFileText(
    { originalFileName: "people.csv", text, uploadedByUserId: 7, options },
    deps,
  );
  return { deps, file };
}

async function collect(generator: AsyncGenerator<string>): Promise<string> {
  let text = "";
  for await (const chunk of generator) text += chunk;
  return text;
}

describe("importCsvFileText", () => {
  it("records the file, its columns and its row count", async () => {
    const { file } = await importSample();

    expect(file.originalFileName).toBe("people.csv");
    expect(file.columnNames).toEqual(["name", "age", "city"]);
    expect(file.rowCount).toBe(3);
    expect(file.delimiter).toBe(",");
    expect(file.hasHeaderRow).toBe(true);
    expect(file.uploadedByUserId).toBe(7);
  });

  it("sniffs a tab-separated file the caller said nothing about", async () => {
    const { file } = await importSample("name\tage\nAda\t36");
    expect(file.delimiter).toBe("\t");
    expect(file.columnNames).toEqual(["name", "age"]);
  });

  it("lets the caller override the sniffed delimiter", async () => {
    // Semicolon-separated text, forced to parse as commas: one wide column.
    const { file } = await importSample("a;b\n1;2", { delimiter: "," });
    expect(file.delimiter).toBe(",");
    expect(file.columnNames).toEqual(["a;b"]);
  });

  it("invents column names when told there is no header row", async () => {
    const { file } = await importSample("Ada,36\nGrace,45", { hasHeaderRow: false });
    expect(file.columnNames).toEqual(["Column 1", "Column 2"]);
    expect(file.rowCount).toBe(2);
  });

  it("refuses a file whose name is not a delimited-text extension", async () => {
    const deps = makeFakeDeps();
    await expect(
      importCsvFileText(
        { originalFileName: "notes.docx", text: "a,b", uploadedByUserId: null },
        deps,
      ),
    ).rejects.toThrow(/Only \.csv/);
  });

  it("refuses an empty file and leaves nothing behind", async () => {
    const deps = makeFakeDeps();

    await expect(
      importCsvFileText({ originalFileName: "empty.csv", text: "", uploadedByUserId: null }, deps),
    ).rejects.toThrow(/no rows to read/);

    // The point of the check: a failed import must not leave a stored file
    // nothing references, nor a row in the picker.
    expect(deps.fileStore.files.size).toBe(0);
    expect(listUploadedCsvFiles(deps.repo)).toHaveLength(0);
  });
});

describe("listUploadedCsvFiles", () => {
  it("lists nothing before anything is uploaded", () => {
    const deps = makeFakeDeps();
    expect(listUploadedCsvFiles(deps.repo)).toEqual([]);
  });

  it("lists newest first", async () => {
    const deps = makeFakeDeps();
    await importCsvFileText(
      { originalFileName: "first.csv", text: "a\n1", uploadedByUserId: null },
      deps,
    );
    await importCsvFileText(
      { originalFileName: "second.csv", text: "a\n1", uploadedByUserId: null },
      deps,
    );

    expect(listUploadedCsvFiles(deps.repo).map((file) => file.originalFileName)).toEqual([
      "second.csv",
      "first.csv",
    ]);
  });
});

describe("readCsvRows", () => {
  it("returns the rows with the file's own column names", async () => {
    const { deps, file } = await importSample();
    const page = await readCsvRows({ fileId: file.id }, deps);

    expect(page.fileId).toBe(file.id);
    expect(page.columns).toEqual(["name", "age", "city"]);
    expect(page.totalRows).toBe(3);
    expect(page.returnedRows).toBe(3);
    expect(page.rows[0].cells).toEqual(["Ada", "36", "London"]);
  });

  it("windows with a limit and an offset", async () => {
    const { deps, file } = await importSample();
    const page = await readCsvRows({ fileId: file.id, limit: 1, offset: 1 }, deps);

    expect(page.returnedRows).toBe(1);
    expect(page.totalRows).toBe(3);
    expect(page.offset).toBe(1);
    expect(page.rows[0].cells[0]).toBe("Grace");
  });

  it("gives each row a distinct id to address it by", async () => {
    const { deps, file } = await importSample();
    const page = await readCsvRows({ fileId: file.id }, deps);

    expect(new Set(page.rows.map((row) => row.rowId)).size).toBe(3);
  });

  it("rejects a file that was never uploaded", async () => {
    const deps = makeFakeDeps();
    await expect(readCsvRows({ fileId: 404 }, deps)).rejects.toThrow(/no longer listed/);
  });

  it("reports a wiped workspace rather than throwing the driver's error", async () => {
    const { deps, file } = await importSample();
    // An upload root is scratch space and clearing it is supported.
    await deps.fileStore.remove(file.tableFileName);

    await expect(readCsvRows({ fileId: file.id }, deps)).rejects.toThrow(/no longer on disk/);
  });

  it("refuses a window larger than the ceiling", async () => {
    const { deps, file } = await importSample();
    await expect(readCsvRows({ fileId: file.id, limit: 99999 }, deps)).rejects.toThrow();
  });
});

describe("editCsvRows", () => {
  it("writes one row and leaves its other columns alone", async () => {
    const { deps, file } = await importSample();
    const before = await readCsvRows({ fileId: file.id }, deps);
    const target = before.rows[0];

    const result = await editCsvRows(
      { fileId: file.id, rowIds: [target.rowId], changes: { city: "Cambridge" } },
      deps,
    );

    expect(result.updatedCount).toBe(1);
    expect(result.fields).toEqual(["city"]);

    const after = await readCsvRows({ fileId: file.id }, deps);
    expect(after.rows[0].cells).toEqual(["Ada", "36", "Cambridge"]);
  });

  it("writes the same values across a selection", async () => {
    const { deps, file } = await importSample();
    const before = await readCsvRows({ fileId: file.id }, deps);
    const rowIds = before.rows.slice(0, 2).map((row) => row.rowId);

    const result = await editCsvRows({ fileId: file.id, rowIds, changes: { city: "Oxford" } }, deps);

    expect(result.updatedCount).toBe(2);
    const after = await readCsvRows({ fileId: file.id }, deps);
    expect(after.rows.map((row) => row.cells[2])).toEqual(["Oxford", "Oxford", "Wilmslow"]);
  });

  it("clears a cell when given null", async () => {
    const { deps, file } = await importSample();
    const before = await readCsvRows({ fileId: file.id }, deps);

    await editCsvRows(
      { fileId: file.id, rowIds: [before.rows[0].rowId], changes: { city: null } },
      deps,
    );

    const after = await readCsvRows({ fileId: file.id }, deps);
    expect(after.rows[0].cells[2]).toBeNull();
  });

  it("reports the written columns in the file's own order", async () => {
    const { deps, file } = await importSample();
    const before = await readCsvRows({ fileId: file.id }, deps);

    // Given out of order on purpose — the result should not echo the caller's.
    const result = await editCsvRows(
      { fileId: file.id, rowIds: [before.rows[0].rowId], changes: { city: "Bath", name: "A" } },
      deps,
    );

    expect(result.fields).toEqual(["name", "city"]);
  });

  it("refuses a column the file does not have, writing nothing", async () => {
    const { deps, file } = await importSample();
    const before = await readCsvRows({ fileId: file.id }, deps);

    await expect(
      editCsvRows(
        { fileId: file.id, rowIds: [before.rows[0].rowId], changes: { nope: "x" } },
        deps,
      ),
    ).rejects.toThrow(/Unknown column/);

    // A half-applied edit would be worse than a refused one.
    const after = await readCsvRows({ fileId: file.id }, deps);
    expect(after.rows[0].cells).toEqual(["Ada", "36", "London"]);
  });

  it("counts a duplicated row id once", async () => {
    const { deps, file } = await importSample();
    const before = await readCsvRows({ fileId: file.id }, deps);
    const rowId = before.rows[0].rowId;

    const result = await editCsvRows(
      { fileId: file.id, rowIds: [rowId, rowId, rowId], changes: { city: "Leeds" } },
      deps,
    );

    expect(result.updatedCount).toBe(1);
  });

  it("rejects an empty selection", async () => {
    const { deps, file } = await importSample();
    await expect(
      editCsvRows({ fileId: file.id, rowIds: [], changes: { city: "x" } }, deps),
    ).rejects.toThrow();
  });

  it("rejects an empty change set", async () => {
    const { deps, file } = await importSample();
    await expect(
      editCsvRows({ fileId: file.id, rowIds: [1], changes: {} }, deps),
    ).rejects.toThrow();
  });
});

describe("deleteCsvRows", () => {
  it("deletes a row and corrects the recorded count", async () => {
    const { deps, file } = await importSample();
    const before = await readCsvRows({ fileId: file.id }, deps);

    const result = await deleteCsvRows(
      { fileId: file.id, rowIds: [before.rows[1].rowId] },
      deps,
    );

    expect(result.deletedCount).toBe(1);
    expect(result.remainingRows).toBe(2);
    // The picker must not go on advertising rows that are gone.
    expect(deps.repo.getById(file.id)?.rowCount).toBe(2);
  });

  it("deletes a selection at once", async () => {
    const { deps, file } = await importSample();
    const before = await readCsvRows({ fileId: file.id }, deps);

    const result = await deleteCsvRows(
      { fileId: file.id, rowIds: before.rows.map((row) => row.rowId) },
      deps,
    );

    expect(result.deletedCount).toBe(3);
    expect(result.remainingRows).toBe(0);
  });

  it("does not reuse the id of a deleted row", async () => {
    const { deps, file } = await importSample();
    const before = await readCsvRows({ fileId: file.id }, deps);
    await deleteCsvRows({ fileId: file.id, rowIds: [before.rows[0].rowId] }, deps);

    const after = await readCsvRows({ fileId: file.id }, deps);
    expect(after.rows.map((row) => row.rowId)).not.toContain(before.rows[0].rowId);
  });

  it("counts a duplicated row id once", async () => {
    const { deps, file } = await importSample();
    const before = await readCsvRows({ fileId: file.id }, deps);
    const rowId = before.rows[0].rowId;

    const result = await deleteCsvRows({ fileId: file.id, rowIds: [rowId, rowId] }, deps);
    expect(result.deletedCount).toBe(1);
  });

  it("rejects an empty selection", async () => {
    const { deps, file } = await importSample();
    await expect(deleteCsvRows({ fileId: file.id, rowIds: [] }, deps)).rejects.toThrow();
  });
});

describe("exportCsvFileText", () => {
  it("writes the header and every row back out", async () => {
    const { deps, file } = await importSample();
    const text = await collect(exportCsvFileText(file.id, deps));

    expect(text).toBe("name,age,city\r\nAda,36,London\r\nGrace,45,New York\r\nAlan,41,Wilmslow\r\n");
  });

  it("exports the edits, not the file as uploaded", async () => {
    const { deps, file } = await importSample();
    const before = await readCsvRows({ fileId: file.id }, deps);
    await editCsvRows(
      { fileId: file.id, rowIds: [before.rows[0].rowId], changes: { city: "Cambridge" } },
      deps,
    );
    await deleteCsvRows({ fileId: file.id, rowIds: [before.rows[2].rowId] }, deps);

    const text = await collect(exportCsvFileText(file.id, deps));
    expect(text).toContain("Ada,36,Cambridge");
    expect(text).not.toContain("Wilmslow");
  });

  it("writes back in the file's own delimiter", async () => {
    const { deps, file } = await importSample("name\tage\nAda\t36");
    const text = await collect(exportCsvFileText(file.id, deps));
    expect(text).toBe("name\tage\r\nAda\t36\r\n");
  });

  it("writes a header even for a file imported without one", async () => {
    const { deps, file } = await importSample("Ada,36", { hasHeaderRow: false });
    const text = await collect(exportCsvFileText(file.id, deps));
    // Without it the export could not be re-imported with its column names,
    // and the names are what every edit was addressed by.
    expect(text).toBe("Column 1,Column 2\r\nAda,36\r\n");
  });
});

describe("deleteUploadedCsvFile", () => {
  it("forgets the file and removes both of its files", async () => {
    const { deps, file } = await importSample();
    expect(deps.fileStore.files.size).toBe(2);

    expect(await deleteUploadedCsvFile(file.id, deps)).toBe(true);

    expect(listUploadedCsvFiles(deps.repo)).toHaveLength(0);
    expect(deps.fileStore.files.size).toBe(0);
  });

  it("reports false for a file that was never there", async () => {
    const deps = makeFakeDeps();
    expect(await deleteUploadedCsvFile(404, deps)).toBe(false);
  });
});
