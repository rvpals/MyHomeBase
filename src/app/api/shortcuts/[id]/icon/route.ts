import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { deps } from "@/lib/wiring";

// Serves a shortcut's uploaded icon. This is the only place those bytes are
// read, which is what keeps them out of every home-screen render — every other
// read of the table names its columns and omits the blob.
//
// ONE THING HERE IS DIFFERENT FROM EVERY OTHER ICON ROUTE, and it is the reason
// this file is worth reading rather than skimming.
//
// The vendor, category, module and account icon routes all serve rows that are
// HOUSEHOLD-WIDE, so "is this reader signed in?" is the entire question they
// need to ask. `sys_user_shortcuts` is per-user: these pictures belong to the
// person who uploaded them. A route that only checked for a session would let
// any signed-in reader walk the ids and pull everyone else's icons.
//
// So the lookup is scoped by the session's user id — `getIcon(currentUser.id,
// id)`, the same user-scoped contract every other read of this table uses — and
// another reader's row is simply not found. Signed-in and yours are different
// questions; this table was built on that distinction and the route honours it.
//
// Note there is deliberately no separate 403: a shortcut belonging to someone
// else returns the same 404 as one that does not exist. Distinguishing them
// would confirm that a given id is real, which is the enumeration this scoping
// exists to prevent.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  if (!currentUser) return new NextResponse(null, { status: 401 });

  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return new NextResponse(null, { status: 400 });

  const icon = deps.userShortcutsRepo.getIcon(currentUser.id, id);
  if (!icon) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(icon.data), {
    headers: {
      "Content-Type": icon.mimeType,
      // Private: it's behind a session, and here it is behind a *person* — a
      // shared cache must never hand one reader's icon to another. Short
      // max-age so a replaced picture shows up quickly; the caller also adds a
      // ?v= cache-buster from updatedAt, which the icon writes bump.
      "Cache-Control": "private, max-age=300",
    },
  });
}
