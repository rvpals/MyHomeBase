// Turns an uploaded raster into an icon that actually works at 16-20px.
//
// ## The problem this solves
//
// Icon art is usually exported from a tool that shows transparency as a grey/white
// checkerboard. Export it as JPEG — which has no alpha channel at all — and the
// checkerboard is written into the file as literal pixels. It looks fine at 1024px, where
// the squares are small relative to the art. At 16px the whole backdrop averages to one
// muddy grey block behind the glyph, and on the compact "Sections" trigger, where the icon
// is the only content, that grey square *is* the control.
//
// The same happens with a solid white or black export on a dark or light theme.
//
// ## What it does
//
// 1. Decide whether the border is a *backdrop* — a checkerboard or one flat colour — and
//    if so turn every matching pixel transparent.
// 2. Trim the now-transparent margin, so the artwork fills the frame instead of sitting in
//    10% of dead space.
// 3. Re-encode as PNG at `ICON_TARGET_SIZE`, the only allowlisted format with alpha.
//
// ## Why the decisions live here and not in the sharp adapter
//
// Everything below is arithmetic over a plain RGBA array, so it is testable without a
// native module and without a real image file — which matters, because "did we correctly
// decide this is a checkerboard?" is the part that can be subtly wrong. The adapter only
// decodes and encodes.
//
// ## The safety property
//
// Detection is a heuristic, so it is built to *decline* rather than to guess: a photo, a
// screenshot, or art that genuinely reaches the edge is left alone. Every rule below has a
// bail-out, and the caller keeps the original bytes when nothing was detected. A false
// negative costs a slightly worse icon; a false positive would punch holes in someone's
// artwork, so the thresholds are deliberately conservative.

import type { IconImageProcessor } from "./ports";
import type { NormalizedIcon, RawBitmap } from "./types";

/**
 * The stored edge length. 256px against a 20px maximum on-screen size (the compact section
 * trigger) leaves room for a 3x-DPR phone and then some; going larger costs bytes in every
 * backup for detail no screen can show. A 1024px upload lands at ~5-8 KB here rather than
 * the ~110 KB it arrived as.
 */
export const ICON_TARGET_SIZE = 256;

/** Per-channel tolerance when deciding two pixels are "the same colour". */
const COLOUR_TOLERANCE = 12;

/**
 * The wider tolerance used when *clearing* an already-identified backdrop tone.
 *
 * Lossy compression does not preserve a flat colour. A checkerboard that was two exact
 * tones comes back from a JPEG as a smear — one real upload had **38 distinct colours in a
 * single row**, clustered around 212-215 and 252-255. Clearing at the detection tolerance
 * left the outliers behind as a faint grid, and, worse, left some border pixels opaque,
 * which defeated the trim entirely because the content box then reached the frame edge.
 *
 * Wider here than at detection on purpose: deciding *whether* this is a backdrop should be
 * strict, but once decided, the ringing around it belongs to the same backdrop.
 */
const CLEAR_TOLERANCE = 26;

/**
 * How much of the border must agree before it counts as a backdrop.
 *
 * High on purpose. A photo's edge is never 92% two alternating greys, and art that bleeds
 * off the edge won't clear this either — both fall through untouched.
 */
const BORDER_AGREEMENT = 0.92;

/** A checkerboard is light-grey/white-ish. Anything darker is somebody's actual artwork. */
const CHECKER_MIN_LUMA = 150;

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

function pixelAt(bitmap: RawBitmap, x: number, y: number): Rgba {
  const i = (y * bitmap.width + x) * 4;
  return {
    r: bitmap.data[i],
    g: bitmap.data[i + 1],
    b: bitmap.data[i + 2],
    a: bitmap.data[i + 3],
  };
}

function sameColour(a: Rgba, b: Rgba, tolerance = COLOUR_TOLERANCE): boolean {
  return (
    Math.abs(a.r - b.r) <= tolerance &&
    Math.abs(a.g - b.g) <= tolerance &&
    Math.abs(a.b - b.b) <= tolerance
  );
}

function luma({ r, g, b }: Rgba): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Every pixel on the 1px outer border, which is where a backdrop is guaranteed to show. */
function borderPixels(bitmap: RawBitmap): Rgba[] {
  const { width, height } = bitmap;
  const out: Rgba[] = [];
  for (let x = 0; x < width; x++) {
    out.push(pixelAt(bitmap, x, 0));
    out.push(pixelAt(bitmap, x, height - 1));
  }
  for (let y = 1; y < height - 1; y++) {
    out.push(pixelAt(bitmap, 0, y));
    out.push(pixelAt(bitmap, width - 1, y));
  }
  return out;
}

/**
 * The one or two colours a flattened backdrop is made of, or null if the border isn't one.
 *
 * Two rather than one because that is exactly what a checkerboard is: alternating light
 * grey and white. Collapsing it to "the single most common colour" would strip half the
 * squares and leave the other half — visibly worse than doing nothing.
 */
export function detectBackdropColours(bitmap: RawBitmap): Rgba[] | null {
  if (bitmap.width < 8 || bitmap.height < 8) return null;

  const border = borderPixels(bitmap);
  if (border.length === 0) return null;

  // Already transparent at the edge? Then the file carries real alpha and there is no
  // flattened backdrop to undo. This is the path a correctly-exported PNG takes.
  const transparentBorder = border.filter((p) => p.a < 16).length / border.length;
  if (transparentBorder > 0.5) return null;

  // Cluster the border into colour buckets, at the WIDER tolerance.
  //
  // Clustering at the strict tolerance was a real bug: lossy compression turns each flat
  // backdrop tone into a spread of neighbours, so a genuine two-tone checkerboard split
  // into a dozen small buckets, no two of which reached `BORDER_AGREEMENT` — and detection
  // declined an image it should plainly have cleaned. Grouping the ringing together first
  // is what makes the *share* meaningful; the strictness that matters (is it light? is it
  // neutral?) is applied to the cluster afterwards, and is unaffected.
  const clusters: { colour: Rgba; count: number }[] = [];
  for (const p of border) {
    const hit = clusters.find((c) => sameColour(c.colour, p, CLEAR_TOLERANCE));
    if (hit) hit.count++;
    else clusters.push({ colour: p, count: 1 });
  }
  clusters.sort((a, b) => b.count - a.count);

  const top = clusters.slice(0, 2);
  const share = top.reduce((sum, c) => sum + c.count, 0) / border.length;
  if (share < BORDER_AGREEMENT) return null;

  // One dominant colour: a solid flat export. Accept any colour — a white *or* black
  // backdrop is equally wrong on some theme.
  if (clusters.length === 1 || top[1].count / border.length < 0.08) {
    return [top[0].colour];
  }

  // Two colours: only treat as a checkerboard if both are light and near-neutral. Two
  // saturated colours at the border are far more likely to be artwork than a checkerboard,
  // and stripping them would gut the image.
  const bothLight = top.every((c) => luma(c.colour) >= CHECKER_MIN_LUMA);
  const bothNeutral = top.every((c) => {
    const { r, g, b } = c.colour;
    return Math.max(r, g, b) - Math.min(r, g, b) <= 24;
  });
  if (!bothLight || !bothNeutral) return [top[0].colour];

  return top.map((c) => c.colour);
}

/**
 * Clears every pixel matching one of `colours` to fully transparent, in place.
 *
 * Global rather than a flood fill from the edges: a checkerboard shows *through* the gaps
 * in a glyph too (inside the loop of a `p`, between the two quote marks), and a flood fill
 * would leave those enclosed squares behind as grey specks.
 *
 * The cost of that choice is that a genuine white shape inside the artwork also goes
 * transparent. For icon line-art that is usually invisible or even desirable; it is the
 * main reason detection is conservative about *whether* to do this at all.
 */
function clearBackdrop(bitmap: RawBitmap, colours: Rgba[]): number {
  let cleared = 0;
  for (let i = 0; i < bitmap.data.length; i += 4) {
    const px = {
      r: bitmap.data[i],
      g: bitmap.data[i + 1],
      b: bitmap.data[i + 2],
      a: bitmap.data[i + 3],
    };
    if (px.a < 16) continue;
    if (colours.some((c) => sameColour(c, px, CLEAR_TOLERANCE))) {
      bitmap.data[i + 3] = 0;
      cleared++;
    }
  }
  return cleared;
}

/**
 * The tightest box containing every pixel that isn't fully transparent, padded by 2% so a
 * stroke's antialiased edge isn't shaved.
 *
 * Returns the full frame when the image is empty — cropping to nothing would throw in the
 * encoder, and an all-transparent upload is the user's problem to see, not a crash.
 */
export function findContentBox(
  bitmap: RawBitmap,
): { left: number; top: number; width: number; height: number } {
  const { width, height } = bitmap;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Threshold rather than `> 0`: a JPEG-decoded edge leaves faint near-transparent
      // fringe pixels, and honouring those would defeat the trim entirely.
      if (pixelAt(bitmap, x, y).a > 24) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0 || maxY < 0) return { left: 0, top: 0, width, height };

  const pad = Math.ceil(Math.max(width, height) * 0.02);
  const left = Math.max(0, minX - pad);
  const top = Math.max(0, minY - pad);
  const right = Math.min(width - 1, maxX + pad);
  const bottom = Math.min(height - 1, maxY + pad);

  // Square it up around the content's centre, so a non-square glyph isn't stretched by
  // the encoder's resize and stays centred in the slot.
  const boxW = right - left + 1;
  const boxH = bottom - top + 1;
  const side = Math.min(Math.max(boxW, boxH), Math.min(width, height));
  const cx = left + boxW / 2;
  const cy = top + boxH / 2;

  return {
    left: Math.round(Math.min(Math.max(0, cx - side / 2), width - side)),
    top: Math.round(Math.min(Math.max(0, cy - side / 2), height - side)),
    width: side,
    height: side,
  };
}

/**
 * The whole pipeline: strip a flattened backdrop, trim, downscale, re-encode as PNG.
 *
 * Async only because decode/encode are; the decisions in between are synchronous.
 */
export async function normalizeIconImage(
  processor: IconImageProcessor,
  data: Buffer,
): Promise<NormalizedIcon> {
  const bitmap = await processor.decode(data);

  const backdrop = detectBackdropColours(bitmap);
  const cleared = backdrop ? clearBackdrop(bitmap, backdrop) : 0;

  const box = findContentBox(bitmap);
  const trimmed = box.width !== bitmap.width || box.height !== bitmap.height;

  const encoded = await processor.encodePng(bitmap, box, ICON_TARGET_SIZE);

  return {
    data: encoded,
    mimeType: "image/png",
    width: ICON_TARGET_SIZE,
    height: ICON_TARGET_SIZE,
    strippedBackdrop: cleared > 0,
    trimmed,
  };
}
