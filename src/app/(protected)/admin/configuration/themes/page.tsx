"use client";

import { COLOR_THEMES } from "@/lib/settings";
import { useAdminSettings } from "../../admin-shell";

export default function ColorThemesPage() {
  const { colorThemeId, setColorThemeId } = useAdminSettings();

  return (
    <div className="mx-auto max-w-4xl">
      <p className="font-mono text-xs font-medium uppercase tracking-widest text-brass-dark">
        Configuration
      </p>
      <h1 className="mt-2 font-display text-3xl font-semibold text-ink">Color Themes</h1>
      <p className="mt-2 text-sm text-muted">
        Pick a color theme for the whole application. Applies everywhere once saved.
      </p>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {COLOR_THEMES.map((theme) => {
          const active = theme.id === colorThemeId;
          return (
            <button
              key={theme.id}
              type="button"
              onClick={() => setColorThemeId(theme.id)}
              aria-pressed={active}
              className={`rounded-xl border p-4 text-left transition ${
                active ? "border-brass ring-2 ring-brass" : "border-line hover:border-brass/50"
              }`}
              style={{ backgroundColor: theme.tokens.paperRaised }}
            >
              <div className="flex items-center gap-2">
                <span className="flex shrink-0 -space-x-1.5">
                  <span
                    className="h-6 w-6 rounded-full border border-black/10"
                    style={{ backgroundColor: theme.tokens.paper }}
                  />
                  <span
                    className="h-6 w-6 rounded-full border border-black/10"
                    style={{ backgroundColor: theme.tokens.brass }}
                  />
                  <span
                    className="h-6 w-6 rounded-full border border-black/10"
                    style={{ backgroundColor: theme.tokens.ink }}
                  />
                </span>
                <span
                  className="font-display text-base font-semibold"
                  style={{ color: theme.tokens.ink }}
                >
                  {theme.name}
                </span>
                {active && (
                  <span
                    className="ml-auto shrink-0 rounded-full px-2 py-0.5 text-xs font-medium text-white"
                    style={{ backgroundColor: theme.tokens.brass }}
                  >
                    Selected
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm" style={{ color: theme.tokens.muted }}>
                {theme.description}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
