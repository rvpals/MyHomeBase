// Regenerates the baked SVG glyph bodies for the selectable icon sets
// (Admin > Configuration > Icons). Writes two files:
//
//   src/components/module-icon-sets.generated.ts  — the 13 module concepts (toolbar,
//                                                   module cards, sidebar badge)
//   src/components/tree-icon-sets.generated.ts    — the module tree-nav section icons
//
//   node scripts/gen-icon-glyphs.mjs   (or: npm run gen:icons)
//
// Pulls authentic icon data from the @iconify-json/* devDependencies at build time so the
// app carries no runtime icon dependency. Keep the set ids here in sync with ICON_SETS in
// src/lib/settings/icon-sets.ts. To add/replace a glyph, adjust the candidate map below
// (a keyword fallback catches anything not explicitly named) and re-run.
//
// The two glyph tables differ in how a miss is treated. A missing *module* concept is
// fatal — every set must cover all 13, since the toolbar has no other artwork to show. A
// missing *tree* concept is only a warning: TreeIcon falls back to its hand-drawn glyph
// in tree-icons.tsx, which is the right answer for the handful of concepts a set genuinely
// lacks (flat-color-icons has no paperclip, for one). Candidates below are named
// explicitly and were each checked against the installed packages; the keyword fallback is
// a safety net, not the plan — left to itself it picks things like "school-bus-side" for a
// classroom, which is worse than the hand-drawn icon it would replace.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const load = (pkg) => require(`${pkg}/icons.json`);

const RAW = {
  lucide: load("@iconify-json/lucide"),
  tabler: load("@iconify-json/tabler"),
  ms: load("@iconify-json/material-symbols"),
  mingcute: load("@iconify-json/mingcute"),
  ph: load("@iconify-json/ph"),
  solar: load("@iconify-json/solar"),
  hugeicons: load("@iconify-json/hugeicons"),
  streamlineColor: load("@iconify-json/streamline-color"),
  fc: load("@iconify-json/flat-color-icons"),
  fluentFlat: load("@iconify-json/fluent-emoji-flat"),
  fluent3d: load("@iconify-json/fluent-emoji"),
};

// The 14 module concepts (matches ModuleIconName in src/lib/modules).
const CONCEPTS = ["building", "home", "briefcase", "wallet", "chart", "folder", "shield", "heart", "book", "tool", "journal", "roster", "music", "game"];

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
    journal: ["notebook", "journal", "diary", "quill", "book"], roster: ["checklist", "list-check", "clipboard", "task"],
    music: ["music-note", "musical-note", "music", "note-music"],
    game: ["gamepad", "game-controller", "videogame", "esports", "joystick", "controller", "game"],
  }[c];
}

const CAND = {
  lucide: { building: ["building-2"], home: ["house", "home"], briefcase: ["briefcase"], wallet: ["wallet"], chart: ["bar-chart-3", "chart-column"], folder: ["folder"], shield: ["shield-check"], heart: ["heart"], book: ["book-open"], tool: ["wrench"], journal: ["notebook-pen"], roster: ["clipboard-list"], music: ["music", "music-4"], game: ["gamepad-2", "gamepad"], magic: ["wand-sparkles", "wand"], player: ["turntable", "disc-3"] },
  // Names below were checked against the installed packages — tabler has no
  // "wrench" (it's "tools"), and mingcute's are all "-fill" suffixed.
  tabler: { building: ["building"], home: ["home"], briefcase: ["briefcase"], wallet: ["wallet"], chart: ["chart-bar"], folder: ["folder"], shield: ["shield-check"], heart: ["heart"], book: ["book"], tool: ["tools"], journal: ["notebook"], roster: ["checklist"], music: ["music"], game: ["device-gamepad-2", "device-gamepad"], magic: ["wand"], player: ["vinyl", "disc"] },
  // Material Symbols' unsuffixed names are the filled variants ("-outline" is the
  // outline), which is the point of adding this set.
  ms: { building: ["apartment"], home: ["home"], briefcase: ["work", "business-center"], wallet: ["wallet"], chart: ["bar-chart"], folder: ["folder"], shield: ["shield"], heart: ["favorite"], book: ["book-2"], tool: ["build", "handyman"], journal: ["history-edu"], roster: ["checklist"], music: ["music-note", "library-music"], game: ["sports-esports", "videogame-asset"] },
  mingcute: { building: ["building-2-fill"], home: ["home-3-fill"], briefcase: ["briefcase-fill"], wallet: ["wallet-fill"], chart: ["chart-bar-fill"], folder: ["folder-fill"], shield: ["shield-fill"], heart: ["heart-fill"], book: ["book-2-fill"], tool: ["tool-fill"], journal: ["book-4-fill", "book-2-fill"], roster: ["task-2-fill"], music: ["music-2-fill", "music-fill"], game: ["game-2-fill", "game-1-fill"], magic: ["magic-hat-fill", "magic-1-fill"], player: ["disc-fill", "album-fill"] },
  ph: (c) => [`${{ building: "buildings", home: "house", briefcase: "briefcase", wallet: "wallet", chart: "chart-bar", folder: "folder", shield: "shield-check", heart: "heart", book: "book-open", tool: "wrench", journal: "notebook", roster: "list-checks", music: "music-notes", game: "game-controller" }[c]}-duotone`],
  solarLine: (c) => ({ building: ["buildings-2-line-duotone"], home: ["home-2-line-duotone", "home-line-duotone"], briefcase: ["case-line-duotone"], wallet: ["wallet-line-duotone"], chart: ["chart-2-line-duotone"], folder: ["folder-line-duotone"], shield: ["shield-check-line-duotone"], heart: ["heart-line-duotone"], book: ["book-2-line-duotone", "book-line-duotone"], tool: ["settings-line-duotone", "wrench-line-duotone"], journal: ["notebook-bookmark-line-duotone", "notebook-line-duotone"], roster: ["checklist-line-duotone"], music: ["music-notes-line-duotone", "music-note-2-line-duotone"], game: ["gamepad-line-duotone", "gamepad-minimalistic-line-duotone"] }[c]),
  solarBold: (c) => ({ building: ["buildings-2-bold-duotone"], home: ["home-2-bold-duotone", "home-bold-duotone"], briefcase: ["case-bold-duotone"], wallet: ["wallet-bold-duotone"], chart: ["chart-2-bold-duotone"], folder: ["folder-bold-duotone"], shield: ["shield-check-bold-duotone"], heart: ["heart-bold-duotone"], book: ["book-2-bold-duotone", "book-bold-duotone"], tool: ["settings-bold-duotone", "wrench-bold-duotone"], journal: ["notebook-bookmark-bold-duotone", "notebook-bold-duotone"], roster: ["checklist-bold-duotone"], music: ["music-notes-bold-duotone", "music-note-2-bold-duotone"], game: ["gamepad-bold-duotone", "gamepad-minimalistic-bold-duotone"] }[c]),
  hugeicons: { building: ["building-03", "building-06"], home: ["home-01", "home-04"], briefcase: ["briefcase-01"], wallet: ["wallet-01", "wallet-02"], chart: ["analytics-01", "chart-histogram"], folder: ["folder-01"], shield: ["shield-01"], heart: ["favourite-square", "favourite"], book: ["book-01", "notebook-01"], tool: ["wrench-01", "tools"], journal: ["notebook-02", "notebook-01"], roster: ["check-list"], music: ["music-note-01", "music-note-02"], game: ["game-controller-01", "gamepad"], magic: ["magic-wand-01", "magic-wand-02"], player: ["disc-3", "record"] },
  streamlineColor: { building: ["building-2"], home: ["home-4", "home-3"], briefcase: ["briefcase-dollar", "briefcase"], wallet: ["wallet", "money-wallet"], chart: ["graph-bar-increase"], folder: ["folder-check", "folder-add"], shield: ["shield-check", "shield-1"], heart: ["heart", "love-it"], book: ["book-reading", "book-1", "read-1"], tool: ["tools-wench-screwdriver", "wench-1", "settings-slider"], journal: ["book-reading"], roster: ["task-list"], music: ["music-note-2", "music-note-1"], game: ["controller", "controller-1"] },
  fc: { building: ["org-unit", "home"], home: ["home"], briefcase: ["business", "portfolio"], wallet: ["money", "currency-exchange"], chart: ["bar-chart", "combo-chart"], folder: ["folder"], shield: ["security-checked", "privacy"], heart: ["like", "add-to-favorites"], book: ["reading", "library"], tool: ["engineering", "services", "support"], journal: ["reading-ebook", "address-book"], roster: ["todo-list"], music: ["music"], game: ["puzzle"] },
  fluentFlat: { building: ["office-building", "building-construction"], home: ["house", "house-with-garden"], briefcase: ["briefcase"], wallet: ["money-bag", "credit-card"], chart: ["bar-chart", "chart-increasing"], folder: ["file-folder", "open-file-folder"], shield: ["shield"], heart: ["red-heart", "sparkling-heart"], book: ["open-book", "books", "book"], tool: ["hammer-and-wrench", "wrench", "toolbox"], journal: ["notebook-with-decorative-cover"], roster: ["clipboard"], music: ["musical-notes", "musical-note"], game: ["video-game", "joystick"] },
  fluent3d: { building: ["office-building", "building-construction"], home: ["house", "house-with-garden"], briefcase: ["briefcase"], wallet: ["money-bag", "credit-card"], chart: ["bar-chart", "chart-increasing"], folder: ["file-folder", "open-file-folder"], shield: ["shield"], heart: ["red-heart", "sparkling-heart"], book: ["open-book", "books", "book"], tool: ["hammer-and-wrench", "wrench", "toolbox"], journal: ["notebook-with-decorative-cover"], roster: ["clipboard"], music: ["musical-notes", "musical-note"], game: ["video-game", "joystick"] },
};

/* ---------------------------------------------------------------------------------------
   Tree-nav section icons. These are the keys in TREE_ICONS (src/components/tree-icons.tsx)
   that name a *place* in a module nav. The row-action glyphs in that same registry —
   pencil, trash, refresh — are deliberately absent: they are buttons, not destinations, and
   full-color artwork on an inline delete button both shouts and weakens the destructive
   read. They stay hand-drawn and monochrome.
--------------------------------------------------------------------------------------- */
const TREE_CONCEPTS = [
  "grid", "list", "history", "database", "stock-quote", "chart", "upload", "sliders", "gear",
  "classroom", "users", "newspaper", "plus", "quote", "window", "palette", "info", "shapes",
  "note", "clip", "shield", "magic", "player",
];

function treeKw(c) {
  return {
    grid: ["grid", "dashboard", "layout"], list: ["list"], history: ["history", "clock"],
    database: ["database", "server"], "stock-quote": ["stock", "trend", "chart-line", "graph"],
    chart: ["chart", "graph", "analytic"], upload: ["upload"],
    sliders: ["slider", "tune", "adjust", "equalizer"], gear: ["settings", "gear", "cog"],
    classroom: ["school", "board", "presentation"], users: ["users", "people", "group"],
    newspaper: ["newspaper", "news"], plus: ["plus", "add"], quote: ["quote"],
    window: ["window", "browser", "app"], palette: ["palette", "paint", "color"],
    info: ["info"], shapes: ["shapes", "shape"], note: ["note", "sticky"],
    clip: ["clip", "attach"], shield: ["shield", "security"],
    magic: ["magic", "wand", "hat"], player: ["turntable", "vinyl", "gramophone", "disc"],
  }[c];
}

// Keyed by set *id*, not raw source: solar-line-duotone and solar-bold-duotone both read
// from the same package but need different glyph names.
const TREE_CAND = {
  lucide: { grid: ["layout-grid"], list: ["list"], history: ["history"], database: ["database"], "stock-quote": ["trending-up"], chart: ["bar-chart-3", "chart-column"], upload: ["upload"], sliders: ["sliders-horizontal"], gear: ["settings"], classroom: ["presentation"], users: ["users"], newspaper: ["newspaper"], plus: ["plus"], quote: ["quote"], window: ["app-window"], palette: ["palette"], info: ["info"], shapes: ["shapes"], note: ["sticky-note"], clip: ["paperclip"], shield: ["shield-check"] },
  tabler: { grid: ["layout-grid"], list: ["list"], history: ["history"], database: ["database"], "stock-quote": ["trending-up"], chart: ["chart-bar"], upload: ["upload"], sliders: ["adjustments-horizontal"], gear: ["settings"], classroom: ["presentation"], users: ["users"], newspaper: ["news"], plus: ["plus"], quote: ["quote"], window: ["app-window"], palette: ["palette"], info: ["info-circle"], shapes: ["shape"], note: ["note"], clip: ["paperclip"], shield: ["shield-check"] },
  "material-symbols": { grid: ["grid-view"], list: ["list"], history: ["history"], database: ["database"], "stock-quote": ["trending-up"], chart: ["bar-chart"], upload: ["upload"], sliders: ["tune"], gear: ["settings"], classroom: ["co-present"], users: ["group"], newspaper: ["newspaper"], plus: ["add"], quote: ["format-quote"], window: ["web-asset"], palette: ["palette"], info: ["info"], shapes: ["shapes"], note: ["sticky-note-2"], clip: ["attach-file"], shield: ["shield"], magic: ["wand-stars", "auto-awesome"], player: ["album", "radio"] },
  // mingcute has no "window"/"sticky-note" (they are "windows-fill"/"notebook-fill"), and
  // its only "*shape*" match is shield-shaped — hence the explicit names.
  mingcute: { grid: ["grid-fill"], list: ["list-check-fill"], history: ["history-fill"], database: ["server-fill"], "stock-quote": ["trending-up-fill"], chart: ["chart-bar-fill"], upload: ["upload-2-fill"], sliders: ["settings-5-fill"], gear: ["settings-3-fill"], classroom: ["presentation-1-fill"], users: ["group-fill"], newspaper: ["news-fill"], plus: ["add-fill"], quote: ["quote-left-fill"], window: ["windows-fill"], palette: ["palette-fill"], info: ["information-fill"], shapes: ["shapes-fill", "triangle-fill"], note: ["notebook-fill"], clip: ["attachment-fill"], shield: ["shield-fill"] },
  "phosphor-duotone": { grid: ["squares-four-duotone"], list: ["list-duotone"], history: ["clock-counter-clockwise-duotone"], database: ["database-duotone"], "stock-quote": ["trend-up-duotone"], chart: ["chart-bar-duotone"], upload: ["upload-simple-duotone"], sliders: ["sliders-horizontal-duotone"], gear: ["gear-six-duotone"], classroom: ["presentation-chart-duotone"], users: ["users-three-duotone"], newspaper: ["newspaper-duotone"], plus: ["plus-duotone"], quote: ["quotes-duotone"], window: ["app-window-duotone"], palette: ["palette-duotone"], info: ["info-duotone"], shapes: ["shapes-duotone"], note: ["note-duotone"], clip: ["paperclip-duotone"], shield: ["shield-check-duotone"], magic: ["magic-wand-duotone"], player: ["vinyl-record-duotone", "disc-duotone"] },
  "solar-line-duotone": { grid: ["widget-4-line-duotone"], list: ["list-line-duotone"], history: ["history-line-duotone"], database: ["server-square-line-duotone"], "stock-quote": ["graph-up-line-duotone"], chart: ["chart-2-line-duotone"], upload: ["upload-line-duotone"], sliders: ["tuning-2-line-duotone"], gear: ["settings-line-duotone"], classroom: ["presentation-graph-line-duotone"], users: ["users-group-rounded-line-duotone"], newspaper: ["notes-line-duotone"], plus: ["add-circle-line-duotone"], quote: ["chat-square-like-line-duotone"], window: ["window-frame-line-duotone"], palette: ["palette-line-duotone"], info: ["info-circle-line-duotone"], shapes: ["widget-line-duotone"], note: ["notes-minimalistic-line-duotone"], clip: ["paperclip-line-duotone"], shield: ["shield-check-line-duotone"], magic: ["magic-stick-3-line-duotone"], player: ["turntable-line-duotone"] },
  "solar-bold-duotone": { grid: ["widget-4-bold-duotone"], list: ["list-bold-duotone"], history: ["history-bold-duotone"], database: ["server-square-bold-duotone"], "stock-quote": ["graph-up-bold-duotone"], chart: ["chart-2-bold-duotone"], upload: ["upload-bold-duotone"], sliders: ["tuning-2-bold-duotone"], gear: ["settings-bold-duotone"], classroom: ["presentation-graph-bold-duotone"], users: ["users-group-rounded-bold-duotone"], newspaper: ["notes-bold-duotone"], plus: ["add-circle-bold-duotone"], quote: ["chat-square-like-bold-duotone"], window: ["window-frame-bold-duotone"], palette: ["palette-bold-duotone"], info: ["info-circle-bold-duotone"], shapes: ["widget-bold-duotone"], note: ["notes-minimalistic-bold-duotone"], clip: ["paperclip-bold-duotone"], shield: ["shield-check-bold-duotone"], magic: ["magic-stick-3-bold-duotone"], player: ["turntable-bold-duotone"] },
  hugeicons: { grid: ["dashboard-square-01", "grid"], list: ["list-view"], history: ["clock-01"], database: ["database"], "stock-quote": ["chart-up", "trade-up"], chart: ["chart-histogram", "analytics-01"], upload: ["upload-01"], sliders: ["preference-horizontal", "filter-horizontal"], gear: ["settings-01"], classroom: ["presentation-01", "teaching-01"], users: ["user-group", "user-multiple"], newspaper: ["news", "newspaper-01"], plus: ["plus-sign"], quote: ["quote-down", "quote-up"], window: ["application-01", "browser"], palette: ["color-picker", "paint-board"], info: ["information-circle"], shapes: ["shapes"], note: ["sticky-note-01", "note-01"], clip: ["attachment-01", "paper-clip"], shield: ["shield-01"] },
  "streamline-color": { grid: ["dashboard-3", "layout-module"], list: ["list-bullets", "task-list"], history: ["square-clock", "circle-clock"], database: ["database", "server-2"], "stock-quote": ["graph-arrow-increase", "graph-bar-increase"], chart: ["graph-bar-increase", "pie-chart"], upload: ["upload-box-1", "cloud-upload"], sliders: ["vertical-slider-square", "settings-slider"], gear: ["cog", "settings"], classroom: ["class-lesson"], users: ["user-multiple-group", "users"], newspaper: ["news-paper", "newspaper"], plus: ["add-1", "add-circle"], quote: ["quotation-2"], window: ["layout-window-1", "browser-window"], palette: ["color-palette", "paint-palette"], info: ["information-circle", "help-circle"], shapes: ["pyramid-shape", "cone-shape"], note: ["new-sticky-note", "blank-notepad"], clip: ["paperclip-1"], shield: ["shield-check", "shield-1"], magic: ["magic-wand-2"], player: ["gramophone"] },
  // flat-color-icons is a 329-icon corporate set and simply lacks some of these concepts.
  // "clip" resolves to nothing paperclip-like, so it is left to fall back to hand-drawn.
  "flat-color": { grid: ["grid"], list: ["todo-list"], history: ["clock"], database: ["data-sheet"], "stock-quote": ["line-chart", "positive-dynamic"], chart: ["bar-chart"], upload: ["upload"], sliders: ["data-configuration"], gear: ["settings"], classroom: ["voice-presentation"], users: ["conference-call"], newspaper: ["news"], plus: ["plus"], quote: ["comments"], window: ["template"], palette: ["picture"], info: ["about"], shapes: ["tree-structure"], note: ["survey"], clip: [], shield: ["privacy"], magic: ["idea"], player: ["music", "audio-file"] },
  // The two Fluent Emoji sets are emoji, not an icon system — the nearest match for an
  // abstract concept is a literal object (a file box for a database, an out-tray for
  // upload, knobs for sliders). Semantically loose, but consistent with what these sets
  // already do for the module toolbar.
  "fluent-flat": { grid: ["card-index-dividers"], list: ["clipboard"], history: ["watch", "stopwatch"], database: ["file-cabinet", "card-file-box"], "stock-quote": ["chart-increasing"], chart: ["bar-chart"], upload: ["outbox-tray"], sliders: ["control-knobs"], gear: ["gear"], classroom: ["teacher"], users: ["busts-in-silhouette"], newspaper: ["newspaper"], plus: ["plus"], quote: ["left-speech-bubble"], window: ["window"], palette: ["artist-palette"], info: ["information"], shapes: ["puzzle-piece"], note: ["memo"], clip: ["paperclip"], shield: ["shield"], magic: ["magic-wand", "top-hat"], player: ["optical-disk", "studio-microphone"] },
  "fluent-3d": { grid: ["card-index-dividers"], list: ["clipboard"], history: ["watch", "stopwatch"], database: ["file-cabinet", "card-file-box"], "stock-quote": ["chart-increasing"], chart: ["bar-chart"], upload: ["outbox-tray"], sliders: ["control-knobs"], gear: ["gear"], classroom: ["teacher"], users: ["busts-in-silhouette"], newspaper: ["newspaper"], plus: ["plus"], quote: ["left-speech-bubble"], window: ["window"], palette: ["artist-palette"], info: ["information"], shapes: ["puzzle-piece"], note: ["memo"], clip: ["paperclip"], shield: ["shield"], magic: ["magic-wand", "top-hat"], player: ["optical-disk", "studio-microphone"] },
};

// setId -> raw source + colorful flag + candidate resolver. "classic" is rendered by the
// hand-drawn components in module-icons.tsx, so it has no baked glyphs here.
const SETS = [
  { id: "classic", raw: null, colorful: false },
  { id: "lucide", raw: "lucide", colorful: false, cand: (c) => CAND.lucide[c] },
  { id: "tabler", raw: "tabler", colorful: false, cand: (c) => CAND.tabler[c] },
  { id: "material-symbols", raw: "ms", colorful: false, cand: (c) => CAND.ms[c] },
  { id: "mingcute", raw: "mingcute", colorful: false, cand: (c) => CAND.mingcute[c] },
  { id: "phosphor-duotone", raw: "ph", colorful: false, cand: (c) => CAND.ph(c) },
  { id: "solar-line-duotone", raw: "solar", colorful: false, cand: (c) => CAND.solarLine(c) },
  { id: "solar-bold-duotone", raw: "solar", colorful: false, cand: (c) => CAND.solarBold(c) },
  { id: "hugeicons", raw: "hugeicons", colorful: false, cand: (c) => CAND.hugeicons[c] },
  { id: "streamline-color", raw: "streamlineColor", colorful: true, cand: (c) => CAND.streamlineColor[c] },
  { id: "flat-color", raw: "fc", colorful: true, cand: (c) => CAND.fc[c] },
  { id: "fluent-flat", raw: "fluentFlat", colorful: true, cand: (c) => CAND.fluentFlat[c] },
  { id: "fluent-3d", raw: "fluent3d", colorful: true, cand: (c) => CAND.fluent3d[c] },
];

/**
 * Bakes one glyph table: every set x every concept, resolved through that set's candidate
 * list then the keyword net. Returns the table plus whatever it could not resolve, and
 * lets the caller decide whether a miss is fatal.
 */
function bake(concepts, candFor, kwFor) {
  const table = {};
  const misses = [];
  for (const set of SETS) {
    if (!set.raw) continue;
    table[set.id] = {};
    for (const c of concepts) {
      const name = pick(set.raw, candFor(set, c), kwFor(c));
      if (!name) { misses.push(`${set.id} / ${c}`); continue; }
      const ic = RAW[set.raw].icons[name];
      table[set.id][c] = { body: ic.body, w: ic.width || RAW[set.raw].width || 24, h: ic.height || RAW[set.raw].height || 24 };
    }
  }
  return { table, misses };
}

const setIdUnion = SETS.map((s) => `  | "${s.id}"`).join("\n");
const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/components");

function write(file, body) {
  const out = path.join(outDir, file);
  fs.writeFileSync(out, body);
  console.log(`Wrote ${out} (${(body.length / 1024).toFixed(1)} KB)`);
}

/* --- Module concepts: every set must cover all of them, so a miss is fatal. --- */
const modules = bake(CONCEPTS, (set, c) => set.cand(c), kw);
if (modules.misses.length) {
  console.error("MISSING MODULE GLYPHS:", modules.misses.join("; "));
  process.exit(1);
}

write(
  "module-icon-sets.generated.ts",
  `// AUTO-GENERATED by scripts/gen-icon-glyphs.mjs — do not edit by hand.
// Glyph bodies for the selectable module icon sets, baked from Iconify at build time.
// "classic" is not here; it is rendered by the hand-drawn components in module-icons.tsx.
// Monochrome sets use currentColor (theme-tinted); colorful sets carry their own fills.

export interface Glyph { body: string; w: number; h: number }
export type ModuleIconSetId =
${setIdUnion};

export const MODULE_ICON_GLYPHS: Partial<Record<ModuleIconSetId, Record<string, Glyph>>> = ${JSON.stringify(modules.table, null, 2)};
`,
);

/* --- Tree-nav concepts: a miss falls back to the hand-drawn glyph, so only warn. --- */
const tree = bake(TREE_CONCEPTS, (set, c) => TREE_CAND[set.id]?.[c], treeKw);
if (tree.misses.length) {
  console.warn(`Tree glyphs falling back to hand-drawn (${tree.misses.length}): ${tree.misses.join("; ")}`);
}

write(
  "tree-icon-sets.generated.ts",
  `// AUTO-GENERATED by scripts/gen-icon-glyphs.mjs — do not edit by hand.
// Glyph bodies for the module tree-nav section icons, baked from Iconify at build time.
// Keyed by the same set ids as MODULE_ICON_GLYPHS, so a reader's chosen icon set applies to
// the section nav as well as the module toolbar.
//
// Not every set covers every concept — TreeIcon falls back to the hand-drawn glyph in
// tree-icons.tsx for anything missing here, which is also where the row-action glyphs
// (pencil, trash, refresh) live permanently.

import type { Glyph, ModuleIconSetId } from "./module-icon-sets.generated";

export const TREE_ICON_GLYPHS: Partial<Record<ModuleIconSetId, Record<string, Glyph>>> = ${JSON.stringify(tree.table, null, 2)};
`,
);

console.log(`${SETS.length - 1} sets x ${CONCEPTS.length} module + ${TREE_CONCEPTS.length} tree concepts`);
