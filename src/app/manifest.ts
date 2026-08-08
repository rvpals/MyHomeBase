import type { MetadataRoute } from "next";
import { DEFAULT_COLOR_THEME_ID, getColorTheme, getSetting } from "@/lib/settings";
import { deps } from "@/lib/wiring";

// The web-app manifest, which is what lets the app be installed to a phone's
// home screen and launch without browser chrome.
//
// Dynamic rather than a static public/manifest.json so the splash screen and
// status bar match the **active colour theme** — the app already lets you swap
// themes at runtime, and a manifest hardcoding one would flash the wrong colour
// on every launch.
//
// Installation needs a secure context, so this only does anything over HTTPS —
// see INSTRUCTION_SETUP_SYNOLOGY.md for the DSM certificate and reverse proxy.
// On iOS, "Add to Home Screen" works regardless and uses apple-touch-icon.png
// plus the `appleWebApp` metadata in layout.tsx.
export default function manifest(): MetadataRoute.Manifest {
  const appName = getSetting(deps.settingsRepo, "application_name")?.value ?? "MyHomeBase";
  const themeId = getSetting(deps.settingsRepo, "color_theme")?.value ?? DEFAULT_COLOR_THEME_ID;
  const theme = getColorTheme(themeId);

  return {
    name: appName,
    short_name: appName,
    description: "Your household's records: investments, spending, journal and analysis.",
    // Straight to the dashboard. The login redirect handles an expired session.
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: theme.tokens.paper,
    theme_color: theme.tokens.paper,
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Separate maskable entry: Android crops icons to its own shape, and an
      // "any" icon used as a mask loses its edges. This one has the safe-zone
      // padding baked in.
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
