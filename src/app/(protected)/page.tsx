import { cookies } from "next/headers";
import { AdminIcon } from "@/components/admin-icon";
import { AppIcon } from "@/components/app-icon";
import { Button } from "@/components/button";
import { ModuleCarousel } from "@/components/module-carousel";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { getRandomQuote } from "@/lib/daily-quote";
import { listModules } from "@/lib/modules";
import { getSetting } from "@/lib/settings";
import { getAccessibleModules, isAdmin } from "@/lib/user";
import { deps } from "@/lib/wiring";
import { DailyQuoteWidget } from "./daily-quote-widget";
import { PAGE_CONTAINER } from "./page-container";

export default async function Home() {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  // The (protected) layout already guarantees currentUser is defined here.
  const allModules = listModules(deps.moduleRepo);
  const modules = currentUser ? getAccessibleModules(currentUser, allModules, deps.userRepo) : [];
  const appName = getSetting(deps.settingsRepo, "application_name")?.value ?? "MyHomeBase";
  // A fresh random quote is picked on every landing on the home screen.
  const quote = getRandomQuote(deps.dailyQuoteRepo);

  return (
    <div className={PAGE_CONTAINER}>
      {/* Wraps below `lg`: icon + title + the Administration button come to
          ~447px, which scrolls a 390px screen sideways. */}
      <div className="flex flex-wrap items-center justify-center gap-4 max-lg:gap-2">
        <AppIcon className="h-14 w-14 shrink-0" />
        <h1 className="font-display text-3xl font-semibold text-ink">{appName}</h1>
        {currentUser && isAdmin(currentUser) && (
          <Button href="/admin" variant="primary">
            <AdminIcon className="h-4 w-4" />
            Administration
          </Button>
        )}
      </div>
      <div className="mt-3 h-px w-full bg-line" />
      {quote && <DailyQuoteWidget initialQuote={quote} />}
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
    </div>
  );
}
