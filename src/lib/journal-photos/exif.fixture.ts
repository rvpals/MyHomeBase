// Builds JPEG byte structures for the EXIF parser's tests.
//
// Hand-built rather than checked-in binary files: the cases that matter are the
// awkward ones (Motorola byte order, a truncated buffer, EXIF behind another APP
// segment, a missing tag), and constructing those from a builder makes each one a
// readable argument instead of an opaque blob nobody can adjust later.
//
// Test support only -- not exported from index.ts.

export interface JpegFixtureOptions {
  /** The DateTimeOriginal value, in the spec's `YYYY:MM:DD HH:MM:SS` form. */
  dateTimeOriginal?: string;
  /** The DateTimeDigitized value, used when DateTimeOriginal is absent. */
  dateTimeDigitized?: string;
  /** The IFD0 DateTime value -- the modification stamp, a last resort. */
  dateTime?: string;
  /** Big-endian (`MM`), as Canon and some scanners write. Default little-endian. */
  bigEndian?: boolean;
  /** Emit no APP1/EXIF segment at all, as a stripped or re-saved file has. */
  withoutExif?: boolean;
  /** Put a JFIF APP0 segment before EXIF, which many files do. */
  withLeadingApp0?: boolean;
}

/** A JPEG's leading bytes, with an EXIF block built to order. */
export function buildJpegWithExif(options: JpegFixtureOptions = {}): Uint8Array {
  const parts: number[] = [0xff, 0xd8]; // SOI

  if (options.withLeadingApp0) {
    // A minimal JFIF APP0: length 16 then 14 bytes of payload.
    const payload = [0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x02, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
    parts.push(0xff, 0xe0, 0x00, payload.length + 2, ...payload);
  }

  if (!options.withoutExif) {
    const exif = buildExifPayload(options);
    const segmentLength = exif.length + 2;
    parts.push(0xff, 0xe1, (segmentLength >> 8) & 0xff, segmentLength & 0xff, ...exif);
  }

  // A token SOS so the structure looks like a real file past the metadata.
  parts.push(0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00);
  parts.push(0xff, 0xd9); // EOI

  return new Uint8Array(parts);
}

/**
 * The APP1 payload: `Exif\0\0`, a TIFF header, IFD0 with a sub-IFD pointer, and the
 * Exif sub-IFD holding the capture tags. Offsets are computed rather than hard-coded
 * so a fixture stays correct when its tag set changes.
 */
function buildExifPayload(options: JpegFixtureOptions): number[] {
  const little = !options.bigEndian;

  const uint16 = (value: number): number[] =>
    little ? [value & 0xff, (value >> 8) & 0xff] : [(value >> 8) & 0xff, value & 0xff];
  const uint32 = (value: number): number[] =>
    little
      ? [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff]
      : [(value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];

  // Every offset below is relative to the start of the TIFF header.
  const ifd0Offset = 8;

  const ifd0Tags: { tag: number; text?: string; pointer?: boolean }[] = [];
  if (options.dateTime !== undefined) ifd0Tags.push({ tag: 0x0132, text: options.dateTime });
  const subIfdTags: { tag: number; text: string }[] = [];
  if (options.dateTimeOriginal !== undefined) {
    subIfdTags.push({ tag: 0x9003, text: options.dateTimeOriginal });
  }
  if (options.dateTimeDigitized !== undefined) {
    subIfdTags.push({ tag: 0x9004, text: options.dateTimeDigitized });
  }

  const hasSubIfd = subIfdTags.length > 0;
  const ifd0EntryCount = ifd0Tags.length + (hasSubIfd ? 1 : 0);

  // Layout: IFD0 entries, then its next-IFD pointer, then IFD0's string data, then
  // the sub-IFD, then the sub-IFD's string data.
  const ifd0Size = 2 + ifd0EntryCount * 12 + 4;
  const ifd0DataOffset = ifd0Offset + ifd0Size;
  const ifd0DataLength = ifd0Tags.reduce((total, entry) => total + (entry.text?.length ?? 0) + 1, 0);
  const subIfdOffset = ifd0DataOffset + ifd0DataLength;
  const subIfdSize = 2 + subIfdTags.length * 12 + 4;
  const subIfdDataOffset = subIfdOffset + subIfdSize;

  const bytes: number[] = [];
  // "Exif\0\0"
  bytes.push(0x45, 0x78, 0x69, 0x66, 0x00, 0x00);
  // TIFF header: byte order, magic 42, offset of IFD0.
  bytes.push(...(little ? [0x49, 0x49] : [0x4d, 0x4d]));
  bytes.push(...uint16(42));
  bytes.push(...uint32(ifd0Offset));

  // --- IFD0 ---
  bytes.push(...uint16(ifd0EntryCount));
  let ifd0DataCursor = ifd0DataOffset;
  for (const entry of ifd0Tags) {
    const text = entry.text ?? "";
    const count = text.length + 1; // includes the terminating NUL
    bytes.push(...uint16(entry.tag));
    bytes.push(...uint16(2)); // ASCII
    bytes.push(...uint32(count));
    bytes.push(...uint32(ifd0DataCursor));
    ifd0DataCursor += count;
  }
  if (hasSubIfd) {
    bytes.push(...uint16(0x8769));
    bytes.push(...uint16(4)); // LONG
    bytes.push(...uint32(1));
    bytes.push(...uint32(subIfdOffset));
  }
  bytes.push(...uint32(0)); // no next IFD

  // IFD0's string data, in the same order the entries point at.
  for (const entry of ifd0Tags) {
    bytes.push(...asciiWithNul(entry.text ?? ""));
  }

  // --- Exif sub-IFD ---
  if (hasSubIfd) {
    bytes.push(...uint16(subIfdTags.length));
    let subDataCursor = subIfdDataOffset;
    for (const entry of subIfdTags) {
      const count = entry.text.length + 1;
      bytes.push(...uint16(entry.tag));
      bytes.push(...uint16(2)); // ASCII
      bytes.push(...uint32(count));
      bytes.push(...uint32(subDataCursor));
      subDataCursor += count;
    }
    bytes.push(...uint32(0));
    for (const entry of subIfdTags) {
      bytes.push(...asciiWithNul(entry.text));
    }
  }

  return bytes;
}

function asciiWithNul(text: string): number[] {
  const bytes = [...text].map((character) => character.charCodeAt(0));
  bytes.push(0);
  return bytes;
}
