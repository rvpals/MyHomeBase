// Regenerates src/components/module-icon-sets.generated.ts — the baked SVG glyph bodies
// for the selectable module icon sets (Admin > Configuration > Icons).
//
//   node scripts/gen-icon-glyphs.mjs   (or: npm run gen:icons)
//
// Pulls authentic icon data from the @iconify-json/* devDependencies at build time so the
// app carries no runtime icon dependency. Keep the set ids here in sync with ICON_SETS in
// src/lib/settings/icon-sets.ts. To add/replace a glyph, adjust the candidate map below
// (a keyword fallback catches anything not explicitly named) and re-run.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const load = (pkg) => require(`${pkg}/icons.json`);

const RAW = {
  lucide: load("@iconify-json/lucide"),
  ph: load("@iconify-json/ph"),
  solar: load("@iconify-json/solar"),
  hugeicons: load("@iconify-json/hugeicons"),
  streamlineColor: load("@iconify-json/streamline-color"),
  fc: load("@iconify-json/flat-color-icons"),
  fluentFlat: load("@iconify-json/fluent-emoji-flat"),
  fluent3d: load("@iconify-json/fluent-emoji"),
};

// The 10 module concepts (matches ModuleIconName in src/lib/modules).
const CONCEPTS = ["building", "home", "briefcase", "wallet", "chart", "folder", "shield", "heart", "book", "tool"];

function pick(setKey, candidates, keywords) {
  const icons = RAW[setKey].icons;
  for (const c of candidates || []) if (icons[c]) return c;
  const keys = Object.keys(icons);
  for (const kw of keywords || []) {
    const hit = keys.find((k) => k.includes(kw));
    if (hit) return hit;
  }
  return null;
}
function kw(c) {
  return {
    building: ["building", "office"], home: ["house", "home"], briefcase: ["briefcase", "business", "case"],
    wallet: ["wallet", "money"], chart: ["chart", "graph", "analytic", "statistic"], folder: ["folder"],
    shield: ["shield", "security", "privacy"], heart: ["heart", "like", "love", "favourite", "favorite"],
    book: ["book", "read", "library", "notebook"], tool: ["wrench", "tool", "hammer", "maintenance", "support"],
  }[c];
}

const CAND = {
  lucide: { building: ["building-2"], home: ["house", "home"], briefcase: ["briefcase"], wallet: ["wallet"], chart: ["bar-chart-3", "chart-column"], folder: ["folder"], shield: ["shield-check"], heart: ["heart"], book: ["book-open"], tool: ["wrench"] },
  ph: (c) => [`${{ building: "buildings", home: "house", briefcase: "briefcase", wallet: "wallet", chart: "chart-bar", folder: "folder", shield: "shield-check", heart: "heart", book: "book-open", tool: "wrench" }[c]}-duotone`],
  solarLine: (c) => ({ building: ["buildings-2-line-duotone"], home: ["home-2-line-duotone", "home-line-duotone"], briefcase: ["case-line-duotone"], wallet: ["wallet-line-duotone"], chart: ["chart-2-line-duotone"], folder: ["folder-line-duotone"], shield: ["shield-check-line-duotone"], heart: ["heart-line-duotone"], book: ["book-2-line-duotone", "book-line-duotone"], tool: ["settings-line-duotone", "wrench-line-duotone"] }[c]),
  solarBold: (c) => ({ building: ["buildings-2-bold-duotone"], home: ["home-2-bold-duotone", "home-bold-duotone"], briefcase: ["case-bold-duotone"], wallet: ["wallet-bold-duotone"], chart: ["chart-2-bold-duotone"], folder: ["folder-bold-duotone"], shield: ["shield-check-bold-duotone"], heart: ["heart-bold-duotone"], book: ["book-2-bold-duotone", "book-bold-duotone"], tool: ["settings-bold-duotone", "wrench-bold-duotone"] }[c]),
  hugeicons: { building: ["building-03", "building-06"], home: ["home-01", "home-04"], briefcase: ["briefcase-01"], wallet: ["wallet-01", "wallet-02"], chart: ["analytics-01", "chart-histogram"], folder: ["folder-01"], shield: ["shield-01"], heart: ["favourite-square", "favourite"], book: ["book-01", "notebook-01"], tool: ["wrench-01", "tools"] },
  streamlineColor: { building: ["building-2"], home: ["home-4", "home-3"], briefcase: ["briefcase-dollar", "briefcase"], wallet: ["wallet", "money-wallet"], chart: ["graph-bar-increase"], folder: ["folder-check", "folder-add"], shield: ["shield-check", "shield-1"], heart: ["heart", "love-it"], book: ["book-reading", "book-1", "read-1"], tool: ["tools-wench-screwdriver", "wench-1", "settings-slider"] },
  fc: { building: ["org-unit", "home"], home: ["home"], briefcase: ["business", "portfolio"], wallet: ["money", "currency-exchange"], chart: ["bar-chart", "combo-chart"], folder: ["folder"], shield: ["security-checked", "privacy"], heart: ["like", "add-to-favorites"], book: ["reading", "library"], tool: ["engineering", "services", "support"] },
  fluentFlat: { building: ["office-building", "building-construction"], home: ["house", "house-with-garden"], briefcase: ["briefcase"], wallet: ["money-bag", "credit-card"], chart: ["bar-chart", "chart-increasing"], folder: ["file-folder", "open-file-folder"], shield: ["shield"], heart: ["red-heart", "sparkling-heart"], book: ["open-book", "books", "book"], tool: ["hammer-and-wrench", "wrench", "toolbox"] },
  fluent3d: { building: ["office-building", "building-construction"], home: ["house", "house-with-garden"], briefcase: ["briefcase"], wallet: ["money-bag", "credit-card"], chart: ["bar-chart", "chart-increasing"], folder: ["file-folder", "open-file-folder"], shield: ["shield"], heart: ["red-heart", "sparkling-heart"], book: ["open-book", "books", "book"], tool: ["hammer-and-wrench", "wrench", "toolbox"] },
};

// setId -> raw source + colorful flag + candidate resolver. "classic" is rendered by the
// hand-drawn components in module-icons.tsx, so it has no baked glyphs here.
const SETS = [
  { id: "classic", raw: null, colorful: false },
  { id: "lucide", raw: "lucide", colorful: false, cand: (c) => CAND.lucide[c] },
  { id: "phosphor-duotone", raw: "ph", colorful: false, cand: (c) => CAND.ph(c) },
  { id: "solar-line-duotone", raw: "solar", colorful: false, cand: (c) => CAND.solarLine(c) },
  { id: "solar-bold-duotone", raw: "solar", colorful: false, cand: (c) => CAND.solarBold(c) },
  { id: "hugeicons", raw: "hugeicons", colorful: false, cand: (c) => CAND.hugeicons[c] },
  { id: "streamline-color", raw: "streamlineColor", colorful: true, cand: (c) => CAND.streamlineColor[c] },
  { id: "flat-color", raw: "fc", colorful: true, cand: (c) => CAND.fc[c] },
  { id: "fluent-flat", raw: "fluentFlat", colorful: true, cand: (c) => CAND.fluentFlat[c] },
  { id: "fluent-3d", raw: "fluent3d", colorful: true, cand: (c) => CAND.fluent3d[c] },
];

const data = {};
const misses = [];
for (const set of SETS) {
  if (!set.raw) continue;
  data[set.id] = {};
  for (const c of CONCEPTS) {
    const name = pick(set.raw, set.cand(c), kw(c));
    if (!name) { misses.push(`${set.id} / ${c}`); continue; }
    const ic = RAW[set.raw].icons[name];
    data[set.id][c] = { body: ic.body, w: ic.width || RAW[set.raw].width || 24, h: ic.height || RAW[set.raw].height || 24 };
  }
}
if (misses.length) {
  console.error("MISSING GLYPHS:", misses.join("; "));
  process.exit(1);
}

const header = `// AUTO-GENERATED by scripts/gen-icon-glyphs.mjs — do not edit by hand.
// Glyph bodies for the selectable module icon sets, baked from Iconify at build time.
// "classic" is not here; it is rendered by the hand-drawn components in module-icons.tsx.
// Monochrome sets use currentColor (theme-tinted); colorful sets carry their own fills.

export interface Glyph { body: string; w: number; h: number }
export type ModuleIconSetId =
${SETS.map((s) => `  | "${s.id}"`).join("\n")};

export const MODULE_ICON_GLYPHS: Partial<Record<ModuleIconSetId, Record<string, Glyph>>> = ${JSON.stringify(data, null, 2)};
`;

const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/components");
const out = path.join(outDir, "module-icon-sets.generated.ts");
fs.writeFileSync(out, header);
console.log(`Wrote ${out} (${(header.length / 1024).toFixed(1)} KB, ${SETS.length - 1} sets x ${CONCEPTS.length} concepts)`);
