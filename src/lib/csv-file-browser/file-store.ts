import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { CsvUploadTooLargeError } from "./errors";
import type { CsvFileStore } from "./ports";

/**
 * The uploaded text files and their SQLite sidecars, in a workspace folder
 * configured in wiring.ts.
 *
 * Scratch space, not archival storage: the files here are copies a reader
 * brought in to work on. Wiping the folder is a supported thing to do —
 * `exists` is checked before every open, and a missing file reports "upload it
 * again" rather than throwing the driver's error.
 *
 * Both files of a pair live here under generated names. They are not linked by
 * naming convention — the row holds both names — so a rename or a collision
 * cannot silently pair one upload's text with another's rows.
 */
export class NodeCsvFileStore implements CsvFileStore {
  constructor(private readonly uploadRoot: string) {}

  /**
   * Streams an upload to disk, enforcing the cap as it goes.
   *
   * The counter is checked per chunk rather than trusting Content-Length,
   * which is a claim the sender makes and can lie about. Passing the cap
   * aborts the write and removes the partial file, so an oversized upload
   * costs the disk `maxBytes` and a moment, not the sender's whole file.
   */
  async saveStream(
    stream: ReadableStream<Uint8Array>,
    originalFileName: string,
    maxBytes: number,
  ): Promise<{ storedFileName: string; byteSize: number }> {
    await mkdir(this.uploadRoot, { recursive: true });

    const storedFileName = `${randomUUID()}${safeExtension(originalFileName)}`;
    const destination = path.join(this.uploadRoot, storedFileName);

    let byteSize = 0;
    try {
      // `Readable.fromWeb` + `pipeline` gives backpressure for free: the
      // source is only pulled as fast as the disk accepts it.
      await pipeline(
        Readable.fromWeb(stream as Parameters<typeof Readable.fromWeb>[0]),
        async function* (source: AsyncIterable<Buffer>) {
          for await (const chunk of source) {
            byteSize += chunk.byteLength;
            if (byteSize > maxBytes) throw new CsvUploadTooLargeError(maxBytes);
            yield chunk;
          }
        },
        createWriteStream(destination),
      );
    } catch (error) {
      // Includes a client that hung up mid-upload, which would otherwise leave
      // a truncated file that parses into half a table.
      await rm(destination, { force: true });
      throw error;
    }

    if (byteSize === 0) {
      await rm(destination, { force: true });
      throw new Error("That file is empty.");
    }

    return { storedFileName, byteSize };
  }

  /**
   * Writes text under a generated name.
   *
   * The stored name is a UUID plus the original *extension* — never the
   * reader's own filename. Two people uploading `data.csv` must not collide,
   * and a name off a file dialog can carry `..` or a path separator, so it is
   * kept for display only and never used to build a path.
   */
  async saveText(text: string, originalFileName: string): Promise<string> {
    await mkdir(this.uploadRoot, { recursive: true });

    const storedFileName = `${randomUUID()}${safeExtension(originalFileName)}`;
    await writeFile(path.join(this.uploadRoot, storedFileName), text, "utf8");

    return storedFileName;
  }

  /**
   * The whole file as text.
   *
   * Read whole rather than streamed, and that is the one place this module
   * pays the file's size in memory. It is bounded by the upload cap and
   * happens exactly once per upload, at import: parsing delimited text needs
   * to see quoted fields that can span lines, so a chunk boundary is not a
   * safe place to stop. Every read *after* import goes to the sidecar, which
   * is windowed.
   */
  async readText(storedFileName: string): Promise<string> {
    return readFile(this.pathFor(storedFileName), "utf8");
  }

  pathFor(storedFileName: string): string {
    // The stored name is generated here, but this is also reached with a name
    // read back out of the database, so it is re-checked rather than trusted:
    // `path.basename` strips any directory part a corrupted row could be
    // carrying, keeping every read inside the upload root.
    return path.join(this.uploadRoot, path.basename(storedFileName));
  }

  async exists(storedFileName: string): Promise<boolean> {
    try {
      const stats = await stat(this.pathFor(storedFileName));
      return stats.isFile();
    } catch {
      return false;
    }
  }

  async remove(storedFileName: string): Promise<void> {
    // `force` so removing an upload whose file a cleanup already took is a
    // no-op rather than an error — the caller's intent is "make it gone".
    await rm(this.pathFor(storedFileName), { force: true });
  }

  /**
   * A generated name for a file's sidecar.
   *
   * `.sqlite`, not the upload's own extension: the workspace holds both files
   * of every pair, and an operator looking in the folder should be able to see
   * which is the text they uploaded and which is the database built from it.
   * The original name is ignored beyond that — the pairing is the row's job.
   */
  tableNameFor(_originalFileName: string): string {
    return `${randomUUID()}.sqlite`;
  }
}

/**
 * The original name's extension, if it is one we recognise.
 *
 * Anything else yields `.csv`, so a stored name can never end in something the
 * OS treats specially. The schema has already restricted uploads to these.
 */
function safeExtension(originalFileName: string): string {
  const match = /\.(csv|txt|tsv|tab|psv)$/i.exec(originalFileName);
  return match ? `.${match[1].toLowerCase()}` : ".csv";
}
