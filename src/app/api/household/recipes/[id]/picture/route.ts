import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { getRecipeImage } from "@/lib/household";
import { deps } from "@/lib/wiring";

// Serves a recipe's picture. This is the only place the image bytes are read, which
// is what keeps them out of every recipe list. Mirrors the expense-account image
// route and the user-avatar route.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  if (!currentUser) return new NextResponse(null, { status: 401 });

  const { id } = await params;
  const recipeId = Number(id);
  if (!Number.isInteger(recipeId) || recipeId <= 0) return new NextResponse(null, { status: 400 });

  const image = getRecipeImage(deps.householdRepo, recipeId);
  if (!image) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(image.data), {
    headers: {
      "Content-Type": image.mimeType,
      // Private: it's behind a session. Short max-age so a replaced picture shows
      // up quickly; the view also adds a ?v= cache-buster from updatedAt.
      "Cache-Control": "private, max-age=300",
    },
  });
}
