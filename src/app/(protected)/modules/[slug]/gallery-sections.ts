// The Picture Gallery module's section list and metadata.
//
// Deliberately NOT a "use client" module: server components (the section pages and
// the shell) read these values directly. Exporting them from a client module instead
// would hand the server client-reference proxies rather than the real objects, so a
// lookup like GALLERY_SECTION_INFO[section] would come back undefined. Same reasoning
// as csv-sections.ts and music-sections.ts.

// "Home screen" is the module ROOT rather than a child route, which is the shape
// every other module uses for its first section -- so the Random Photo card lives at
// /modules/picture-gallery, not at a /home-screen path below it. Favorites is a child
// route.
export const GALLERY_SECTIONS = ["main", "favorites"] as const;

export type GallerySection = (typeof GALLERY_SECTIONS)[number];

export function isGallerySection(value: string): value is GallerySection {
  return (GALLERY_SECTIONS as readonly string[]).includes(value);
}

/** Title and one-line description, used in the nav and as the page heading. */
export const GALLERY_SECTION_INFO: Record<
  GallerySection,
  { label: string; description: string }
> = {
  main: {
    label: "Home screen",
    description: "A photograph drawn at random from the archive, redrawn whenever you ask.",
  },
  favorites: {
    label: "Favorite photos",
    description: "The photographs you've kept. Watch them as a slideshow, or download a few.",
  },
};

/** Section -> nav icon key, resolved by TreeIcon. */
export const GALLERY_SECTION_ICONS: Record<GallerySection, string> = {
  // `photo` for the one drawn picture, `heart-filled` for the kept ones -- the pair
  // has to read as "a photograph" against "the ones you chose". Both are real
  // TREE_ICONS keys; an invented one renders NOTHING rather than falling back.
  main: "photo",
  // Filled rather than outline: in the nav it is a label, not the card's toggle, so
  // there is no empty state for an outline to mean.
  favorites: "heart-filled",
};

const BASE_PATH = "/modules/picture-gallery";

/** The home screen is the module root; any later section becomes a child route. */
export function gallerySectionHref(section: GallerySection): string {
  return section === "main" ? BASE_PATH : `${BASE_PATH}/${section}`;
}
