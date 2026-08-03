// The selectable module-icon sets, mirroring themes.ts. This registry is the source of
// truth for which sets exist, their labels, and whether they are full-color (so the
// presentation layer knows to drop the accent tint behind them). The actual glyph SVGs
// live in the presentation layer (src/components/module-icon-sets.generated.ts), keyed
// by these same ids — keep the id lists in sync.

export interface IconSet {
  id: string;
  name: string;
  description: string;
  /**
   * True for multi-color artwork that carries its own fills and therefore cannot be
   * tinted to the theme accent. The UI renders these on a neutral tile instead of the
   * solid-accent icon badge.
   */
  colorful: boolean;
}

export const ICON_SETS: IconSet[] = [
  {
    id: "classic",
    name: "Classic",
    description: "The original hand-drawn line icons. Tinted to the theme accent.",
    colorful: false,
  },
  {
    id: "lucide",
    name: "Lucide",
    description: "Clean, consistent outline icons. Tinted to the theme accent.",
    colorful: false,
  },
  {
    id: "tabler",
    name: "Tabler",
    description: "Uniform 2px outline icons. Tinted to the theme accent.",
    colorful: false,
  },
  {
    id: "material-symbols",
    name: "Material Symbols",
    description: "Google's icons in the solid filled style. Tinted to the theme accent.",
    colorful: false,
  },
  {
    id: "mingcute",
    name: "MingCute",
    description: "Rounded, friendly filled icons. Tinted to the theme accent.",
    colorful: false,
  },
  {
    id: "phosphor-duotone",
    name: "Phosphor Duotone",
    description: "Outline icons with a soft second-tone fill. Tinted to the theme accent.",
    colorful: false,
  },
  {
    id: "solar-line-duotone",
    name: "Solar Line Duotone",
    description: "Detailed two-tone outline icons. Tinted to the theme accent.",
    colorful: false,
  },
  {
    id: "solar-bold-duotone",
    name: "Solar Bold Duotone",
    description: "Rich, filled two-tone icons with depth. Tinted to the theme accent.",
    colorful: false,
  },
  {
    id: "hugeicons",
    name: "Hugeicons",
    description: "Highly detailed two-tone strokes. Tinted to the theme accent.",
    colorful: false,
  },
  {
    id: "streamline-color",
    name: "Streamline Color",
    description: "Detailed full-color illustrations. Shown on a neutral tile.",
    colorful: true,
  },
  {
    id: "flat-color",
    name: "Flat Color",
    description: "Corporate flat-color icons. Shown on a neutral tile.",
    colorful: true,
  },
  {
    id: "fluent-flat",
    name: "Fluent Emoji Flat",
    description: "Microsoft's detailed flat emoji artwork. Shown on a neutral tile.",
    colorful: true,
  },
  {
    id: "fluent-3d",
    name: "Fluent Emoji 3D",
    description: "Gradient 3D emoji renders — maximum detail. Shown on a neutral tile.",
    colorful: true,
  },
];

export const DEFAULT_ICON_SET_ID = "solar-bold-duotone";

export function getIconSet(id: string): IconSet {
  return ICON_SETS.find((set) => set.id === id) ?? ICON_SETS[0];
}
