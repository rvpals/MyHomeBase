import type { Metadata } from "next";
import { Fraunces, IBM_Plex_Mono, Manrope } from "next/font/google";
import { Sidebar } from "@/components/sidebar";
import { getModuleCode, listModules } from "@/lib/modules";
import { DEFAULT_COLOR_THEME_ID, getColorTheme, getSetting } from "@/lib/settings";
import { deps } from "@/lib/wiring";
import "./globals.css";

const fraunces = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
});

const manrope = Manrope({
  variable: "--font-body",
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-mono-code",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

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
  const appName = getAppName();
  const theme = getActiveTheme();
  const links = listModules(deps.moduleRepo).map((appModule) => ({
    slug: appModule.slug,
    name: appModule.shortName,
    href: `/modules/${appModule.slug}`,
    code: getModuleCode(appModule.slug),
    icon: appModule.icon,
    hint: appModule.description,
  }));

  // Overrides the default token values declared in globals.css :root — rendered
  // server-side so the selected theme applies with no client-side flash.
  const themeCss = `:root{--paper:${theme.tokens.paper};--paper-raised:${theme.tokens.paperRaised};--ink:${theme.tokens.ink};--line:${theme.tokens.line};--muted:${theme.tokens.muted};--muted-inverse:${theme.tokens.mutedInverse};--brass:${theme.tokens.brass};--brass-dark:${theme.tokens.brassDark};--brass-soft:${theme.tokens.brassSoft};}`;

  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${manrope.variable} ${plexMono.variable} h-full antialiased`}
    >
      <head>
        <style>{themeCss}</style>
      </head>
      <body className="min-h-full bg-paper">
        <div className="flex min-h-screen">
          <Sidebar links={links} appName={appName} />
          <main className="flex-1 p-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
