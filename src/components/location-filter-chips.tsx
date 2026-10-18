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
// Presentational: it renders the names it is given and says which were picked.
// It does not know what the filtering then does, and it does no searching.

import { FilterChip } from "@/app/(protected)/admin/locations/filter-chip";

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
   * name with no entry simply draws as a plain chip.
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
  // Nothing to filter on: draw nothing rather than two empty labelled rows.
  // Every caller had this guard inline; it belongs here.
  if (categoryOptions.length === 0 && tagOptions.length === 0) return null;

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {categoryOptions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-muted">Categories</span>
          {categoryOptions.map((option) => (
            <FilterChip
              key={option}
              label={option}
              iconUrl={categoryIcons?.[option]}
              isActive={activeCategories.includes(option)}
              onToggle={() => onCategoriesChange(toggle(activeCategories, option))}
            />
          ))}
        </div>
      )}

      {tagOptions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-muted">Tags</span>
          {tagOptions.map((option) => (
            <FilterChip
              key={option}
              label={option}
              iconUrl={tagIcons?.[option]}
              isActive={activeTags.includes(option)}
              onToggle={() => onTagsChange(toggle(activeTags, option))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
