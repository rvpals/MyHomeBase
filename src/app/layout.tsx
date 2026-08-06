import type { Metadata } from "next";
import {
  Familjen_Grotesk,
  Inter,
  IBM_Plex_Mono,
  JetBrains_Mono,
  Manrope,
  Sora,
  Space_Grotesk,
} from "next/font/google";
import { IconSetProvider } from "@/components/icon-set-context";
import type { ModuleIconSetId } from "@/components/module-icon-sets.generated";
import {
  DEFAULT_COLOR_THEME_ID,
  DEFAULT_ICON_SET_ID,
  type FontKey,
  getColorTheme,
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

function getActiveTheme() {
  const themeId = getSetting(deps.settingsRepo, "color_theme")?.value ?? DEFAULT_COLOR_THEME_ID;
  return getColorTheme(themeId);
}

function getActiveIconSet() {
  const iconSetId = getSetting(deps.settingsRepo, "icon_set")?.value ?? DEFAULT_ICON_SET_ID;
  return getIconSet(iconSetId);
}

export function generateMetadata(): Metadata {
  return { title: getAppName() };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const theme = getActiveTheme();
  const iconSet = getActiveIconSet();

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
      className={`${spaceGrotesk.variable} ${sora.variable} ${familjenGrotesk.variable} ${manrope.variable} ${inter.variable} ${plexMono.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <head>
        <style>{themeCss}</style>
        {/* Applies the stored sidebar state before first paint. Without it the
            page renders with the full sidebar and its 6rem gutter, then jumps
            when the client effect reads localStorage — a visible shove of every
            page's content on every navigation.

            The key strings are duplicated from src/components/sidebar.tsx on
            purpose: that file is "use client", and importing a constant from it
            into this server component yields an undefined client-reference
            proxy rather than the string, with nothing to catch it at build
            time. Keep the two in step. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              'try{var k="myhomebase:sidebar-state",s=localStorage.getItem(k);' +
              'if(s!=="full"&&s!=="rail"&&s!=="strip"){' +
              'var c=localStorage.getItem("myhomebase:sidebar-collapsed");' +
              's=c==="true"?"rail":"full";}' +
              'document.documentElement.dataset.sidebar=s;}catch(e){}',
          }}
        />
      </head>
      <body className="min-h-full bg-paper">
        <IconSetProvider value={{ id: iconSet.id as ModuleIconSetId, colorful: iconSet.colorful }}>
          {children}
        </IconSetProvider>
      </body>
    </html>
  );
}
