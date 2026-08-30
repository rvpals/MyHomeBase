import { CollapsibleCard } from "@/components/collapsible-card";
import { listGames, listTopScores } from "@/lib/games";
import { deps } from "@/lib/wiring";
import { GamesArcadeView } from "./games-arcade-view";
import { GamesConfigurationView } from "./games-configuration-view";
import { GamesInstructions } from "./games-instructions";
import { GamesScoresView } from "./games-scores-view";
import { GamesShell } from "./games-shell";
import { GAMES_SECTION_INFO, type GamesSection as GamesSectionName } from "./games-sections";

// Composes one Games section: the section nav, a heading, the instruction card, and
// the section's own view. A server component, so it can read `deps` directly and hand
// plain data to the client views. Mirrors csv-section.tsx.
//
// Each section loads only what it needs: Arcade reads the catalogue plus each game's
// best score, Scores reads the board, and Configuration reads nothing at all.

const TOP_SCORE_LIMIT = 100;

export async function GamesSection({ section }: { section: GamesSectionName }) {
  const info = GAMES_SECTION_INFO[section];

  return (
    // The two-tier shell: a module rail, a section panel and a utility header, all
    // placed by `GamesShell`. See design.md, "Navigation: the two-tier shell".
    <GamesShell>
      <div>
        <header className="mb-4">
          <h1 className="font-display text-2xl text-ink">{info.label}</h1>
          <p className="text-sm text-muted">{info.description}</p>
        </header>

        <CollapsibleCard title="Instruction">
          <GamesInstructions section={section} />
        </CollapsibleCard>

        <div className="mt-6">
          {section === "main" && <GamesArcadeView games={listGames(deps.gamesRepo)} />}
          {section === "scores" && (
            <GamesScoresView
              scores={listTopScores(deps.gamesRepo, { limit: TOP_SCORE_LIMIT })}
            />
          )}
          {section === "configuration" && <GamesConfigurationView />}
        </div>
      </div>
    </GamesShell>
  );
}
