import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { getPrefillTemplateIcon } from "@/lib/journal";
import { deps } from "@/lib/wiring";
import { journalIconResponse } from "../../../icon-response";

// Serves a journal prefill template's icon (migration 0176). This is the only
// place the icon bytes are read, which is what keeps them out of the Templates
// list and out of the New Entry form's props.
//
// Keyed by `id`, NOT by name — unlike the category and tag icon routes next door.
// A template's name is editable, so a name-keyed URL would 404 after a rename
// until the next hard load, and a rename is a normal thing to do on this screen.
//
// Templates are household-wide rows, so this asks one question: is the reader
// signed in? The user-scoped shape `sys_user_shortcuts` needs (migration 0115)
// does not apply — there is no per-person template to leak.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  if (!currentUser) return new NextResponse(null, { status: 401 });

  const { id } = await params;
  const templateId = Number(id);
  if (!Number.isInteger(templateId) || templateId <= 0) {
    return new NextResponse(null, { status: 400 });
  }

  const icon = getPrefillTemplateIcon(deps.journalRepo, templateId);
  if (!icon) return new NextResponse(null, { status: 404 });

  return journalIconResponse(icon);
}
