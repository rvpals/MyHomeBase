// Reads the capture date out of a JPEG's EXIF block.
//
// A hand-written parser rather than a dependency, for two reasons. It only has to
// answer one question -- "what day was this taken?" -- and it has to answer it from a
// PARTIAL read: the journal card scans a month folder of several hundred photos over
// SMB, and pulling whole multi-megabyte files to read a timestamp near the front of
// each one would make the feature unusable. So the caller streams the first few KB and
// hands the bytes here.
//
// Pure: bytes in, date out. No filesystem, which is what lets the awkward cases
// (Motorola byte order, a truncated buffer, a JPEG with no EXIF at all) be tested
// directly from fixtures instead of from real files.
//
// Structure being walked, for anyone maintaining this:
//
//   FFD8                      start of image
//   FFE1 <len> "Exif\0\0"     the APP1 marker holding EXIF
//     II*\0 / MM\0*           TIFF header -- byte order + magic
//     <offset to IFD0>
//     IFD0: <count> entries, each 12 bytes: tag, type, count, value/offset
//       tag 0x8769 -> offset of the Exif sub-IFD
//         tag 0x9003 DateTimeOriginal  "YYYY:MM:DD HH:MM:SS"
//         tag 0x9004 DateTimeDigitized
//       tag 0x0132 DateTime (modification -- last resort)

/** JPEG markers that carry no payload length and so are skipped by 2 bytes. */
const STANDALONE_MARKERS = new Set([0xd8, 0xd9, 0x01]);

const TAG_EXIF_SUB_IFD = 0x8769;
const TAG_DATE_TIME_ORIGINAL = 0x9003;
const TAG_DATE_TIME_DIGITIZED = 0x9004;
const TAG_DATE_TIME = 0x0132;

/**
 * How many bytes of a file are worth handing to `readExifDate`.
 *
 * EXIF sits in the first APP1 segment, immediately after the 2-byte SOI, and a
 * segment's length field is 16 bits -- so the whole block cannot exceed ~64KB and in
 * practice runs 4-30KB once a thumbnail is included. 128KB covers a file that puts
 * another APP segment (JFIF, ICC profile) in front of EXIF and still reads a fraction
 * of a 6MB photo.
 */
export const EXIF_HEADER_BYTES = 128 * 1024;

/**
 * The capture date as `YYYY-MM-DD`, or `undefined` when the bytes carry none.
 *
 * `undefined` covers every failure the same way -- not a JPEG, no EXIF segment, no
 * date tag, a buffer that stopped mid-structure, a corrupt offset. The caller's next
 * move is the same in all of those cases (fall back to the file name), and a photo
 * with unreadable metadata must never fail the folder scan it appears in.
 *
 * Tag preference is DateTimeOriginal -> DateTimeDigitized -> DateTime: the first is
 * when the shutter fired, which is the question being asked. `DateTime` is only the
 * last-known modification and can have been rewritten by an editing tool, so it is a
 * last resort rather than an equal.
 */
export function readExifDate(bytes: Uint8Array): string | undefined {
  const exifStart = findExifSegment(bytes);
  if (exifStart === undefined) return undefined;

  const tiff = readTiffHeader(bytes, exifStart);
  if (tiff === undefined) return undefined;

  const { isLittleEndian, tiffStart, ifdOffset } = tiff;

  const ifd0 = readIfd(bytes, tiffStart, ifdOffset, isLittleEndian);
  if (ifd0 === undefined) return undefined;

  // The capture tags live in the Exif sub-IFD, which IFD0 only points at.
  const subIfdOffset = ifd0.get(TAG_EXIF_SUB_IFD)?.longValue;
  const subIfd =
    subIfdOffset === undefined
      ? undefined
      : readIfd(bytes, tiffStart, subIfdOffset, isLittleEndian);

  const candidates = [
    subIfd?.get(TAG_DATE_TIME_ORIGINAL),
    subIfd?.get(TAG_DATE_TIME_DIGITIZED),
    ifd0.get(TAG_DATE_TIME),
  ];

  for (const candidate of candidates) {
    if (candidate === undefined) continue;
    const raw = readAsciiValue(bytes, tiffStart, candidate, isLittleEndian);
    const date = parseExifDate(raw);
    if (date !== undefined) return date;
  }

  return undefined;
}

/**
 * Turns an EXIF timestamp into `YYYY-MM-DD`.
 *
 * The spec's format is `YYYY:MM:DD HH:MM:SS`, but real files also contain the dashed
 * form and a trailing NUL, so both are accepted. A blank or zeroed timestamp
 * (`0000:00:00 00:00:00`) means "unset" and is rejected rather than returned as a
 * date -- cameras and editing tools both write it.
 *
 * Exported for its own tests: this is where a malformed value has to be caught.
 */
export function parseExifDate(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;

  const match = raw.trim().match(/^(\d{4})[:-](\d{2})[:-](\d{2})/);
  if (!match) return undefined;

  const [, year, month, day] = match;
  if (year === "0000" || month === "00" || day === "00") return undefined;

  const candidate = `${year}-${month}-${day}`;
  const parsed = new Date(`${candidate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return undefined;
  // Round-tripping rejects 2019-02-30, which a range check on the parts would accept.
  if (parsed.toISOString().slice(0, 10) !== candidate) return undefined;

  return candidate;
}

/**
 * The offset just past the `Exif\0\0` identifier of the first APP1 segment, or
 * `undefined` when the bytes hold no such segment.
 *
 * Walks the marker chain rather than searching for the string: a JPEG's compressed
 * image data can contain the bytes `Exif\0\0` by coincidence, and a naive search would
 * then parse pixel data as a TIFF header. Stops at SOS (`FFDA`), after which
 * everything is entropy-coded image data and no metadata segment can follow.
 */
function findExifSegment(bytes: Uint8Array): number | undefined {
  if (bytes.length < 4) return undefined;
  // Start of Image. Anything else is not a JPEG.
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;

  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      // Fill bytes are legal padding between segments; anything else means the
      // structure is not one this parser can follow.
      offset += 1;
      continue;
    }

    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (STANDALONE_MARKERS.has(marker)) {
      offset += 2;
      continue;
    }
    // Start of Scan: image data from here on.
    if (marker === 0xda) return undefined;

    const segmentLength = (bytes[offset + 2] << 8) | bytes[offset + 3];
    // A length below 2 cannot include its own length field -- the chain is broken.
    if (segmentLength < 2) return undefined;

    if (marker === 0xe1) {
      const identifier = offset + 4;
      if (identifier + 6 <= bytes.length && isExifIdentifier(bytes, identifier)) {
        return identifier + 6;
      }
    }

    offset += 2 + segmentLength;
  }

  return undefined;
}

/** Whether the six bytes at `offset` are the ASCII `Exif` followed by two NULs. */
function isExifIdentifier(bytes: Uint8Array, offset: number): boolean {
  return (
    bytes[offset] === 0x45 &&
    bytes[offset + 1] === 0x78 &&
    bytes[offset + 2] === 0x69 &&
    bytes[offset + 3] === 0x66 &&
    bytes[offset + 4] === 0x00 &&
    bytes[offset + 5] === 0x00
  );
}

interface TiffHeader {
  isLittleEndian: boolean;
  /** Every offset inside EXIF is relative to here, not to the file. */
  tiffStart: number;
  ifdOffset: number;
}

/**
 * The TIFF header that opens an EXIF block: byte order, magic number, and the offset
 * of IFD0.
 *
 * Both byte orders are real and both must work -- `II` (Intel, little-endian) is what
 * most cameras and phones write, `MM` (Motorola, big-endian) is what Canon and some
 * scanners write. Getting this wrong does not fail loudly; it silently reads every
 * subsequent number byte-swapped.
 */
function readTiffHeader(bytes: Uint8Array, tiffStart: number): TiffHeader | undefined {
  if (tiffStart + 8 > bytes.length) return undefined;

  const byteOrder = (bytes[tiffStart] << 8) | bytes[tiffStart + 1];
  let isLittleEndian: boolean;
  if (byteOrder === 0x4949) isLittleEndian = true;
  else if (byteOrder === 0x4d4d) isLittleEndian = false;
  else return undefined;

  // 42, the TIFF magic. A mismatch means this is not an EXIF TIFF block.
  if (readUint16(bytes, tiffStart + 2, isLittleEndian) !== 42) return undefined;

  const ifdOffset = readUint32(bytes, tiffStart + 4, isLittleEndian);
  if (ifdOffset === undefined || ifdOffset < 8) return undefined;

  return { isLittleEndian, tiffStart, ifdOffset };
}

interface IfdEntry {
  type: number;
  count: number;
  /** Where the entry's 4 value bytes sit, for reading an inline or offset value. */
  valueOffset: number;
  /** The entry read as a single unsigned long -- how a sub-IFD pointer is stored. */
  longValue?: number;
}

/**
 * One IFD's entries, keyed by tag.
 *
 * Bounded deliberately: `entryCount` comes from the file, and a corrupt or hostile
 * value would otherwise drive a loop past the end of the buffer. Anything that does
 * not fit in the bytes provided ends the read and returns what was gathered, because
 * a partial header is the normal case here -- the caller only streamed the first
 * 128KB.
 */
function readIfd(
  bytes: Uint8Array,
  tiffStart: number,
  ifdOffset: number,
  isLittleEndian: boolean,
): Map<number, IfdEntry> | undefined {
  const base = tiffStart + ifdOffset;
  if (base + 2 > bytes.length) return undefined;

  const entryCount = readUint16(bytes, base, isLittleEndian);
  if (entryCount === undefined) return undefined;

  const entries = new Map<number, IfdEntry>();
  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = base + 2 + index * 12;
    if (entryOffset + 12 > bytes.length) break;

    const tag = readUint16(bytes, entryOffset, isLittleEndian);
    const type = readUint16(bytes, entryOffset + 2, isLittleEndian);
    const count = readUint32(bytes, entryOffset + 4, isLittleEndian);
    if (tag === undefined || type === undefined || count === undefined) break;

    entries.set(tag, {
      type,
      count,
      valueOffset: entryOffset + 8,
      longValue: readUint32(bytes, entryOffset + 8, isLittleEndian),
    });
  }

  return entries;
}

/**
 * An ASCII entry's string value.
 *
 * A value of 4 bytes or fewer is stored inline in the entry itself; anything longer
 * (a 20-byte timestamp always is) is stored elsewhere and the entry holds an offset.
 * Both cases are handled, since a hand-edited or unusual file can present either.
 */
function readAsciiValue(
  bytes: Uint8Array,
  tiffStart: number,
  entry: IfdEntry,
  isLittleEndian: boolean,
): string | undefined {
  // Type 2 is ASCII. Anything else is not a timestamp string.
  if (entry.type !== 2) return undefined;
  if (entry.count === 0 || entry.count > 64) return undefined;

  let start: number;
  if (entry.count <= 4) {
    start = entry.valueOffset;
  } else {
    const offset = readUint32(bytes, entry.valueOffset, isLittleEndian);
    if (offset === undefined) return undefined;
    start = tiffStart + offset;
  }

  const end = start + entry.count;
  if (start < 0 || end > bytes.length) return undefined;

  let text = "";
  for (let index = start; index < end; index += 1) {
    const byte = bytes[index];
    // The count includes the terminating NUL; stop rather than embedding it.
    if (byte === 0) break;
    text += String.fromCharCode(byte);
  }

  return text;
}

function readUint16(bytes: Uint8Array, offset: number, isLittleEndian: boolean): number | undefined {
  if (offset + 2 > bytes.length) return undefined;
  return isLittleEndian
    ? bytes[offset] | (bytes[offset + 1] << 8)
    : (bytes[offset] << 8) | bytes[offset + 1];
}

/** Unsigned, via `>>> 0` -- a high bit set would otherwise read as a negative offset. */
function readUint32(bytes: Uint8Array, offset: number, isLittleEndian: boolean): number | undefined {
  if (offset + 4 > bytes.length) return undefined;
  const value = isLittleEndian
    ? bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)
    : (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
  return value >>> 0;
}
