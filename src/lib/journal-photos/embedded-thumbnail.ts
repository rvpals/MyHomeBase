import { findExifSegment, readIfd, readTiffHeader, readUint16, readUint32 } from "./exif";

// The small preview JPEG most cameras and phones tuck inside a photo's EXIF block.
//
// THE CHEAP THUMBNAIL. It sits in IFD1, inside the same first ~64KB that `readHeader`
// already pulls for the capture date -- so a strip thumbnail costs one partial read
// instead of the whole multi-megabyte original over SMB, and no decode at all on the
// server. Typically 160x120.
//
// Pure: bytes in, bytes out. Same parser as `exif.ts`, reached through its exported
// helpers rather than a second copy of the segment walk.

const TAG_ORIENTATION = 0x0112;
const TAG_THUMBNAIL_OFFSET = 0x0201;
const TAG_THUMBNAIL_LENGTH = 0x0202;

/** A preview larger than this is not a thumbnail; refuse it rather than trust a bad length. */
const MAX_THUMBNAIL_BYTES = 64 * 1024;

export interface EmbeddedThumbnail {
  /** The preview's own JPEG bytes, starting at its SOI marker. */
  jpeg: Uint8Array;
  /**
   * The ORIGINAL photo's EXIF orientation, 1-8, or 1 when it carries none.
   *
   * Carried with the preview because the preview has no EXIF of its own: a portrait
   * phone photo is stored sideways with `orientation = 6`, and its preview is stored
   * sideways too. The browser rotates the original from its tag; nothing rotates the
   * preview unless the server does. See `orientationTransform`.
   */
  orientation: number;
}

/**
 * The EXIF preview inside a photo's header bytes, or `undefined` when there is none.
 *
 * `undefined` covers every failure the same way -- no EXIF, no IFD1, an offset past the
 * bytes provided, a length that is zero or implausibly large, bytes that are not a JPEG.
 * The caller's next move is identical in all of them: build the thumbnail from the
 * original instead.
 */
export function readEmbeddedThumbnail(bytes: Uint8Array): EmbeddedThumbnail | undefined {
  const exifStart = findExifSegment(bytes);
  if (exifStart === undefined) return undefined;

  const tiff = readTiffHeader(bytes, exifStart);
  if (tiff === undefined) return undefined;
  const { isLittleEndian, tiffStart, ifdOffset } = tiff;

  const ifd0 = readIfd(bytes, tiffStart, ifdOffset, isLittleEndian);
  if (ifd0 === undefined) return undefined;

  // IFD1 is reached through IFD0's "next IFD" pointer, which sits straight after its
  // entries. `readIfd` does not return it, so it is read here from the entry count.
  const ifd0Base = tiffStart + ifdOffset;
  const ifd0Count = readUint16(bytes, ifd0Base, isLittleEndian);
  if (ifd0Count === undefined) return undefined;
  const ifd1Offset = readUint32(bytes, ifd0Base + 2 + ifd0Count * 12, isLittleEndian);
  if (ifd1Offset === undefined || ifd1Offset < 8) return undefined;

  const ifd1 = readIfd(bytes, tiffStart, ifd1Offset, isLittleEndian);
  if (ifd1 === undefined) return undefined;

  const offset = ifd1.get(TAG_THUMBNAIL_OFFSET)?.longValue;
  const length = ifd1.get(TAG_THUMBNAIL_LENGTH)?.longValue;
  if (offset === undefined || length === undefined) return undefined;
  if (length < 4 || length > MAX_THUMBNAIL_BYTES) return undefined;

  const start = tiffStart + offset;
  const end = start + length;
  if (end > bytes.length) return undefined;
  // SOI. Anything else is not the JPEG the tags claim it is.
  if (bytes[start] !== 0xff || bytes[start + 1] !== 0xd8) return undefined;

  return {
    jpeg: bytes.slice(start, end),
    orientation: readOrientation(bytes, ifd0.get(TAG_ORIENTATION)?.valueOffset, isLittleEndian),
  };
}

/** The orientation SHORT stored inline in its entry, or 1 when absent or out of range. */
function readOrientation(
  bytes: Uint8Array,
  valueOffset: number | undefined,
  isLittleEndian: boolean,
): number {
  if (valueOffset === undefined) return 1;
  const value = readUint16(bytes, valueOffset, isLittleEndian);
  return value !== undefined && value >= 1 && value <= 8 ? value : 1;
}

/** What to do to a stored image so it displays the right way up. */
export interface OrientationTransform {
  /** Clockwise, applied first. */
  rotate: 0 | 90 | 180 | 270;
  /** Mirror left-right, applied after the rotation. */
  flop: boolean;
  /** Mirror top-bottom, applied after the rotation. */
  flip: boolean;
}

/**
 * The correction for an EXIF orientation, or `undefined` when the image is already
 * upright (1, or a value outside the spec).
 *
 * The eight cases are the EXIF definitions. 2, 4, 5 and 7 are the mirrored ones and
 * rarely come from a camera, but a scanner or an editor can write them.
 */
export function orientationTransform(orientation: number): OrientationTransform | undefined {
  switch (orientation) {
    case 2:
      return { rotate: 0, flop: true, flip: false };
    case 3:
      return { rotate: 180, flop: false, flip: false };
    case 4:
      return { rotate: 0, flop: false, flip: true };
    case 5:
      return { rotate: 90, flop: true, flip: false };
    case 6:
      return { rotate: 90, flop: false, flip: false };
    case 7:
      return { rotate: 270, flop: true, flip: false };
    case 8:
      return { rotate: 270, flop: false, flip: false };
    default:
      return undefined;
  }
}
