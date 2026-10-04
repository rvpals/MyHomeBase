// The eleven flags the Foreign Currencies card draws, as inline SVG.
//
// **Drawn locally rather than fetched or typed as emoji**, which is the same call
// `mahjong-tile.tsx` makes about the Unicode mahjong block and for the same reason.
// The regional-indicator flag emoji (🇨🇳, 🇬🇧) have no glyphs at all on Windows — they
// render as the bare letter pairs "CN" and "GB" — and are emoji-coloured on macOS,
// so one card would look three different ways across the machines this app runs on.
// A remote flag service would render consistently but means a cache table, a
// migration and an API route, which is a lot of machinery for decoration. Eleven
// small SVGs cost more code once and then render identically everywhere, offline.
//
// Deliberately **not** icon slots: these are the identity of a row, like `IndexLogo`
// on the Indexes card, not a mark for a place someone might re-skin. See
// `src/lib/icons/slots.ts`.
//
// Each flag is drawn on a 3:2 viewBox (0 0 24 16) and clipped to a rounded corner by
// the wrapper, so they all sit on the same footprint whatever their real proportions.
// These are simplified — the right stripes and the recognisable central device, not a
// heraldic reproduction. A few (the UK's saltires, Korea's trigrams) are approximations
// at 24px, which is the size they are actually seen at.

import type { ReactElement } from "react";

/** The drawing surface every flag shares. */
function Flag({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <svg
      viewBox="0 0 24 16"
      className="h-4 w-6 shrink-0 rounded-[2px] ring-1 ring-black/10"
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      {children}
    </svg>
  );
}

/** A five-pointed star, used by several flags at different sizes and angles. */
function Star({ cx, cy, r, fill, rotate = 0 }: {
  cx: number;
  cy: number;
  r: number;
  fill: string;
  rotate?: number;
}) {
  const points = Array.from({ length: 5 }, (_, index) => {
    const outer = ((index * 72 - 90 + rotate) * Math.PI) / 180;
    const inner = (((index * 72) + 36 - 90 + rotate) * Math.PI) / 180;
    return [
      `${cx + r * Math.cos(outer)},${cy + r * Math.sin(outer)}`,
      `${cx + r * 0.382 * Math.cos(inner)},${cy + r * 0.382 * Math.sin(inner)}`,
    ].join(" ");
  }).join(" ");
  return <polygon points={points} fill={fill} />;
}

function ChinaFlag() {
  return (
    <Flag title="China">
      <rect width="24" height="16" fill="#de2910" />
      <Star cx={4} cy={4} r={2.6} fill="#ffde00" />
      <Star cx={8.4} cy={1.8} r={0.9} fill="#ffde00" />
      <Star cx={10.2} cy={3.8} r={0.9} fill="#ffde00" />
      <Star cx={10.2} cy={6.2} r={0.9} fill="#ffde00" />
      <Star cx={8.4} cy={8} r={0.9} fill="#ffde00" />
    </Flag>
  );
}

function EuFlag() {
  // Twelve stars in a circle — the count is fixed and has never tracked membership.
  const stars = Array.from({ length: 12 }, (_, index) => {
    const angle = ((index * 30 - 90) * Math.PI) / 180;
    return { cx: 12 + 4.2 * Math.cos(angle), cy: 8 + 4.2 * Math.sin(angle) };
  });
  return (
    <Flag title="European Union">
      <rect width="24" height="16" fill="#003399" />
      {stars.map((star, index) => (
        <Star key={index} cx={star.cx} cy={star.cy} r={1.1} fill="#ffcc00" />
      ))}
    </Flag>
  );
}

function UkFlag() {
  return (
    <Flag title="United Kingdom">
      <rect width="24" height="16" fill="#012169" />
      {/* The white saltire, then the red one inset on top of it. */}
      <path d="M0 0 L24 16 M24 0 L0 16" stroke="#fff" strokeWidth="3.2" />
      <path d="M0 0 L24 16 M24 0 L0 16" stroke="#c8102e" strokeWidth="1.6" />
      {/* The upright cross sits above both arms. */}
      <path d="M12 0 V16 M0 8 H24" stroke="#fff" strokeWidth="5.4" />
      <path d="M12 0 V16 M0 8 H24" stroke="#c8102e" strokeWidth="3.2" />
    </Flag>
  );
}

function JapanFlag() {
  return (
    <Flag title="Japan">
      <rect width="24" height="16" fill="#fff" />
      <circle cx="12" cy="8" r="4.8" fill="#bc002d" />
    </Flag>
  );
}

function CanadaFlag() {
  return (
    <Flag title="Canada">
      <rect width="24" height="16" fill="#fff" />
      <rect width="6" height="16" fill="#d80621" />
      <rect x="18" width="6" height="16" fill="#d80621" />
      {/* The maple leaf, simplified to its silhouette at this size. */}
      <path
        d="M12 3.2 L12.8 5.4 L14.8 4.6 L14.1 6.8 L16.2 6.6 L14.6 8.2 L16 9.1 L13.8 9.6
           L14.2 11 L12.5 10.4 L12.3 12.8 L11.7 12.8 L11.5 10.4 L9.8 11 L10.2 9.6
           L8 9.1 L9.4 8.2 L7.8 6.6 L9.9 6.8 L9.2 4.6 L11.2 5.4 Z"
        fill="#d80621"
      />
    </Flag>
  );
}

function AustraliaFlag() {
  return (
    <Flag title="Australia">
      <rect width="24" height="16" fill="#00008b" />
      {/* The canton: a scaled Union Flag in the upper hoist quarter. */}
      <g>
        <rect width="12" height="8" fill="#012169" />
        <path d="M0 0 L12 8 M12 0 L0 8" stroke="#fff" strokeWidth="1.6" />
        <path d="M0 0 L12 8 M12 0 L0 8" stroke="#c8102e" strokeWidth="0.8" />
        <path d="M6 0 V8 M0 4 H12" stroke="#fff" strokeWidth="2.7" />
        <path d="M6 0 V8 M0 4 H12" stroke="#c8102e" strokeWidth="1.6" />
      </g>
      <Star cx={6} cy={12} r={1.9} fill="#fff" />
      <Star cx={19} cy={3.4} r={1} fill="#fff" />
      <Star cx={21.4} cy={7.6} r={1} fill="#fff" />
      <Star cx={18.4} cy={11.4} r={1} fill="#fff" />
      <Star cx={15.8} cy={7} r={1} fill="#fff" />
      <Star cx={19.6} cy={9} r={0.6} fill="#fff" />
    </Flag>
  );
}

function SwitzerlandFlag() {
  // The only square national flag; drawn to the card's 3:2 box like the rest, with
  // the cross centred rather than stretched.
  return (
    <Flag title="Switzerland">
      <rect width="24" height="16" fill="#d52b1e" />
      <rect x="10.6" y="3.4" width="2.8" height="9.2" fill="#fff" />
      <rect x="7.4" y="6.6" width="9.2" height="2.8" fill="#fff" />
    </Flag>
  );
}

function KoreaFlag() {
  return (
    <Flag title="South Korea">
      <rect width="24" height="16" fill="#fff" />
      {/* The taegeuk: red over blue, split by an S-curve rather than a straight line. */}
      <path d="M12 3.6 A4.4 4.4 0 0 1 12 12.4 A2.2 2.2 0 0 0 12 8 A2.2 2.2 0 0 1 12 3.6 Z" fill="#cd2e3a" />
      <path d="M12 3.6 A4.4 4.4 0 0 0 12 12.4 A2.2 2.2 0 0 1 12 8 A2.2 2.2 0 0 0 12 3.6 Z" fill="#0047a0" />
      {/* Four trigrams, simplified to bars at the corners. */}
      <g fill="#000" transform="rotate(-56 12 8)">
        <rect x="2.6" y="7.3" width="3.4" height="0.5" />
        <rect x="2.6" y="8.1" width="3.4" height="0.5" />
        <rect x="2.6" y="8.9" width="3.4" height="0.5" />
      </g>
      <g fill="#000" transform="rotate(56 12 8)">
        <rect x="18" y="7.3" width="3.4" height="0.5" />
        <rect x="18" y="8.1" width="3.4" height="0.5" />
        <rect x="18" y="8.9" width="3.4" height="0.5" />
      </g>
      <g fill="#000" transform="rotate(-124 12 8)">
        <rect x="2.6" y="7.3" width="3.4" height="0.5" />
        <rect x="2.6" y="8.1" width="3.4" height="0.5" />
      </g>
      <g fill="#000" transform="rotate(124 12 8)">
        <rect x="18" y="7.3" width="3.4" height="0.5" />
        <rect x="18" y="8.9" width="3.4" height="0.5" />
      </g>
    </Flag>
  );
}

function HongKongFlag() {
  return (
    <Flag title="Hong Kong">
      <rect width="24" height="16" fill="#de2910" />
      {/* The bauhinia, as five petals around the centre. */}
      {Array.from({ length: 5 }, (_, index) => {
        const angle = ((index * 72 - 90) * Math.PI) / 180;
        return (
          <ellipse
            key={index}
            cx={12 + 2.3 * Math.cos(angle)}
            cy={8 + 2.3 * Math.sin(angle)}
            rx="1.5"
            ry="2.3"
            fill="#fff"
            transform={`rotate(${index * 72} ${12 + 2.3 * Math.cos(angle)} ${8 + 2.3 * Math.sin(angle)})`}
          />
        );
      })}
    </Flag>
  );
}

function IndiaFlag() {
  return (
    <Flag title="India">
      <rect width="24" height="5.33" fill="#ff9933" />
      <rect y="5.33" width="24" height="5.34" fill="#fff" />
      <rect y="10.67" width="24" height="5.33" fill="#138808" />
      {/* The Ashoka Chakra: a rim and spokes, not all 24 at this size. */}
      <circle cx="12" cy="8" r="2.1" fill="none" stroke="#000080" strokeWidth="0.5" />
      <g stroke="#000080" strokeWidth="0.28">
        {Array.from({ length: 12 }, (_, index) => {
          const angle = (index * 30 * Math.PI) / 180;
          return (
            <line
              key={index}
              x1={12}
              y1={8}
              x2={12 + 2.1 * Math.cos(angle)}
              y2={8 + 2.1 * Math.sin(angle)}
            />
          );
        })}
      </g>
    </Flag>
  );
}

function TaiwanFlag() {
  return (
    <Flag title="Taiwan">
      <rect width="24" height="16" fill="#fe0000" />
      <rect width="12" height="8" fill="#000095" />
      {/* The white sun: twelve rays around a disc. */}
      <g fill="#fff">
        {Array.from({ length: 12 }, (_, index) => (
          <rect
            key={index}
            x={5.4}
            y={3.5}
            width="1.2"
            height="1"
            transform={`rotate(${index * 30} 6 4) translate(0 -1.7)`}
          />
        ))}
      </g>
      <circle cx="6" cy="4" r="1.7" fill="#fff" />
      <circle cx="6" cy="4" r="1.2" fill="#000095" />
    </Flag>
  );
}

/** Every flag the catalogue can name, keyed by its `flag` field. */
const FLAGS: Record<string, () => ReactElement> = {
  cn: ChinaFlag,
  eu: EuFlag,
  gb: UkFlag,
  jp: JapanFlag,
  ca: CanadaFlag,
  au: AustraliaFlag,
  ch: SwitzerlandFlag,
  kr: KoreaFlag,
  hk: HongKongFlag,
  in: IndiaFlag,
  tw: TaiwanFlag,
};

/**
 * The flag for a catalogue entry.
 *
 * An unknown key draws a neutral placeholder rather than throwing or rendering
 * nothing: a currency added to the catalogue without a flag here should still
 * produce a readable row, with a visible gap where the artwork belongs.
 */
export function CurrencyFlag({ flag, label }: { flag: string; label: string }) {
  const Drawn = FLAGS[flag];
  if (!Drawn) {
    return (
      <Flag title={label}>
        <rect width="24" height="16" fill="currentColor" opacity="0.12" />
      </Flag>
    );
  }
  return <Drawn />;
}
