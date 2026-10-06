import type { CSSProperties, ReactNode } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { CollapsibleCardScope } from "@/components/collapsible-card-scope";
import { MusicPlayerBar } from "@/components/music-player-bar";
import { MusicPlayerProvider } from "@/components/music-player-provider";
import { CompactNavStyleProvider } from "@/components/nav-style-context";
import { FloatingHost } from "@/components/floating-host";
import { PersonalToolbars } from "@/components/personal-toolbar";
import type { CalculatorActions } from "@/components/floating-calculator";
import type { FloatingActions } from "@/components/floating-layer";
import type { ScratchpadActions } from "@/components/floating-scratchpad";
import { resolveAppTexture } from "@/lib/app-texture";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { listCalculations } from "@/lib/calculator";
import { getDashboardTexture, listDashboardTextures } from "@/lib/dashboard-texture";
import { describeClock } from "@/lib/clock";
import { getEnabledFloating } from "@/lib/floating";
import { getScratchpad } from "@/lib/scratchpad";
import { listMenuItems } from "@/lib/menu-items";
import { listModules } from "@/lib/modules";
import {
  listToolbars,
  parseHiddenToolbars,
  resolveToolbarsFor,
  TOOLBARS_HIDDEN_PREFERENCE_KEY,
} from "@/lib/toolbars";
import { recordSiteVisit } from "@/lib/site-visits";
import { isAdmin } from "@/lib/user";
import { getUserPreferences } from "@/lib/user-preferences";
import { getForecast, type WeatherForecast } from "@/lib/weather";
import { deps } from "@/lib/wiring";
import { readSiteVisitContext } from "../login/request-context";
import { createMenuItemSource } from "./menu-item-source";
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

  // Personal toolbars (migration 0125) — additional shortcut bars docked to a screen
  // edge. **Not navigation**: the tree and the compact bar are untouched, and a reader
  // with no toolbars sees exactly what they saw before.
  //
  // Resolved here, in the one layout every authenticated page shares, for the same
  // reason the floating layer is: a bar is app-wide chrome that outlives navigation.
  // Every visibility rule except `fullModeOnly` is applied on the server — the admin's
  // switch, this reader's hide list, and dropping rows whose menu item no longer
  // exists — so the first HTML is already correct. `fullModeOnly` is the client's,
  // because the reader can pin the compact layout on a wide window.
  const hiddenToolbars = parseHiddenToolbars(
    deps.userPreferencesRepo
      .listByUserId(currentUser.id)
      .find((row) => row.key === TOOLBARS_HIDDEN_PREFERENCE_KEY)?.value,
  );
  const toolbars = resolveToolbarsFor(
    listToolbars(deps.toolbarRepo),
    listMenuItems(
      createMenuItemSource(listModules(deps.moduleRepo, { includeHidden: true })),
      deps.menuItemOverrideRepo,
    ),
    {
      // `isCompact: false` — the server does not decide this one; see above.
      isCompact: false,
      hiddenIds: hiddenToolbars,
      // The app texture library, so a bar pointing at one of its pictures
      // (migration 0130) resolves to a URL here rather than in the component.
      // Cheap: `listDashboardTextures` never reads the image bytes, and the
      // library is capped at 20 rows.
      textures: listDashboardTextures(deps.dashboardTextureRepo),
    },
  );

  // The app-wide background picture (migration 0116). Resolved in the one layout
  // every authenticated page shares, which is what makes "the same texture on
  // every screen" a single wrapper rather than a line in each of nine module
  // shells plus Administration plus the account screen.
  //
  // No module texture is passed: this layout cannot know which module a child
  // route belongs to, and does not need to. A module that has its own picture
  // suppresses this layer and draws its own from its shell — see
  // `music-shell.tsx`, and `resolveAppTexture` for the precedence.
  //
  // Cheap: the settings row carries `hasImage`, never the bytes. `vars` is
  // undefined unless an admin has both selected a picture and ticked the scope
  // on, and then no attribute is rendered and there is no fixed compositing
  // layer at all.
  const appTexture = resolveAppTexture(getDashboardTexture(deps.dashboardTextureRepo));

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
          {/* The texture attaches to `.app-main` itself rather than to a nested
              div: its `::before` is `fixed` so it covers the viewport either
              way, but the wrapper must be a stacking context that contains the
              page's content, and adding another element here would change the
              padding `.app-main` reserves for the nav tiers. The attribute is
              absent unless there is a picture to draw. */}
          <main
            className="app-main min-h-screen pb-8"
            data-app-texture={appTexture.vars ? "" : undefined}
            style={appTexture.vars as CSSProperties | undefined}
          >
            {/* Gives every `CollapsibleCard` under a route its ordinal, so the
                cards remember whether the reader left them open. Wraps
                `children` only — deliberately not the floating layer below,
                whose windows outlive navigation and would otherwise consume
                ordinals that belong to the page. */}
            <CollapsibleCardScope>{children}</CollapsibleCardScope>
          </main>
          <MusicPlayerBar />
          {/* Docked shortcut bars. **Additive** — this renders nothing at all for a
              reader with no toolbars, and it never replaces a navigation tier: the
              tree and the compact bottom bar are untouched. Placed after the player
              because its CSS stacks above `--music-player-height`, so the player
              keeps the bottom edge and a bottom toolbar sits on top of it. */}
          {/* `canEdit` offers the ✎ shortcut into each bar's editor. Admins only —
              the screen it links to calls `requireAdmin()` itself, so this decides
              whether the control is *offered*, never whether it is allowed. */}
          <PersonalToolbars toolbars={toolbars} canEdit={isAdmin(currentUser)} />
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
