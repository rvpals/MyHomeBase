import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { cookies } from "next/headers";
import { AppVersionWatch } from "@/components/app-version-watch";
import { IconOverrideProvider } from "@/components/icon-override-context";
import { IconSetProvider } from "@/components/icon-set-context";
import { ViewportCorrector } from "@/components/viewport-corrector";
import { ViewportProvider } from "@/components/viewport-context";
import { getAppVersion } from "@/lib/app-version";
import { colorSchemeFor, resolveActiveTheme } from "@/lib/color-themes";
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
  resolveBorderWidths,
  resolveChromeStyle,
  SCRIPT_FONT_SETTING_KEYS,
  scriptFontCssVar,
} from "@/lib/settings";
import { deps } from "@/lib/wiring";
import "./globals.css";

// The eight webfaces, loaded from committed files in ./fonts rather than
// fetched from Google at build time.
//
// **This was `next/font/google` and must not go back.** Those loaders download
// from fonts.gstatic.com *while the build runs*, and `npm run build` clears
// `.next` first — so nothing cached between builds and every release was gated
// on eight consecutive successful fetches through a corporate network. One
// hiccup aborted `publish:nas` with "next/font/google queries have exactly one
// entry", which reads like a bug in this file and isn't. See ./fonts/README.md.
//
// `declarations: [{ prop: "font-named-instance", value: "Regular" }]` is not
// needed here; what matters is that each `src` entry declares the weight RANGE
// a variable file actually covers. Next emits one @font-face per entry, and a
// range lets the browser synthesise every weight in it — which is what keeps a
// theme free to ask for 600 from a file whose entry says 500-700.
//
// The CSS variable names are unchanged from the Google loaders, deliberately:
// they are the seam `FONT_VAR_MAP` below and the stored themes resolve through,
// so preserving them means no migration and no theme rewrite.

// Variable file covering 500-700 — the three weights the themes use.
const spaceGrotesk = localFont({
  src: [{ path: "./fonts/space-grotesk-variable.woff2", weight: "500 700", style: "normal" }],
  variable: "--font-space-grotesk",
  display: "swap",
});

const sora = localFont({
  src: [{ path: "./fonts/sora-variable.woff2", weight: "500 700", style: "normal" }],
  variable: "--font-sora",
  display: "swap",
});

const familjenGrotesk = localFont({
  src: [{ path: "./fonts/familjen-grotesk-variable.woff2", weight: "500 700", style: "normal" }],
  variable: "--font-familjen-grotesk",
  display: "swap",
});

// Manrope and Inter carried no `weight` array under the Google loaders, i.e.
// their full variable range. Kept that way so the theme builder can assign
// either to any slot at any weight.
const manrope = localFont({
  src: [{ path: "./fonts/manrope-variable.woff2", weight: "200 800", style: "normal" }],
  variable: "--font-manrope",
  display: "swap",
});

const inter = localFont({
  src: [{ path: "./fonts/inter-variable.woff2", weight: "100 900", style: "normal" }],
  variable: "--font-inter",
  display: "swap",
});

// The one family Google still serves as separate statics, so it is the one with
// three files. Three `src` entries, one per weight.
const plexMono = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-mono-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-mono-600.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-ibm-plex-mono",
  display: "swap",
});

const jetbrainsMono = localFont({
  src: [{ path: "./fonts/jetbrains-mono-variable.woff2", weight: "400 500", style: "normal" }],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

// THE SIX DECORATIVE SCRIPT FACES.
//
// Deliberately NOT theme faces: they are absent from FONT_KEYS, so the theme
// builder never offers them and nobody can pick handwriting as their body font.
// They are instead selected on Administration → Display Settings → Script Fonts
// and resolved into the `--font-script` / `--font-script-journal` tokens below.
//
// **All six load on every page, and that is the intended trade.** The pair of
// settings is read per request, so the chosen faces are not known at module
// scope where `localFont` has to be called — the loaders are a build-time
// transform, not something that can be called conditionally. What this actually
// costs is six `@font-face` DECLARATIONS, not six downloads: a browser fetches a
// face only when something on the page renders a glyph in it, so each page pulls
// the one or two faces it actually uses. Same shape as the seven theme faces
// above, which are all declared and switched between by repointing a variable.
//
// Great Vibes is first because it is the default and what both surfaces wore
// before either was configurable. Caveat and Dancing Script are variable files
// covering 400–700; the other four are single-weight 400 designs with no bold
// cut, so their entries must say "400" and not a range — claiming a range a file
// does not cover is how you get a synthesised faux-bold that looks nothing like
// the face. See ./fonts/README.md.
const greatVibes = localFont({
  src: [{ path: "./fonts/great-vibes-variable.woff2", weight: "400", style: "normal" }],
  variable: "--font-great-vibes",
  display: "swap",
});

const dancingScript = localFont({
  src: [{ path: "./fonts/dancing-script-variable.woff2", weight: "400 700", style: "normal" }],
  variable: "--font-dancing-script",
  display: "swap",
});

const caveat = localFont({
  src: [{ path: "./fonts/caveat-variable.woff2", weight: "400 700", style: "normal" }],
  variable: "--font-caveat",
  display: "swap",
});

const kalam = localFont({
  src: [{ path: "./fonts/kalam-variable.woff2", weight: "400", style: "normal" }],
  variable: "--font-kalam",
  display: "swap",
});

const parisienne = localFont({
  src: [{ path: "./fonts/parisienne-variable.woff2", weight: "400", style: "normal" }],
  variable: "--font-parisienne",
  display: "swap",
});

const pinyonScript = localFont({
  src: [{ path: "./fonts/pinyon-script-variable.woff2", weight: "400", style: "normal" }],
  variable: "--font-pinyon-script",
  display: "swap",
});

// Maps a theme's font choice to the CSS variable the matching `localFont`
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

// The bevel on the header and the navigation tree (migrations/0121). Resolved
// rather than read raw so a garbled row degrades to the default instead of
// emitting a `data-chrome-style` no CSS rule matches, which would leave the
// chrome with no treatment at all.
function getActiveChromeStyle() {
  return resolveChromeStyle(getSetting(deps.settingsRepo, "chrome_style")?.value);
}

// The three border weights (migrations/0122). Resolved rather than read raw so a
// garbled row degrades per axis to 1px instead of emitting an invalid width.
function getActiveBorderWidths() {
  return resolveBorderWidths(getSetting(deps.settingsRepo, "border_widths")?.value);
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
  const chromeStyle = getActiveChromeStyle();
  const borderWidths = getActiveBorderWidths();
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

  // Tells the browser which way round to draw its own widgets — the date/time
  // picker glyphs, number spinners and bare scrollbars, none of which CSS can
  // reach. Without it the browser assumes a light page and paints the calendar
  // icon near-black, leaving it near-invisible on a dark theme. Derived from
  // `paper` so a user-generated theme gets it right too.
  const colorScheme = colorSchemeFor(theme.tokens.paper);

  // Overrides the default token values declared in globals.css :root — rendered
  // server-side so the selected theme applies with no client-side flash. Lives
  // in the root layout (not the protected layout) so /login gets it too. Fonts
  // are overridden the same way: every font this theme could pick is already
  // loaded above, so switching themes just repoints the --font-* variables.
  //
  // The three `--*-width` values ride in the same block (migrations/0122). They
  // are not theme tokens — they come from their own setting, not from the theme —
  // but they belong to the same "render the admin's display choices before first
  // paint" job, and a second <style> tag for three numbers would be noise.
  //
  // The two script faces ride in it for the same reason (migrations/0137). They
  // are likewise not theme tokens: no theme can select a script face, and these
  // come from their own two settings on Display Settings → Script Fonts. Writing
  // them here rather than hard-coding `--font-script` in globals.css is what
  // makes the pick apply before first paint — a quote that renders in Great
  // Vibes and then swaps to Caveat one frame later is worse than either face.
  // `scriptFontCssVar` falls back to Great Vibes for a missing or unrecognised
  // row, so a fresh install with no seeded rows still gets a font-family.
  const dailyQuoteFontVar = scriptFontCssVar(
    getSetting(deps.settingsRepo, SCRIPT_FONT_SETTING_KEYS.dailyQuote)?.value,
  );
  const journalFontVar = scriptFontCssVar(
    getSetting(deps.settingsRepo, SCRIPT_FONT_SETTING_KEYS.journalHandwriting)?.value,
  );
  const themeCss = `:root{color-scheme:${colorScheme};--paper:${theme.tokens.paper};--paper-raised:${theme.tokens.paperRaised};--ink:${theme.tokens.ink};--line:${theme.tokens.line};--muted:${theme.tokens.muted};--muted-inverse:${theme.tokens.mutedInverse};--brass:${theme.tokens.brass};--brass-dark:${theme.tokens.brassDark};--brass-soft:${theme.tokens.brassSoft};--font-display:${FONT_VAR_MAP[theme.tokens.fonts.display]};--font-body:${FONT_VAR_MAP[theme.tokens.fonts.body]};--font-mono-code:${FONT_VAR_MAP[theme.tokens.fonts.mono]};--chrome-outline-width:${borderWidths.outline}px;--chrome-divider-width:${borderWidths.divider}px;--line-width:${borderWidths.line}px;--font-script:var(${dailyQuoteFontVar});--font-script-journal:var(${journalFontVar});}`;

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
      // The chrome's border treatment, set server-side from the app-wide
      // setting so the first HTML already draws the chosen bevel — the header
      // and the tree are the worst surfaces on which to restyle themselves one
      // frame after hydration. globals.css selects on this attribute.
      data-chrome-style={chromeStyle}
      className={`${spaceGrotesk.variable} ${sora.variable} ${familjenGrotesk.variable} ${manrope.variable} ${inter.variable} ${plexMono.variable} ${jetbrainsMono.variable} ${greatVibes.variable} ${dancingScript.variable} ${caveat.variable} ${kalam.variable} ${parisienne.variable} ${pinyonScript.variable} h-full antialiased`}
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
