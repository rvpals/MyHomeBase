// The Games module's section list and metadata.
//
// Deliberately NOT a "use client" module: server components (the section pages and
// the shell) read these values directly. Exporting them from the client nav module
// instead would hand the server client-reference proxies rather than the real
// objects, so a lookup like GAMES_SECTION_INFO[section] would come back undefined.
// Same reasoning as csv-sections.ts and music-sections.ts.

export const GAMES_SECTIONS = ["main", "scores", "configuration"] as const;

export type GamesSection = (typeof GAMES_SECTIONS)[number];

export function isGamesSection(value: string): value is GamesSection {
  return (GAMES_SECTIONS as readonly string[]).includes(value);
}

/** Title and one-line description, used in the nav and as the page heading. */
export const GAMES_SECTION_INFO: Record<GamesSection, { label: string; description: string }> = {
  main: {
    label: "Arcade",
    description: "Pick a game and play.",
  },
  scores: {
    label: "Scores",
    description: "The shared high-score board across every game.",
  },
  configuration: {
    label: "Configuration",
    description: "How the Games module behaves.",
  },
};

/**
 * Section -> nav icon key, resolved by TreeIcon.
 *
 * Every key here is a real TREE_ICONS concept — an invented one renders NOTHING
 * rather than falling back to a default. These are also the `defaultConcept` values
 * of the three `games_section_*` icon slots, so an override replaces them per place.
 */
export const GAMES_SECTION_ICONS: Record<GamesSection, string> = {
  main: "grid",
  scores: "chart",
  configuration: "gear",
};

const BASE_PATH = "/modules/games";

/** The arcade is the module root; every other section is a child route. */
export function gamesSectionHref(section: GamesSection): string {
  return section === "main" ? BASE_PATH : `${BASE_PATH}/${section}`;
}
