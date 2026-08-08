import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import {
  VIEWPORT_COOKIE,
  VIEWPORT_PINNED_COOKIE,
  resolveViewport,
} from "@/lib/viewport";
import { deps } from "@/lib/wiring";
import { AccountView } from "./view";

export default async function AccountPage() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  if (!currentUser) redirect("/login");

  return (
    <AccountView
      user={currentUser}
      viewport={resolveViewport({ cookieValue: cookieStore.get(VIEWPORT_COOKIE)?.value })}
      viewportPinned={cookieStore.get(VIEWPORT_PINNED_COOKIE)?.value === "1"}
    />
  );
}
