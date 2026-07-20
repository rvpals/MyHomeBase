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
import { DEFAULT_COLOR_THEME_ID, type FontKey, getColorTheme, getSetting } from "@/lib/settings";
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

export function generateMetadata(): Metadata {
  return { title: getAppName() };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const theme = getActiveTheme();

  // Overrides the default token values declared in globals.css :root — rendered
  // server-side so the selected theme applies with no client-side flash. Lives
  // in the root layout (not the protected layout) so /login gets it too. Fonts
  // are overridden the same way: every font this theme could pick is already
  // loaded above, so switching themes just repoints the --font-* variables.
  const themeCss = `:root{--paper:${theme.tokens.paper};--paper-raised:${theme.tokens.paperRaised};--ink:${theme.tokens.ink};--line:${theme.tokens.line};--muted:${theme.tokens.muted};--muted-inverse:${theme.tokens.mutedInverse};--brass:${theme.tokens.brass};--brass-dark:${theme.tokens.brassDark};--brass-soft:${theme.tokens.brassSoft};--font-display:${FONT_VAR_MAP[theme.tokens.fonts.display]};--font-body:${FONT_VAR_MAP[theme.tokens.fonts.body]};--font-mono-code:${FONT_VAR_MAP[theme.tokens.fonts.mono]};}`;

  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${sora.variable} ${familjenGrotesk.variable} ${manrope.variable} ${inter.variable} ${plexMono.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <head>
        <style>{themeCss}</style>
      </head>
      <body className="min-h-full bg-paper">{children}</body>
    </html>
  );
}
