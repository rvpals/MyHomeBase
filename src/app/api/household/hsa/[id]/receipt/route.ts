import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { getHsaReceipt } from "@/lib/household";
import { getModuleBySlug } from "@/lib/modules";
import { userHasModuleAccess } from "@/lib/user";
import { deps } from "@/lib/wiring";
import { hsaReceiptFiles } from "@/app/(protected)/modules/[slug]/household-receipt-root";

// Serves an HSA receipt, read from the receipt folder on the NAS. The only place the
// file bytes are read, which keeps them out of every expense list. Mirrors the recipe
// picture route, with one addition: a receipt is health-and-money paperwork, so being
// signed in is not enough — the reader must hold the Household module, exactly as the
// page itself requires. A route handler is its own endpoint; no layout runs before it.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  if (!currentUser) return new NextResponse(null, { status: 401 });

  const appModule = getModuleBySlug(deps.moduleRepo, "household");
  if (!appModule || !userHasModuleAccess(currentUser, appModule.id, deps.userRepo)) {
    return new NextResponse(null, { status: 404 });
  }

  const { id } = await params;
  const expenseId = Number(id);
  if (!Number.isInteger(expenseId) || expenseId <= 0) return new NextResponse(null, { status: 400 });

  // 404 too when the row has a receipt but the file is gone from the folder (moved or
  // deleted by hand) — there is nothing to serve, and the grid still shows the name.
  const receipt = await getHsaReceipt(deps.hsaRepo, hsaReceiptFiles(), expenseId);
  if (!receipt) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(receipt.data), {
    headers: {
      "Content-Type": receipt.mimeType,
      // Inline, so a phone opens the picture or PDF rather than saving it; the name
      // is what a "save as" would offer.
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(receipt.fileName)}`,
      // Served from our own origin: never let a browser re-interpret the bytes.
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=300",
    },
  });
}
