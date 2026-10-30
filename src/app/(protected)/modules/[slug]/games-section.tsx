import { CollapsibleCard } from "@/components/collapsible-card";
import {
  arrowBestScores,
  countCustomWords,
  listCustomWords,
  listGames,
  listPlayableWords,
  listTopScores,
  PICTIONARY_TIERS,
  type PictionaryTier,
  type PictionaryWord,
} from "@/lib/games";
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
// Each section loads only what it needs: Arcade reads the catalogue, each game's best
// score and Pictionary's word pool; Scores reads the board; Configuration reads the
// custom word bank.

const TOP_SCORE_LIMIT = 100;

export async function GamesSection({ section }: { section: GamesSectionName }) {
  const info = GAMES_SECTION_INFO[section];

  /*
    Pictionary's word pool, per tier — the built-in bank joined with whatever this
    household imported. Resolved here because a client component cannot read `deps`,
    and per tier because the session picks its tier after this has already loaded.

    All three tiers are read rather than only the chosen one: the pick happens in the
    browser, and fetching on change would mean a round trip between choosing "hard" and
    being able to start. The whole bank is a few hundred short strings.
  */
  const wordPool =
    section === "main"
      ? (Object.fromEntries(
          PICTIONARY_TIERS.map((tier) => [
            tier,
            listPlayableWords(deps.pictionaryWordsRepo, tier),
          ]),
        ) as Record<PictionaryTier, readonly PictionaryWord[]>)
      : ({} as Record<PictionaryTier, readonly PictionaryWord[]>);


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
          {/* Arrow Clearing is one card but three scoreboards, so its per-tier bests
              are read alongside the catalogue — see `arrowBestScores`. */}
          {section === "main" && (
            <GamesArcadeView
              games={listGames(deps.gamesRepo)}
              arrowBests={arrowBestScores(deps.gamesRepo)}
              wordPool={wordPool}
            />
          )}
          {section === "scores" && (
            <GamesScoresView
              scores={listTopScores(deps.gamesRepo, { limit: TOP_SCORE_LIMIT })}
            />
          )}
          {section === "configuration" && (
            <GamesConfigurationView
              words={listCustomWords(deps.pictionaryWordsRepo)}
              wordCounts={countCustomWords(deps.pictionaryWordsRepo)}
            />
          )}
        </div>
      </div>
    </GamesShell>
  );
}
