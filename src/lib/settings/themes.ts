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
    id: "brass",
    name: "Brass",
    description: "Warm brass on cool paper — the original.",
    tokens: {
      paper: "#F7F8FA",
      paperRaised: "#FFFFFF",
      ink: "#12161C",
      line: "#E1E4EA",
      muted: "#6B7280",
      mutedInverse: "#9AA3AF",
      brass: "#B4772E",
      brassDark: "#8B5A22",
      brassSoft: "#F1E3CD",
    },
  },
  {
    id: "sage",
    name: "Sage",
    description: "Muted green, calm and grounded.",
    tokens: {
      paper: "#F5F7F3",
      paperRaised: "#FFFFFF",
      ink: "#171C17",
      line: "#DCE3D8",
      muted: "#6B7268",
      mutedInverse: "#9CA79A",
      brass: "#5C7A5C",
      brassDark: "#3F5940",
      brassSoft: "#E1E8DD",
    },
  },
  {
    id: "slate",
    name: "Slate",
    description: "Cool blue-gray, quiet and precise.",
    tokens: {
      paper: "#F4F6FA",
      paperRaised: "#FFFFFF",
      ink: "#121820",
      line: "#DCE2EC",
      muted: "#667085",
      mutedInverse: "#9AA6BC",
      brass: "#4A6FA5",
      brassDark: "#34517D",
      brassSoft: "#DCE5F0",
    },
  },
  {
    id: "terracotta",
    name: "Terracotta",
    description: "Warm clay, earthy and inviting.",
    tokens: {
      paper: "#FBF6F2",
      paperRaised: "#FFFFFF",
      ink: "#1E1712",
      line: "#EEDFD3",
      muted: "#7A6A5D",
      mutedInverse: "#B7A292",
      brass: "#C1592F",
      brassDark: "#973F1E",
      brassSoft: "#F3DDCB",
    },
  },
  {
    id: "plum",
    name: "Plum",
    description: "Deep purple, a little more formal.",
    tokens: {
      paper: "#F8F6FA",
      paperRaised: "#FFFFFF",
      ink: "#1A1520",
      line: "#E5DCEA",
      muted: "#71667A",
      mutedInverse: "#A99DB2",
      brass: "#7A4E8C",
      brassDark: "#593668",
      brassSoft: "#E9DCEE",
    },
  },
  {
    id: "teal",
    name: "Teal",
    description: "Deep teal, cool and focused.",
    tokens: {
      paper: "#F3F9F8",
      paperRaised: "#FFFFFF",
      ink: "#0E1E1B",
      line: "#D4E7E3",
      muted: "#5F7975",
      mutedInverse: "#9DB8B3",
      brass: "#2A7F76",
      brassDark: "#1C5A53",
      brassSoft: "#D3EAE6",
    },
  },
  {
    id: "mustard",
    name: "Mustard",
    description: "Warm gold, confident and bright.",
    tokens: {
      paper: "#FAF7EF",
      paperRaised: "#FFFFFF",
      ink: "#211B0E",
      line: "#EDE2C3",
      muted: "#7C7154",
      mutedInverse: "#B6A87F",
      brass: "#B98A1F",
      brassDark: "#8A6714",
      brassSoft: "#F0E1B8",
    },
  },
  {
    id: "rose",
    name: "Rose",
    description: "Dusty rose, soft but not precious.",
    tokens: {
      paper: "#FAF5F5",
      paperRaised: "#FFFFFF",
      ink: "#201417",
      line: "#EBDBDD",
      muted: "#7C6669",
      mutedInverse: "#B79DA1",
      brass: "#A2495A",
      brassDark: "#78313E",
      brassSoft: "#F0D8DC",
    },
  },
  {
    id: "ocean",
    name: "Ocean",
    description: "Deep blue, clear and confident.",
    tokens: {
      paper: "#F2F7FA",
      paperRaised: "#FFFFFF",
      ink: "#0E1A24",
      line: "#D6E5EE",
      muted: "#5E7284",
      mutedInverse: "#9AB2C2",
      brass: "#2C6E9E",
      brassDark: "#1E4E71",
      brassSoft: "#CFE3EF",
    },
  },
  {
    id: "charcoal",
    name: "Charcoal",
    description: "Near-monochrome, minimal and quiet.",
    tokens: {
      paper: "#F6F6F6",
      paperRaised: "#FFFFFF",
      ink: "#171717",
      line: "#E2E2E2",
      muted: "#6B6B6F",
      mutedInverse: "#A3A3A6",
      brass: "#52525B",
      brassDark: "#3A3A40",
      brassSoft: "#E4E4E7",
    },
  },
];

export const DEFAULT_COLOR_THEME_ID = "brass";

export function getColorTheme(id: string): ColorTheme {
  return COLOR_THEMES.find((theme) => theme.id === id) ?? COLOR_THEMES[0];
}
