import type { CSSProperties } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ModuleCarousel } from "@/components/module-carousel";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { getAuthEventSummary } from "@/lib/auth-events";
import { dashboardTextureCssVars, getDashboardTexture } from "@/lib/dashboard-texture";
import { getRandomQuote } from "@/lib/daily-quote";
import {
  HOME_WIDGETS_SETTING_KEY,
  isHomeWidgetVisible,
  resolveHomeWidgets,
  visibleHomeWidgets,
  type HomeWidgetId,
} from "@/lib/home-dashboard";
import { listTodayInHistory } from "@/lib/journal";
import { listFavPhotos } from "@/lib/fav-photos";
import { pickRandomPhoto } from "@/lib/journal-photos";
import { listModules } from "@/lib/modules";
import { getSetting, getStartupMessage } from "@/lib/settings";
import { todayIsoLocal } from "@/lib/shared/date";
import {
  computeDayMovesByType,
  computeTickerDayMoves,
  listPositions,
} from "@/lib/stock-positions";
import { getAccessibleModules, isAdmin } from "@/lib/user";
import { getUserPreferences, resolveStartupDestination } from "@/lib/user-preferences";
import { deps } from "@/lib/wiring";
import { BadLoginAlert } from "./bad-login-alert";
import { DailyQuoteWidget } from "./daily-quote-widget";
import { HomeShell } from "./home-shell";
import { photoStore } from "./modules/[slug]/journal-photo-root";
import { StockDailyGlance } from "./modules/[slug]/stock-daily-glance";
import { PAGE_CONTAINER } from "./page-container";
import { RandomPhotoWidget } from "./random-photo-widget";
import { StartupMessage } from "./startup-message";
import { TodayInHistoryWidget } from "./today-in-history-widget";

const STOCK_ETFS_MODULE_SLUG = "stock-etfs";
const JOURNAL_MODULE_SLUG = "journal";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // `?home=1` means "I clicked Home" — show the home screen even for someone
  // whose preference is to open a favorite module. Without it the app-bar logo
  // pointed at a page that immediately redirected away, so the home screen was
  // unreachable once the preference was on.
  const askedForHome = (await searchParams).home !== undefined;

  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  // The (protected) layout already guarantees currentUser is defined here.
  const allModules = listModules(deps.moduleRepo);
  const modules = currentUser ? getAccessibleModules(currentUser, allModules, deps.userRepo) : [];

  // Somebody who has chosen a favorite module and asked to open it on startup
  // goes straight there — but only on a startup entry (bare `/`), not when they
  // asked for the home screen by name. Done before any of the home screen's own
  // data is read, so a redirected visit doesn't pay for a quote, the journal and
  // the positions it will never render. The destination is a module route, never
  // this page, so there is nothing to loop. A favorite that has since been hidden
  // or revoked resolves to undefined and lands here as normal — see
  // resolveStartupDestination.
  if (currentUser && !askedForHome) {
    const startupSlug = resolveStartupDestination(
      getUserPreferences(deps.userPreferencesRepo, currentUser.id),
      modules.map((appModule) => appModule.slug),
    );
    if (startupSlug) redirect(`/modules/${startupSlug}`);
  }

  // Which cards to draw and in what order -- Administration -> Display Settings ->
  // Dashboard Widgets, stored as one app setting (migrations/0067). Read before any of
  // the card data below so a hidden card can skip its own fetch entirely: an untied
  // Random Photo costs three directory listings over the NAS, and there is no point
  // paying that to render nothing. Visibility is an AND with each card's own condition,
  // never an override.
  const widgets = resolveHomeWidgets(getSetting(deps.settingsRepo, HOME_WIDGETS_SETTING_KEY)?.value);
  const shows = (id: HomeWidgetId) => isHomeWidgetVisible(widgets, id);

  // A fresh random quote is picked on every landing on the home screen.
  const quote = shows("dailyQuote") ? getRandomQuote(deps.dailyQuoteRepo) : undefined;
  const todayInHistory = shows("todayInHistory")
    ? listTodayInHistory(deps.journalRepo, todayIsoLocal())
    : [];
  // One photograph from anywhere in the archive, drawn fresh on every landing like the
  // quote above. Three directory listings over the share and no file read -- the bytes
  // are fetched separately by the browser from the image route. An unconfigured or
  // unreachable archive comes back as a `reason` rather than throwing, so a NAS that is
  // asleep cannot take the home screen down with it.
  const randomPhoto = shows("randomPhoto") ? await pickRandomPhoto(photoStore()) : undefined;
  // The favourites list, read alongside the draw and only when the card is shown. One
  // small table read that serves both the heart's state and the list dialog's contents,
  // so neither costs a round trip on first interaction.
  const favoritePhotos = shows("randomPhoto") ? listFavPhotos(deps.favPhotoRepo) : [];

  // Set by a deployment; blank once someone has clicked OK. Read here rather than
  // in the layout so it appears on the home screen specifically.
  const startupMessage = getStartupMessage(deps.settingsRepo);

  // Admins only: a non-admin can't reach the sign-in log, so warning them would be a
  // message they can't act on. Counted rather than read as a stored message, so it
  // clears only when the failures are actually reviewed — see migrations/0045.
  const unreviewedFailures =
    currentUser && isAdmin(currentUser)
      ? getAuthEventSummary(deps.authEventRepo).unreviewedFailures
      : 0;

  // Daily Glance is shown only to someone who can open the module it belongs to
  // — `modules` is already access-filtered, so testing it costs nothing extra.
  // Positions are read only once that's true, and an empty portfolio renders
  // nothing rather than a card of zeroes.
  const stockModule = modules.find((appModule) => appModule.slug === STOCK_ETFS_MODULE_SLUG);
  const positions = stockModule && shows("stockGlance") ? listPositions(deps.stockPositionRepo) : [];
  // Each dashboard card is badged with its own module's icon, so it's obvious at
  // a glance which module the numbers belong to. Undefined when the module is
  // hidden or not granted, in which case the card simply shows no glyph.
  const journalModule = modules.find((appModule) => appModule.slug === JOURNAL_MODULE_SLUG);

  // The dashboard's optional background picture. `undefined` when no image has
  // been uploaded, which is what keeps the fixed texture layer out of the DOM
  // entirely rather than rendering one at opacity 0 — see globals.css,
  // `[data-dashboard-texture]`. Cheap to read: the settings row carries
  // `hasImage`, never the bytes (migrations/0063).
  const textureVars = dashboardTextureCssVars(getDashboardTexture(deps.dashboardTextureRepo));

  // The cards that will actually appear, in order. Visibility alone isn't enough:
  // Daily Quote draws nothing until a quote exists and Daily Glance nothing without
  // positions, so a ticked-but-empty card would otherwise take the "first card" slot
  // and leave the real first card with a stray gap above it.
  const hasContent: Record<HomeWidgetId, boolean> = {
    carousel: true,
    dailyQuote: Boolean(quote),
    todayInHistory: true,
    randomPhoto: Boolean(randomPhoto),
    stockGlance: positions.length > 0,
  };
  const drawnWidgets = visibleHomeWidgets(widgets).filter((id) => hasContent[id]);

  return (
    // The home screen belongs to no module, so it gets the rail and the header
    // but no section panel — see `home-shell.tsx`.
    <HomeShell label="Home" icon="home" href="/?home=1">
      {/* The texture layer attaches to this wrapper, not to a nested element:
          its `::before` is `fixed` and must cover the viewport and sit behind
          the cards. The attribute is absent when nothing was uploaded. */}
      <div
        className={PAGE_CONTAINER}
        data-dashboard-texture={textureVars ? "" : undefined}
        style={textureVars as CSSProperties | undefined}
      >
        {/* Neither of these two is an arrangeable card, so neither appears in
            Dashboard Widgets: the deployment message is a one-shot notice that
            clears itself once acknowledged, and the failed sign-in alert is a
            security signal an admin shouldn't be able to tick away for good. */}
        {startupMessage && <StartupMessage message={startupMessage} />}
        {unreviewedFailures > 0 && <BadLoginAlert count={unreviewedFailures} />}

        {/* Drawn in the admin's chosen order rather than a fixed one, so the list
            below is a lookup and `widgets` is what decides the sequence. Each entry
            keeps its own render condition -- visibility only ever takes a card away,
            it can't conjure a quote or a position that isn't there. The shipped
            default order is the one this screen has always used: quote, history,
            photo, glance -- quietest first, and the longest (Daily Glance, five
            gainers and five losers) last so it isn't pushing the others off screen. */}
        {drawnWidgets.map((id, position) => {
          // The gap belongs to the position, not the card. Previously the carousel
          // was always first and so carried no top margin while the others hardcoded
          // `mt-8`; once any card can be first, that spacing has to be positional or
          // the top of the page gains a stray gap and a demoted carousel butts up
          // against the card above it.
          const spacing = position === 0 ? "" : "mt-8";
          switch (id) {
            case "carousel":
              return (
                // Plain data across the boundary -- the carousel is a client island
                // and can't be handed the module records themselves.
                <ModuleCarousel
                  key={id}
                  className={spacing}
                  modules={modules.map((appModule) => ({
                    slug: appModule.slug,
                    name: appModule.longName,
                    description: appModule.description,
                    icon: appModule.icon,
                    href: `/modules/${appModule.slug}`,
                    // A flag and a timestamp, never the bytes -- the browser fetches
                    // the artwork from the image route.
                    hasImage: appModule.hasCarouselImage,
                    imageVersion: appModule.updatedAt,
                  }))}
                />
              );
            case "dailyQuote":
              return quote ? (
                <DailyQuoteWidget
                  key={id}
                  className={spacing}
                  initialQuote={quote}
                  isAdmin={currentUser ? isAdmin(currentUser) : false}
                />
              ) : null;
            case "todayInHistory":
              return (
                <TodayInHistoryWidget
                  key={id}
                  className={spacing}
                  todayInHistory={todayInHistory}
                  icon={journalModule?.icon}
                />
              );
            case "randomPhoto":
              // `randomPhoto` is undefined only when this card is hidden, in which
              // case we aren't in this branch -- the check is what keeps the prop
              // required rather than widening it for a case that can't happen.
              return randomPhoto ? (
                <RandomPhotoWidget
                  key={id}
                  className={spacing}
                  initialPick={randomPhoto}
                  initialFavorites={favoritePhotos}
                />
              ) : null;
            case "stockGlance":
              return positions.length > 0 ? (
                <StockDailyGlance
                  key={id}
                  className={spacing}
                  moves={computeDayMovesByType(positions)}
                  // Summed per ticker here, not in the view: a holding split across
                  // two accounts is still one security, and that rollup is domain
                  // logic.
                  tickerMoves={computeTickerDayMoves(positions)}
                  icon={stockModule?.icon}
                />
              ) : null;
          }
        })}
      </div>
    </HomeShell>
  );
}
