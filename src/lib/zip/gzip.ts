// A single-entry ZIP writer that actually compresses, for server-side archives.
//
// Why this exists alongside `buildZip`: that writer is STORED (method 0) and is
// right for what it does -- handing a browser a bundle of already-compressed JPEGs,
// where deflate buys nothing. A SQLite database is the opposite case. It is highly
// compressible (long runs of zeroes in free pages, repeated column values), and the
// archive is written to a NAS where space is the point of keeping several.
//
// `buildZip` is deliberately untouched: it is pure, has no `node:*` import, and
// feeds two browser-download routes. Adding deflate to it would pull `node:zlib`
// into a module whose own doc promises it has none. Its header comment says the
// moment compression matters is the moment to add deflate -- this is that moment,
// in a separate file with a separate call site.
//
// The output is a real ZIP with one deflated entry, not a bare `.gz` renamed:
// double-clicking it on Windows or a Mac opens it, which a `.gz` does not.

import { deflateRaw } from "node:zlib";
import { promisify } from "node:util";
import { crc32 } from "./zip";

const deflateRawAsync = promisify(deflateRaw);

const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;

/** Version 2.0 and method 8 (deflate) -- the universally-read combination. */
const VERSION_NEEDED = 20;
const METHOD_DEFLATE = 8;

/** Bit 11: the entry name is UTF-8. Same reasoning as `zip.ts`. */
const UTF8_NAME_FLAG = 0x0800;

/**
 * Builds a ZIP holding one deflated file.
 *
 * Takes and returns whole buffers rather than streaming. That is a deliberate
 * limit, and the reason the caller snapshots to a staging file first: the
 * compressed result is what gets held, and a database compresses far enough that
 * the peak is dominated by the input, not the archive. If a database ever grows
 * past what this machine can hold twice over, this is the function to replace with
 * a streaming pipeline -- and the staging file it reads from is already the right
 * shape for that.
 *
 * Timestamps are written as a fixed 1980-01-01, matching `buildZip`: the archive's
 * own name carries the real moment, so stamping the entry too would be a second,
 * redundant clock to keep honest.
 */
export async function buildGzippedZip(entryName: string, data: Uint8Array): Promise<Uint8Array> {
  if (entryName.trim() === "") throw new Error("A zip entry needs a name.");

  const nameBytes = new TextEncoder().encode(entryName);
  const compressed = new Uint8Array(await deflateRawAsync(data));
  const checksum = crc32(data);

  const localHeaderSize = 30 + nameBytes.length;
  const centralSize = 46 + nameBytes.length;
  const total = localHeaderSize + compressed.length + centralSize + 22;

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let offset = 0;

  const u16 = (value: number) => {
    view.setUint16(offset, value, true);
    offset += 2;
  };
  const u32 = (value: number) => {
    view.setUint32(offset, value >>> 0, true);
    offset += 4;
  };
  const bytes = (value: Uint8Array) => {
    out.set(value, offset);
    offset += value.length;
  };

  // --- Local file header
  u32(LOCAL_FILE_HEADER);
  u16(VERSION_NEEDED);
  u16(UTF8_NAME_FLAG);
  u16(METHOD_DEFLATE);
  u16(0); // modification time -- 1980-01-01
  u16(0x0021); // modification date -- 1980-01-01
  u32(checksum);
  u32(compressed.length);
  u32(data.length);
  u16(nameBytes.length);
  u16(0); // no extra field
  bytes(nameBytes);
  bytes(compressed);

  // --- Central directory
  const centralStart = offset;
  u32(CENTRAL_DIRECTORY_HEADER);
  u16(VERSION_NEEDED); // version made by
  u16(VERSION_NEEDED); // version needed
  u16(UTF8_NAME_FLAG);
  u16(METHOD_DEFLATE);
  u16(0);
  u16(0x0021);
  u32(checksum);
  u32(compressed.length);
  u32(data.length);
  u16(nameBytes.length);
  u16(0); // extra field length
  u16(0); // comment length
  u16(0); // disk number
  u16(0); // internal attributes
  u32(0); // external attributes
  u32(0); // offset of the local header
  bytes(nameBytes);

  // --- End of central directory
  u32(END_OF_CENTRAL_DIRECTORY);
  u16(0); // this disk
  u16(0); // disk with the central directory
  u16(1); // entries on this disk
  u16(1); // entries total
  u32(centralSize);
  u32(centralStart);
  u16(0); // no comment

  return out;
}
