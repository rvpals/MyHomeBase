// The Music Library module's section list and metadata.
//
// Deliberately NOT a "use client" module: server components (the section pages and
// the shell) read these values directly. Exporting them from the client nav module
// instead would hand the server client-reference proxies rather than the real
// objects, so a lookup like MUSIC_SECTION_INFO[section] would come back undefined.
// Same reasoning as attendance-sections.ts and journal-sections.ts.

export const MUSIC_SECTIONS = ["main", "magic", "player", "queue", "scan", "configuration"] as const;

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
  magic: {
    label: "Magic Playlist",
    description: "Pick genres, artists and a length; get a random playlist that fits.",
  },
  player: {
    label: "Player",
    description: "The current track, with artwork and lyrics.",
  },
  queue: {
    label: "Queue",
    description: "What is lined up next. Reorder it, shuffle it, or take tracks out.",
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
  // A magician's hat with a baton -- literal for "conjure me a playlist". Added as a real
  // `magic` concept in TREE_ICONS *and* in the icon-set generator, so every set draws its
  // own wand/hat glyph; an invented key renders NOTHING rather than falling back, per the
  // note on `scan` below. Frees `shapes` back to the Genres view (LIBRARY_VIEW_ICONS).
  magic: "magic",
  // A turntable, added the same way as `magic` above. Replaces the old `classroom`
  // stand-in, which read as a lecture stage rather than as playback.
  player: "player",
  // `list` is the honest fit and the only one: a queue IS an ordered list. Shared with
  // the All Songs entry in LIBRARY_VIEW_ICONS, which is a different icon set rendered in
  // a different place (the Library's view tabs), so there is no collision in the nav.
  queue: "list",
  // `upload` rather than `folder`: TreeIcon has no folder concept (TREE_ICONS in
  // tree-icons.tsx lists them all), and an unknown name renders NOTHING rather than
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
