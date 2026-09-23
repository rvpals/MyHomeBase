// Reads EVERY tag out of a JPEG's EXIF block, for the viewer's EXIF panel.
//
// The sibling of `readExifDateTime` in `exif.ts`, asking a wider question off the same
// walk. That file owns the traversal (segment -> TIFF header -> IFD) and exports its
// helpers; this one adds a general VALUE reader, because the existing parser only ever
// needed ASCII strings and a tag table needs numbers and rationals too.
//
// Why not a dependency (exifr, piexifjs): the constraint here is the same one that
// produced the hand-written date parser -- a PARTIAL read over SMB. The callers hand in
// the first 128KB of a file and nothing may open the whole photograph. A library that
// takes a path or a Blob would undo that, and one that takes bytes would still duplicate
// the traversal this repo already owns and tests.
//
// Pure: bytes in, rows out. Never throws -- a corrupt or truncated header yields the
// tags that could be read, because a photo with odd metadata must still open.

import {
  findExifSegment,
  readIfd,
  readTiffHeader,
  readUint16,
  readUint32,
  TAG_EXIF_SUB_IFD,
  type IfdEntry,
} from "./exif";
import {
  describeExifTag,
  EXIF_POINTER_TAGS,
  formatExifValue,
  type ExifTag,
  type ExifTagSource,
  type ExifValue,
} from "./exif-tags";

/** The GPS sub-IFD pointer, held in IFD0 beside the Exif one. */
const TAG_GPS_SUB_IFD = 0x8825;

/**
 * Bytes per component for each EXIF value type, indexed by the type code.
 *
 * `0` marks a type this reader does not decode. Types 1-12 are the whole of the spec:
 * BYTE, ASCII, SHORT, LONG, RATIONAL, SBYTE, UNDEFINED, SSHORT, SLONG, SRATIONAL,
 * FLOAT, DOUBLE.
 */
const TYPE_SIZES: Record<number, number> = {
  1: 1, // BYTE
  2: 1, // ASCII
  3: 2, // SHORT
  4: 4, // LONG
  5: 8, // RATIONAL (two LONGs)
  6: 1, // SBYTE
  7: 1, // UNDEFINED
  8: 2, // SSHORT
  9: 4, // SLONG
  10: 8, // SRATIONAL (two SLONGs)
  11: 4, // FLOAT
  12: 8, // DOUBLE
};

/**
 * A cap on how many components of one tag are decoded.
 *
 * MakerNote and similar UNDEFINED blobs declare thousands of bytes; a maker's colour
 * table is not a panel row, and decoding it would spend the reader's time building a
 * string nobody reads. The tag still appears, with its length said plainly.
 */
const MAX_COMPONENTS = 16;

/** Everything one photograph's EXIF block holds. */
export interface ExifReadout {
  /** Every tag found, across IFD0, the Exif sub-IFD and the GPS sub-IFD. */
  tags: ExifTag[];
  /**
   * The coordinates as a decimal pair, when the GPS IFD held a usable fix.
   *
   * SEPARATE from the tags, and derived rather than displayed: the GPS tab shows the
   * stored values verbatim (Min's instruction), while the map needs two numbers. Both
   * come from the same rows, so they cannot disagree.
   */
  gps?: ExifGpsFix;
}

/** A decimal position, as a map wants it. */
export interface ExifGpsFix {
  latitude: number;
  longitude: number;
  /** Metres above sea level, when the photo recorded one. */
  altitude?: number;
}

/**
 * Every EXIF tag in the bytes provided, grouped and formatted for display.
 *
 * Returns an empty readout rather than `undefined` for a file with no EXIF: the panel's
 * "no metadata" state is the same for "not a JPEG", "stripped by an editor" and "the
 * buffer stopped early", and a reader can act on none of them.
 */
export function readAllExifTags(bytes: Uint8Array): ExifReadout {
  const exifStart = findExifSegment(bytes);
  if (exifStart === undefined) return { tags: [] };

  const tiff = readTiffHeader(bytes, exifStart);
  if (tiff === undefined) return { tags: [] };

  const { isLittleEndian, tiffStart, ifdOffset } = tiff;

  const ifd0 = readIfd(bytes, tiffStart, ifdOffset, isLittleEndian);
  if (ifd0 === undefined) return { tags: [] };

  const tags: ExifTag[] = [];
  collectIfd(bytes, tiffStart, isLittleEndian, ifd0, "ifd0", tags);

  const exifIfdOffset = ifd0.get(TAG_EXIF_SUB_IFD)?.longValue;
  if (exifIfdOffset !== undefined) {
    const exifIfd = readIfd(bytes, tiffStart, exifIfdOffset, isLittleEndian);
    if (exifIfd !== undefined) {
      collectIfd(bytes, tiffStart, isLittleEndian, exifIfd, "exif", tags);
    }
  }

  const gpsIfdOffset = ifd0.get(TAG_GPS_SUB_IFD)?.longValue;
  let gps: ExifGpsFix | undefined;
  if (gpsIfdOffset !== undefined) {
    const gpsIfd = readIfd(bytes, tiffStart, gpsIfdOffset, isLittleEndian);
    if (gpsIfd !== undefined) {
      collectIfd(bytes, tiffStart, isLittleEndian, gpsIfd, "gps", tags);
      gps = readGpsFix(bytes, tiffStart, isLittleEndian, gpsIfd);
    }
  }

  return gps === undefined ? { tags } : { tags, gps };
}

/** Reads one IFD's entries into display rows, skipping pointers. */
function collectIfd(
  bytes: Uint8Array,
  tiffStart: number,
  isLittleEndian: boolean,
  ifd: Map<number, IfdEntry>,
  source: ExifTagSource,
  into: ExifTag[],
): void {
  for (const [id, entry] of ifd) {
    if (EXIF_POINTER_TAGS.has(id)) continue;

    const value = readValue(bytes, tiffStart, entry, isLittleEndian);
    if (value === undefined) continue;

    const { name, group, format } = describeExifTag(id, source);
    into.push({
      id,
      name,
      value: formatExifValue(value, format),
      raw: rawText(value),
      group,
      source,
    });
  }
}

/** The value as the file held it, before any formatter made it readable. */
function rawText(value: ExifValue): string {
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

/**
 * One entry's decoded value, or `undefined` when it cannot be read.
 *
 * The inline-vs-offset rule is the awkward part of EXIF: an entry has 4 bytes for its
 * value, and anything longer lives elsewhere with those 4 bytes holding an offset. That
 * applies per TOTAL SIZE, not per component -- two SHORTs (4 bytes) are inline, three
 * (6 bytes) are not.
 */
function readValue(
  bytes: Uint8Array,
  tiffStart: number,
  entry: IfdEntry,
  isLittleEndian: boolean,
): ExifValue | undefined {
  const size = TYPE_SIZES[entry.type];
  if (size === undefined || entry.count === 0) return undefined;

  const totalBytes = size * entry.count;
  // A count from the file. A corrupt one would otherwise drive a huge loop below.
  if (!Number.isFinite(totalBytes) || totalBytes < 0) return undefined;

  let start: number;
  if (totalBytes <= 4) {
    start = entry.valueOffset;
  } else {
    const offset = readUint32(bytes, entry.valueOffset, isLittleEndian);
    if (offset === undefined) return undefined;
    start = tiffStart + offset;
  }
  if (start < 0 || start >= bytes.length) return undefined;

  // ASCII and UNDEFINED are both text-shaped in practice (UNDEFINED carries the
  // version strings and the user comment), so both decode as a string.
  if (entry.type === 2) return readAscii(bytes, start, entry.count);
  if (entry.type === 7) return readUndefined(bytes, start, entry.count);

  const components: number[] = [];
  const limit = Math.min(entry.count, MAX_COMPONENTS);
  for (let index = 0; index < limit; index += 1) {
    const at = start + index * size;
    const component = readNumeric(bytes, at, entry.type, isLittleEndian);
    if (component === undefined) break;
    components.push(component);
  }

  if (components.length === 0) return undefined;
  if (components.length === 1) return components[0];
  return components;
}

/** A NUL-terminated ASCII string, bounded by the buffer. */
function readAscii(bytes: Uint8Array, start: number, count: number): string | undefined {
  const end = Math.min(start + count, bytes.length);
  let text = "";
  for (let index = start; index < end; index += 1) {
    const byte = bytes[index];
    if (byte === 0) break;
    // Printable ASCII only. A stray control byte in a hand-edited field would
    // otherwise put an unrenderable character into the panel.
    text += byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : " ";
  }
  const trimmed = text.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/**
 * An UNDEFINED block.
 *
 * These carry two different things in practice: a version like `0230` (printable), and
 * a binary blob such as MakerNote. Printable content is shown; a blob is reported by
 * its size, which is the honest summary of bytes that have no display form.
 */
function readUndefined(bytes: Uint8Array, start: number, count: number): string | undefined {
  const end = Math.min(start + count, bytes.length);
  if (end <= start) return undefined;

  // The UserComment field opens with an 8-byte character-set marker; skip it so the
  // comment itself is what shows rather than "ASCII" followed by the text.
  let from = start;
  if (count > 8 && isAsciiMarker(bytes, start)) from = start + 8;

  let printable = "";
  let printableCount = 0;
  for (let index = from; index < end && printableCount < 64; index += 1) {
    const byte = bytes[index];
    if (byte === 0) continue;
    if (byte >= 0x20 && byte < 0x7f) {
      printable += String.fromCharCode(byte);
      printableCount += 1;
    } else {
      // Not text. Report the length instead of a mangled string.
      return `${end - start} bytes`;
    }
  }

  const trimmed = printable.trim();
  return trimmed.length === 0 ? `${end - start} bytes` : trimmed;
}

/** The `ASCII\0\0\0` character-set marker that opens a UserComment. */
function isAsciiMarker(bytes: Uint8Array, offset: number): boolean {
  return (
    bytes[offset] === 0x41 &&
    bytes[offset + 1] === 0x53 &&
    bytes[offset + 2] === 0x43 &&
    bytes[offset + 3] === 0x49 &&
    bytes[offset + 4] === 0x49
  );
}

/** One numeric component, by EXIF type code. */
function readNumeric(
  bytes: Uint8Array,
  offset: number,
  type: number,
  isLittleEndian: boolean,
): number | undefined {
  switch (type) {
    case 1: // BYTE
      return offset < bytes.length ? bytes[offset] : undefined;
    case 6: // SBYTE
      if (offset >= bytes.length) return undefined;
      return (bytes[offset] << 24) >> 24;
    case 3: // SHORT
      return readUint16(bytes, offset, isLittleEndian);
    case 8: {
      // SSHORT
      const unsigned = readUint16(bytes, offset, isLittleEndian);
      return unsigned === undefined ? undefined : (unsigned << 16) >> 16;
    }
    case 4: // LONG
      return readUint32(bytes, offset, isLittleEndian);
    case 9: {
      // SLONG
      const unsigned = readUint32(bytes, offset, isLittleEndian);
      return unsigned === undefined ? undefined : unsigned | 0;
    }
    case 5: // RATIONAL
      return readRational(bytes, offset, isLittleEndian, false);
    case 10: // SRATIONAL
      return readRational(bytes, offset, isLittleEndian, true);
    case 11: // FLOAT
      return readFloat(bytes, offset, isLittleEndian, 4);
    case 12: // DOUBLE
      return readFloat(bytes, offset, isLittleEndian, 8);
    default:
      return undefined;
  }
}

/**
 * A rational, as its quotient.
 *
 * A zero denominator is real in EXIF -- an unset aperture or a camera that writes
 * `0/0` -- and must not become `Infinity` or `NaN` in the panel.
 */
function readRational(
  bytes: Uint8Array,
  offset: number,
  isLittleEndian: boolean,
  isSigned: boolean,
): number | undefined {
  const rawNumerator = readUint32(bytes, offset, isLittleEndian);
  const rawDenominator = readUint32(bytes, offset + 4, isLittleEndian);
  if (rawNumerator === undefined || rawDenominator === undefined) return undefined;

  const numerator = isSigned ? rawNumerator | 0 : rawNumerator;
  const denominator = isSigned ? rawDenominator | 0 : rawDenominator;
  if (denominator === 0) return undefined;

  return numerator / denominator;
}

/** An IEEE float or double, read through a DataView so the bit layout is the platform's. */
function readFloat(
  bytes: Uint8Array,
  offset: number,
  isLittleEndian: boolean,
  width: 4 | 8,
): number | undefined {
  if (offset + width > bytes.length) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, width);
  const value = width === 4 ? view.getFloat32(0, isLittleEndian) : view.getFloat64(0, isLittleEndian);
  return Number.isFinite(value) ? value : undefined;
}

// ---------------------------------------------------------------------------
// GPS
// ---------------------------------------------------------------------------

const TAG_GPS_LATITUDE_REF = 0x0001;
const TAG_GPS_LATITUDE = 0x0002;
const TAG_GPS_LONGITUDE_REF = 0x0003;
const TAG_GPS_LONGITUDE = 0x0004;
const TAG_GPS_ALTITUDE_REF = 0x0005;
const TAG_GPS_ALTITUDE = 0x0006;

/**
 * The GPS IFD as a decimal position, or `undefined` when it holds no usable fix.
 *
 * A GPS IFD often exists with only a version tag in it -- a phone that had location off
 * still writes the block. That is not a position, and pinning a map at 0,0 off the coast
 * of Africa is the classic bug here, so both coordinates must be present and in range
 * before anything is returned.
 */
function readGpsFix(
  bytes: Uint8Array,
  tiffStart: number,
  isLittleEndian: boolean,
  gpsIfd: Map<number, IfdEntry>,
): ExifGpsFix | undefined {
  const latitude = readCoordinate(
    bytes,
    tiffStart,
    isLittleEndian,
    gpsIfd.get(TAG_GPS_LATITUDE),
    gpsIfd.get(TAG_GPS_LATITUDE_REF),
    "S",
  );
  const longitude = readCoordinate(
    bytes,
    tiffStart,
    isLittleEndian,
    gpsIfd.get(TAG_GPS_LONGITUDE),
    gpsIfd.get(TAG_GPS_LONGITUDE_REF),
    "W",
  );

  if (latitude === undefined || longitude === undefined) return undefined;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return undefined;

  const altitude = readAltitude(bytes, tiffStart, isLittleEndian, gpsIfd);
  return altitude === undefined ? { latitude, longitude } : { latitude, longitude, altitude };
}

/**
 * One coordinate, from the spec's three rationals (degrees, minutes, seconds).
 *
 * The reference letter carries the SIGN and is not optional: `40 20 0 N` and
 * `40 20 0 S` are opposite hemispheres, so a missing or unexpected ref is treated as
 * no fix rather than assumed north/east.
 */
function readCoordinate(
  bytes: Uint8Array,
  tiffStart: number,
  isLittleEndian: boolean,
  entry: IfdEntry | undefined,
  refEntry: IfdEntry | undefined,
  negativeRef: "S" | "W",
): number | undefined {
  if (entry === undefined || refEntry === undefined) return undefined;
  if (entry.type !== 5 || entry.count < 3) return undefined;

  // Three rationals are 24 bytes, so they are always stored at an offset.
  const offset = readUint32(bytes, entry.valueOffset, isLittleEndian);
  if (offset === undefined) return undefined;
  const start = tiffStart + offset;

  const degrees = readRational(bytes, start, isLittleEndian, false);
  const minutes = readRational(bytes, start + 8, isLittleEndian, false);
  const seconds = readRational(bytes, start + 16, isLittleEndian, false);
  if (degrees === undefined || minutes === undefined || seconds === undefined) return undefined;

  const ref = readAscii(bytes, refEntry.valueOffset, Math.min(refEntry.count, 2))?.toUpperCase();
  const positiveRef = negativeRef === "S" ? "N" : "E";
  if (ref !== negativeRef && ref !== positiveRef) return undefined;

  const magnitude = degrees + minutes / 60 + seconds / 3600;
  return ref === negativeRef ? -magnitude : magnitude;
}

/** Altitude in metres, negated when the reference says "below sea level". */
function readAltitude(
  bytes: Uint8Array,
  tiffStart: number,
  isLittleEndian: boolean,
  gpsIfd: Map<number, IfdEntry>,
): number | undefined {
  const entry = gpsIfd.get(TAG_GPS_ALTITUDE);
  if (entry === undefined || entry.type !== 5) return undefined;

  const offset = readUint32(bytes, entry.valueOffset, isLittleEndian);
  if (offset === undefined) return undefined;

  const metres = readRational(bytes, tiffStart + offset, isLittleEndian, false);
  if (metres === undefined) return undefined;

  // Reference 1 means below sea level. It is a BYTE, stored inline.
  const refEntry = gpsIfd.get(TAG_GPS_ALTITUDE_REF);
  const ref = refEntry === undefined ? 0 : bytes[refEntry.valueOffset];
  return ref === 1 ? -metres : metres;
}
