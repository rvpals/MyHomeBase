import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, completeGoogleLogin } from "@/lib/auth";
import { deps } from "@/lib/wiring";
import { STATE_COOKIE_NAME } from "../route";

function redirectToLogin(request: NextRequest, error: string): NextResponse {
  return NextResponse.redirect(new URL(`/login?error=${error}`, request.url));
}

export async function GET(request: NextRequest) {
  if (!deps.googleOAuthClient) {
    return redirectToLogin(request, "google_failed");
  }

  const store = await cookies();
  const expectedState = store.get(STATE_COOKIE_NAME)?.value;
  store.delete(STATE_COOKIE_NAME);

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  if (!code || !state || !expectedState || state !== expectedState) {
    return redirectToLogin(request, "google_failed");
  }

  let result;
  try {
    result = await completeGoogleLogin(code, deps.googleOAuthClient, deps.userRepo, deps.sessionRepo);
  } catch {
    return redirectToLogin(request, "google_failed");
  }

  if (!result) {
    return redirectToLogin(request, "google_not_linked");
  }

  const response = NextResponse.redirect(new URL("/", request.url));
  response.cookies.set(SESSION_COOKIE_NAME, result.session.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(result.session.expiresAt),
  });
  return response;
}
