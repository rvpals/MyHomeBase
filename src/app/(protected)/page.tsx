import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AdminIcon } from "@/components/admin-icon";
import { AppIcon } from "@/components/app-icon";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/button";
import { ModuleCarousel } from "@/components/module-carousel";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { getRandomQuote } from "@/lib/daily-quote";
import { listTodayInHistory } from "@/lib/journal";
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
import { DailyQuoteWidget } from "./daily-quote-widget";
import { StockDailyGlance } from "./modules/[slug]/stock-daily-glance";
import { PAGE_CONTAINER } from "./page-container";
import { StartupMessage } from "./startup-message";
import { TodayInHistoryWidget } from "./today-in-history-widget";

const STOCK_ETFS_MODULE_SLUG = "stock-etfs";

export default async function Home() {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  // The (protected) layout already guarantees currentUser is defined here.
  const allModules = listModules(deps.moduleRepo);
  const modules = currentUser ? getAccessibleModules(currentUser, allModules, deps.userRepo) : [];

  // Somebody who has chosen a favorite module and asked to open it on startup
  // goes straight there. Done before any of the home screen's own data is read,
  // so a redirected visit doesn't pay for a quote, the journal and the positions
  // it will never render. The destination is a module route, never this page, so
  // there is nothing to loop. A favorite that has since been hidden or revoked
  // resolves to undefined and lands here as normal — see resolveStartupDestination.
  if (currentUser) {
    const startupSlug = resolveStartupDestination(
      getUserPreferences(deps.userPreferencesRepo, currentUser.id),
      modules.map((appModule) => appModule.slug),
    );
    if (startupSlug) redirect(`/modules/${startupSlug}`);
  }

  const appName = getSetting(deps.settingsRepo, "application_name")?.value ?? "MyHomeBase";
  // A fresh random quote is picked on every landing on the home screen.
  const quote = getRandomQuote(deps.dailyQuoteRepo);
  const todayInHistory = listTodayInHistory(deps.journalRepo, todayIsoLocal());
  // Set by a deployment; blank once someone has clicked OK. Read here rather than
  // in the layout so it appears on the home screen specifically.
  const startupMessage = getStartupMessage(deps.settingsRepo);

  // Daily Glance leads the home screen, but only for someone who can open the
  // module it belongs to — `modules` is already access-filtered, so testing it
  // costs nothing extra. Positions are read only once that's true, and an empty
  // portfolio renders nothing rather than a card of zeroes above the app title.
  const canSeeStocks = modules.some((appModule) => appModule.slug === STOCK_ETFS_MODULE_SLUG);
  const positions = canSeeStocks ? listPositions(deps.stockPositionRepo) : [];

  return (
    <div className={PAGE_CONTAINER}>
      {startupMessage && <StartupMessage message={startupMessage} />}
      {positions.length > 0 && (
        <div className="mb-8">
          <StockDailyGlance
            moves={computeDayMovesByType(positions)}
            // Summed per ticker here, not in the view: a holding split across two
            // accounts is still one security, and that rollup is domain logic.
            tickerMoves={computeTickerDayMoves(positions)}
          />
        </div>
      )}
      <div className="flex flex-wrap items-center justify-center gap-4 max-lg:gap-2">
        {currentUser?.avatarMimeType ? (
          <Avatar
            userId={currentUser.id}
            avatarMimeType={currentUser.avatarMimeType}
            fallbackText={currentUser.fullName}
            size="lg"
            version={currentUser.updatedAt}
          />
        ) : (
          <AppIcon className="h-14 w-14 shrink-0" />
        )}
        <div className="flex flex-wrap items-center justify-center gap-3 max-lg:gap-2">
          <h1 className="font-display text-3xl font-semibold text-ink">{appName}</h1>
          {currentUser && isAdmin(currentUser) && (
            // Compact drops the label for a square gear puck: the full button
            // put icon + title + label at ~447px, which scrolled a 390px screen
            // sideways. `max-lg:` overrides only, so desktop can't regress.
            <Button
              href="/admin"
              variant="primary"
              title="Administration"
              ariaLabel="Administration"
              className="max-lg:h-9 max-lg:w-9 max-lg:p-0"
            >
              <AdminIcon className="h-4 w-4 max-lg:h-5 max-lg:w-5" />
              <span className="max-lg:hidden">Administration</span>
            </Button>
          )}
        </div>
      </div>
      <div className="mt-3 h-px w-full bg-line" />
      {/* Plain data across the boundary — the carousel is a client island and
          can't be handed the module records themselves. */}
      <ModuleCarousel
        className="mt-8"
        modules={modules.map((appModule) => ({
          slug: appModule.slug,
          name: appModule.longName,
          description: appModule.description,
          icon: appModule.icon,
          href: `/modules/${appModule.slug}`,
          // A flag and a timestamp, never the bytes — the browser fetches the
          // artwork from the image route.
          hasImage: appModule.hasCarouselImage,
          imageVersion: appModule.updatedAt,
        }))}
      />
      {quote && (
        <DailyQuoteWidget
          className="mt-8"
          initialQuote={quote}
          isAdmin={currentUser ? isAdmin(currentUser) : false}
        />
      )}
      <TodayInHistoryWidget className="mt-8" todayInHistory={todayInHistory} />
    </div>
  );
}
