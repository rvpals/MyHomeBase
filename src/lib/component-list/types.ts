// Domain model for the component registry rendered on Admin → About → Code.
//
// The source is `components.md`'s **Index** table, not a scan of
// `src/components/`. That is deliberate and it is the whole reason this module
// exists: a directory listing gives filenames and nothing else, and the question
// the screen answers is "what is this component *for*". Only the registry carries
// that sentence, written by hand for each entry.
//
// The consequence to be honest about: this lists the ~96 *registered reusable*
// components, not every React component in the app. Page-local one-offs are
// deliberately unregistered (`components.md` → "One-offs stay local"), so they are
// absent by design rather than by omission. The view says so on screen.

/** One row of the registry's Index table. */
export interface ComponentEntry {
  /**
   * The exported name, e.g. `DataGrid`. A few entries name a pair that ships
   * together (`MessageQueue / MonitorWarningDialog`) and keep the slash — that is
   * what the registry calls them, and splitting them would invent two entries
   * where the document deliberately has one.
   */
  name: string;
  /** What it is for, one line, as written in the registry's "Use it for" column. */
  purpose: string;
  /** Repo-relative path, e.g. `src/components/data-grid.tsx`. */
  sourcePath: string;
  /** Whether it is a client component — the registry's "Client?" column. */
  isClient: boolean;
}

/**
 * The registry as read off disk.
 *
 * `entries` is empty both when the file is missing and when it holds no Index
 * table, so the view needs `isAvailable` to tell "no document here" from "a
 * document that parsed to nothing" — two different things to put on screen.
 */
export interface ComponentList {
  entries: ComponentEntry[];
  /** False when `components.md` could not be read at all. */
  isAvailable: boolean;
}
