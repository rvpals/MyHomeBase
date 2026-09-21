import {
  DEFAULT_DELIMITER,
  parseDelimited,
  sniffDelimiter,
  toDelimitedLine,
} from "./delimiter";
import type { CsvFileStore, CsvTableStore, UploadedCsvFileRepository } from "./ports";
import {
  csvImportOptionsSchema,
  csvUploadFileNameSchema,
  deleteCsvRowsSchema,
  editCsvRowsSchema,
  readCsvRowsSchema,
  type CsvImportOptionsInput,
  type DeleteCsvRowsInput,
  type EditCsvRowsInput,
  type ReadCsvRowsInput,
} from "./schema";
import type {
  CsvBrowsedPage,
  DeleteCsvRowsResult,
  EditCsvRowsResult,
  UploadedCsvFile,
} from "./types";

/** The dependencies every use-case here needs, passed rather than constructed. */
export interface CsvFileBrowserDeps {
  repo: UploadedCsvFileRepository;
  fileStore: CsvFileStore;
  tableStore: CsvTableStore;
}

/** Every uploaded file, newest first. */
export function listUploadedCsvFiles(repo: UploadedCsvFileRepository): UploadedCsvFile[] {
  return repo.list();
}

/** One uploaded file, or undefined. */
export function getUploadedCsvFile(
  repo: UploadedCsvFileRepository,
  fileId: number,
): UploadedCsvFile | undefined {
  return repo.getById(fileId);
}

/**
 * Stores an uploaded file, loads it into a sidecar, and records it.
 *
 * The order is deliberate and is the same one `sqlite-browser` uses: bytes
 * first, sidecar second, row last. A failure at any step removes what the
 * earlier steps wrote, so there is never a row pointing at a file that isn't
 * there or a sidecar nothing references. The reverse order would leave a
 * phantom in the picker.
 *
 * An empty file is refused here rather than accepted as a zero-row table: a
 * file with no columns cannot be browsed, edited or exported, so a picker
 * entry for it is only ever a dead end.
 */
export async function importCsvFileStream(
  input: {
    originalFileName: string;
    stream: ReadableStream<Uint8Array>;
    uploadedByUserId: number | null;
    options?: CsvImportOptionsInput;
  },
  deps: CsvFileBrowserDeps,
  maxBytes: number,
): Promise<UploadedCsvFile> {
  // Validated before a byte is written, so a `.docx` is refused without being
  // spooled to disk first.
  const originalFileName = csvUploadFileNameSchema.parse(input.originalFileName);

  const { storedFileName, byteSize } = await deps.fileStore.saveStream(
    input.stream,
    originalFileName,
    maxBytes,
  );

  return finishImport(
    { originalFileName, storedFileName, byteSize, uploadedByUserId: input.uploadedByUserId },
    input.options,
    deps,
  );
}

/**
 * The same, from text already in hand — what the CLI calls.
 *
 * Identical rules to `importCsvFileStream`; it differs only in not streaming,
 * which is fine for a terminal reading a local file it already opened.
 */
export async function importCsvFileText(
  input: {
    originalFileName: string;
    text: string;
    uploadedByUserId: number | null;
    options?: CsvImportOptionsInput;
  },
  deps: CsvFileBrowserDeps,
): Promise<UploadedCsvFile> {
  const originalFileName = csvUploadFileNameSchema.parse(input.originalFileName);
  const storedFileName = await deps.fileStore.saveText(input.text, originalFileName);

  return finishImport(
    {
      originalFileName,
      storedFileName,
      byteSize: Buffer.byteLength(input.text, "utf8"),
      uploadedByUserId: input.uploadedByUserId,
    },
    input.options,
    deps,
  );
}

/**
 * Parses the stored text into a sidecar and records the row — the half of an
 * import that both entry points share.
 *
 * Everything it writes is undone if anything after it fails, which is why the
 * cleanup lives here rather than being repeated in each caller.
 */
async function finishImport(
  stored: {
    originalFileName: string;
    storedFileName: string;
    byteSize: number;
    uploadedByUserId: number | null;
  },
  options: CsvImportOptionsInput | undefined,
  deps: CsvFileBrowserDeps,
): Promise<UploadedCsvFile> {
  let tableFileName: string | undefined;

  try {
    const text = await deps.fileStore.readText(stored.storedFileName);
    const parsedOptions = csvImportOptionsSchema.parse(options ?? {});

    // Sniffed only when the caller did not say. A reader who corrected the
    // guess, or a CLI `--delimiter`, must win over the heuristic.
    const delimiter = parsedOptions.delimiter ?? (text.length > 0 ? sniffDelimiter(text) : DEFAULT_DELIMITER);
    const { columnNames, rows } = parseDelimited(text, delimiter, parsedOptions.hasHeaderRow);

    if (columnNames.length === 0) {
      throw new Error("That file has no rows to read.");
    }

    tableFileName = deps.fileStore.tableNameFor(stored.originalFileName);
    const rowCount = deps.tableStore.create(
      deps.fileStore.pathFor(tableFileName),
      columnNames,
      rows,
    );

    return deps.repo.create({
      originalFileName: stored.originalFileName,
      storedFileName: stored.storedFileName,
      tableFileName,
      delimiter,
      hasHeaderRow: parsedOptions.hasHeaderRow,
      columnNames,
      rowCount,
      byteSize: stored.byteSize,
      uploadedByUserId: stored.uploadedByUserId,
    });
  } catch (error) {
    // Both files go, in the order they were made. Nothing references either at
    // this point, so a leftover would be unreachable clutter in the workspace.
    await deps.fileStore.remove(stored.storedFileName);
    if (tableFileName) await deps.fileStore.remove(tableFileName);
    throw error;
  }
}

/** A window of one uploaded file's rows. */
export async function readCsvRows(
  input: ReadCsvRowsInput,
  deps: CsvFileBrowserDeps,
): Promise<CsvBrowsedPage> {
  const parsed = readCsvRowsSchema.parse(input);
  const { record, sidecarPath } = await resolveFile(parsed.fileId, deps);

  const page = deps.tableStore.read(sidecarPath, record.columnNames, parsed.limit, parsed.offset);
  // The store is handed a path and never learns which upload it belongs to, so
  // the id is stamped on here — the view keys its state by it.
  return { ...page, fileId: parsed.fileId };
}

/**
 * Writes the same values to one or more rows.
 *
 * One use-case for both the single-row edit and the bulk edit, because they
 * are the same operation with a different number of rowids — splitting them
 * would be two code paths that must not drift. The UI still presents them
 * differently, which is a presentation concern.
 *
 * Two rules, enforced here rather than in the UI so the CLI gets them too:
 *
 *   - **A named column must exist on the file.** An unknown name throws rather
 *     than being skipped: silently writing the other columns would be a
 *     half-applied edit the caller never sees.
 *   - **Every value is written as text.** That is what the file holds, and
 *     coercing an edit to an inferred type would let the tool change a value
 *     the reader typed.
 */
export async function editCsvRows(
  input: EditCsvRowsInput,
  deps: CsvFileBrowserDeps,
): Promise<EditCsvRowsResult> {
  const parsed = editCsvRowsSchema.parse(input);
  const { record, sidecarPath } = await resolveFile(parsed.fileId, deps);

  // `Object.keys` rather than the `in` operator: the change set arrives as
  // parsed JSON from a server action or a CLI flag, and `in` would also answer
  // true for inherited keys, letting a column nobody declared reach the write.
  const changedColumns = Object.keys(parsed.changes);
  const known = new Set(record.columnNames);
  const unknown = changedColumns.filter((name) => !known.has(name));
  if (unknown.length > 0) {
    throw new Error(`Unknown column(s) for this file: ${unknown.join(", ")}.`);
  }

  // Written in the file's column order, so the generated SQL is stable
  // regardless of the order the caller happened to build the object in.
  const changed = new Set(changedColumns);
  const fields = record.columnNames.filter((name) => changed.has(name));

  // Duplicates in the selection would inflate the reported count without
  // writing anything extra, so they are collapsed before the write runs.
  const uniqueRowIds = [...new Set(parsed.rowIds)];
  const updatedCount = deps.tableStore.update(
    sidecarPath,
    record.columnNames,
    uniqueRowIds,
    parsed.changes,
  );

  return { fileId: parsed.fileId, updatedCount, fields };
}

/**
 * Deletes rows from an uploaded file.
 *
 * This writes to the sidecar, which is the point of the screen — the uploaded
 * copy is a workspace, not the household's data. It can never reach
 * `myhomebase.db`: the path comes from the file store, keyed by the row's
 * generated sidecar name.
 *
 * The recorded row count is corrected afterwards so the picker doesn't go on
 * advertising rows that are gone.
 */
export async function deleteCsvRows(
  input: DeleteCsvRowsInput,
  deps: CsvFileBrowserDeps,
): Promise<DeleteCsvRowsResult> {
  const parsed = deleteCsvRowsSchema.parse(input);
  const { sidecarPath } = await resolveFile(parsed.fileId, deps);

  const uniqueRowIds = [...new Set(parsed.rowIds)];
  const deletedCount = deps.tableStore.deleteRows(sidecarPath, uniqueRowIds);

  // Counted rather than subtracted: the sidecar is the authority on what it
  // holds, and "one fewer per id" is only right if every id matched a row.
  const remainingRows = deps.tableStore.countRows(sidecarPath);
  deps.repo.updateRowCount(parsed.fileId, remainingRows);

  return { fileId: parsed.fileId, deletedCount, remainingRows };
}

/**
 * The file's current contents as delimited text, for the export route.
 *
 * Generated from the sidecar, not from the stored original: the sidecar is
 * where the edits are, and the original is deliberately never rewritten. The
 * original's delimiter is reused so a tab-separated file exports as one.
 *
 * A generator rather than a string, so the route can stream a large file out
 * without building the whole thing in memory first — the same reason the
 * upload streams in.
 */
export async function* exportCsvFileText(
  fileId: number,
  deps: CsvFileBrowserDeps,
): AsyncGenerator<string> {
  const { record, sidecarPath } = await resolveFile(fileId, deps);

  // The header row is written back whether or not the upload had one: without
  // it an exported file could not be re-imported with its column names, and
  // the names are what every edit was addressed by.
  yield `${toDelimitedLine(record.columnNames, record.delimiter)}\r\n`;

  for (const row of deps.tableStore.readAll(sidecarPath, record.columnNames)) {
    yield `${toDelimitedLine(row, record.delimiter)}\r\n`;
  }
}

/**
 * Forgets an uploaded file and removes both of its files from disk.
 *
 * The row goes first, the opposite of import: if an unlink fails, a stranded
 * file in a workspace folder is harmless, whereas a row pointing at a deleted
 * file would be a picker entry that errors on every click.
 */
export async function deleteUploadedCsvFile(
  fileId: number,
  deps: CsvFileBrowserDeps,
): Promise<boolean> {
  const record = deps.repo.getById(fileId);
  if (!record) return false;

  deps.repo.delete(fileId);
  await deps.fileStore.remove(record.storedFileName);
  await deps.fileStore.remove(record.tableFileName);
  return true;
}

/**
 * The record and its sidecar path, checked to still exist.
 *
 * The sidecar is what is checked, not the original text: every read and write
 * after import goes to the sidecar, so that is the file whose absence actually
 * breaks the screen. An upload root is a workspace and can legitimately be
 * cleared, and "upload it again" is something the reader can act on, unlike
 * the driver's own error.
 */
async function resolveFile(
  fileId: number,
  deps: CsvFileBrowserDeps,
): Promise<{ record: UploadedCsvFile; sidecarPath: string }> {
  const record = deps.repo.getById(fileId);
  if (!record) throw new Error("That uploaded file is no longer listed.");

  if (!(await deps.fileStore.exists(record.tableFileName))) {
    throw new Error(
      `The data for "${record.originalFileName}" is no longer on disk. Upload it again.`,
    );
  }

  return { record, sidecarPath: deps.fileStore.pathFor(record.tableFileName) };
}
