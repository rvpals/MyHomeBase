import Link from "next/link";
import { splitChipOverflow } from "@/lib/shared/chip-overflow";

// The one way this app draws a user-uploaded icon that stands for a *named
// thing you classify by* — a journal tag or category, a journal location type,
// an expense category, an expense vendor.
//
// Before this existed the same <img> was copy-pasted in six places at three
// different sizes; `CategoryIconThumbnail` and `VendorIconThumbnail` in
// expense-shared were byte-for-byte identical and differed only in name.
//
// Deliberately NOT here: `Cover` in music-player-bar (album art, carries its own
// onError fallback state) and `CardThumbnail` in expense-shared (h-6 w-9 credit
// card art). Those are pictures, not glyphs; folding them in would turn this
// into a generic image box and lose the point.

/**
 * Icon sizes. `sm` is the compact-layout size, `lg` the full-layout one; `md`
 * sits between for rows that can't afford 40px.
 *
 * One table so an icon and its same-size spacer can never drift apart — that
 * pairing is the whole reason the spacer lives in here rather than at the call
 * site, where a size bump used to silently break column alignment.
 */
const SIZES = {
  sm: "h-7 w-7",
  md: "h-8 w-8",
  lg: "h-10 w-10",
} as const;

export type TaxonomyIconSize = keyof typeof SIZES;

export interface TaxonomyIconProps {
  /** The icon's bytes. Absent means this name has no icon — `fallback` decides. */
  url?: string;
  /** The tag/category/vendor name. Hover hint, and the alt text when `alt="name"`. */
  name: string;
  /** Default `"sm"`. */
  size?: TaxonomyIconSize;
  /**
   * What to draw when there is no `url`. `"none"` (default) renders nothing.
   * `"spacer"` renders an invisible box of the same size, so a column of names
   * beside a column of icons stays aligned when only some rows have one.
   */
  fallback?: "none" | "spacer";
  /**
   * `"none"` (default) marks the image decorative — correct when the row already
   * states the name in text beside it, which is the common case. `"name"` is for
   * when the icon is the only content of its link and a screen reader would
   * otherwise announce nothing.
   */
  alt?: "none" | "name";
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

/**
 * A taxonomy icon.
 *
 * `object-contain`, not `cover`: these are glyphs, not photographs, and cover
 * silently crops a non-square upload's edges off. No border either — at these
 * sizes a `border-line` outline competes with the glyph's own edge instead of
 * giving it definition the way it did at 20px.
 *
 * Note the bytes are never resized on upload (`@/lib/shared/image-upload`
 * validates type and byte cap only), so the source is usually much larger than
 * the box and scales down cleanly.
 */
export function TaxonomyIcon({
  url,
  name,
  size = "sm",
  fallback = "none",
  alt = "none",
  className = "",
}: TaxonomyIconProps) {
  if (!url) {
    if (fallback === "none") return null;
    return <span aria-hidden="true" className={`${SIZES[size]} shrink-0 ${className}`} />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- icon bytes are served from our own DB-backed route, not a static asset next/image can optimize.
    <img
      src={url}
      alt={alt === "name" ? name : ""}
      title={name}
      loading="lazy"
      className={`${SIZES[size]} shrink-0 rounded object-contain ${className}`}
    />
  );
}

export interface TaxonomyChipProps {
  /** The icon's bytes. A chip with no icon still renders — the label carries it. */
  url?: string;
  /** The name, shown as the chip's label. */
  name: string;
  /** Icon size inside the chip. Default `"sm"`. */
  size?: TaxonomyIconSize;
  /**
   * Where the chip goes when clicked. Omit for a non-interactive chip — a real
   * `Link` is used when present so middle-click and ⌘-click open a new tab like
   * any other navigation.
   */
  href?: string;
  /** Hover hint. Falls back to the name. */
  title?: string;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

/**
 * Icon *beside* its name, in a pill.
 *
 * For the places that render a bare icon and nothing else — a calendar entry
 * row, the entry viewer — where the reader has to already know what the glyph
 * means. The label removes that guess.
 *
 * Label beside rather than under: under repeats a name that is usually already
 * sitting next to the icon, and it truncates twice on a narrow row.
 */
export function TaxonomyChip({
  url,
  name,
  size = "sm",
  href,
  title,
  className = "",
}: TaxonomyChipProps) {
  const body = (
    <>
      <TaxonomyIcon url={url} name={name} size={size} />
      <span className="truncate">{name}</span>
    </>
  );

  // `max-w-full` + the truncating label keeps one long name from pushing a row
  // of chips wider than its container.
  const shell = `inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-full border border-line bg-paper-raised py-0.5 pl-1 pr-2.5 text-xs text-ink ${className}`;

  if (!href) {
    return (
      <span title={title ?? name} className={shell}>
        {body}
      </span>
    );
  }

  return (
    <Link
      href={href}
      title={title ?? name}
      className={`${shell} transition-colors hover:border-brass hover:text-brass-dark`}
    >
      {body}
    </Link>
  );
}

/**
 * The first `limit` chips, plus a `+N` marker for the rest.
 *
 * A calendar entry row can carry several categories *and* several tags on one
 * truncating line that already competes with the title and the place name.
 * Chips are much wider than bare icons were, so the row is capped rather than
 * left to wrap — the full set is on the entry itself.
 */
export interface TaxonomyChipRowProps {
  /** Every chip the row *could* show, in display order. */
  items: { name: string; url?: string; href?: string }[];
  /** How many to draw before collapsing into `+N`. Default `3`. */
  limit?: number;
  /** Icon size inside each chip. Default `"sm"`. */
  size?: TaxonomyIconSize;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

export function TaxonomyChipRow({
  items,
  limit = 3,
  size = "sm",
  className = "",
}: TaxonomyChipRowProps) {
  if (items.length === 0) return null;

  // The capping rule is in lib so it can be tested; this file only draws.
  const { shown, hidden } = splitChipOverflow(items, limit);

  return (
    <span className={`flex min-w-0 items-center gap-1 ${className}`}>
      {shown.map((item) => (
        <TaxonomyChip key={item.name} url={item.url} name={item.name} size={size} href={item.href} />
      ))}
      {hidden.length > 0 ? (
        // Titled with the names it stands for, so the hidden set is one hover
        // away rather than lost.
        <span
          title={hidden.map((item) => item.name).join(", ")}
          className="shrink-0 rounded-full bg-brass-soft px-1.5 py-0.5 font-mono text-[0.625rem] font-semibold leading-none text-brass-dark"
        >
          +{hidden.length}
        </span>
      ) : null}
    </span>
  );
}
