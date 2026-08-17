import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ModuleCarousel } from "@/components/module-carousel";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { getAuthEventSummary } from "@/lib/auth-events";
import { getRandomQuote } from "@/lib/daily-quote";
import { listTodayInHistory } from "@/lib/journal";
import { listModules } from "@/lib/modules";
import { getStartupMessage } from "@/lib/settings";
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
import { StockDailyGlance } from "./modules/[slug]/stock-daily-glance";
import { PAGE_CONTAINER } from "./page-container";
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

  // A fresh random quote is picked on every landing on the home screen.
  const quote = getRandomQuote(deps.dailyQuoteRepo);
  const todayInHistory = listTodayInHistory(deps.journalRepo, todayIsoLocal());
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
  const positions = stockModule ? listPositions(deps.stockPositionRepo) : [];
  // Each dashboard card is badged with its own module's icon, so it's obvious at
  // a glance which module the numbers belong to. Undefined when the module is
  // hidden or not granted, in which case the card simply shows no glyph.
  const journalModule = modules.find((appModule) => appModule.slug === JOURNAL_MODULE_SLUG);

  return (
    <div className={PAGE_CONTAINER}>
      {startupMessage && <StartupMessage message={startupMessage} />}
      {unreviewedFailures > 0 && <BadLoginAlert count={unreviewedFailures} />}
      {/* Plain data across the boundary — the carousel is a client island and
          can't be handed the module records themselves. */}
      <ModuleCarousel
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
      {/* Quote, then history, then the glance — quietest card first, and the
          longest (Daily Glance, five gainers and five losers) last so it isn't
          pushing the other two off the screen. */}
      {quote && (
        <DailyQuoteWidget
          className="mt-8"
          initialQuote={quote}
          isAdmin={currentUser ? isAdmin(currentUser) : false}
        />
      )}
      <TodayInHistoryWidget
        className="mt-8"
        todayInHistory={todayInHistory}
        icon={journalModule?.icon}
      />
      {positions.length > 0 && (
        <StockDailyGlance
          className="mt-8"
          moves={computeDayMovesByType(positions)}
          // Summed per ticker here, not in the view: a holding split across two
          // accounts is still one security, and that rollup is domain logic.
          tickerMoves={computeTickerDayMoves(positions)}
          icon={stockModule?.icon}
        />
      )}
    </div>
  );
}
