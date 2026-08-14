import { cookies } from "next/headers";
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
import { getAccessibleModules, isAdmin } from "@/lib/user";
import { deps } from "@/lib/wiring";
import { DailyQuoteWidget } from "./daily-quote-widget";
import { PAGE_CONTAINER } from "./page-container";
import { StartupMessage } from "./startup-message";
import { TodayInHistoryWidget } from "./today-in-history-widget";

export default async function Home() {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  // The (protected) layout already guarantees currentUser is defined here.
  const allModules = listModules(deps.moduleRepo);
  const modules = currentUser ? getAccessibleModules(currentUser, allModules, deps.userRepo) : [];
  const appName = getSetting(deps.settingsRepo, "application_name")?.value ?? "MyHomeBase";
  // A fresh random quote is picked on every landing on the home screen.
  const quote = getRandomQuote(deps.dailyQuoteRepo);
  const todayInHistory = listTodayInHistory(deps.journalRepo, todayIsoLocal());
  // Set by a deployment; blank once someone has clicked OK. Read here rather than
  // in the layout so it appears on the home screen specifically.
  const startupMessage = getStartupMessage(deps.settingsRepo);

  return (
    <div className={PAGE_CONTAINER}>
      {startupMessage && <StartupMessage message={startupMessage} />}
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
