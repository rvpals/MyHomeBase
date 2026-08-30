export type FontKey =
  | "space-grotesk"
  | "sora"
  | "familjen-grotesk"
  | "manrope"
  | "inter"
  | "ibm-plex-mono"
  | "jetbrains-mono";

/**
 * Every font key, as a value rather than only a type.
 *
 * The union above cannot be iterated, and two things now need to: the zod schema that
 * validates a user-built theme's font choice, and the admin builder's three font
 * dropdowns. Both must agree with the `next/font/google` loaders in
 * src/app/layout.tsx — a key here that nothing loads renders as the browser fallback.
 * Adding a font means a loader there, an entry in `FONT_VAR_MAP` there, and a key here.
 */
export const FONT_KEYS = [
  "space-grotesk",
  "sora",
  "familjen-grotesk",
  "manrope",
  "inter",
  "ibm-plex-mono",
  "jetbrains-mono",
] as const satisfies readonly FontKey[];

/** How each font is named on the builder's dropdowns. */
export const FONT_LABELS: Record<FontKey, string> = {
  "space-grotesk": "Space Grotesk",
  sora: "Sora",
  "familjen-grotesk": "Familjen Grotesk",
  manrope: "Manrope",
  inter: "Inter",
  "ibm-plex-mono": "IBM Plex Mono",
  "jetbrains-mono": "JetBrains Mono",
};

/** Which of the nine token slots are colors — the ones the builder shows a picker for. */
export const COLOR_TOKEN_KEYS = [
  "paper",
  "paperRaised",
  "ink",
  "line",
  "muted",
  "mutedInverse",
  "brass",
  "brassDark",
  "brassSoft",
] as const;

export type ColorTokenKey = (typeof COLOR_TOKEN_KEYS)[number];

export interface ColorThemeFonts {
  display: FontKey;
  body: FontKey;
  mono: FontKey;
}

export interface ColorThemeTokens {
  paper: string;
  paperRaised: string;
  ink: string;
  line: string;
  muted: string;
  mutedInverse: string;
  brass: string;
  brassDark: string;
  brassSoft: string;
  fonts: ColorThemeFonts;
}

export interface ColorTheme {
  id: string;
  name: string;
  description: string;
  tokens: ColorThemeTokens;
}

// Every theme fills the same slots (paper/ink/brass/etc.) that components already
// reference via Tailwind utilities (bg-paper, text-ink, bg-brass, ...). Swapping the
// active theme means overriding these CSS custom properties at :root — no component
// code changes.
export const COLOR_THEMES: ColorTheme[] = [
  {
    id: "signal-deck",
    name: "Signal Deck",
    description: "Graphite console with a teal signal accent.",
    tokens: {
      paper: "#12161A",
      paperRaised: "#1A1F26",
      ink: "#EEF2F3",
      line: "#2B323B",
      muted: "#8B96A1",
      mutedInverse: "#5B6470",
      brass: "#33E2B8",
      brassDark: "#1C8A71",
      brassSoft: "#15332D",
      fonts: { display: "space-grotesk", body: "manrope", mono: "jetbrains-mono" },
    },
  },
  {
    id: "ember-ledger",
    name: "Ember Ledger",
    description: "Ink navy with a warm amber accent.",
    tokens: {
      paper: "#11131B",
      paperRaised: "#171A25",
      ink: "#F4EEE3",
      line: "#2A2D3D",
      muted: "#9992A3",
      mutedInverse: "#655F70",
      brass: "#E79355",
      brassDark: "#A35C2B",
      brassSoft: "#3A2A1C",
      fonts: { display: "sora", body: "manrope", mono: "ibm-plex-mono" },
    },
  },
  {
    id: "aurora-deck",
    name: "Aurora Deck",
    description: "Near-black with a violet and cyan duo-tone accent.",
    tokens: {
      paper: "#0D0E14",
      paperRaised: "#15171F",
      ink: "#F5F6FA",
      line: "#262A38",
      muted: "#8A8EA3",
      mutedInverse: "#4D5166",
      brass: "#7C5CFF",
      brassDark: "#29B6E0",
      brassSoft: "#1C2036",
      fonts: { display: "familjen-grotesk", body: "inter", mono: "jetbrains-mono" },
    },
  },
  {
    id: "bms",
    name: "BMS",
    description: "Bristol Myers Squibb brand purple on charcoal gray.",
    tokens: {
      paper: "#1A1818",
      paperRaised: "#221F1F",
      ink: "#F2F0F0",
      line: "#3A3636",
      muted: "#9B9494",
      mutedInverse: "#6B6565",
      brass: "#BE2BBB",
      brassDark: "#7D1B7A",
      brassSoft: "#2A172A",
      fonts: { display: "sora", body: "manrope", mono: "ibm-plex-mono" },
    },
  },
  // The one light theme. Here "raised" reads brighter than "paper" (pure-white cards
  // on a warm off-white page), the inverse of the dark themes — the paper/paperRaised
  // relationship still holds (raised is one step toward the light). Because every
  // component reads these same tokens, the app renders correctly on a light page with
  // no per-component changes. Caveat: the semantic red/green exception in design.md
  // (300–400 shades tuned for dark) reads a bit light here; acceptable for now.
  {
    id: "daybreak",
    name: "Daybreak",
    description: "Warm daylight paper with a rose signal accent.",
    tokens: {
      paper: "#F4F1F2",
      paperRaised: "#FFFFFF",
      ink: "#232830",
      line: "#E7E2E4",
      muted: "#6B7280",
      mutedInverse: "#9AA1AC",
      brass: "#F43F5E",
      brassDark: "#C21E48",
      brassSoft: "#FCE4EA",
      fonts: { display: "space-grotesk", body: "manrope", mono: "jetbrains-mono" },
    },
  },
  // The second light theme. Same inverted paper/paperRaised relationship as
  // Daybreak; the teal accent is dark enough to stay legible as text on the pale
  // page (brassDark is the text-on-brassSoft shade, so it has to be darker still).
  {
    id: "sea-glass",
    name: "Sea Glass",
    description: "Cool off-white paper with a deep teal accent.",
    tokens: {
      paper: "#F5F7F6",
      paperRaised: "#FFFFFF",
      ink: "#17262B",
      line: "#D6DEDC",
      muted: "#5F7377",
      mutedInverse: "#93A5A8",
      brass: "#0F766E",
      brassDark: "#0B534E",
      brassSoft: "#D3E9E5",
      fonts: { display: "familjen-grotesk", body: "inter", mono: "ibm-plex-mono" },
    },
  },
  {
    id: "midnight-slate",
    name: "Midnight Slate",
    description: "Deep blue-slate console with a cool ice-blue accent.",
    tokens: {
      paper: "#0F141C",
      paperRaised: "#171E28",
      ink: "#E8EEF5",
      line: "#28303D",
      muted: "#8794A5",
      mutedInverse: "#5A6675",
      brass: "#5AB3F0",
      brassDark: "#2E7DB4",
      brassSoft: "#12293B",
      fonts: { display: "sora", body: "inter", mono: "jetbrains-mono" },
    },
  },
  {
    id: "copper-vault",
    name: "Copper Vault",
    description: "Near-black ledger with a polished copper accent.",
    tokens: {
      paper: "#14100E",
      paperRaised: "#1D1815",
      ink: "#F2EBE4",
      line: "#33291F",
      muted: "#9C8B7C",
      mutedInverse: "#6B5D51",
      brass: "#C87F4A",
      brassDark: "#9A5B2E",
      brassSoft: "#33210F",
      fonts: { display: "space-grotesk", body: "manrope", mono: "ibm-plex-mono" },
    },
  },
];

export const DEFAULT_COLOR_THEME_ID = "signal-deck";

export function getColorTheme(id: string): ColorTheme {
  return COLOR_THEMES.find((theme) => theme.id === id) ?? COLOR_THEMES[0];
}
