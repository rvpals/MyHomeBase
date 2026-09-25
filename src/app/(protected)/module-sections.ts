// The composition root for navigation: every module's sections, in one place.
//
// This is the `src/app/` half of `SectionSource` (`src/lib/navigation/ports.ts`).
// The nine `*-sections.ts` files live next to the routes whose hrefs they build, and
// `src/lib/` may not import from `src/app/` — so the tree declares what it needs and
// this file supplies it, exactly as `deps` supplies repositories.
//
// **Not a "use client" module**, and that is load-bearing. Every `*-sections.ts` it
// imports is deliberately server-safe for the same reason (see the comment at the top
// of `journal-sections.ts`): the shells are server components and read these values
// directly, so a client directive anywhere in this chain would hand the server
// client-reference proxies instead of the real objects.
//
// Adding a module means one entry in `SECTION_BUILDERS`. A module with no entry gets
// an empty heading rather than an error — see `sectionsFor`.

import type { SectionSource, TreeSection } from "@/lib/navigation";
import {
  ATTENDANCE_SECTIONS,
  ATTENDANCE_SECTION_ICONS,
  ATTENDANCE_SECTION_INFO,
  attendanceSectionHref,
} from "./modules/[slug]/attendance-sections";
import {
  CSV_SECTIONS,
  CSV_SECTION_ICONS,
  CSV_SECTION_INFO,
  csvSectionHref,
} from "./modules/[slug]/csv-sections";
import {
  EXPENSE_SECTIONS,
  EXPENSE_SECTION_ICONS,
  EXPENSE_SECTION_INFO,
  expenseSectionHref,
} from "./modules/[slug]/expense-sections";
import {
  GALLERY_SECTIONS,
  GALLERY_SECTION_ICONS,
  GALLERY_SECTION_INFO,
  gallerySectionHref,
} from "./modules/[slug]/gallery-sections";
import {
  GAMES_SECTIONS,
  GAMES_SECTION_ICONS,
  GAMES_SECTION_INFO,
  gamesSectionHref,
} from "./modules/[slug]/games-sections";
import {
  JOURNAL_CONFIGURATION_SECTIONS,
  JOURNAL_DATA_MANAGEMENT_SECTIONS,
  JOURNAL_LOCATION_SECTIONS,
  JOURNAL_SECTIONS,
  JOURNAL_SECTION_ICONS,
  JOURNAL_SECTION_INFO,
  journalSectionHref,
} from "./modules/[slug]/journal-sections";
import {
  MUSIC_SECTIONS,
  MUSIC_SECTION_ICONS,
  MUSIC_SECTION_INFO,
  musicSectionHref,
} from "./modules/[slug]/music-sections";
import {
  STOCK_SECTIONS,
  STOCK_SECTION_ICONS,
  STOCK_SECTION_INFO,
  stockSectionHref,
} from "./modules/[slug]/stock-sections";
import {
  TOOLS_SECTIONS,
  TOOLS_SECTION_ICONS,
  TOOLS_SECTION_INFO,
  toolsSectionHref,
} from "./modules/[slug]/tools-sections";

/**
 * Builds the four parallel exports every `*-sections.ts` publishes into `TreeSection`s.
 *
 * Every one of the nine files has the identical shape — a slug tuple, an INFO record,
 * an ICONS record and an href function — so this generic does all nine rather than
 * nine near-identical map calls. `group` is applied from the lookup below.
 */
function toSections<Slug extends string>(
  slugs: readonly Slug[],
  info: Record<Slug, { label: string; description: string }>,
  icons: Record<Slug, string>,
  href: (slug: Slug) => string,
  groups: Partial<Record<Slug, string>> = {},
): TreeSection[] {
  return slugs.map((slug) => ({
    id: slug,
    label: info[slug].label,
    href: href(slug),
    hint: info[slug].description,
    icon: icons[slug],
    group: groups[slug],
  }));
}

/**
 * Journal's three groups, flattened to a `group` label per section.
 *
 * The tree spends its one level of nesting on the module, so a module's own groups
 * become labels between rows rather than a second accordion — the same trade
 * `CompactSectionList` already makes. Derived from the same three constants
 * `journal-shell.tsx` builds its accordion from, so the two can't drift.
 */
const JOURNAL_GROUPS: Partial<Record<(typeof JOURNAL_SECTIONS)[number], string>> = {
  ...Object.fromEntries(JOURNAL_LOCATION_SECTIONS.map((slug) => [slug, "Locations"])),
  ...Object.fromEntries(JOURNAL_DATA_MANAGEMENT_SECTIONS.map((slug) => [slug, "Data Management"])),
  ...Object.fromEntries(JOURNAL_CONFIGURATION_SECTIONS.map((slug) => [slug, "Configuration"])),
};

/**
 * Module slug to its section list. Keyed by the slug in `sys_modules`, which is why
 * Investments appears as `investments` while its files are still named `stock-*` —
 * migration 0108 renamed the module, not the files.
 */
const SECTION_BUILDERS: Record<string, () => TreeSection[]> = {
  investments: () =>
    toSections(STOCK_SECTIONS, STOCK_SECTION_INFO, STOCK_SECTION_ICONS, stockSectionHref),
  journal: () =>
    toSections(
      JOURNAL_SECTIONS,
      JOURNAL_SECTION_INFO,
      JOURNAL_SECTION_ICONS,
      journalSectionHref,
      JOURNAL_GROUPS,
    ),
  "csv-analysis": () =>
    toSections(CSV_SECTIONS, CSV_SECTION_INFO, CSV_SECTION_ICONS, csvSectionHref),
  expense: () =>
    toSections(EXPENSE_SECTIONS, EXPENSE_SECTION_INFO, EXPENSE_SECTION_ICONS, expenseSectionHref),
  attendance: () =>
    toSections(
      ATTENDANCE_SECTIONS,
      ATTENDANCE_SECTION_INFO,
      ATTENDANCE_SECTION_ICONS,
      attendanceSectionHref,
    ),
  "music-library": () =>
    toSections(MUSIC_SECTIONS, MUSIC_SECTION_INFO, MUSIC_SECTION_ICONS, musicSectionHref),
  games: () =>
    toSections(GAMES_SECTIONS, GAMES_SECTION_INFO, GAMES_SECTION_ICONS, gamesSectionHref),
  "picture-gallery": () =>
    toSections(GALLERY_SECTIONS, GALLERY_SECTION_INFO, GALLERY_SECTION_ICONS, gallerySectionHref),
  tools: () =>
    toSections(TOOLS_SECTIONS, TOOLS_SECTION_INFO, TOOLS_SECTION_ICONS, toolsSectionHref),
};

/**
 * The app's section source, for `buildNavigationTree`.
 *
 * Returns `[]` for an unknown slug rather than throwing: a module row can exist in
 * `sys_modules` before its shell does, and navigation that threw on a half-built
 * module would take down every page behind the login rather than one heading.
 */
export const moduleSectionSource: SectionSource = {
  sectionsFor: (moduleSlug) => SECTION_BUILDERS[moduleSlug]?.() ?? [],
};
