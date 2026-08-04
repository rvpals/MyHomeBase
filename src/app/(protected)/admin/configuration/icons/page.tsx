"use client";

import { ModuleIconPreview } from "@/components/module-icons";
import type { ModuleIconSetId } from "@/components/module-icon-sets.generated";
import { ICON_SETS } from "@/lib/settings";
import { useAdminSettings } from "../../admin-shell";
import { PAGE_CONTAINER } from "../../../page-container";

// A representative handful of module concepts to preview each set with.
const PREVIEW_ICONS = ["building", "wallet", "chart", "shield", "book"];

export default function IconsPage() {
  const { iconSetId, setIconSetId } = useAdminSettings();

  return (
    <div className={PAGE_CONTAINER}>
      <p className="font-mono text-xs font-medium uppercase tracking-widest text-brass-dark">
        Configuration
      </p>
      <h1 className="mt-2 font-display text-3xl font-semibold text-ink">Icons</h1>
      <p className="mt-2 text-sm text-muted">
        Pick the icon set used for module icons on the home screen and sidebar. Color sets
        keep their own colors and aren&apos;t tinted to the theme accent. Applies everywhere
        once saved.
      </p>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {ICON_SETS.map((set) => {
          const active = set.id === iconSetId;
          return (
            <button
              key={set.id}
              type="button"
              onClick={() => setIconSetId(set.id)}
              aria-pressed={active}
              className={`rounded-xl border bg-paper-raised p-4 text-left transition ${
                active ? "border-brass ring-2 ring-brass" : "border-line hover:border-brass/50"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="font-display text-base font-semibold text-ink">{set.name}</span>
                {active && (
                  <span className="ml-auto shrink-0 rounded-full bg-brass px-2 py-0.5 text-xs font-medium text-paper">
                    Selected
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-muted">{set.description}</p>
              <div className="mt-4 flex items-center gap-2.5">
                {PREVIEW_ICONS.map((name) => (
                  <span
                    key={name}
                    className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                      set.colorful ? "border border-line bg-paper" : "bg-brass text-paper"
                    }`}
                  >
                    <ModuleIconPreview
                      setId={set.id as ModuleIconSetId}
                      name={name}
                      className="h-6 w-6"
                    />
                  </span>
                ))}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
