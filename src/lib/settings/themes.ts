export type FontKey =
  | "space-grotesk"
  | "sora"
  | "familjen-grotesk"
  | "manrope"
  | "inter"
  | "ibm-plex-mono"
  | "jetbrains-mono";

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
];

export const DEFAULT_COLOR_THEME_ID = "signal-deck";

export function getColorTheme(id: string): ColorTheme {
  return COLOR_THEMES.find((theme) => theme.id === id) ?? COLOR_THEMES[0];
}
