import { Comments } from "@/components/comments";
import { getModuleBySlug } from "@/lib/modules";
import { deps } from "@/lib/wiring";
import { MusicConfigurationView } from "./music-configuration-view";
import { MusicLibraryView } from "./music-library-view";
import { MagicInstructions } from "./music-magic-instructions";
import { MusicMagicView } from "./music-magic-view";
import { MusicPlayerView } from "./music-player-view";
import { MusicQueueView } from "./music-queue-view";
import { MusicScanView } from "./music-scan-view";
import { MUSIC_SECTION_INFO, type MusicSection } from "./music-sections";
import { SectionLayout } from "./section-layout";

// Composes one Music Library section: the section nav, a heading, and the section's own
// view. A server component, so it can read `deps` directly and hand plain data to the
// client views. Mirrors attendance-section.tsx.

const MUSIC_LIBRARY_SLUG = "music-library";

export function MusicSection({ section }: { section: MusicSection }) {
  const info = MUSIC_SECTION_INFO[section];
  // The module's name and icon are admin-editable at runtime, so they are read from the
  // row rather than hardcoded -- same rule the other section shells follow.
  const musicModule = getModuleBySlug(deps.moduleRepo, MUSIC_LIBRARY_SLUG);

  return (
    <SectionLayout
      nav="music"
      module={musicModule ? { name: musicModule.shortName, icon: musicModule.icon } : undefined}
    >
      <div>
        <header className="mb-4">
          <h1 className="flex items-center gap-2 font-display text-2xl text-ink">
            {info.label}
            {/* Magic Playlist only: its guidance rides beside the title as a chip rather
                than filling a card above the builder. Same call as the attendance home
                screen -- the criteria builder is why a reader is here, and after the first
                visit the copy is read once and then in the way. The other sections have no
                instruction card to move. */}
            {section === "magic" && (
              <Comments title="Instruction" label="Instruction" content={<MagicInstructions />} />
            )}
          </h1>
          <p className="text-sm text-muted">{info.description}</p>
        </header>

        {section === "main" && <MusicLibraryView />}
        {section === "magic" && <MusicMagicView />}
        {section === "player" && <MusicPlayerView />}
        {section === "queue" && <MusicQueueView />}
        {section === "scan" && <MusicScanView />}
        {section === "configuration" && <MusicConfigurationView />}
      </div>
    </SectionLayout>
  );
}
