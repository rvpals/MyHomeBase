// Builds JPEG byte structures carrying ARBITRARY EXIF tags, for `exif-all`'s tests.
//
// Separate from `exif.fixture.ts` rather than an extension of it. That builder answers
// the date parser's questions and lays out exactly the tags a timestamp test needs; this
// one has to place tags of any type, in any of three IFDs, including the GPS block with
// its rationals. Merging them would make one builder whose layout code serves two
// unrelated shapes -- and the date fixtures are the ones that must not shift.
//
// Test support only -- not exported from index.ts.

/** An EXIF value type code, as the spec numbers them. */
export type FixtureType = 1 | 2 | 3 | 4 | 5 | 7 | 9 | 10;

/** One tag to place in a fixture. */
export interface FixtureTag {
  tag: number;
  type: FixtureType;
  /**
   * The value. A string for ASCII/UNDEFINED, a number for the integer types, and an
   * array of `[numerator, denominator]` pairs for the rational ones.
   */
  value: string | number | number[];
}

export interface ExifFixtureOptions {
  ifd0?: FixtureTag[];
  exif?: FixtureTag[];
  gps?: FixtureTag[];
  /** Big-endian (`MM`), as Canon and some scanners write. Default little-endian. */
  bigEndian?: boolean;
  /** Emit no APP1/EXIF segment at all. */
  withoutExif?: boolean;
  /** Truncate the result to this many bytes, to model a partial read. */
  truncateTo?: number;
}

/** A latitude/longitude as the three rationals EXIF stores. */
export function degreesMinutesSeconds(
  degrees: number,
  minutes: number,
  seconds: number,
): number[] {
  // Seconds carry a denominator of 100 so a fractional value survives the integers.
  return [degrees, 1, minutes, 1, Math.round(seconds * 100), 100];
}

/** A JPEG whose EXIF block holds exactly the tags given. */
export function buildJpegWithTags(options: ExifFixtureOptions = {}): Uint8Array {
  const parts: number[] = [0xff, 0xd8]; // SOI

  if (!options.withoutExif) {
    const payload = buildPayload(options);
    const segmentLength = payload.length + 2;
    parts.push(0xff, 0xe1, (segmentLength >> 8) & 0xff, segmentLength & 0xff, ...payload);
  }

  parts.push(0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00); // SOS
  parts.push(0xff, 0xd9); // EOI

  const bytes = new Uint8Array(parts);
  return options.truncateTo === undefined ? bytes : bytes.slice(0, options.truncateTo);
}

const TAG_EXIF_SUB_IFD = 0x8769;
const TAG_GPS_SUB_IFD = 0x8825;

/**
 * `Exif\0\0`, a TIFF header, then IFD0 followed by the two sub-IFDs.
 *
 * Laid out in three passes because an IFD entry has to know where its own out-of-line
 * data will sit before that data is written: sizes first, then offsets, then bytes.
 */
function buildPayload(options: ExifFixtureOptions): number[] {
  const little = !options.bigEndian;
  const ifd0Tags = [...(options.ifd0 ?? [])];
  const exifTags = options.exif ?? [];
  const gpsTags = options.gps ?? [];

  const uint16 = (value: number): number[] =>
    little ? [value & 0xff, (value >> 8) & 0xff] : [(value >> 8) & 0xff, value & 0xff];
  const uint32 = (value: number): number[] =>
    little
      ? [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff]
      : [(value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];

  const hasExif = exifTags.length > 0;
  const hasGps = gpsTags.length > 0;

  // IFD0 carries a pointer entry for each sub-IFD present.
  const ifd0EntryCount = ifd0Tags.length + (hasExif ? 1 : 0) + (hasGps ? 1 : 0);

  const ifd0Offset = 8;
  const ifd0Size = 2 + ifd0EntryCount * 12 + 4;
  const ifd0DataOffset = ifd0Offset + ifd0Size;
  const ifd0DataSize = totalDataSize(ifd0Tags);

  const exifOffset = ifd0DataOffset + ifd0DataSize;
  const exifSize = hasExif ? 2 + exifTags.length * 12 + 4 : 0;
  const exifDataOffset = exifOffset + exifSize;
  const exifDataSize = totalDataSize(exifTags);

  const gpsOffset = exifDataOffset + exifDataSize;
  const gpsSize = hasGps ? 2 + gpsTags.length * 12 + 4 : 0;
  const gpsDataOffset = gpsOffset + gpsSize;

  const bytes: number[] = [];
  bytes.push(0x45, 0x78, 0x69, 0x66, 0x00, 0x00); // "Exif\0\0"
  bytes.push(...(little ? [0x49, 0x49] : [0x4d, 0x4d]));
  bytes.push(...uint16(42));
  bytes.push(...uint32(ifd0Offset));

  // --- IFD0 ---
  bytes.push(...uint16(ifd0EntryCount));
  let cursor = ifd0DataOffset;
  for (const entry of ifd0Tags) {
    bytes.push(...entryBytes(entry, cursor, uint16, uint32));
    cursor += dataSize(entry);
  }
  if (hasExif) {
    bytes.push(...uint16(TAG_EXIF_SUB_IFD), ...uint16(4), ...uint32(1), ...uint32(exifOffset));
  }
  if (hasGps) {
    bytes.push(...uint16(TAG_GPS_SUB_IFD), ...uint16(4), ...uint32(1), ...uint32(gpsOffset));
  }
  bytes.push(...uint32(0)); // no next IFD
  for (const entry of ifd0Tags) bytes.push(...dataBytes(entry, uint16, uint32));

  // --- Exif sub-IFD ---
  if (hasExif) {
    bytes.push(...uint16(exifTags.length));
    cursor = exifDataOffset;
    for (const entry of exifTags) {
      bytes.push(...entryBytes(entry, cursor, uint16, uint32));
      cursor += dataSize(entry);
    }
    bytes.push(...uint32(0));
    for (const entry of exifTags) bytes.push(...dataBytes(entry, uint16, uint32));
  }

  // --- GPS sub-IFD ---
  if (hasGps) {
    bytes.push(...uint16(gpsTags.length));
    cursor = gpsDataOffset;
    for (const entry of gpsTags) {
      bytes.push(...entryBytes(entry, cursor, uint16, uint32));
      cursor += dataSize(entry);
    }
    bytes.push(...uint32(0));
    for (const entry of gpsTags) bytes.push(...dataBytes(entry, uint16, uint32));
  }

  return bytes;
}

/** How many components a tag declares. */
function componentCount(entry: FixtureTag): number {
  if (typeof entry.value === "string") return entry.value.length + 1; // with NUL
  if (Array.isArray(entry.value)) {
    // Rationals come in numerator/denominator pairs.
    return entry.type === 5 || entry.type === 10 ? entry.value.length / 2 : entry.value.length;
  }
  return 1;
}

const SIZES: Record<FixtureType, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

/** Bytes this tag's value occupies, or 0 when it fits inline in the entry. */
function dataSize(entry: FixtureTag): number {
  const total = SIZES[entry.type] * componentCount(entry);
  return total <= 4 ? 0 : total;
}

function totalDataSize(entries: FixtureTag[]): number {
  return entries.reduce((sum, entry) => sum + dataSize(entry), 0);
}

/** The 12-byte directory entry, holding either the value or an offset to it. */
function entryBytes(
  entry: FixtureTag,
  dataOffset: number,
  uint16: (value: number) => number[],
  uint32: (value: number) => number[],
): number[] {
  const count = componentCount(entry);
  const out = [...uint16(entry.tag), ...uint16(entry.type), ...uint32(count)];

  if (dataSize(entry) > 0) {
    out.push(...uint32(dataOffset));
    return out;
  }

  // Inline: the value occupies the 4 value bytes, left-aligned and zero-padded, which
  // is what the spec requires. `uint16`/`uint32` have already applied the byte order,
  // so the padding is the only thing left to do.
  const inline = dataBytes(entry, uint16, uint32);
  while (inline.length < 4) inline.push(0);
  out.push(...inline.slice(0, 4));
  return out;
}

/** The value's own bytes, in the order the entry or the data area expects. */
function dataBytes(
  entry: FixtureTag,
  uint16: (value: number) => number[],
  uint32: (value: number) => number[],
): number[] {
  if (typeof entry.value === "string") {
    const out = [...entry.value].map((character) => character.charCodeAt(0));
    out.push(0);
    return out;
  }

  const values = Array.isArray(entry.value) ? entry.value : [entry.value];

  switch (entry.type) {
    case 1:
    case 7:
      return values.map((value) => value & 0xff);
    case 3:
      return values.flatMap((value) => uint16(value));
    case 4:
    case 9:
      return values.flatMap((value) => uint32(value));
    case 5:
    case 10:
      // Already numerator/denominator pairs.
      return values.flatMap((value) => uint32(value));
    default:
      return [];
  }
}
