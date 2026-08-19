// The Music Library module's section list and metadata.
//
// Deliberately NOT a "use client" module: server components (the section pages and
// the shell) read these values directly. Exporting them from the client nav module
// instead would hand the server client-reference proxies rather than the real
// objects, so a lookup like MUSIC_SECTION_INFO[section] would come back undefined.
// Same reasoning as attendance-sections.ts and journal-sections.ts.

export const MUSIC_SECTIONS = ["main", "player", "scan", "configuration"] as const;

export type MusicSection = (typeof MUSIC_SECTIONS)[number];

export function isMusicSection(value: string): value is MusicSection {
  return (MUSIC_SECTIONS as readonly string[]).includes(value);
}

/** Title and one-line description, used in the nav and as the page heading. */
export const MUSIC_SECTION_INFO: Record<
  MusicSection,
  { label: string; description: string }
> = {
  main: {
    label: "Library",
    description: "Browse and search everything in the catalog.",
  },
  player: {
    label: "Player",
    description: "The current track, with artwork and lyrics.",
  },
  scan: {
    label: "Scan Music",
    description: "Pick a folder on the NAS and catalog what is in it.",
  },
  configuration: {
    label: "Configuration",
    description: "Which file formats to include when scanning.",
  },
};

/** Section -> nav icon key, resolved by TreeIcon. */
export const MUSIC_SECTION_ICONS: Record<MusicSection, string> = {
  main: "grid",
  // `chart` is wrong for a player and `grid` is taken; `classroom` reads as a stage.
  // The tree icon set has no music glyph, so this is the closest honest fit.
  player: "classroom",
  // `upload` rather than `folder`: TreeIcon has no folder concept (TREE_ICONS in
  // tree-icons.tsx lists all 24), and an unknown name renders NOTHING rather than
  // falling back -- so a made-up key is a silently blank nav row. `upload` is the
  // closest existing fit for "pull files in from the NAS".
  scan: "upload",
  configuration: "gear",
};

const BASE_PATH = "/modules/music-library";

/** The library is the module root; every other section is a child route. */
export function musicSectionHref(section: MusicSection): string {
  return section === "main" ? BASE_PATH : `${BASE_PATH}/${section}`;
}
