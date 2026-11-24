// The home screen's **systems**: the domains the modules are clustered into.
//
// A module is one domain concept, but thirteen of them laid out flat read as a
// list of thirteen equal things. A system is the next grouping up — "Money",
// "Household" — so the landing page says what this app is *for* before it says
// what it contains.
//
// **This is a code registry, not data.** Unlike `sys_modules` (admin-editable
// rows) a system has no database table, no migration and no admin screen: it is
// a piece of editorial judgement about how the modules relate, and the place to
// change it is this file. Two consequences:
//
// - A module the registry has never heard of — a new one, or one whose slug an
//   admin changed — must still reach the screen. That is what `catchAll` is for;
//   see `groupModulesBySystem`.
// - The *names* on screen still come from the module rows (`shortName`,
//   `description`), which are admin-editable. Only the grouping is fixed here.
//
// The tint is a key from the shared palette, never a colour. `""` means the
// plain card surface — design.md, "Tinted surfaces: a hue mixed into a token".

import type { TintColor } from "@/lib/shared/tint";

/** Every system, as the ids the view keys its activity data by. */
export type HomeSystemId =
  | "money"
  | "journal"
  | "household"
  | "media"
  | "classroom"
  | "workbench"
  | "other";

/** One cluster of modules, as the home screen draws it. */
export interface HomeSystem {
  id: HomeSystemId;
  /** The panel heading, e.g. "Money". */
  name: string;
  /** One line under the heading. */
  tagline: string;
  /**
   * A key from `TINT_COLORS`, or `""` for the plain surface.
   *
   * Keys, not colours: the hue is mixed into the running theme's tokens by the
   * `.clip-tint-<key>` classes in `globals.css`, so a panel reads correctly on a
   * light theme and a dark one without branching.
   */
  tint: TintColor | "";
  /** The module slugs this system claims. Membership only — order comes from the module rows. */
  slugs: readonly string[];
  /**
   * Whether this system collects modules no other system claims.
   *
   * Exactly one system should set it. Without a catch-all, a module added after
   * this file was last edited would be silently missing from the home screen —
   * which is a worse failure than an oddly-filed row, because nothing on screen
   * says anything is absent.
   */
  catchAll?: boolean;
}

/** One system with the modules the reader can actually open. */
export interface HomeSystemCard<M> {
  system: HomeSystem;
  modules: M[];
}

/**
 * The shipped grouping.
 *
 * Classroom stands alone rather than sitting with the other working tools: it is
 * a different audience (a class, not the household) and it owns two sizeable
 * section groups of its own.
 *
 * Six tints for seven systems, and that is deliberate — "Everything else" takes
 * the plain surface, which is what `""` means in this palette. Adding a seventh
 * key to `TINT_COLORS` would also add a swatch to the Clips and Journal category
 * pickers, which share that list, and the key would be permanent.
 */
export const HOME_SYSTEMS: readonly HomeSystem[] = [
  {
    id: "money",
    name: "Money",
    tagline: "The portfolio and what the household spends.",
    tint: "ocean",
    slugs: ["investments", "expense"],
  },
  {
    id: "journal",
    name: "Journal & Notes",
    tagline: "What happened, and everything written down about it.",
    tint: "rose",
    slugs: ["journal", "clips", "documents"],
  },
  {
    id: "household",
    name: "Household",
    tagline: "The paperwork, the lists and the utilities.",
    tint: "sage",
    slugs: ["household", "tools"],
  },
  {
    id: "media",
    name: "Media",
    tagline: "Music, pictures and something to play.",
    tint: "indigo",
    slugs: ["music-library", "picture-gallery", "games"],
  },
  {
    id: "classroom",
    name: "Classroom",
    tagline: "Registers, exams and the marks that come out of them.",
    tint: "amber",
    slugs: ["classroom"],
  },
  {
    id: "workbench",
    name: "Workbench",
    tagline: "Data to pull apart and code worth keeping.",
    tint: "slate",
    slugs: ["csv-analysis", "code-library"],
  },
  {
    id: "other",
    name: "Everything else",
    tagline: "Modules this grouping has not been taught about yet.",
    tint: "",
    slugs: [],
    catchAll: true,
  },
];
