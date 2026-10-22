"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import {
  clearCalculations,
  listCalculations,
  recordCalculation,
  type CalculationEntry,
} from "@/lib/calculator";
import type {
  FloatingPositionInput,
  FloatingPositionResetInput,
} from "@/lib/floating";
import { searchPlaces, type GeoPlace } from "@/lib/geocoding";
import {
  createNote,
  deleteNote,
  listNotes,
  saveNote,
  type Note,
} from "@/lib/scratchpad";
import { listModules } from "@/lib/modules";
import {
  clearToolbarPosition,
  parseHiddenToolbars,
  parseToolbarPositions,
  serializeHiddenToolbars,
  serializeToolbarPositions,
  setToolbarHidden,
  setToolbarPosition,
  TOOLBAR_POSITIONS_PREFERENCE_KEY,
  TOOLBARS_HIDDEN_PREFERENCE_KEY,
} from "@/lib/toolbars";
import { clearUserAvatar, getAccessibleModules, setUserAvatar, setUserPassword } from "@/lib/user";
import {
  resetFloatingPosition,
  saveCalculatorState,
  saveFloatingCorner,
  saveFloatingPosition,
  saveFloatingState,
  saveUserPreferences,
  type CalculatorStateUpdate,
  type FloatingCornerUpdate,
  type FloatingStateUpdate,
  type UserPreferencesUpdate,
} from "@/lib/user-preferences";
import type { User } from "@/lib/user";
import { deps } from "@/lib/wiring";
import { requireUser } from "../require-access";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

async function getActingUser(): Promise<User> {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  if (!currentUser) throw new Error("Not authenticated.");
  return currentUser;
}

async function getActingUserId(): Promise<number> {
  return (await getActingUser()).id;
}

function toErrorResult(error: unknown, fallback: string): ActionResult {
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

export async function uploadOwnAvatarAction(formData: FormData): Promise<ActionResult> {
  try {
    const userId = await getActingUserId();
    const file = formData.get("avatar");
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, error: "Choose an image first." };
    }
    const data = Buffer.from(await file.arrayBuffer());
    setUserAvatar(userId, { data, mimeType: file.type }, deps.userRepo);
  } catch (error) {
    return toErrorResult(error, "Failed to upload image.");
  }
  revalidatePath("/account");
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function removeOwnAvatarAction(): Promise<ActionResult> {
  try {
    const userId = await getActingUserId();
    clearUserAvatar(userId, deps.userRepo);
  } catch (error) {
    return toErrorResult(error, "Failed to remove image.");
  }
  revalidatePath("/account");
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function changeOwnPasswordAction(password: string): Promise<ActionResult> {
  try {
    const userId = await getActingUserId();
    setUserPassword(userId, { password }, deps.userRepo);
  } catch (error) {
    return toErrorResult(error, "Failed to change password.");
  }
  return { ok: true };
}

export async function saveOwnPreferencesAction(
  input: UserPreferencesUpdate,
): Promise<ActionResult> {
  try {
    // The session decides whose preferences these are — the client never supplies
    // a user id. The allowed favorites are re-derived here for the same reason:
    // the picker's option list arrived from the server, but a hand-rolled request
    // needn't have used it.
    const currentUser = await getActingUser();
    const accessibleModules = getAccessibleModules(
      currentUser,
      listModules(deps.moduleRepo),
      deps.userRepo,
    );
    saveUserPreferences(
      deps.userPreferencesRepo,
      currentUser.id,
      input,
      accessibleModules.map((appModule) => appModule.slug),
    );
  } catch (error) {
    return toErrorResult(error, "Failed to save preferences.");
  }
  revalidatePath("/account");
  // The home page reads these to decide whether to redirect on arrival.
  revalidatePath("/");
  return { ok: true };
}

/**
 * Records the shape one of this reader's floating components is in.
 *
 * `requireUser()` on the first line: a floating component is a whole-app accessory
 * that no module owns, the same category the weather-location picker falls in. An
 * action is its own POST endpoint, so neither the `(protected)` layout nor the fact
 * that the only caller is a click handler inside the layer guards it.
 *
 * The session decides *whose* state this is — the client never supplies a user id, so
 * this cannot be used to rearrange someone else's screen. The id and the state are
 * validated by `floatingStateUpdateSchema` inside the use-case.
 *
 * Deliberately **no `revalidatePath`**. This fires every time a reader minimizes or
 * restores a window; revalidating the layout on each would re-render every page in the
 * app to persist a window position the client has already applied optimistically.
 * The next natural navigation picks up the stored value.
 */
export async function saveFloatingStateAction(
  input: FloatingStateUpdate,
): Promise<ActionResult> {
  try {
    const currentUser = await requireUser();
    saveFloatingState(deps.userPreferencesRepo, currentUser.id, input);
  } catch (error) {
    return toErrorResult(error, "Failed to save the floating component's state.");
  }
  return { ok: true };
}

/**
 * Records which corner this reader docks one floating component's puck in.
 *
 * `requireUser()` on the first line, same category as the state above: a floating
 * component is a whole-app accessory no module owns. The session decides whose
 * preference this is, so it cannot be used to rearrange someone else's screen.
 *
 * No `revalidatePath`: the layer applies the move optimistically and the next
 * navigation reads the stored value.
 */
export async function saveFloatingCornerAction(
  input: FloatingCornerUpdate,
): Promise<ActionResult> {
  try {
    const currentUser = await requireUser();
    saveFloatingCorner(deps.userPreferencesRepo, currentUser.id, input);
  } catch (error) {
    return toErrorResult(error, "Failed to save the corner.");
  }
  return { ok: true };
}

/**
 * Records one completed calculation on this reader's tape, and returns the tape.
 *
 * `requireUser()` on the first line — a floating component is a whole-app accessory
 * that no module owns, so there is no slug to check, and an action is its own POST
 * endpoint whatever guards the page that calls it.
 *
 * The session decides *whose* tape this is: the client never supplies a user id, so
 * this cannot be used to write onto, or read, somebody else's working-out.
 *
 * No `revalidatePath` — this fires on every `=`, and re-rendering every page in the app
 * to persist a tape row the window has already drawn would be pure waste. The tape is
 * returned instead, so the caller updates from the response.
 */
export async function recordCalculationAction(
  expression: string,
  result: string,
): Promise<ActionResult & { history?: CalculationEntry[] }> {
  try {
    const currentUser = await requireUser();
    recordCalculation(deps.calculatorHistoryRepo, currentUser.id, { expression, result });
    return { ok: true, history: listCalculations(deps.calculatorHistoryRepo, currentUser.id) };
  } catch (error) {
    return toErrorResult(error, "Failed to record the calculation.");
  }
}

/** This reader's tape, newest first. */
export async function listCalculationsAction(): Promise<
  ActionResult & { history?: CalculationEntry[] }
> {
  try {
    const currentUser = await requireUser();
    return { ok: true, history: listCalculations(deps.calculatorHistoryRepo, currentUser.id) };
  } catch (error) {
    return toErrorResult(error, "Failed to read the calculation history.");
  }
}

/**
 * Wipes this reader's tape.
 *
 * Reachable only from the window's explicit "Clear history" control — never from `AC`,
 * which clears the display alone. A calculator that forgot your working-out because you
 * pressed clear would be a bug.
 */
export async function clearCalculationHistoryAction(): Promise<ActionResult> {
  try {
    const currentUser = await requireUser();
    clearCalculations(deps.calculatorHistoryRepo, currentUser.id);
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Failed to clear the calculation history.");
  }
}

/**
 * Persists the calculator's angle mode, its last result, or both.
 *
 * Single-key writes inside `saveCalculatorState`, so flipping the mode cannot blank the
 * last result and vice versa. No `revalidatePath`, for the same reason as the tape.
 */
export async function saveCalculatorStateAction(
  update: CalculatorStateUpdate,
): Promise<ActionResult> {
  try {
    const currentUser = await requireUser();
    saveCalculatorState(deps.userPreferencesRepo, currentUser.id, update);
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Failed to save the calculator's state.");
  }
}

export interface PlaceSearchResult extends ActionResult {
  places?: GeoPlace[];
}

/**
 * Looks up a place by name, for the weather-location picker.
 *
 * `requireUser()` on the first line, not `requireModuleAccess`: the home screen's
 * Clock card belongs to no module, so there is no module slug to check — this is the
 * "a home-screen widget no module owns" case in ARCHITECTURE.md. It still has to be
 * guarded, because an action is its own POST endpoint and would otherwise be an open
 * geocoding proxy for anyone who found the URL.
 *
 * The Journal has its own `searchPlacesAction` gated on journal access. Duplicated
 * rather than shared because the two differ precisely in who may call them, which is
 * the one part of an action that should never be factored away.
 */
export async function searchPlacesForWeatherAction(query: string): Promise<PlaceSearchResult> {
  await requireUser();
  try {
    return { ok: true, places: await searchPlaces(deps.geocodingClient, { query }) };
  } catch (error) {
    return toErrorResult(error, "Place search failed.");
  }
}

/**
 * The Floating Scratchpad's note actions.
 *
 * `requireUser()` on the first line of each, not `requireModuleAccess`: a floating
 * component is a whole-app accessory that no module owns, so there is no slug to match —
 * the same category the clock's and calculator's actions fall into. Each is still its own
 * POST endpoint, so the guard is what stands between it and anyone who found the URL,
 * whatever guards the page that calls it.
 *
 * **The session decides whose notes these are.** No action here takes a user id; every
 * one passes `currentUser.id` to a use-case whose repository is scoped by it. So a note
 * id belonging to somebody else is simply not found, and none of these can be used to
 * read or write another person's notebook.
 *
 * Each returns the **tab's notes** on success rather than just `ok`, so the window
 * reorders its list (most recently edited first) from the response instead of making a
 * second round trip. And none of them calls `revalidatePath`: autosave fires while
 * someone types, and re-rendering every page in the app on each keystroke-batch would be
 * pure waste — the same call the calculator's tape makes.
 */
export interface ScratchpadNotesResult extends ActionResult {
  notes?: Note[];
}

/** This reader's notes in one tab, for a tab switch. */
export async function listScratchpadNotesAction(
  categoryId: number,
): Promise<ScratchpadNotesResult> {
  try {
    const currentUser = await requireUser();
    return { ok: true, notes: listNotes(deps.scratchpadRepo, currentUser.id, categoryId) };
  } catch (error) {
    return toErrorResult(error, "Failed to read the notes.");
  }
}

/**
 * Creates an empty note in a tab.
 *
 * The use-case refuses a category that no longer exists and refuses past the per-category
 * cap, returning a message rather than throwing — so a full tab reports why instead of
 * failing as an exception.
 */
export async function createScratchpadNoteAction(
  categoryId: number,
): Promise<ScratchpadNotesResult> {
  try {
    const currentUser = await requireUser();
    const result = createNote(
      deps.noteCategoryRepo,
      deps.scratchpadRepo,
      currentUser.id,
      { categoryId },
    );
    if (!result.ok) return { ok: false, error: result.message };
    return {
      ok: true,
      notes: listNotes(deps.scratchpadRepo, currentUser.id, categoryId),
    };
  } catch (error) {
    return toErrorResult(error, "Failed to create the note.");
  }
}

/**
 * Saves a note's title, body, or both — what autosave calls.
 *
 * Title and body are written independently by the use-case, so a body autosave cannot
 * blank a title the reader set a moment earlier.
 */
export async function saveScratchpadNoteAction(input: {
  id: number;
  title?: string;
  body?: string;
}): Promise<ScratchpadNotesResult> {
  try {
    const currentUser = await requireUser();
    const result = saveNote(deps.scratchpadRepo, currentUser.id, input);
    if (!result.ok) return { ok: false, error: result.message };
    return {
      ok: true,
      notes: listNotes(deps.scratchpadRepo, currentUser.id, result.note.categoryId),
    };
  } catch (error) {
    return toErrorResult(error, "Failed to save the note.");
  }
}

/** Deletes one of this reader's notes, returning what is left in the tab. */
export async function deleteScratchpadNoteAction(id: number): Promise<ScratchpadNotesResult> {
  try {
    const currentUser = await requireUser();
    // Read first, so the tab can be listed after the row is gone. Scoped by the session,
    // so this is also the check that the note is the caller's to delete.
    const existing = deps.scratchpadRepo.findById(currentUser.id, id);
    if (!existing) return { ok: false, error: "That note no longer exists." };

    const result = deleteNote(deps.scratchpadRepo, currentUser.id, { id });
    if (!result.ok) return { ok: false, error: result.message };

    return {
      ok: true,
      notes: listNotes(deps.scratchpadRepo, currentUser.id, existing.categoryId),
    };
  } catch (error) {
    return toErrorResult(error, "Failed to delete the note.");
  }
}

/**
 * Shows or hides one personal toolbar, for this reader only.
 *
 * `requireUser()` on the first line, same category as the floating state above: a
 * toolbar is whole-app chrome no module owns. The session decides whose preference
 * this is, so it cannot be used to rearrange someone else's screen.
 *
 * Written with `setValue` — ONE key — rather than through the preferences form,
 * which writes every key it carries. Folding this into that form would mean
 * pressing Save on an unrelated field reset the reader's hidden list, and every
 * toggle would have to resend the whole preference set. Same rule
 * `saveFloatingState` follows, and the reason `userPreferencesToEntries` excludes
 * these independent keys.
 *
 * `revalidatePath("/", "layout")` because the bars are rendered by the protected
 * layout that every page shares — unlike the floating layer, which applies its own
 * state optimistically on the client, this one has to come back from the server.
 */
export async function saveToolbarVisibilityAction(
  toolbarId: number,
  hidden: boolean,
): Promise<ActionResult> {
  try {
    const currentUser = await requireUser();
    const stored = deps.userPreferencesRepo
      .listByUserId(currentUser.id)
      .find((row) => row.key === TOOLBARS_HIDDEN_PREFERENCE_KEY)?.value;

    deps.userPreferencesRepo.setValue(
      currentUser.id,
      TOOLBARS_HIDDEN_PREFERENCE_KEY,
      serializeHiddenToolbars(
        setToolbarHidden(parseHiddenToolbars(stored), toolbarId, hidden),
      ),
    );
    revalidatePath("/", "layout");
  } catch (error) {
    return toErrorResult(error, "Failed to save the toolbar's visibility.");
  }
  return { ok: true };
}

/**
 * Records where this reader has dragged one floating toolbar (migration 0153).
 *
 * `requireUser()` on the first line, same category as the visibility toggle above
 * and for the same reason: a toolbar is whole-app chrome no module owns, and the
 * session decides whose preference this is — so this cannot be used to rearrange
 * someone else's screen.
 *
 * Written with `setValue` — ONE key — for the reason `saveToolbarVisibilityAction`
 * records: the preferences form writes every key it carries, so folding this in
 * would let pressing Save on an unrelated field reset every bar's position.
 *
 * ## Deliberately NO `revalidatePath`
 *
 * This is the one place this action differs from the visibility toggle beside it,
 * and it is the important difference. Visibility has to come back from the server
 * because the set of rendered bars changes. A position does not: the component has
 * already moved the bar on screen — the reader is *looking at* the result of their
 * own drag — and this call only persists it for the next page load.
 *
 * Revalidating here would re-render the entire protected layout on every drop,
 * which is both wasted work and visibly worse: the bar would jump as the server's
 * value replaced the local one.
 *
 * Passing `null` clears the entry, which is the Account screen's "Reset position".
 * Clearing rather than storing the default is what lets the default itself change —
 * see `clearToolbarPosition`.
 */
export async function saveToolbarPositionAction(
  toolbarId: number,
  position: { x: number; y: number } | null,
): Promise<ActionResult> {
  try {
    const currentUser = await requireUser();
    const stored = deps.userPreferencesRepo
      .listByUserId(currentUser.id)
      .find((row) => row.key === TOOLBAR_POSITIONS_PREFERENCE_KEY)?.value;

    const positions = parseToolbarPositions(stored);
    const next = position
      ? setToolbarPosition(positions, toolbarId, position)
      : clearToolbarPosition(positions, toolbarId);

    deps.userPreferencesRepo.setValue(
      currentUser.id,
      TOOLBAR_POSITIONS_PREFERENCE_KEY,
      serializeToolbarPositions(next),
    );
  } catch (error) {
    return toErrorResult(error, "Failed to save the toolbar's position.");
  }
  return { ok: true };
}

/**
 * Forgets where this reader dragged one floating toolbar — the Account screen's
 * "Reset position", which puts the bar back at its default.
 *
 * A separate exported action rather than the Account view calling
 * `saveToolbarPositionAction(id, null)`, and that is not duplication for its own
 * sake: a `"use server"` function reaches a client component only as *itself*, so
 * a view wanting `(id) => …` cannot wrap one in an arrow — the closure fails to
 * serialise at request time. The signature the caller needs is the signature the
 * action has to have. Same rule the protected layout records for the floating and
 * queue action props.
 *
 * `requireUser()` on the first line, same category as the two actions above — the
 * session decides whose preference this is.
 *
 * `revalidatePath` here, unlike the drag it undoes: this is pressed on the Account
 * screen, a different page from the bar, so nothing has moved on screen locally and
 * the layout genuinely has to re-render for the reset to be visible.
 */
export async function resetToolbarPositionAction(toolbarId: number): Promise<ActionResult> {
  const result = await saveToolbarPositionAction(toolbarId, null);
  if (!result.ok) return result;
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Records where this reader dropped one floating component's puck.
 *
 * `requireUser()` on the first line, same category as the state and the corner above:
 * a floating component is a whole-app accessory no module owns, so there is no slug to
 * check — and an action is its own POST endpoint whatever guards the page that calls
 * it. The session decides *whose* screen this is, so it cannot be used to shove
 * somebody else's puck around.
 *
 * Flat `x`/`y` rather than a nested point, because the client port assigns this action
 * directly: a `"use server"` function crosses to a client component only as itself, and
 * an adapter arrow that reshaped the argument would fail to serialize at request time.
 *
 * No `revalidatePath`, and this one matters more than for the corner. The puck is
 * already where the reader dropped it; re-rendering the protected layout on every drop
 * would re-resolve the whole floating layer — forecast, tape and all — and the puck
 * would visibly jump as the server's older position arrived. `FloatingPuck` holds the
 * dropped position locally until the server's value agrees with it.
 */
export async function saveFloatingPositionAction(
  input: FloatingPositionInput,
): Promise<ActionResult> {
  try {
    const currentUser = await requireUser();
    saveFloatingPosition(deps.userPreferencesRepo, currentUser.id, input);
  } catch (error) {
    return toErrorResult(error, "Failed to save the puck's position.");
  }
  return { ok: true };
}

/**
 * Forgets where this reader dragged one puck, so it docks in its corner again.
 *
 * `requireUser()` on the first line, for the reason above.
 *
 * **This one does revalidate**, unlike the save. It is called from the Account screen,
 * which is a different page from the puck: without re-rendering the layout the reader
 * would press "Reset position" and watch nothing happen until their next full reload.
 * The layout is also where `initialPositions` is resolved, which is what releases the
 * provider's local override — see the effect in `FloatingLayerProvider`.
 */
export async function resetFloatingPositionAction(
  input: FloatingPositionResetInput,
): Promise<ActionResult> {
  try {
    const currentUser = await requireUser();
    resetFloatingPosition(deps.userPreferencesRepo, currentUser.id, input);
    // "layout" because the floating layer is mounted by the protected layout, which
    // every page shares — not by the Account route that called this.
    revalidatePath("/", "layout");
  } catch (error) {
    return toErrorResult(error, "Failed to reset the puck's position.");
  }
  return { ok: true };
}
