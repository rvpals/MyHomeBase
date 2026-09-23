import type { ReactNode } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { MusicPlayerBar } from "@/components/music-player-bar";
import { MusicPlayerProvider } from "@/components/music-player-provider";
import { CompactNavStyleProvider } from "@/components/nav-style-context";
import { FloatingHost } from "@/components/floating-host";
import type { CalculatorActions } from "@/components/floating-calculator";
import type { FloatingActions } from "@/components/floating-layer";
import type { ScratchpadActions } from "@/components/floating-scratchpad";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { listCalculations } from "@/lib/calculator";
import { describeClock } from "@/lib/clock";
import { getEnabledFloating } from "@/lib/floating";
import { getScratchpad } from "@/lib/scratchpad";
import { recordSiteVisit } from "@/lib/site-visits";
import { getUserPreferences } from "@/lib/user-preferences";
import { getForecast, type WeatherForecast } from "@/lib/weather";
import { deps } from "@/lib/wiring";
import { readSiteVisitContext } from "../login/request-context";
import { ClockWeather } from "./clock-weather";
import {
  clearCalculationHistoryAction,
  createScratchpadNoteAction,
  deleteScratchpadNoteAction,
  listScratchpadNotesAction,
  recordCalculationAction,
  saveCalculatorStateAction,
  saveFloatingCornerAction,
  saveFloatingStateAction,
  saveScratchpadNoteAction,
} from "./account/actions";
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

// The floating layer's and the calculator's server actions, handed to the host as props
// for exactly the reason the queue actions below are: a shared component takes props and
// emits events, so a file under src/components must not reach into src/app.
//
// Each action is assigned **directly — never wrapped in an arrow.** A `"use server"`
// function is passable to a client component because React recognises that specific
// function; `saveState: (id, state) => action({ id, state })` produces an ordinary
// closure, and serializing it fails at request time with "Functions cannot be passed
// directly to Client Components". That is why both ports mirror their action's exact
// signature rather than offering a tidier one, and why these objects are only ever
// assignments. Adapt shapes inside the client component, not here.
const floatingActions: FloatingActions = {
  saveState: saveFloatingStateAction,
  saveCorner: saveFloatingCornerAction,
};

const calculatorActions: CalculatorActions = {
  record: recordCalculationAction,
  clearHistory: clearCalculationHistoryAction,
  saveState: saveCalculatorStateAction,
};

// Same rule, and worth repeating because it is the one that bites at runtime: every
// value here is the action itself, never an arrow around it.
const scratchpadActions: ScratchpadActions = {
  listNotes: listScratchpadNotesAction,
  createNote: createScratchpadNoteAction,
  saveNote: saveScratchpadNoteAction,
  deleteNote: deleteScratchpadNoteAction,
};

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
  if (!currentUser) {
    // Somebody arrived at the site root without a session. Logged before the
    // redirect, because after it this render is over — and only for the root, which
    // is the scope migrations/0102 deliberately drew: a full access log on a public
    // hostname is thousands of rows a day answering a question nobody asked.
    //
    // The path comes from `src/proxy.ts`, since a server layout cannot read the
    // current URL. Never throws (see `recordSiteVisit`), so a failed audit write
    // cannot turn a visitor's arrival into an error page.
    const path = (await headers()).get("x-mhb-path");
    if (path === "/") {
      recordSiteVisit(
        await readSiteVisitContext(path),
        deps.siteVisitRepo,
        deps.ipAllowlistRepo,
      );
    }
    redirect("/login");
  }

  // The reader's compact navigation arrangement, read here rather than in the
  // root layout because it is per-user and this is the first layout that knows
  // who they are. Resolved on the server so the very first HTML draws the bar
  // they chose — navigation is the worst place for a visible rearrangement one
  // frame after hydration.
  const preferences = getUserPreferences(deps.userPreferencesRepo, currentUser.id);
  const { compactNavStyle } = preferences;

  // The floating layer. Resolved here, in the one layout every authenticated page
  // shares, because a floating window has to outlive navigation — mounting it inside a
  // page would close it on every link, the same reason the music player lives here.
  const enabledFloating = getEnabledFloating(deps.settingsRepo);
  const clockFloating = enabledFloating.includes("clock") && preferences.floating.clock !== "closed";

  // The Clock's inputs, fetched only when the floating clock is actually up. The date
  // is free; the forecast is a network call, so it is gated on all three of: the
  // component enabled, this reader having it open, and the weather toggle on.
  //
  // Wrapped exactly as the home screen's is: Open-Meteo being down must degrade to a
  // clock without a forecast, never to an app that won't render. `getForecast` caches
  // 30 minutes per location, so this shares the home screen's cache entry rather than
  // doubling the traffic.
  const clockReading = describeClock();
  const weatherLocation =
    clockFloating && preferences.clock.showWeather ? preferences.weatherLocation : undefined;

  // The tape, read only when the calculator is actually up. A closed or disabled
  // component costs no query — the same gating the forecast below gets, and the reason
  // both are resolved here rather than inside the client component.
  const calculatorFloating =
    enabledFloating.includes("calculator") && preferences.floating.calculator !== "closed";
  const calculatorHistory = calculatorFloating
    ? listCalculations(deps.calculatorHistoryRepo, currentUser.id)
    : [];

  // The scratchpad, read only when it is actually up — the same gating the tape and the
  // forecast get. A closed or disabled component costs no query.
  //
  // `getScratchpad` resolves the tab strip, the active tab and that tab's notes in one
  // call, so the window's first paint has the right tab selected rather than flipping to
  // it after hydration. Only the active tab's notes are read: a household that has used
  // this for a year has a lot of notes, and the window shows one tab at a time.
  const scratchpadFloating =
    enabledFloating.includes("scratchpad") && preferences.floating.scratchpad !== "closed";
  const scratchpad = scratchpadFloating
    ? getScratchpad(deps.noteCategoryRepo, deps.scratchpadRepo, currentUser.id)
    : { categories: [], notes: [], activeCategoryId: undefined };

  let forecast: WeatherForecast | undefined;
  if (weatherLocation) {
    try {
      forecast = await getForecast(deps.weatherClient, {
        latitude: weatherLocation.latitude,
        longitude: weatherLocation.longitude,
        unit: preferences.weatherUnit,
        days: 7,
      });
    } catch {
      // Swallowed: the floating clock simply shows no weather. Unlike the home card
      // there is no notice — a 320px window is not where a reader wants an apology.
      forecast = undefined;
    }
  }

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
      <CompactNavStyleProvider value={compactNavStyle}>
        <MusicPlayerProvider actions={musicQueueActions}>
          <main className="app-main min-h-screen pb-8">{children}</main>
          <MusicPlayerBar />
          {/* Below the player so the layer's pucks stack above the player's own,
              and inside both providers so a floating component can read either. */}
          <FloatingHost
            enabled={enabledFloating}
            initialStates={preferences.floating}
            initialCorners={preferences.floatingCorners}
            actions={floatingActions}
            clockReading={clockReading}
            clockOptions={preferences.clock}
            clockWeather={
              forecast && weatherLocation ? (
                <ClockWeather forecast={forecast} placeName={weatherLocation.name} />
              ) : undefined
            }
            calculatorActions={calculatorActions}
            calculatorAngleMode={preferences.calculator.angleMode}
            calculatorLastResult={preferences.calculator.lastResult}
            calculatorHistory={calculatorHistory}
            scratchpadActions={scratchpadActions}
            scratchpadCategories={scratchpad.categories}
            scratchpadNotes={scratchpad.notes}
            scratchpadCategoryId={scratchpad.activeCategoryId}
          />
        </MusicPlayerProvider>
      </CompactNavStyleProvider>
    </div>
  );
}
