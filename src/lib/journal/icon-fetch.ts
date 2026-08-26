// Fetches an icon from the Iconify API and rewrites it onto this app's icon
// tile. The one impure file in the generated-icon story: icon-search.ts decides
// *which* icon, generated-icons.ts draws the offline fallback, this fetches.
//
// Why the bytes get rewritten rather than stored as delivered. Iconify serves an
// icon sized for inline use in a stylesheet-bearing document:
//
//   <svg ... width="1em" height="1em" viewBox="0 0 24 24">
//     <path fill="currentColor" d="..."/></svg>
//
// Both of those are wrong for us. We store the SVG and serve it back through an
// <img> tag, where there is no font-size to resolve `1em` against and no colour
// to inherit for `currentColor` — so as delivered it renders as a ~16px black
// smudge, or nothing at all. So the paths are lifted out and re-mounted on the
// same 64px hue-tinted tile the hand-drawn glyphs use, which also keeps a mixed
// row of fetched and fallback icons looking like one set.
//
// Licensing: the set is fixed to Material Design Icons, Apache-2.0. That licence
// is what makes it legitimate to keep a copy of the bytes rather than hotlinking.
//
// Everything fetched runs through `isSafeGeneratedIconSvg` before it can be
// returned. These are third-party bytes; they get the strict door, not a
// relaxed one.

import {
  GENERATED_ICON_MIME_TYPE,
  buildGeneratedIconSvg,
  isSafeGeneratedIconSvg,
  iconTileColors,
  wrapIconBody,
} from "./generated-icons";
import { iconifyIconId } from "./icon-search";

/** Where icons come from. No key, no account — a public, free API. */
const API_ORIGIN = "https://api.iconify.design";

/** Iconify's canvas. Every MDI icon is 24x24; we scale it onto our 64 tile. */
const SOURCE_VIEWBOX = 24;

/** How much of the 64px tile the glyph fills, leaving a margin like the hand-drawn set. */
const GLYPH_SPAN = 40;

/** Cap on a fetched icon, comfortably above any real one (they run ~200-2000 bytes). */
const MAX_FETCHED_BYTES = 64 * 1024;

/** Give up rather than hang a request behind a slow third party. */
const FETCH_TIMEOUT_MS = 8000;

/** What `fetchIconSvg` gives back: the SVG plus where it came from. */
export interface FetchedIcon {
  svg: string;
  mimeType: string;
  /** The Iconify id used, or undefined when this is the offline fallback. */
  iconId?: string;
}

/**
 * Pulls the drawable children out of an Iconify SVG.
 *
 * Deliberately not a general SVG parser — this handles exactly the shape the API
 * returns (a flat list of self-closing shape elements) and refuses anything else,
 * which is the right bias for third-party input. `fill="currentColor"` is
 * rewritten to the tile's stroke colour; a `<path>` from MDI is a filled shape,
 * not a stroked one, so the fill is what carries the drawing.
 */
export function extractIconBody(svg: string, color: string): string | undefined {
  const openMatch = svg.match(/<svg\b[^>]*>/i);
  if (!openMatch) return undefined;
  const inner = svg.slice(openMatch.index! + openMatch[0].length).replace(/<\/svg>\s*$/i, "");
  if (inner.trim() === "") return undefined;

  // Only the shape elements, and only with attributes we recognise. Anything
  // else — a <style>, a <use>, a nested <svg>, a gradient — and we bail to the
  // fallback rather than trying to sanitize something unexpected.
  const allowed = /^(path|circle|ellipse|rect|line|polyline|polygon|g)$/i;
  let out = "";
  const elementPattern = /<\s*([a-zA-Z][\w:-]*)\b([^>]*?)\/?\s*>/g;
  let consumed = 0;
  for (const match of inner.matchAll(elementPattern)) {
    const [whole, tag, attrs] = match;
    if (!allowed.test(tag)) return undefined;
    if (/\son\w+\s*=/i.test(attrs)) return undefined;
    if (/(href|xlink:href|src|style|filter|mask|clip-path)\s*=/i.test(attrs)) return undefined;
    // `currentColor` has nothing to inherit from in a standalone <img>.
    out += `<${tag}${attrs.replace(/currentColor/g, color)}/>`;
    consumed += whole.length;
  }
  if (out === "") return undefined;
  // Reject leftovers: text nodes or closing tags we didn't account for mean the
  // markup isn't the flat shape list we know how to handle.
  const leftover = inner.replace(elementPattern, "").replace(/<\/(g|svg)\s*>/gi, "").trim();
  if (leftover !== "" || consumed === 0) return undefined;

  return out;
}

/**
 * An Iconify icon re-drawn on our tile, or undefined when the markup wasn't the
 * shape we know how to rewrite.
 *
 * `name` supplies the tile tint, so a fetched icon is coloured by the same
 * name-hash as a hand-drawn one and the two mix without looking sorted.
 */
export function buildFetchedIconSvg(name: string, iconSvg: string): string | undefined {
  const { stroke } = iconTileColors(name);
  const body = extractIconBody(iconSvg, stroke);
  if (body === undefined) return undefined;

  // Centre the 24-unit source inside the 64-unit tile at GLYPH_SPAN across.
  const scale = GLYPH_SPAN / SOURCE_VIEWBOX;
  const offset = (64 - GLYPH_SPAN) / 2;
  const transform = `translate(${offset} ${offset}) scale(${scale.toFixed(4)})`;

  const svg = wrapIconBody(name, `<g transform="${transform}">${body}</g>`);
  return isSafeGeneratedIconSvg(svg) ? svg : undefined;
}

/** Fetches one URL as text, with a timeout and a size cap. */
async function fetchText(url: string): Promise<string | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return undefined;
    const text = await response.text();
    if (text.length > MAX_FETCHED_BYTES) return undefined;
    // The API answers a miss with a 200 and the body "404".
    if (!text.includes("<svg")) return undefined;
    return text;
  } catch {
    // A network failure is not an error here — the caller falls back to a
    // locally drawn glyph, which is the whole point of keeping that table.
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The icon for a category/tag name: fetched from Iconify when the name maps to
 * one and the network cooperates, otherwise the locally drawn glyph.
 *
 * Never throws for a network or mapping failure — it degrades. The only throw is
 * an empty name, which is a caller bug.
 */
export async function fetchIconSvg(name: string): Promise<FetchedIcon> {
  if (name.trim() === "") throw new Error("Cannot generate an icon for an empty name.");

  const iconId = iconifyIconId(name);
  if (iconId !== undefined) {
    const [prefix, icon] = iconId.split(":");
    const fetched = await fetchText(`${API_ORIGIN}/${prefix}/${icon}.svg`);
    if (fetched !== undefined) {
      const svg = buildFetchedIconSvg(name, fetched);
      if (svg !== undefined) return { svg, mimeType: GENERATED_ICON_MIME_TYPE, iconId };
    }
  }

  // Offline, unmapped, or unexpected markup: the hand-drawn table still covers
  // most of a household vocabulary, and the letter tile backs that up.
  return { svg: buildGeneratedIconSvg(name), mimeType: GENERATED_ICON_MIME_TYPE };
}
