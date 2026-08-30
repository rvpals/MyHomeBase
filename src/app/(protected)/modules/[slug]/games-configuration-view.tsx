"use client";

import { GAME_CATALOGUE } from "@/lib/games";

// The Games module's Configuration screen.
//
// There is nothing to configure yet, and this screen says so plainly rather than
// shipping a settings form with no settings in it. What it does show is the catalogue
// read-only, which is the useful thing here: it answers "what can this install
// play?" and makes clear the list is part of the build rather than data an admin
// could add a row to. No `sys_module_settings` keys, so no settings.ts in the
// library module (modules.md step 6 — only if needed).

export function GamesConfigurationView() {
  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl border border-line bg-paper-raised p-5">
        <h2 className="font-display text-base text-ink">Games in this build</h2>
        <p className="mt-1 text-sm text-muted">
          The catalogue lives in the application code, not in the database — a game exists
          when the code that draws it does. That is why there is nothing to add or remove
          here.
        </p>

        <ul className="mt-4 flex flex-col divide-y divide-line border-t border-line">
          {GAME_CATALOGUE.map((game) => (
            <li key={game.key} className="flex items-baseline justify-between gap-3 py-2">
              <div>
                <span className="text-sm text-ink">{game.name}</span>
                <p className="text-xs text-muted">{game.description}</p>
              </div>
              <span className="whitespace-nowrap text-xs text-muted">
                {game.status === "available" ? "Playable" : "Coming soon"}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-line bg-paper-raised p-5">
        <h2 className="font-display text-base text-ink">Scores</h2>
        <p className="mt-1 text-sm text-muted">
          The high-score board is shared by everyone with access to this module, and a
          score cannot be edited or deleted once a game has finished. Access itself is
          granted per user in Administration → User Management.
        </p>
      </section>
    </div>
  );
}
