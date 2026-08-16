// Regenerates public/splash/*.png — the iOS launch ("startup") images.
//
//   node scripts/gen-splash.mjs   (or: npm run gen:splash)
//
// iOS ignores the web-app manifest's background_color and does not generate a
// launch screen the way Android does. Without these images an installed app
// shows a white flash before the first paint. Each image must match a device's
// exact pixel resolution or iOS silently ignores it, which is why this is a
// generated set rather than one scaled asset.
//
// The background is a FIXED colour, deliberately: the app's themes are
// swappable at runtime but these PNGs are static, so they cannot follow the
// active theme. We use the default theme's `paper` (Signal Deck, #12161A) —
// six of the eight themes are dark, so this reads correctly for most of them
// and exactly for the default. Re-run this if that default ever changes.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(root, "public", "icon-512.png");
const OUT_DIR = path.join(root, "public", "splash");

// Must stay in sync with DEFAULT_COLOR_THEME_ID's `paper` in
// src/lib/settings/themes.ts. See the note above before changing.
const BACKGROUND = "#12161A";

// Logical size + DPR per device family, which is what the `media` query in the
// <link> tag matches on; the PNG itself is width*dpr by height*dpr. Covers the
// iPhone and iPad families still receiving iOS updates. A device not listed
// falls back to a plain background_color flash — no worse than today.
const DEVICES = [
  { w: 440, h: 956, dpr: 3 }, // iPhone 16 Pro Max / 15 Pro Max
  { w: 402, h: 874, dpr: 3 }, // iPhone 16 Pro
  { w: 430, h: 932, dpr: 3 }, // iPhone 15 Plus / 14 Pro Max
  { w: 393, h: 852, dpr: 3 }, // iPhone 15 / 14 Pro
  { w: 390, h: 844, dpr: 3 }, // iPhone 14 / 13 / 12
  { w: 375, h: 812, dpr: 3 }, // iPhone 13 mini / X / XS
  { w: 428, h: 926, dpr: 3 }, // iPhone 14 Plus / 13 Pro Max
  { w: 414, h: 896, dpr: 2 }, // iPhone 11 / XR
  { w: 375, h: 667, dpr: 2 }, // iPhone SE
  { w: 834, h: 1194, dpr: 2 }, // iPad Pro 11"
  { w: 1024, h: 1366, dpr: 2 }, // iPad Pro 12.9"
  { w: 820, h: 1180, dpr: 2 }, // iPad Air
];

// Fraction of the shorter edge the logo occupies. Matches the restrained
// proportion Android's generated splash uses rather than filling the screen.
const LOGO_RATIO = 0.32;

function name(device, orientation) {
  return `splash-${device.w}x${device.h}@${device.dpr}x-${orientation}.png`;
}

// The <link> tags to paste into layout.tsx. Printed rather than written so the
// metadata stays reviewable in source instead of being generated at build time.
function linkTag(device, orientation) {
  const media =
    `(device-width: ${device.w}px) and (device-height: ${device.h}px) ` +
    `and (-webkit-device-pixel-ratio: ${device.dpr}) ` +
    `and (orientation: ${orientation})`;
  return `<link rel="apple-touch-startup-image" media="${media}" href="/splash/${name(device, orientation)}" />`;
}

async function render(device, orientation) {
  const pxW = (orientation === "portrait" ? device.w : device.h) * device.dpr;
  const pxH = (orientation === "portrait" ? device.h : device.w) * device.dpr;
  const logo = Math.round(Math.min(pxW, pxH) * LOGO_RATIO);

  const resized = await sharp(SOURCE).resize(logo, logo, { fit: "contain" }).toBuffer();

  await sharp({
    create: {
      width: pxW,
      height: pxH,
      channels: 4,
      background: BACKGROUND,
    },
  })
    .composite([{ input: resized, gravity: "centre" }])
    .png()
    .toFile(path.join(OUT_DIR, name(device, orientation)));
}

async function main() {
  if (!fs.existsSync(SOURCE)) {
    throw new Error(`Missing source icon: ${SOURCE}`);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const tags = [];
  for (const device of DEVICES) {
    for (const orientation of ["portrait", "landscape"]) {
      await render(device, orientation);
      tags.push(linkTag(device, orientation));
    }
  }

  console.log(`Wrote ${tags.length} images to public/splash/\n`);
  console.log("Link tags for src/app/layout.tsx:\n");
  console.log(tags.join("\n"));
}

await main();
