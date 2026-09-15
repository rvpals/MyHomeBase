// Reads a JPEG's pixel dimensions out of its frame header.
//
// A hand-written parser rather than a dependency, for the same two reasons `exif.ts`
// is one. It answers a single question -- "how big is this picture?" -- and it has to
// answer it from a PARTIAL read: the Magic List indexer walks thousands of photos over
// SMB, and pulling whole multi-megabyte files to learn two 16-bit numbers near the
// front of each would make the feature unusable.
//
// It costs NO EXTRA I/O. The SOF marker sits in the same first bytes as the EXIF block,
// so the 128KB `readHeader` the date scanner already performs carries both; the indexer
// reads once and hands the same buffer to `readExifDateTime` and to this.
//
// Pure: bytes in, dimensions out. No filesystem, which is what lets the awkward cases
// (a progressive JPEG, a segment straddling the end of the buffer, a file that is not a
// JPEG at all) be tested directly from fixtures instead of from real photographs.
//
// Structure being walked, for anyone maintaining this:
//
//   FFD8                      start of image
//   FFEn <len> ...            APP segments -- JFIF, EXIF, ICC. Skipped by their length.
//   FFDB <len> ...            quantisation tables, etc. Also skipped by length.
//   FFC0 <len> <prec>         start of frame (baseline) -- the one we want
//     <height:2> <width:2>    ... in that order. Big-endian, always.

/** A picture's size in pixels. */
export interface JpegSize {
  width: number;
  height: number;
}

/**
 * Markers that start a frame and therefore carry the dimensions.
 *
 * `FFC0` is baseline and `FFC2` is progressive -- both ordinary in a photo archive, and
 * a phone that shoots progressive would otherwise report every picture as unmeasurable.
 * The arithmetically-coded and hierarchical variants (`FFC9`, `FFCA`, ...) are included
 * because reading them costs nothing: every SOF_n lays out its first five bytes
 * identically, so the same four lines work for all of them.
 *
 * `FFC4`, `FFC8` and `FFCC` are the exceptions and are deliberately ABSENT: they share
 * the `FFCn` shape but are a Huffman table, a JPEG extension and an arithmetic-coding
 * conditioning table respectively -- not frames. Treating one as a frame would read two
 * unrelated bytes and report a confident, wrong size.
 */
const FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

/** Markers that carry no payload length and so advance by two bytes, as in `exif.ts`. */
const STANDALONE_MARKERS = new Set([0xd8, 0xd9, 0x01]);

/**
 * The picture's dimensions, or `undefined` when the bytes carry none.
 *
 * `undefined` covers every failure the same way -- not a JPEG, a buffer that stopped
 * before the frame header, a corrupt segment length, a frame declaring a zero
 * dimension. The caller's next move is identical in all of them (record the size as
 * unknown and let a resolution criterion exclude it), and one unreadable photo must
 * never fail the scan it appears in. Same contract as `readExifDate`.
 *
 * WIDTH AND HEIGHT ARE NOT SWAPPED FOR ORIENTATION. A portrait photo from a phone is
 * very often stored as a landscape frame plus an EXIF orientation tag saying "rotate
 * this", so the numbers here are the STORED ones. That is the right answer for the
 * question this feeds -- "is this picture at least 1920x1080 of real pixels?" -- where
 * a rotation changes nothing about how much detail is present. It would be the wrong
 * answer for laying the picture out on screen, which is not what this is for.
 */
export function readJpegSize(bytes: Uint8Array): JpegSize | undefined {
  // Every JPEG opens with SOI. Checking it means a PNG or a truncated download exits
  // here rather than being walked as if its bytes were segment lengths.
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;

  let offset = 2;

  // Bounded by the buffer, not by a marker search: a corrupt length field that points
  // backwards or past the end must terminate the walk, never loop it.
  while (offset + 1 < bytes.length) {
    // Segments are byte-aligned but padding of `FF` between them is legal, so skip any
    // run of fill bytes before reading the marker itself.
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    let marker = bytes[offset + 1];
    while (marker === 0xff && offset + 2 < bytes.length) {
      offset += 1;
      marker = bytes[offset + 1];
    }

    if (STANDALONE_MARKERS.has(marker)) {
      offset += 2;
      continue;
    }

    // SOS -- the entropy-coded image data begins, and it is not segment-structured.
    // Any frame header worth reading came before it, so walking on would be parsing
    // compressed pixels as if they were markers.
    if (marker === 0xda) return undefined;

    // Everything else carries a 16-bit big-endian length, which includes its own two
    // bytes. Needs four bytes available: two for the marker, two for the length.
    if (offset + 4 > bytes.length) return undefined;
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    // A length under 2 cannot include its own field, so the file is malformed and the
    // walk cannot advance -- returning here is what stops an infinite loop.
    if (length < 2) return undefined;

    if (FRAME_MARKERS.has(marker)) {
      // SOF payload: 1 byte precision, then height and width as big-endian 16-bit.
      // Height first -- the order is the one thing here that is easy to get backwards.
      if (offset + 9 > bytes.length) return undefined;
      const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
      const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
      // A frame declaring zero is malformed. Reported as unknown rather than as a
      // 0x0 picture, which would quietly satisfy "no maximum" criteria.
      if (width <= 0 || height <= 0) return undefined;
      return { width, height };
    }

    offset += 2 + length;
  }

  return undefined;
}
