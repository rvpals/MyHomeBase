import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { deps } from "@/lib/wiring";

export const STATE_COOKIE_NAME = "myhomebase_google_oauth_state";
const STATE_COOKIE_MAX_AGE_SECONDS = 5 * 60;

export async function GET() {
  if (!deps.googleOAuthClient) {
    return NextResponse.json({ error: "Google sign-in isn't configured." }, { status: 404 });
  }

  const state = randomBytes(16).toString("hex");
  (await cookies()).set(STATE_COOKIE_NAME, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: STATE_COOKIE_MAX_AGE_SECONDS,
  });

  return NextResponse.redirect(deps.googleOAuthClient.getAuthorizationUrl(state));
}
