import type { SplashDevice, SplashImage } from "./types";

// iOS launch ("startup") images. iOS ignores the manifest's background_color and
// does not generate a launch screen the way Android does, so an installed app
// flashes white before first paint unless we supply a real image per device
// resolution. Each entry must match a device's exact logical size and DPR or
// iOS silently ignores it.
//
// Keep this list in sync with DEVICES in scripts/gen-splash.mjs — that script
// writes the PNGs these entries point at. Adding a device here without
// re-running the generator produces a 404, not a fallback.
export const SPLASH_DEVICES: SplashDevice[] = [
  { width: 440, height: 956, dpr: 3 }, // iPhone 16 Pro Max / 15 Pro Max
  { width: 402, height: 874, dpr: 3 }, // iPhone 16 Pro
  { width: 430, height: 932, dpr: 3 }, // iPhone 15 Plus / 14 Pro Max
  { width: 393, height: 852, dpr: 3 }, // iPhone 15 / 14 Pro
  { width: 390, height: 844, dpr: 3 }, // iPhone 14 / 13 / 12
  { width: 375, height: 812, dpr: 3 }, // iPhone 13 mini / X / XS
  { width: 428, height: 926, dpr: 3 }, // iPhone 14 Plus / 13 Pro Max
  { width: 414, height: 896, dpr: 2 }, // iPhone 11 / XR
  { width: 375, height: 667, dpr: 2 }, // iPhone SE
  { width: 834, height: 1194, dpr: 2 }, // iPad Pro 11"
  { width: 1024, height: 1366, dpr: 2 }, // iPad Pro 12.9"
  { width: 820, height: 1180, dpr: 2 }, // iPad Air
];

export function splashImageFileName(
  device: SplashDevice,
  orientation: "portrait" | "landscape",
): string {
  return `splash-${device.width}x${device.height}@${device.dpr}x-${orientation}.png`;
}

// The `media` query iOS matches against. Both orientations are listed for every
// device because iOS picks per launch, and a missing landscape image falls back
// to the white flash rather than to the portrait one.
export function splashMediaQuery(
  device: SplashDevice,
  orientation: "portrait" | "landscape",
): string {
  return [
    `(device-width: ${device.width}px)`,
    `(device-height: ${device.height}px)`,
    `(-webkit-device-pixel-ratio: ${device.dpr})`,
    `(orientation: ${orientation})`,
  ].join(" and ");
}

// Flattens the device table into the href/media pairs the layout renders as
// <link rel="apple-touch-startup-image"> tags.
export function listSplashImages(devices: SplashDevice[] = SPLASH_DEVICES): SplashImage[] {
  const orientations: ("portrait" | "landscape")[] = ["portrait", "landscape"];
  return devices.flatMap((device) =>
    orientations.map((orientation) => ({
      href: `/splash/${splashImageFileName(device, orientation)}`,
      media: splashMediaQuery(device, orientation),
    })),
  );
}
