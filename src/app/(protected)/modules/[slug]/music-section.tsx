import { getModuleBySlug } from "@/lib/modules";
import { deps } from "@/lib/wiring";
import { MusicConfigurationView } from "./music-configuration-view";
import { MusicLibraryView } from "./music-library-view";
import { MusicPlayerView } from "./music-player-view";
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
          <h1 className="font-display text-2xl text-ink">{info.label}</h1>
          <p className="text-sm text-muted">{info.description}</p>
        </header>

        {section === "main" && <MusicLibraryView />}
        {section === "player" && <MusicPlayerView />}
        {section === "scan" && <MusicScanView />}
        {section === "configuration" && <MusicConfigurationView />}
      </div>
    </SectionLayout>
  );
}
