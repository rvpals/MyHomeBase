// Builds JPEG headers whose EXIF block carries an embedded preview in IFD1.
//
// Hand-built for the same reason as `exif.fixture.ts`: the cases that matter (no IFD1,
// a length past the buffer, Motorola byte order, an orientation tag) are each one
// readable option here instead of an opaque binary file.
//
// Test support only -- not exported from index.ts.

export interface ThumbnailFixtureOptions {
  /** The preview's bytes. Default: a minimal SOI..EOI JPEG. */
  thumbnail?: number[];
  /** IFD0's Orientation tag. Omitted when undefined. */
  orientation?: number;
  /** Big-endian (`MM`). Default little-endian. */
  bigEndian?: boolean;
  /** Leave IFD0's next-IFD pointer at 0, so there is no IFD1. */
  withoutIfd1?: boolean;
  /** Override the length tag, e.g. to point past the end of the buffer. */
  lengthOverride?: number;
}

/** A fake preview: SOI, a few bytes, EOI. Enough to be recognised as a JPEG. */
export const FAKE_PREVIEW = [0xff, 0xd8, 0x01, 0x02, 0x03, 0x04, 0xff, 0xd9];

/** A JPEG's leading bytes, with an EXIF block holding IFD0 and (usually) IFD1. */
export function buildJpegWithPreview(options: ThumbnailFixtureOptions = {}): Uint8Array {
  const little = !options.bigEndian;
  const uint16 = (value: number): number[] =>
    little ? [value & 0xff, (value >> 8) & 0xff] : [(value >> 8) & 0xff, value & 0xff];
  const uint32 = (value: number): number[] =>
    little
      ? [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff]
      : [(value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];

  const preview = options.thumbnail ?? FAKE_PREVIEW;

  // Offsets relative to the TIFF header start.
  const ifd0Offset = 8;
  const ifd0Entries = options.orientation === undefined ? 0 : 1;
  const ifd0Size = 2 + ifd0Entries * 12 + 4;
  const ifd1Offset = ifd0Offset + ifd0Size;
  const ifd1Size = 2 + 2 * 12 + 4;
  const previewOffset = ifd1Offset + ifd1Size;

  const tiff: number[] = [];
  tiff.push(...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...uint16(42), ...uint32(ifd0Offset));

  // IFD0
  tiff.push(...uint16(ifd0Entries));
  if (options.orientation !== undefined) {
    // SHORT, count 1, value inline in the first two of the four value bytes.
    tiff.push(...uint16(0x0112), ...uint16(3), ...uint32(1), ...uint16(options.orientation), 0, 0);
  }
  tiff.push(...uint32(options.withoutIfd1 ? 0 : ifd1Offset));

  if (!options.withoutIfd1) {
    // IFD1: JPEGInterchangeFormat (offset) and JPEGInterchangeFormatLength.
    tiff.push(...uint16(2));
    tiff.push(...uint16(0x0201), ...uint16(4), ...uint32(1), ...uint32(previewOffset));
    tiff.push(
      ...uint16(0x0202),
      ...uint16(4),
      ...uint32(1),
      ...uint32(options.lengthOverride ?? preview.length),
    );
    tiff.push(...uint32(0));
    tiff.push(...preview);
  }

  const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff]; // "Exif\0\0" + TIFF
  const segmentLength = payload.length + 2;
  const bytes = [
    0xff, 0xd8, // SOI
    0xff, 0xe1, (segmentLength >> 8) & 0xff, segmentLength & 0xff, ...payload,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, // token SOS
    0xff, 0xd9, // EOI
  ];
  return new Uint8Array(bytes);
}
