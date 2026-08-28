// Turns an uploaded .svg file into markup that is safe to inline into the page.
//
// ## Why this exists at all
//
// `@/lib/shared/image-upload` refuses SVG outright, and its comment says why: these
// bytes are served from the app's own origin, so an SVG carrying script is stored XSS.
// That reasoning is sound for *raster* storage, where the file is handed back verbatim
// by a route. A slot override needs SVG for a reason raster can't satisfy — an inlined
// SVG inherits `currentColor`, so a custom glyph still tints to the theme accent the
// way every built-in set does. Raster on an accent badge is a coloured blob.
//
// So the file is not stored verbatim. It is parsed, reduced to an allowlist of drawing
// elements and attributes, and only the surviving inner markup is kept. The threat model
// is not "a stranger uploaded this" — only an admin can reach the upload — it is "an
// admin uploaded an icon they downloaded from somewhere and it carried a payload."
//
// ## Why allowlist rather than strip-the-bad-parts
//
// A blocklist has to anticipate every vector: `<script>`, but also `onload=` on any
// element, `javascript:` in an `href`, `<foreignObject>` smuggling HTML, `<use>`
// referencing an external document, CSS `url()` inside `<style>`. Miss one and it ships.
// An allowlist inverts the default: unknown element, unknown attribute — dropped. New
// vectors in future SVG features are excluded for free because they were never named.
//
// Note the CSP + `sandbox` headers in src/app/api/journal/icon-response.ts do NOT help
// here. Those protect a file *served as a document*. Inlined markup executes in this
// page's own context, so sanitizing at write time is the only control that applies.

/** Drawing elements. Shapes, grouping, gradients — nothing that can navigate or script. */
const ALLOWED_ELEMENTS = new Set([
  "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  "defs", "lineargradient", "radialgradient", "stop", "clippath", "mask",
  "title", "desc",
]);

/**
 * Presentation and geometry attributes.
 *
 * No `href`/`xlink:href` at any cost — that is what makes `<a>` and `<use>` dangerous,
 * and it is why `<use>` is absent from the element list above. No `style` either: a
 * style attribute can carry `url(...)`, and every fill/stroke property worth having is
 * available as its own presentation attribute.
 */
const ALLOWED_ATTRS = new Set([
  "d", "cx", "cy", "r", "rx", "ry", "x", "y", "x1", "y1", "x2", "y2",
  "width", "height", "points", "transform",
  "fill", "fill-rule", "fill-opacity", "stroke", "stroke-width", "stroke-linecap",
  "stroke-linejoin", "stroke-dasharray", "stroke-dashoffset", "stroke-opacity",
  "stroke-miterlimit", "opacity", "offset", "stop-color", "stop-opacity",
  "gradientunits", "gradienttransform", "clip-path", "clip-rule", "mask",
  "id", "class",
]);

/** Elements dropped with their entire subtree, rather than unwrapped. */
const DANGEROUS_ELEMENTS = [
  "script", "style", "foreignobject", "animate", "animatetransform",
  "animatemotion", "set", "use", "image", "a", "filter", "switch",
];

export interface SanitizedSvg {
  /** Inner markup only — safe to hand to `dangerouslySetInnerHTML`. */
  body: string;
  /** The coordinate system the body is drawn in, from viewBox (or width/height). */
  width: number;
  height: number;
}

/** Everything between the outer <svg …> and </svg>, plus that tag's own attributes. */
function splitOuterSvg(source: string): { openTag: string; inner: string } {
  const open = /<svg\b[^>]*>/i.exec(source);
  if (!open) throw new Error("That file doesn't look like an SVG.");

  const close = source.toLowerCase().lastIndexOf("</svg>");
  if (close < 0) throw new Error("That SVG is missing its closing tag.");

  const start = open.index + open[0].length;
  if (close < start) throw new Error("That SVG is malformed.");

  return { openTag: open[0], inner: source.slice(start, close) };
}

/**
 * The drawing size, so `SlotIcon` can emit a viewBox that frames the art.
 *
 * viewBox wins over width/height because it is the actual coordinate system; width/height
 * may be a display size in px (or in units this app can't honour) and are only a fallback.
 * A glyph drawn 24x24 but declared 100x100 renders as a speck, so getting this right
 * matters more than it looks.
 */
function readViewBox(openTag: string): { width: number; height: number } {
  const viewBox = /viewbox\s*=\s*["']([^"']+)["']/i.exec(openTag);
  if (viewBox) {
    const parts = viewBox[1].trim().split(/[\s,]+/).map(Number);
    if (
      parts.length === 4 &&
      parts.every((n) => Number.isFinite(n)) &&
      parts[2] > 0 &&
      parts[3] > 0
    ) {
      return { width: parts[2], height: parts[3] };
    }
  }

  const width = /\bwidth\s*=\s*["']?([\d.]+)/i.exec(openTag);
  const height = /\bheight\s*=\s*["']?([\d.]+)/i.exec(openTag);
  const w = width ? Number(width[1]) : NaN;
  const h = height ? Number(height[1]) : NaN;
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return { width: w, height: h };

  // A square 24 box: the size every built-in set uses, so an SVG that declares nothing
  // lands on the same grid as the glyph it replaces rather than being rejected outright.
  return { width: 24, height: 24 };
}

/** Drops an element and everything inside it — used for <script>, <style>, <foreignObject>. */
function removeElementTree(source: string, tag: string): string {
  const paired = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi");
  const selfClosing = new RegExp(`<${tag}\\b[^>]*\\/?>`, "gi");
  return source.replace(paired, "").replace(selfClosing, "");
}

function sanitizeAttributes(rawAttrs: string): string {
  const kept: string[] = [];
  const attr = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/g;

  let match: RegExpExecArray | null;
  while ((match = attr.exec(rawAttrs)) !== null) {
    const name = match[1].toLowerCase();
    const value = match[3] ?? match[4] ?? "";

    if (!ALLOWED_ATTRS.has(name)) continue;
    // `fill="url(#x)"` is legitimate for a gradient defined in the same document, but any
    // other url() reaches outside it. Cheaper to refuse the lot than to resolve which is
    // which.
    if (/url\s*\(/i.test(value) && !/^url\(#[\w-]+\)$/i.test(value.trim())) continue;
    if (/[<>]/.test(value)) continue;

    kept.push(`${name}="${value.replace(/"/g, "&quot;")}"`);
  }

  return kept.length ? ` ${kept.join(" ")}` : "";
}

/**
 * Reduces an uploaded SVG to inlineable markup, or throws with a message fit to show
 * an admin.
 *
 * Deliberately not a general-purpose SVG sanitizer: it keeps what an *icon* needs. An
 * upload using embedded raster, external fonts or filters loses those parts, which is
 * the intended trade — the alternative is a DOM parser dependency (jsdom) on the server
 * for a feature one admin uses occasionally.
 */
export function sanitizeSvg(source: string): SanitizedSvg {
  if (!source.trim()) throw new Error("That SVG file is empty.");

  const { openTag, inner } = splitOuterSvg(source);
  const { width, height } = readViewBox(openTag);

  let body = inner;
  // Comments first: a comment can contain a stray `-->` that reopens parsing, and
  // stripping them before the element pass means no tag hides inside one.
  body = body.replace(/<!--[\s\S]*?-->/g, "").replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
  for (const tag of DANGEROUS_ELEMENTS) body = removeElementTree(body, tag);

  // Rebuild every remaining tag from the allowlist. Anything not recognised is dropped
  // tag-and-all, but its children keep being walked — so an unknown wrapper loses itself
  // rather than silently deleting the artwork inside it.
  body = body.replace(
    /<\/?([a-zA-Z][-a-zA-Z0-9:]*)((?:[^>"']|"[^"]*"|'[^']*')*)\/?>/g,
    (whole: string, rawName: string, rawAttrs: string) => {
      const name = rawName.toLowerCase();
      if (!ALLOWED_ELEMENTS.has(name)) return "";
      if (whole.startsWith("</")) return `</${name}>`;
      const attrs = sanitizeAttributes(rawAttrs);
      return whole.endsWith("/>") ? `<${name}${attrs}/>` : `<${name}${attrs}>`;
    },
  );

  body = body.replace(/>\s+</g, "><").trim();

  if (!body) throw new Error("That SVG had no drawable shapes once cleaned up.");
  return { body, width, height };
}
