import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppChrome } from "@/components/app-chrome";
import { MusicPlayerBar } from "@/components/music-player-bar";
import { MusicPlayerProvider } from "@/components/music-player-provider";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { VIEWPORT_PINNED_COOKIE } from "@/lib/viewport";
import { listModules } from "@/lib/modules";
import { getSetting } from "@/lib/settings";
import { getAccessibleModules, isAdmin } from "@/lib/user";
import { deps } from "@/lib/wiring";
import { logoutAction } from "../login/actions";
import {
  advanceQueueAction,
  clearQueueAction,
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
// and it is typechecked against MusicQueueActions at the call site below -- the same
// shape `logoutAction` is passed to AppChrome.
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
  setRepeatMode: setRepeatModeAction,
};

function getAppName(): string {
  return getSetting(deps.settingsRepo, "application_name")?.value ?? "MyHomeBase";
}

export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  if (!currentUser) redirect("/login");

  const viewportPinned = cookieStore.get(VIEWPORT_PINNED_COOKIE)?.value === "1";

  const appName = getAppName();
  const allModules = listModules(deps.moduleRepo);
  const accessibleModules = getAccessibleModules(currentUser, allModules, deps.userRepo);
  const links = accessibleModules.map((appModule) => ({
    slug: appModule.slug,
    name: appModule.shortName,
    href: `/modules/${appModule.slug}`,
    icon: appModule.icon,
    hint: appModule.description,
  }));

  // Every bar is `fixed`, so they're out of the flow and content gets the full
  // width. `app-main` is the hook globals.css uses to pad for whichever bars are
  // showing — this stays a server component, so reacting to that client-side
  // state has to happen in CSS. The bottom edge stacks: the section nav sits on
  // it, and the music player rides above the nav rather than covering it.
  return (
    <div className="min-h-screen">
      <AppChrome
        links={links}
        appName={appName}
        currentUser={{
          id: currentUser.id,
          fullName: currentUser.fullName,
          avatarMimeType: currentUser.avatarMimeType,
          updatedAt: currentUser.updatedAt,
        }}
        showAdmin={isAdmin(currentUser)}
        logoutAction={logoutAction}
        viewportPinned={viewportPinned}
      />
      {/* No `px-*` here — `.app-main` sets the side gutter from `--app-gutter`,
          so the compact section-tree bar can cancel exactly that much and run
          edge to edge. */}
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
