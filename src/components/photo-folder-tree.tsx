// A lazy, any-depth folder tree over the photo archive -- the photo viewer's "Browse"
// panel.
//
// LAZY ON PURPOSE. A folder's children are read only when the reader opens it, through
// the injected `onListFolder`, so the archive is never walked up front: a recursive read
// would list tens of thousands of files over SMB to draw a tree of which the reader
// opens three branches.
//
// Dark-on-black, because its only home is inside the viewer's opaque overlay. It is not
// `TreeNav` (two levels, app navigation) and not `FolderBrowser` (a modal that picks a
// folder one level at a time): this one shows files as well as folders, and a click on a
// file is the point of it.
//
// Pure presentation: every read is an injected callback, so `src/components/` keeps no
// dependency on `src/app/`.

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TreeIcon } from "@/components/tree-icons";

/** What `onListFolder` resolves to. The action's result is structurally assignable. */
export interface FolderTreeListing {
  ok: boolean;
  folders?: string[];
  photos?: string[];
  error?: string;
}

export interface PhotoFolderTreeProps {
  /**
   * Reads one level of the archive. `""` is the root.
   *
   * PASS A STABLE REFERENCE -- a module-scope server action. The mount effect depends
   * on it.
   */
  onListFolder: (relativePath: string) => Promise<FolderTreeListing>;
  /**
   * Folders to open on mount, root-first (see `ancestorFolders` in
   * `@/lib/journal-photos/browse`). Read ONCE, so the tree opens on the photo already
   * on the stage and then belongs to the reader.
   */
  initialExpanded?: readonly string[];
  /** The photo on the stage, highlighted in the tree when its folder is open. */
  selectedPath?: string;
  /**
   * A photo was clicked. Hands over the folder's whole photo list as well as the one
   * picked, so the viewer can make that folder its strip without a second read.
   */
  onSelectPhoto: (folderPath: string, photoNames: string[], photoName: string) => void;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

type Listing =
  | { status: "ok"; folders: string[]; photos: string[] }
  | { status: "error"; error: string };

/** Root-aware join, mirroring `joinArchivePath` without importing the lib barrel. */
function join(folder: string, name: string): string {
  return folder === "" ? name : `${folder}/${name}`;
}

/** Indentation per level. Inline style because the depth is unbounded. */
const INDENT_PX = 14;

export function PhotoFolderTree({
  onListFolder,
  initialExpanded = [],
  selectedPath,
  onSelectPhoto,
  className = "",
}: PhotoFolderTreeProps) {
  // Absent from this map means "not read yet" -- which, for an open folder, renders as
  // "Loading…". No separate loading flag, so no synchronous setState in an effect.
  const [listings, setListings] = useState<Record<string, Listing>>({});
  // `""` (the root) is always open: it has no row of its own to close it with.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(["", ...initialExpanded]),
  );
  // Which folders have been ASKED for. A ref, so a second expand of a folder still in
  // flight does not fire a second read -- the same pattern as the viewer's details cache.
  const requestedRef = useRef<Set<string>>(new Set());

  const load = useCallback(
    (folder: string) => {
      if (requestedRef.current.has(folder)) return;
      requestedRef.current.add(folder);
      void onListFolder(folder)
        .then(
          (outcome): Listing =>
            outcome.ok
              ? { status: "ok", folders: outcome.folders ?? [], photos: outcome.photos ?? [] }
              : { status: "error", error: outcome.error ?? "Couldn't read that folder." },
        )
        .catch((): Listing => ({ status: "error", error: "The photo archive isn't answering." }))
        .then((listing) => setListings((current) => ({ ...current, [folder]: listing })));
    },
    [onListFolder],
  );

  // Reads every folder open at mount. Later expansions read from `toggle`.
  useEffect(() => {
    for (const folder of expanded) load(folder);
    // Mount only: `expanded` changes are handled by `toggle`, which loads as it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const toggle = useCallback(
    (folder: string) => {
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(folder)) next.delete(folder);
        else next.add(folder);
        return next;
      });
      load(folder);
    },
    [load],
  );

  // Brings the photo on the stage into view ONCE, when its folder's listing first lands.
  // Only once: after that the tree belongs to the reader, and yanking the scroll back
  // every time a branch opened would fight them.
  const navRef = useRef<HTMLElement>(null);
  const hasScrolledRef = useRef(false);
  useEffect(() => {
    if (hasScrolledRef.current) return;
    const selected = navRef.current?.querySelector<HTMLElement>("[aria-current='true']");
    if (selected == null) return;
    hasScrolledRef.current = true;
    selected.scrollIntoView({ block: "center" });
  }, [listings]);

  // A retry after an error: forget the request so `load` asks again.
  const retry = useCallback(
    (folder: string) => {
      requestedRef.current.delete(folder);
      setListings((current) => {
        const next = { ...current };
        delete next[folder];
        return next;
      });
      load(folder);
    },
    [load],
  );

  function renderChildren(folder: string, depth: number) {
    const listing = listings[folder];
    const pad = { paddingLeft: 8 + depth * INDENT_PX };

    if (listing === undefined) {
      return (
        <li style={pad} className="py-1 text-xs text-white/40">
          Loading&hellip;
        </li>
      );
    }
    if (listing.status === "error") {
      return (
        <li style={pad} className="py-1 text-xs text-red-300">
          {listing.error}{" "}
          <button type="button" onClick={() => retry(folder)} className="underline">
            Retry
          </button>
        </li>
      );
    }
    if (listing.folders.length === 0 && listing.photos.length === 0) {
      return (
        <li style={pad} className="py-1 text-xs text-white/40">
          Empty folder
        </li>
      );
    }

    return (
      <>
        {listing.folders.map((name) => {
          const path = join(folder, name);
          const isOpen = expanded.has(path);
          return (
            <li key={`d:${path}`}>
              <button
                type="button"
                onClick={() => toggle(path)}
                aria-expanded={isOpen}
                title={name}
                style={pad}
                className="flex w-full items-center gap-1.5 py-1.5 pr-2 text-left text-sm text-white/85 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white"
              >
                <span aria-hidden="true" className="w-3 shrink-0 text-center text-white/50">
                  {isOpen ? "▾" : "▸"}
                </span>
                <TreeIcon name="photo-folder" className="h-4 w-4 shrink-0 text-white/60" />
                <span className="truncate">{name}</span>
              </button>
              {isOpen && <ul>{renderChildren(path, depth + 1)}</ul>}
            </li>
          );
        })}
        {listing.photos.map((name) => {
          const path = join(folder, name);
          const isSelected = path === selectedPath;
          return (
            <li key={`f:${path}`}>
              <button
                type="button"
                onClick={() => onSelectPhoto(folder, listing.photos, name)}
                aria-current={isSelected}
                title={name}
                // Photos sit one chevron-width further in than folders, so names line up.
                style={{ paddingLeft: 8 + depth * INDENT_PX + 18 }}
                className={`flex w-full items-center gap-1.5 py-1 pr-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white ${
                  isSelected ? "bg-white/15 text-white" : "text-white/65 hover:bg-white/10"
                }`}
              >
                <TreeIcon name="photo" className="h-3.5 w-3.5 shrink-0 text-white/50" />
                <span className="truncate font-mono">{name}</span>
              </button>
            </li>
          );
        })}
      </>
    );
  }

  return (
    <nav ref={navRef} aria-label="Photo archive folders" className={className}>
      <ul>{renderChildren("", 0)}</ul>
    </nav>
  );
}
