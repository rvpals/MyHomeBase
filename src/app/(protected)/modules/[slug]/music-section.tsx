import { Comments } from "@/components/comments";
import { MusicConfigurationView } from "./music-configuration-view";
import { MusicLibraryView } from "./music-library-view";
import { MagicInstructions } from "./music-magic-instructions";
import { MusicMagicView } from "./music-magic-view";
import { MusicPlayerView } from "./music-player-view";
import { MusicQueueView } from "./music-queue-view";
import { MusicScanView } from "./music-scan-view";
import { MusicShell } from "./music-shell";
import { MUSIC_SECTION_INFO, type MusicSection } from "./music-sections";

// Composes one Music Library section: the section nav, a heading, and the section's own
// view. A server component, so it can read `deps` directly and hand plain data to the
// client views. Mirrors attendance-section.tsx.


export async function MusicSection({ section }: { section: MusicSection }) {
  const info = MUSIC_SECTION_INFO[section];

  return (
    // The two-tier shell: a module rail, a section panel and a utility header,
    // all placed by `MusicShell`. See design.md, "Navigation: the two-tier
    // shell".
    //
    // `async` because the shell reads cookies for the session and the pinned
    // layout, which `next/headers` only exposes as a promise.
    <MusicShell>
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
    </MusicShell>
  );
}
