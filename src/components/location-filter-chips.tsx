"use client";

// The Categories / Tags filter block that sits above every list of saved
// places: Admin → Locations → Location Manager, Admin → Locations → Location
// Map, and the journal entry form's "add from the location database" tab.
//
// All three had their own copy of this markup plus their own `toggleFilter`,
// which is four near-identical implementations of "add it if missing, drop it
// if present". The component owns that toggle now and raises the next array, so
// a caller never writes it again.
//
// The two lists are drawn as one group box of square tiles rather than two
// loose rows of pills. Categories and tags are the same kind of question --
// "narrow this list to places marked X" -- so they read better framed together
// than as two unexplained strips above the results, and a square tile gives an
// uploaded taxonomy icon enough room to actually be recognised.
//
// Presentational: it renders the names it is given and says which were picked.
// It does not know what the filtering then does, and it does no searching.

import { FilterTile } from "@/components/filter-tile";

export interface LocationFilterChipsProps {
  /** Every category name that can be filtered on, in display order. */
  categoryOptions: string[];
  /** Every tag name that can be filtered on, in display order. */
  tagOptions: string[];
  /** Currently picked category names. Controlled — the caller owns the state. */
  activeCategories: string[];
  /** Currently picked tag names. Controlled. */
  activeTags: string[];
  /** The full next selection, not the one name that changed. */
  onCategoriesChange: (next: string[]) => void;
  onTagsChange: (next: string[]) => void;
  /**
   * Name -> icon URL. Optional and independent per list: the admin screens show
   * the uploaded taxonomy icons, the journal picker deliberately doesn't. A
   * name with no entry draws its monogram instead, so every tile is the same
   * size either way.
   */
  categoryIcons?: Record<string, string>;
  tagIcons?: Record<string, string>;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

/** Add it if missing, drop it if present. */
function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

/**
 * One labelled list of tiles inside the group box.
 *
 * `.tile-grid` sizes itself by auto-fit, so a tile is the same size on a phone
 * as on a desktop and nothing here counts columns per breakpoint.
 */
function TileSection({
  heading,
  options,
  active,
  icons,
  onChange,
}: {
  heading: string;
  options: string[];
  active: string[];
  icons?: Record<string, string>;
  onChange: (next: string[]) => void;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted">{heading}</h3>
      <div className="tile-grid gap-2">
        {options.map((option) => (
          <FilterTile
            key={option}
            label={option}
            iconUrl={icons?.[option]}
            isActive={active.includes(option)}
            onToggle={() => onChange(toggle(active, option))}
          />
        ))}
      </div>
    </section>
  );
}

export function LocationFilterChips({
  categoryOptions,
  tagOptions,
  activeCategories,
  activeTags,
  onCategoriesChange,
  onTagsChange,
  categoryIcons,
  tagIcons,
  className = "",
}: LocationFilterChipsProps) {
  // Nothing to filter on: draw nothing rather than an empty group box. Every
  // caller had this guard inline; it belongs here.
  if (categoryOptions.length === 0 && tagOptions.length === 0) return null;

  return (
    // `.panel-inset` over `bg-paper` — design.md's groove, which presses the
    // block into the page. The filters are a control surface the results flow
    // out of, not a card competing with them for attention.
    <div className={`panel-inset flex flex-col gap-4 rounded-md bg-paper p-3 ${className}`}>
      {categoryOptions.length > 0 && (
        <TileSection
          heading="Categories"
          options={categoryOptions}
          active={activeCategories}
          icons={categoryIcons}
          onChange={onCategoriesChange}
        />
      )}

      {tagOptions.length > 0 && (
        <TileSection
          heading="Tags"
          options={tagOptions}
          active={activeTags}
          icons={tagIcons}
          onChange={onTagsChange}
        />
      )}
    </div>
  );
}
