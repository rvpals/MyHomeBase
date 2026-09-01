// A minimal ZIP writer: enough of the format to hand a browser several files as one
// download, and nothing more.
//
// Hand-written rather than pulled from `archiver` or `jszip`, for two reasons. The
// first is that this app is deployed by copying a folder to a NAS, so every dependency
// is weight in a place where updating one is a manual errand. The second is that the
// only thing being zipped here is photographs — JPEGs and PNGs, already compressed —
// so the compression a library would bring buys nothing. Entries are STORED (method 0):
// the archive is the sum of its files plus a few hundred bytes of bookkeeping, and
// building it is a memcpy rather than a deflate pass over hundreds of megabytes.
//
// What this deliberately does NOT support, so nobody reaches for it expecting more:
// - No compression. A folder of text files zipped with this is the same size as the
//   folder. If that ever matters, that is the moment to add deflate, not before.
// - No Zip64. Archives are capped below 4 GB (see `MAX_ARCHIVE_BYTES`) and rejected
//   above it, rather than silently writing a header that says the wrong length.
// - No directory entries, no permissions, no comments. A flat list of named files.
//
// Pure: takes bytes, returns bytes. No `node:fs`, no streams, no `next` — reading the
// files is the caller's job, which is what lets this be tested with string literals.

/** The ZIP spec's four-byte signatures, in the order a reader meets them. */
const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;

/**
 * Version 2.0, "no compression", MS-DOS.
 *
 * 20 rather than the 10 that store-only strictly requires: every extractor in
 * circulation reads 2.0, and claiming 1.0 makes some of them treat the archive as
 * ancient and second-guess the encoding of the names.
 */
const VERSION_NEEDED = 20;

/**
 * Bit 11 of the general-purpose flags: the file names are UTF-8.
 *
 * Not optional here. These names come from a photo archive full of folders like
 * `2019-06-09 Von Thun Farm Strawberry Festival`, and without this bit an extractor is
 * entitled to read them as IBM Code Page 437 — which turns any accented character in a
 * place name into mojibake in the extracted folder.
 */
const UTF8_NAME_FLAG = 0x0800;

/**
 * The ceiling on one archive, in bytes.
 *
 * The real limit is the format's: the 32-bit offsets in the central directory cannot
 * describe an archive at or past 4 GiB, and writing one anyway would produce a file
 * that looks fine until an extractor follows an offset that wrapped. 3.5 GiB leaves
 * room for the bookkeeping and lands well clear of it.
 *
 * Callers are expected to have their own, much smaller, limit — a download is also
 * held whole in memory at both ends. This one is the floor under a bug, not the policy.
 */
export const MAX_ARCHIVE_BYTES = 3.5 * 1024 * 1024 * 1024;

/** One file going into the archive. */
export interface ZipEntry {
  /**
   * The name it will extract to. Forward slashes make a folder; `zip/` rejects
   * anything that would escape the archive root.
   */
  name: string;
  data: Uint8Array;
}

/**
 * The CRC-32 lookup table, built once on first use.
 *
 * ZIP stores a CRC-32 per entry and extractors check it, so this is not optional
 * bookkeeping — an archive with wrong checksums reports every file as corrupt. Built
 * lazily rather than at module load: 256 iterations is nothing, but a module that does
 * work merely by being imported is a module that shows up in a cold-start profile for
 * no reason.
 */
let crcTable: Uint32Array | undefined;

function getCrcTable(): Uint32Array {
  if (crcTable !== undefined) return crcTable;

  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      // 0xedb88320 is the reversed CRC-32 polynomial — the one ZIP, PNG and gzip all
      // use. `>>> 1` and not `>> 1`: this is unsigned arithmetic, and a sign-propagating
      // shift here corrupts every value above 0x7fffffff.
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value;
  }

  crcTable = table;
  return table;
}

/**
 * The CRC-32 of some bytes, as an unsigned 32-bit number.
 *
 * Exported because the tests check it against the published values for known inputs
 * (`"" -> 0`, `"123456789" -> 0xcbf43926`), which is the cheapest way to know the table
 * above was built correctly. Nothing outside this module should need it otherwise.
 */
export function crc32(data: Uint8Array): number {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (let index = 0; index < data.length; index += 1) {
    crc = table[(crc ^ data[index]) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Rejects a name that would extract outside the archive's own folder.
 *
 * The caller here builds names from a photo archive's paths, which are already
 * validated — but this module takes arbitrary strings and its whole output is a file
 * someone will double-click, so a traversal is checked where the archive is written
 * rather than trusted to have been checked upstream. Same belt-and-braces argument the
 * photo route makes about its path.
 */
function assertSafeName(name: string): void {
  if (name === "") throw new Error("A zip entry needs a name.");
  // A leading slash or a drive letter makes an absolute path; some extractors honour
  // one, which is how a zip writes outside the folder you opened it in.
  if (name.startsWith("/") || /^[a-zA-Z]:/.test(name)) {
    throw new Error(`A zip entry name must be relative: ${name}`);
  }
  if (name.includes("\\")) {
    throw new Error(`A zip entry name must use forward slashes: ${name}`);
  }
  if (name.split("/").includes("..")) {
    throw new Error(`A zip entry name must not traverse upwards: ${name}`);
  }
  // The format stores this length in 16 bits, and no useful name is anywhere near it.
  if (name.length > 0xffff) {
    throw new Error("A zip entry name is too long.");
  }
}

/**
 * A little-endian writer over one buffer.
 *
 * The whole archive is sized up front and written into a single allocation, rather than
 * pushing chunks onto an array and concatenating: the size is exactly computable from
 * the entries (that is the point of storing rather than compressing), and the one-pass
 * write is what keeps a 500 MB download from briefly costing a gigabyte.
 */
class ByteWriter {
  private readonly bytes: Uint8Array;
  private readonly view: DataView;
  private position = 0;

  constructor(size: number) {
    this.bytes = new Uint8Array(size);
    this.view = new DataView(this.bytes.buffer);
  }

  /** How many bytes are written so far — the ZIP's own notion of an offset. */
  get offset(): number {
    return this.position;
  }

  u16(value: number): void {
    this.view.setUint16(this.position, value, true);
    this.position += 2;
  }

  u32(value: number): void {
    this.view.setUint32(this.position, value, true);
    this.position += 4;
  }

  raw(data: Uint8Array): void {
    this.bytes.set(data, this.position);
    this.position += data.length;
  }

  /**
   * The finished buffer.
   *
   * Throws rather than trimming if the write didn't fill the allocation exactly: a
   * mismatch means the size arithmetic and the writing disagree, which produces an
   * archive with a valid-looking directory pointing at the wrong bytes. Better to fail
   * where the bug is than to hand out a file that opens empty.
   */
  finish(): Uint8Array {
    if (this.position !== this.bytes.length) {
      throw new Error(
        `Zip writer wrote ${this.position} of ${this.bytes.length} bytes — this is a bug.`,
      );
    }
    return this.bytes;
  }
}

/** What the writer needs to remember about an entry between the two passes. */
interface PreparedEntry {
  name: Uint8Array;
  data: Uint8Array;
  crc: number;
  /** Where this entry's local header starts, for the central directory to point at. */
  offset: number;
}

/** Sizes, in bytes, of the fixed parts of each record. */
const LOCAL_HEADER_BYTES = 30;
const CENTRAL_ENTRY_BYTES = 46;
const EOCD_BYTES = 22;

/**
 * Builds a ZIP archive from a flat list of named files.
 *
 * Two passes over the entries: the first writes a local header and the bytes for each
 * file, the second writes the central directory that indexes them. That is the format's
 * own shape, not a choice — an extractor reads the directory at the end and seeks
 * backwards, which is why a zip can be opened without reading all of it.
 *
 * Throws on a duplicate name, an unsafe name, an empty list, or an archive that would
 * exceed `MAX_ARCHIVE_BYTES`. Every one of those is a caller bug or an ask that cannot
 * be honoured, and a silently-truncated archive is worse than a failed download.
 *
 * Timestamps are written as a fixed 1980-01-01 rather than "now". The archive is
 * assembled on demand from files whose real modification times the caller hasn't read,
 * so stamping every entry with the moment of the download would be inventing metadata;
 * 1980 is the DOS epoch and reads as "unknown" rather than as a plausible lie.
 */
export function buildZip(entries: ZipEntry[]): Uint8Array {
  if (entries.length === 0) throw new Error("A zip needs at least one file.");
  // The count lives in 16 bits in the end-of-central-directory record.
  if (entries.length > 0xffff) throw new Error("A zip can hold at most 65535 files.");

  const encoder = new TextEncoder();
  const seen = new Set<string>();
  const prepared: PreparedEntry[] = [];

  let totalSize = EOCD_BYTES;
  for (const entry of entries) {
    assertSafeName(entry.name);
    // Duplicates are rejected rather than de-duplicated: two entries with one name is
    // an archive whose extraction depends on the extractor, and the caller is better
    // placed to decide which name should change. `planFavPhotoDownload` does exactly
    // that before calling here.
    if (seen.has(entry.name)) throw new Error(`Duplicate zip entry name: ${entry.name}`);
    seen.add(entry.name);

    if (entry.data.length > 0xffffffff) {
      throw new Error(`A zip entry is too large to store: ${entry.name}`);
    }

    const name = encoder.encode(entry.name);
    // Each file costs a local header, its name and its bytes on the way out, plus a
    // central-directory record repeating the name at the end.
    totalSize +=
      LOCAL_HEADER_BYTES + name.length + entry.data.length + CENTRAL_ENTRY_BYTES + name.length;

    if (totalSize > MAX_ARCHIVE_BYTES) {
      throw new Error("The archive would be too large to build.");
    }

    prepared.push({ name, data: entry.data, crc: crc32(entry.data), offset: 0 });
  }

  const writer = new ByteWriter(totalSize);

  // Pass one: local header + bytes per file, remembering where each began.
  for (const entry of prepared) {
    entry.offset = writer.offset;
    writer.u32(LOCAL_FILE_HEADER);
    writer.u16(VERSION_NEEDED);
    writer.u16(UTF8_NAME_FLAG);
    writer.u16(0); // Compression method 0 — stored.
    writer.u16(0); // Modification time, DOS epoch.
    writer.u16(0); // Modification date, DOS epoch.
    writer.u32(entry.crc);
    // Compressed and uncompressed sizes are the same number, because nothing is
    // compressed. Written up front rather than deferred to a data descriptor, which is
    // only needed when the size isn't known before writing — here it always is.
    writer.u32(entry.data.length);
    writer.u32(entry.data.length);
    writer.u16(entry.name.length);
    writer.u16(0); // No extra field.
    writer.raw(entry.name);
    writer.raw(entry.data);
  }

  // Pass two: the index an extractor actually reads.
  const centralDirectoryOffset = writer.offset;
  for (const entry of prepared) {
    writer.u32(CENTRAL_DIRECTORY_HEADER);
    writer.u16(VERSION_NEEDED); // Version made by.
    writer.u16(VERSION_NEEDED); // Version needed to extract.
    writer.u16(UTF8_NAME_FLAG);
    writer.u16(0); // Stored.
    writer.u16(0); // Time.
    writer.u16(0); // Date.
    writer.u32(entry.crc);
    writer.u32(entry.data.length);
    writer.u32(entry.data.length);
    writer.u16(entry.name.length);
    writer.u16(0); // No extra field.
    writer.u16(0); // No comment.
    writer.u16(0); // Disk number — single-disk archive.
    writer.u16(0); // Internal attributes.
    writer.u32(0); // External attributes.
    writer.u32(entry.offset);
    writer.raw(entry.name);
  }
  const centralDirectorySize = writer.offset - centralDirectoryOffset;

  writer.u32(END_OF_CENTRAL_DIRECTORY);
  writer.u16(0); // This disk's number.
  writer.u16(0); // The disk the directory starts on.
  writer.u16(prepared.length); // Entries on this disk.
  writer.u16(prepared.length); // Entries in total.
  writer.u32(centralDirectorySize);
  writer.u32(centralDirectoryOffset);
  writer.u16(0); // No archive comment.

  return writer.finish();
}
