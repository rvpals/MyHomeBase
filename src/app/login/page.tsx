import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import { deps } from "@/lib/wiring";
import { LoginView } from "./view";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  if (currentUser) redirect("/");

  const appName = getSetting(deps.settingsRepo, "application_name")?.value ?? "MyHomeBase";
  const { error } = await searchParams;

  return (
    <LoginView
      appName={appName}
      googleLoginEnabled={deps.googleOAuthClient !== undefined}
      errorCode={error}
    />
  );
}
