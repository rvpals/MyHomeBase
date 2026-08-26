import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { MusicPlayerBar } from "@/components/music-player-bar";
import { MusicPlayerProvider } from "@/components/music-player-provider";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { deps } from "@/lib/wiring";
import {
  advanceQueueAction,
  clearQueueAction,
  closeQueueAction,
  enqueueTracksAction,
  getQueueAction,
  playQueueEntryAction,
  removeQueueEntryAction,
  rewindQueueAction,
  setQueueAction,
  setRepeatModeAction,
  shuffleQueueAction,
} from "./modules/[slug]/music-queue-actions";

// The queue's server actions, handed to the player provider as props.
//
// Wired here rather than imported inside the component for the reason components.md
// gives: a shared component takes props and emits events, so a file under
// src/components must not reach into src/app. This object is where the two layers meet,
// and it is typechecked against MusicQueueActions at the call site below.
const musicQueueActions = {
  getQueue: getQueueAction,
  setQueue: setQueueAction,
  enqueueTracks: enqueueTracksAction,
  playQueueEntry: playQueueEntryAction,
  advanceQueue: advanceQueueAction,
  rewindQueue: rewindQueueAction,
  shuffleQueue: shuffleQueueAction,
  removeQueueEntry: removeQueueEntryAction,
  clearQueue: clearQueueAction,
  closeQueue: closeQueueAction,
  setRepeatMode: setRepeatModeAction,
};

export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  if (!currentUser) redirect("/login");


  return (
    <div className="min-h-screen">
      {/* No top bar: navigation is `TwoTierShell`, which each module's own shell
          renders (see design.md, "Navigation: the two-tier shell"). The tiers are
          `fixed`, so `.app-main` pads for whichever are showing via the
          `html[data-shell]` rules in globals.css — this is a server component and
          can't see that client state. */}
      {/* No `px-*` here — `.app-main` sets the side gutter from `--app-gutter`,
          so a bar inside it can cancel exactly that much and run edge to edge. */}
      {/* The music player wraps the page rather than living inside the Music
          Library module: an <audio> element stops when it unmounts, so keeping the
          one instance above `children` is what lets a track keep playing while you
          navigate between modules. The bar renders nothing until something plays. */}
      <MusicPlayerProvider actions={musicQueueActions}>
        <main className="app-main min-h-screen pb-8">{children}</main>
        <MusicPlayerBar />
      </MusicPlayerProvider>
    </div>
  );
}
