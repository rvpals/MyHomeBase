// Downloads the app's webfonts into src/app/fonts/ as .woff2 files.
//
// Why this exists: the app used to load all eight families through
// `next/font/google`, which fetches them from fonts.gstatic.com *during the
// build*. `npm run build` clears .next first, so nothing was cached between
// builds and every release was gated on eight consecutive successful fetches
// through a corporate network. One hiccup aborted `publish:nas` with
// "next/font/google queries have exactly one entry" — a resolve error that
// reads like a code bug and isn't. The fonts are committed now and loaded with
// `next/font/local`, so a build never touches the network.
//
// This script is therefore NOT part of the build. It is the tool you run to
// populate src/app/fonts/ once, or to refresh a family later. Committing its
// output is the point.
//
// Two things about Google's CSS API that this script exists to handle, both of
// which produced silently wrong files on the first attempt:
//
//   1. `&subset=latin` IS IGNORED. The stylesheet comes back with a @font-face
//      block per subset — vietnamese, latin-ext and latin — each with its own
//      URL and its own `unicode-range`. Taking the first .woff2 per weight gets
//      you *vietnamese*: a ~1.6 KB file that renders almost no English text and
//      is not obviously wrong until you look at a rendered page. The latin
//      block is identified here by its unicode-range, not by position.
//
//   2. WEIGHTS OFTEN SHARE ONE FILE. Most of these families are variable fonts
//      now, so `wght@500;600;700` returns three @font-face blocks pointing at
//      the SAME url — one file covering the range. Saving it three times under
//      three weight-named filenames produces byte-identical duplicates and
//      implies a per-weight split that doesn't exist. When the URLs match, this
//      writes one `<slug>-variable.woff2` and reports the range.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(here, "..", "src", "app", "fonts");

// Chrome's UA. The CSS API serves .woff2 only to a UA it believes supports it;
// ask as Node and you get .ttf, which is several times larger.
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// How the `latin` subset's block is recognised. Google labels the blocks only
// in CSS comments (`/* latin */`), which are not part of any parsed structure,
// so the reliable signal is the range itself: the latin block is the one
// covering Basic Latin, U+0000-00FF. The other subsets (latin-ext starts at
// U+0100, vietnamese at U+0102) never claim it.
const LATIN_MARKER = "U+0000-00FF";

// Each family, with the weights layout.tsx actually uses. `range` is only used
// for variable families, to build the wght axis query.
const FAMILIES = [
  { family: "Space Grotesk", slug: "space-grotesk", weights: ["500", "600", "700"] },
  { family: "Sora", slug: "sora", weights: ["500", "600", "700"] },
  { family: "Familjen Grotesk", slug: "familjen-grotesk", weights: ["500", "600", "700"] },
  { family: "Manrope", slug: "manrope", axis: "200..800" },
  { family: "Inter", slug: "inter", axis: "100..900" },
  { family: "IBM Plex Mono", slug: "ibm-plex-mono", weights: ["400", "500", "600"] },
  { family: "JetBrains Mono", slug: "jetbrains-mono", weights: ["400", "500"] },
  { family: "Great Vibes", slug: "great-vibes", weights: ["400"] },
];

function cssUrl(entry) {
  const name = entry.family.replace(/ /g, "+");
  const axis = entry.axis ? `:wght@${entry.axis}` : `:wght@${entry.weights.join(";")}`;
  return `https://fonts.googleapis.com/css2?family=${name}${axis}&display=swap`;
}

async function getText(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

async function getBytes(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

// Pulls the LATIN faces out of a Google stylesheet as [{ weight, url }].
//
// Blocks for other subsets are dropped by their unicode-range. A src that isn't
// a plain .woff2 is also dropped: the API sometimes emits a redirecting
// `/l/font?kit=...` form, which is the shape Turbopack choked on, and a
// stylesheet carrying those is not something to save.
function parseLatinFaces(css) {
  const faces = [];
  for (const block of css.split("@font-face").slice(1)) {
    const weight = /font-weight:\s*([^;]+);/.exec(block)?.[1]?.trim();
    const url = /src:\s*url\(([^)]+)\)/.exec(block)?.[1]?.trim();
    const range = /unicode-range:\s*([^;]+);/.exec(block)?.[1] ?? "";
    if (!weight || !url) continue;
    if (!url.endsWith(".woff2")) continue;
    if (!range.includes(LATIN_MARKER)) continue;
    faces.push({ weight, url });
  }
  return faces;
}

function writeFile(name, bytes) {
  fs.writeFileSync(path.join(OUT_DIR, name), bytes);
  console.log(`  ${name.padEnd(32)} ${(bytes.length / 1024).toFixed(1)} KB`);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let count = 0;

  for (const entry of FAMILIES) {
    const url = cssUrl(entry);
    const faces = parseLatinFaces(await getText(url));
    if (faces.length === 0) {
      throw new Error(
        `No latin .woff2 face found for ${entry.family}. Google served a stylesheet ` +
          `this script could not read — inspect ${url} by hand before retrying.`,
      );
    }

    // Declared variable (no weight list), or every requested weight resolved to
    // the same file? Either way it is one variable file, stored once.
    const urls = new Set(faces.map((f) => f.url));
    if (entry.axis || urls.size === 1) {
      const weights = faces.map((f) => f.weight).join(", ");
      writeFile(`${entry.slug}-variable.woff2`, await getBytes(faces[0].url));
      console.log(`      ^ one variable file covering: ${weights}`);
      count += 1;
      continue;
    }

    // Genuinely separate static files, one per weight. Matched by the
    // stylesheet's own font-weight rather than by position, so a reordered
    // response cannot mislabel a file.
    for (const weight of entry.weights) {
      const face = faces.find((f) => f.weight === weight);
      if (!face) {
        throw new Error(`${entry.family} weight ${weight} missing from Google's stylesheet.`);
      }
      writeFile(`${entry.slug}-${weight}.woff2`, await getBytes(face.url));
      count += 1;
    }
  }

  console.log(`\n${count} files in src/app/fonts/. Commit them.`);
}

main().catch((error) => {
  console.error(`\nfetch-fonts failed: ${error.message}`);
  process.exit(1);
});
