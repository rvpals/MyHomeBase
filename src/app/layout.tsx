import type { Metadata, Viewport } from "next";
import {
  Familjen_Grotesk,
  Inter,
  IBM_Plex_Mono,
  JetBrains_Mono,
  Manrope,
  Sora,
  Space_Grotesk,
} from "next/font/google";
import { cookies } from "next/headers";
import { AppVersionWatch } from "@/components/app-version-watch";
import { IconOverrideProvider } from "@/components/icon-override-context";
import { IconSetProvider } from "@/components/icon-set-context";
import { ViewportCorrector } from "@/components/viewport-corrector";
import { ViewportProvider } from "@/components/viewport-context";
import { getAppVersion } from "@/lib/app-version";
import { resolveActiveTheme } from "@/lib/color-themes";
import { getOverrideMap } from "@/lib/icons";
import { listSplashImages } from "@/lib/pwa";
import {
  VIEWPORT_COOKIE,
  VIEWPORT_PINNED_COOKIE,
  resolveViewport,
} from "@/lib/viewport";
import type { ModuleIconSetId } from "@/components/module-icon-sets.generated";
import {
  DEFAULT_ICON_SET_ID,
  type FontKey,
  getIconSet,
  getSetting,
} from "@/lib/settings";
import { deps } from "@/lib/wiring";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const familjenGrotesk = Familjen_Grotesk({
  variable: "--font-familjen-grotesk",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

// Maps a theme's font choice to the CSS variable the matching next/font/google
// loader above exposes it under.
const FONT_VAR_MAP: Record<FontKey, string> = {
  "space-grotesk": "var(--font-space-grotesk)",
  sora: "var(--font-sora)",
  "familjen-grotesk": "var(--font-familjen-grotesk)",
  manrope: "var(--font-manrope)",
  inter: "var(--font-inter)",
  "ibm-plex-mono": "var(--font-ibm-plex-mono)",
  "jetbrains-mono": "var(--font-jetbrains-mono)",
};

function getAppName(): string {
  return getSetting(deps.settingsRepo, "application_name")?.value ?? "MyHomeBase";
}

// Themes are DATA as of migration 0076, so this reads the row rather than the code
// array. Still synchronous — better-sqlite3 is — which is what lets `generateViewport`
// and `manifest.ts` keep calling it without becoming async. `resolveActiveTheme` always
// answers: a selected id with no row falls back to the default, then to the code
// definition, so a missing or unmigrated table renders a working page.
function getActiveTheme() {
  return resolveActiveTheme(
    deps.colorThemeRepo,
    getSetting(deps.settingsRepo, "color_theme")?.value,
  );
}

function getActiveIconSet() {
  const iconSetId = getSetting(deps.settingsRepo, "icon_set")?.value ?? DEFAULT_ICON_SET_ID;
  return getIconSet(iconSetId);
}

export function generateMetadata(): Metadata {
  const appName = getAppName();
  return {
    title: appName,
    description: "Your household's records: investments, spending, journal and analysis.",
    // iOS ignores the web-app manifest for "Add to Home Screen" and reads these
    // instead — without them the app launches in a Safari tab with browser
    // chrome rather than full screen.
    appleWebApp: {
      capable: true,
      title: appName,
      statusBarStyle: "black-translucent",
    },
    icons: { apple: "/apple-touch-icon.png" },
    other: {
      // Next emits the standardised `mobile-web-app-capable`, which iOS only
      // honours from 16.4. Older iOS reads this Apple-prefixed one, and without
      // it the home-screen app opens inside Safari chrome instead of full
      // screen. Harmless everywhere else.
      "apple-mobile-web-app-capable": "yes",
    },
  };
}

// `viewport-fit=cover` lets the app paint under the notch and home indicator,
// which is what "standalone" is supposed to look like; `themeColor` tints the
// status bar to match the active theme's page background.
export function generateViewport(): Viewport {
  return {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    themeColor: getActiveTheme().tokens.paper,
  };
}

// Async because it reads the viewport cookie. The layout was already dynamic
// (it reads settings from the database), so this costs nothing.
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const theme = getActiveTheme();
  const iconSet = getActiveIconSet();
  // Scoped to the active set: an override only ever applies under the set it was
  // uploaded for, so switching sets swaps the whole map rather than filtering per render.
  const iconOverrides = getOverrideMap(deps.iconOverridesRepo, iconSet.id);

  // Which layout to draw, decided here so the very first HTML is already right
  // — no desktop-then-phone flip after hydration. Middleware seeds the cookie
  // from the User-Agent; `ViewportCorrector` below replaces that guess with the
  // measured width. Lives in the root layout, not the protected one, so /login
  // gets it too.
  const cookieStore = await cookies();
  const viewport = resolveViewport({
    cookieValue: cookieStore.get(VIEWPORT_COOKIE)?.value,
  });
  const viewportPinned = cookieStore.get(VIEWPORT_PINNED_COOKIE)?.value === "1";

  // The build serving this document, handed to `AppVersionWatch` below so an
  // installed PWA can tell — on its next foreground — that it is still running
  // JavaScript from a build the server has since replaced. Read here rather than
  // in the protected layout so a phone parked on /login gets it too.
  const { buildId } = getAppVersion(deps.buildIdRepo);

  // Overrides the default token values declared in globals.css :root — rendered
  // server-side so the selected theme applies with no client-side flash. Lives
  // in the root layout (not the protected layout) so /login gets it too. Fonts
  // are overridden the same way: every font this theme could pick is already
  // loaded above, so switching themes just repoints the --font-* variables.
  const themeCss = `:root{--paper:${theme.tokens.paper};--paper-raised:${theme.tokens.paperRaised};--ink:${theme.tokens.ink};--line:${theme.tokens.line};--muted:${theme.tokens.muted};--muted-inverse:${theme.tokens.mutedInverse};--brass:${theme.tokens.brass};--brass-dark:${theme.tokens.brassDark};--brass-soft:${theme.tokens.brassSoft};--font-display:${FONT_VAR_MAP[theme.tokens.fonts.display]};--font-body:${FONT_VAR_MAP[theme.tokens.fonts.body]};--font-mono-code:${FONT_VAR_MAP[theme.tokens.fonts.mono]};}`;

  return (
    <html
      lang="en"
      // The pre-paint script below sets `data-sidebar` on this element, so the
      // DOM React hydrates against already differs from the HTML it sent. That
      // is the whole point of the script — suppress the warning here rather
      // than letting a real mismatch hide in the noise. Only affects this
      // element's own attributes, not the tree beneath it.
      suppressHydrationWarning
      // Set server-side from the same cookie the client corrects, so
      // globals.css can reserve room for the bottom-pinned section bar
      // (`TreeNav`) a module renders. Deliberately not a media query: the
      // layout can be pinned, so a wide window can be in compact.
      data-viewport={viewport}
      className={`${spaceGrotesk.variable} ${sora.variable} ${familjenGrotesk.variable} ${manrope.variable} ${inter.variable} ${plexMono.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <head>
        <style>{themeCss}</style>
        {/* iOS launch images. Next has no metadata API for these, so they are
            raw <link> tags. Unlike the manifest and `themeColor` above, these
            PNGs are static and cannot follow the active theme — they bake in
            the default theme's background. See src/lib/pwa/splash.ts. */}
        {listSplashImages().map((image) => (
          <link
            key={image.href}
            rel="apple-touch-startup-image"
            media={image.media}
            href={image.href}
          />
        ))}
        {/* Applies the stored section-panel state before first paint. Without
            it the page renders padded for an open panel and then jumps when
            `TwoTierShell`'s effect reads localStorage — a visible shove of every
            page's content on every navigation.

            Only the *panel* is pre-applied, not `data-shell`: whether a page has
            the tiers at all depends on which route rendered, which this script
            can't know. The shell sets that on mount, and until it does
            `.app-main` has no left padding — the honest default for the home
            grid and the account screen, which have no rail.

            The key string is duplicated from src/components/two-tier-shell.tsx
            on purpose: that file is "use client", and importing a constant from
            it into this server component yields an undefined client-reference
            proxy rather than the string, with nothing to catch it at build
            time. Keep the two in step. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{document.documentElement.dataset.sectionpanel=" +
              'localStorage.getItem("myhomebase:section-panel")==="closed"?"closed":"open";' +
              "}catch(e){}",
          }}
        />
      </head>
      <body className="min-h-full bg-paper">
        <IconSetProvider value={{ id: iconSet.id as ModuleIconSetId, colorful: iconSet.colorful }}>
          <IconOverrideProvider value={iconOverrides}>
            <ViewportProvider value={viewport}>
              <ViewportCorrector current={viewport} pinned={viewportPinned} />
              <AppVersionWatch bootBuildId={buildId} />
              {children}
            </ViewportProvider>
          </IconOverrideProvider>
        </IconSetProvider>
      </body>
    </html>
  );
}
