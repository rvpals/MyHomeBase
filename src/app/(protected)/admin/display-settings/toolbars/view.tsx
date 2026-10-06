"use client";

// The Personal Toolbars admin screen: a list card, and an editor for one toolbar.
//
// Route-local rather than a registered component, for the reason components.md
// gives: it is one admin control bound to this screen's actions.
//
// Two states in one view — the list, and the editor for whichever toolbar is open.
// Not a modal: the editor is a long form with a repeating row builder, which is a
// page's worth of content, and `Modal` is for a focused decision.
//
// Narrow behaviour: every row is a stacked block and the grids are `sm:` upward, so
// a phone gets one column. No `useIsCompact()` fork — nothing here needs a different
// *component* narrow, only a narrower one.

import { useMemo, useState, type DragEventHandler } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import type { DashboardTextureItem } from "@/lib/dashboard-texture";
import type { MenuItem } from "@/lib/menu-items";
import {
  isOrnamentalKind,
  MAX_TOOLBAR_LABEL_LENGTH,
  MAX_TOOLBAR_NAME_LENGTH,
  TOOLBAR_EDGES,
  type ToolbarEdge,
  type ToolbarItemKind,
  type ToolbarWithItems,
} from "@/lib/toolbars";
import {
  addToolbarItemAction,
  createToolbarAction,
  deleteToolbarAction,
  removeToolbarItemAction,
  reorderToolbarItemsAction,
  updateToolbarAction,
} from "./actions";

const INPUT =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

const LABEL = "text-xs font-medium uppercase tracking-wide text-muted";

const EDGE_LABELS: Record<ToolbarEdge, string> = {
  top: "Top",
  bottom: "Bottom",
  left: "Left",
  right: "Right",
};

/** The editable shape of a toolbar, before it is saved. */
interface Draft {
  name: string;
  edge: ToolbarEdge;
  backgroundColor: string;
  borderColor: string;
  textColor: string;
  /** The library picture id, or `undefined` for no texture. */
  textureId?: number;
  textureOpacity: number;
  fullModeOnly: boolean;
  isVisible: boolean;
}

function toDraft(toolbar?: ToolbarWithItems): Draft {
  return {
    name: toolbar?.name ?? "",
    edge: toolbar?.edge ?? "left",
    // A colour input needs a value, but "unset" is a real and common state — so the
    // draft carries "" and the checkbox beside each picker is what says "use the
    // theme". Sending "" is what the schema turns back into `undefined`.
    backgroundColor: toolbar?.backgroundColor ?? "",
    borderColor: toolbar?.borderColor ?? "",
    textColor: toolbar?.textColor ?? "",
    textureId: toolbar?.textureId,
    // The table's own default, so a bar that has never had a picture starts
    // somewhere visible rather than at 0 the first time one is chosen.
    textureOpacity: toolbar?.textureOpacity ?? 0.15,
    fullModeOnly: toolbar?.fullModeOnly ?? false,
    isVisible: toolbar?.isVisible ?? true,
  };
}

/** One colour field: a swatch, a hex box, and a "use the theme" reset. */
function ColorField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <div className="mt-1 flex items-center gap-2">
        <input
          id={id}
          type="color"
          // A native colour input cannot be empty, so it shows a neutral grey while
          // the real value is unset. The text box beside it is the honest one.
          value={value || "#808080"}
          onChange={(event) => onChange(event.target.value)}
          className="h-8 w-10 shrink-0 cursor-pointer rounded border border-line bg-paper"
        />
        <input
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Theme default"
          className={INPUT}
        />
        {value ? (
          <Button variant="secondary" size="sm" onClick={() => onChange("")}>
            Clear
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The background texture: a thumbnail grid from the app texture library, plus this
 * bar's own strength.
 *
 * Pictures are **not** uploaded here. The library lives at Configuration → App
 * Texture and is shared with the dashboard and the modules; this screen only points
 * at one, the same way `ModuleTextureControl` does. So an empty library is a normal
 * state and gets a sentence saying where pictures come from rather than an upload
 * control this screen has no business owning.
 *
 * ## Why opacity is here and not taken from the picture
 *
 * A module drawing a library picture reuses that picture's tuning (migration 0117) —
 * right for something that fills a viewport. A toolbar is 44px across, so a
 * background tuned to 0.10 for a full page is invisible in it, and migration 0130
 * gives each bar its own strength instead. That is why this control exists on a
 * screen where its sibling module control has none.
 *
 * NARROW SCREENS: the grid steps 4 → 6 → 8 columns with plain responsive variants,
 * so it is the same component at every width — the rule in `design.md`.
 */
function TextureField({
  textures,
  textureId,
  textureOpacity,
  onChange,
}: {
  textures: DashboardTextureItem[];
  textureId?: number;
  textureOpacity: number;
  onChange: (next: { textureId?: number; textureOpacity: number }) => void;
}) {
  // `id` is in the URL so each tile shows its own picture, and `v=` busts the
  // serving route's 5-minute cache. Same URL shape the module control builds.
  const thumbnail = (item: DashboardTextureItem) =>
    `/api/dashboard/texture?id=${item.id}&v=${encodeURIComponent(item.updatedAt)}`;

  return (
    <div className="mt-4 rounded-lg border border-line p-3">
      <p className={LABEL}>Background texture</p>

      {textures.length === 0 ? (
        <p className="mt-2 text-xs text-muted">
          No pictures in the library yet. Upload them at Administration →
          Configuration → App&nbsp;Texture, then pick one here.
        </p>
      ) : (
        <>
          <p className="mt-1 text-xs text-muted">
            A picture drawn behind this bar&apos;s shortcuts. It always tiles — a
            44px bar is too thin to show a stretched photograph. Pictures come from
            Configuration → App&nbsp;Texture.
          </p>

          <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
            {/* "None" is a tile rather than a Clear button beside the grid, so
                turning a texture off is the same gesture as choosing one. */}
            <button
              type="button"
              onClick={() => onChange({ textureId: undefined, textureOpacity })}
              title="No texture"
              aria-pressed={textureId === undefined}
              className={`flex aspect-square items-center justify-center rounded-md border bg-paper text-xs text-muted transition-colors ${
                textureId === undefined
                  ? "border-brass ring-2 ring-brass"
                  : "border-line hover:border-brass/50"
              }`}
            >
              None
            </button>

            {textures.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onChange({ textureId: item.id, textureOpacity })}
                // The picture's name, because a tile of an abstract texture at
                // 48px is not something a reader can identify by sight.
                title={item.name}
                aria-pressed={textureId === item.id}
                className={`overflow-hidden rounded-md border transition-colors ${
                  textureId === item.id
                    ? "border-brass ring-2 ring-brass"
                    : "border-line hover:border-brass/50"
                }`}
              >
                {/* A plain `img`, not `next/image`: these are session-gated bytes
                    from a route that already sets its own caching, and the
                    optimizer cannot read them. Same choice the module control and
                    the texture gallery make. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={thumbnail(item)}
                  alt={item.name}
                  className="aspect-square w-full object-cover"
                />
              </button>
            ))}
          </div>

          {/* Shown only with a picture chosen — a strength slider for no texture is
              a control that does nothing, and hiding it says so more clearly than
              disabling it would. */}
          {textureId !== undefined ? (
            <div className="mt-3">
              <label htmlFor="toolbar-texture-opacity" className={LABEL}>
                Strength — {Math.round(textureOpacity * 100)}%
              </label>
              <input
                id="toolbar-texture-opacity"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={textureOpacity}
                onChange={(event) =>
                  onChange({ textureId, textureOpacity: Number(event.target.value) })
                }
                className="mt-1 w-full accent-brass"
              />
              <p className="mt-1 text-xs text-muted">
                This bar&apos;s own strength, not the picture&apos;s. A thin bar shows
                very little of a texture, so it usually wants more than a full-page
                background does.
              </p>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * An ON/OFF switch for one toolbar's household visibility, on the list row.
 *
 * ## It saves on click, not on a Save button
 *
 * That is the point of it: the editor already carries a "Visible" checkbox, and
 * reaching it is open → scroll → tick → Save → close. This is for the gesture that
 * wants to be one click — turning a bar off because it is in the way right now.
 * Same choice the icon and carousel controls on the Modules screen make, and for
 * the same reason: there is nothing to batch, one switch is one write.
 *
 * ## What it is and is not switching
 *
 * This is the **admin's** switch — `isVisible`, which decides whether the toolbar
 * exists for the household at all. It is not a reader's own hide list, which lives
 * in their preferences and is reachable only from their Account page. Turning this
 * off takes the bar off everyone's screen; turning it on returns it to everyone who
 * has not hidden it themselves. The two are deliberately separate (migration 0125
 * records why), so the tooltip says "for the household" rather than implying this
 * controls what any one person sees.
 *
 * A `button` with `role="switch"` rather than a checkbox: it carries its own ON/OFF
 * text and fires immediately, which is a switch's semantics rather than a form
 * field's. `aria-checked` is what a screen reader announces, so the visible text
 * and the state cannot drift apart.
 */
function VisibilityToggle({
  toolbar,
  isBusy,
  onToggle,
}: {
  toolbar: ToolbarWithItems;
  isBusy: boolean;
  onToggle: () => void;
}) {
  const isOn = toolbar.isVisible;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isOn}
      disabled={isBusy}
      onClick={onToggle}
      // Named for the bar: a list of several of these would otherwise all announce
      // as the same control.
      title={
        isOn
          ? `Turn the “${toolbar.name}” toolbar off for the household`
          : `Turn the “${toolbar.name}” toolbar on for the household`
      }
      aria-label={`Show the ${toolbar.name} toolbar`}
      className={`flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
        isOn
          ? "border-brass bg-brass-soft text-brass-dark"
          : "border-line bg-paper text-muted hover:border-brass/50"
      }`}
    >
      {/* Colour alone would not separate the two states for a reader who cannot
          see it, which is why the ON/OFF text sits beside the dot. */}
      <span
        aria-hidden
        className={`h-2 w-2 rounded-full ${isOn ? "bg-brass-dark" : "bg-muted"}`}
      />
      {isOn ? "ON" : "OFF"}
    </button>
  );
}

export function ToolbarsView({
  toolbars,
  menuItems,
  textures,
  editToolbarId,
}: {
  toolbars: ToolbarWithItems[];
  menuItems: MenuItem[];
  /**
   * The app texture library, for the editor's background picker. Empty is a normal
   * state — nothing has been uploaded yet — and the picker says where pictures
   * come from rather than offering an upload this screen does not own.
   */
  textures: DashboardTextureItem[];
  /**
   * Open this toolbar's editor immediately — `?edit=<id>`, which the ✎ button on a
   * rendered toolbar links to. Already validated by the page, so it either names a
   * real toolbar or is absent.
   */
  editToolbarId?: number;
}) {
  const router = useRouter();
  // Seeded from the prop rather than applied in an effect: an effect would render
  // the list for one frame and then swap, and — worse — would re-open the editor
  // every time the reader closed it, because the URL still carries `?edit=`.
  // Closing clears the param instead (see `close`), which is what makes this a
  // one-shot.
  const [editingId, setEditingId] = useState<number | "new" | undefined>(editToolbarId);
  const [draft, setDraft] = useState<Draft>(
    toDraft(toolbars.find((toolbar) => toolbar.id === editToolbarId)),
  );
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [message, setMessage] = useState<string | undefined>(undefined);

  const editing = typeof editingId === "number" ? toolbars.find((t) => t.id === editingId) : undefined;

  function open(toolbar?: ToolbarWithItems) {
    setEditingId(toolbar ? toolbar.id : "new");
    setDraft(toDraft(toolbar));
    setError(undefined);
    setMessage(undefined);
  }

  function close() {
    setEditingId(undefined);
    setError(undefined);
    // Drop `?edit=` so a refresh (or the back button later) doesn't reopen the
    // editor the reader just closed. `replace`, not `push`: closing a panel is not
    // a navigation step worth putting in the history.
    if (editToolbarId !== undefined) router.replace("/admin/display-settings/toolbars");
  }

  async function run(action: () => Promise<{ ok: boolean; error?: string }>, note?: string) {
    setIsBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const result = await action();
      if (!result.ok) {
        setError(result.error ?? "The change could not be saved.");
        return false;
      }
      if (note) setMessage(note);
      // The bars are rendered by the protected layout, so refresh rather than
      // trusting this page's own cache to carry the change onto the screen.
      router.refresh();
      return true;
    } finally {
      setIsBusy(false);
    }
  }

  async function handleSave() {
    const input = {
      name: draft.name,
      edge: draft.edge,
      backgroundColor: draft.backgroundColor,
      borderColor: draft.borderColor,
      textColor: draft.textColor,
      textureId: draft.textureId,
      textureOpacity: draft.textureOpacity,
      fullModeOnly: draft.fullModeOnly,
      isVisible: draft.isVisible,
    };

    const ok = await run(
      () =>
        editingId === "new"
          ? createToolbarAction(input)
          : updateToolbarAction(editingId as number, input),
      editingId === "new" ? `Created “${draft.name}”.` : `Saved “${draft.name}”.`,
    );
    // A new toolbar closes back to the list, where its Items section is waiting.
    // An edit stays open, so colour tweaking is not a save-and-reopen loop.
    if (ok && editingId === "new") setEditingId(undefined);
  }

  /**
   * Flips one toolbar's household visibility straight from the list row.
   *
   * **Every field is resent, not just `isVisible`.** `updateToolbarAction` replaces
   * the whole row — it takes a complete `ToolbarInput` and the repository's UPDATE
   * sets every column — so posting the one flag would blank the bar's name, its
   * colours and its texture. `toDraft` is reused to build that payload rather than
   * spreading `toolbar`, because it already converts the stored shape to the input
   * shape the schema expects (an unset colour is `""` on the way in, `undefined` on
   * the way out), and duplicating that mapping here is how the two would drift.
   *
   * Items are untouched: they live in their own table and the action does not read
   * them.
   */
  async function toggleVisible(toolbar: ToolbarWithItems) {
    const next = !toolbar.isVisible;

    await run(
      () =>
        updateToolbarAction(toolbar.id, {
          ...toDraft(toolbar),
          isVisible: next,
        }),
      next
        ? `“${toolbar.name}” is on.`
        : `“${toolbar.name}” is off — it is off everyone's screen.`,
    );
  }

  return (
    <>
      <CollapsibleCard className="mt-8" title="Toolbars">
        <p className="text-sm text-muted">
          Each toolbar docks to one edge. <strong className="text-ink">ON</strong> means
          it exists for the household — switch it off and it leaves everyone&apos;s
          screen. Each person can still hide an ON toolbar from their own Account page.
        </p>

        {error && editingId === undefined ? (
          <p className="mt-4 text-sm text-red-400">{error}</p>
        ) : null}
        {message ? <p className="mt-4 text-sm text-emerald-400">{message}</p> : null}

        {toolbars.length === 0 ? (
          <p className="mt-4 text-sm text-muted">
            No toolbars yet. Add one to give yourself a strip of shortcuts to the
            screens you open most.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-line rounded-xl border border-line">
            {toolbars.map((toolbar) => (
              <li key={toolbar.id} className="flex items-start justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">
                    {toolbar.name}
                    {/* The "hidden" pill that used to sit here is gone: the ON/OFF
                        switch on this same row now says the same thing, and two
                        indicators for one state is the kind of noise that makes a
                        reader wonder whether they mean different things. The switch
                        wins because it is also the control. */}
                    {toolbar.fullModeOnly ? (
                      <span className="ml-2 rounded-full bg-brass-soft px-2 py-0.5 text-xs font-normal text-brass-dark">
                        full mode only
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {EDGE_LABELS[toolbar.edge]} edge · {toolbar.items.length} item
                    {toolbar.items.length === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <VisibilityToggle
                    toolbar={toolbar}
                    isBusy={isBusy}
                    onToggle={() => void toggleVisible(toolbar)}
                  />
                  <Button variant="secondary" onClick={() => open(toolbar)}>
                    Edit
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4">
          <Button variant="primary" onClick={() => open()}>
            Add a toolbar
          </Button>
        </div>
      </CollapsibleCard>

      {editingId !== undefined ? (
        <CollapsibleCard
          className="mt-6"
          title={editingId === "new" ? "New toolbar" : `Edit “${editing?.name ?? ""}”`}
        >
          {error ? <p className="mb-4 text-sm text-red-400">{error}</p> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="toolbar-name" className={LABEL}>
                Name
              </label>
              <input
                id="toolbar-name"
                value={draft.name}
                maxLength={MAX_TOOLBAR_NAME_LENGTH}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder="My shortcuts"
                className={`mt-1 ${INPUT}`}
              />
            </div>

            <div>
              <label htmlFor="toolbar-edge" className={LABEL}>
                Position
              </label>
              <select
                id="toolbar-edge"
                value={draft.edge}
                onChange={(event) =>
                  setDraft({ ...draft, edge: event.target.value as ToolbarEdge })
                }
                className={`mt-1 ${INPUT}`}
              >
                {TOOLBAR_EDGES.map((edge) => (
                  <option key={edge} value={edge}>
                    {EDGE_LABELS[edge]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <ColorField
              id="toolbar-bg"
              label="Background"
              value={draft.backgroundColor}
              onChange={(backgroundColor) => setDraft({ ...draft, backgroundColor })}
            />
            <ColorField
              id="toolbar-border"
              label="Border"
              value={draft.borderColor}
              onChange={(borderColor) => setDraft({ ...draft, borderColor })}
            />
            <ColorField
              id="toolbar-text"
              label="Text"
              value={draft.textColor}
              onChange={(textColor) => setDraft({ ...draft, textColor })}
            />
          </div>
          <p className="mt-2 text-xs text-muted">
            Leave a colour empty to follow the application&apos;s theme — which keeps the
            toolbar in step when the colour scheme changes.
          </p>

          <TextureField
            textures={textures}
            textureId={draft.textureId}
            textureOpacity={draft.textureOpacity}
            onChange={(next) => setDraft({ ...draft, ...next })}
          />

          <div className="mt-4 space-y-2">
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={draft.isVisible}
                onChange={(event) => setDraft({ ...draft, isVisible: event.target.checked })}
              />
              Visible
              <span className="text-xs text-muted">
                — off hides it from everyone, whatever each person has chosen
              </span>
            </label>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={draft.fullModeOnly}
                onChange={(event) => setDraft({ ...draft, fullModeOnly: event.target.checked })}
              />
              Full mode only
              <span className="text-xs text-muted">
                — hide on phones, where the bottom edge is already in use
              </span>
            </label>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" disabled={isBusy} onClick={() => void handleSave()}>
              {isBusy ? "Saving…" : editingId === "new" ? "Create" : "Save"}
            </Button>
            <Button variant="secondary" disabled={isBusy} onClick={close}>
              Close
            </Button>
            {editing ? (
              <Button
                variant="danger"
                disabled={isBusy}
                onClick={() => {
                  void (async () => {
                    const ok = await run(
                      () => deleteToolbarAction(editing.id),
                      `Deleted “${editing.name}”.`,
                    );
                    // `close()` rather than clearing the id, so `?edit=` goes too —
                    // otherwise the URL still names the toolbar that was just
                    // deleted, and a refresh would try to reopen it.
                    if (ok) close();
                  })();
                }}
              >
                Delete toolbar
              </Button>
            ) : null}
          </div>

          {editing ? (
            <ToolbarItems
              toolbar={editing}
              menuItems={menuItems}
              isBusy={isBusy}
              run={run}
            />
          ) : (
            <p className="mt-6 text-sm text-muted">
              Create the toolbar first, then add items to it.
            </p>
          )}
        </CollapsibleCard>
      ) : null}
    </>
  );
}

/**
 * The row builder for one toolbar.
 *
 * Split out because the add form has its own three-way state (kind, then module,
 * then screen) that has nothing to do with the toolbar's own fields, and folding it
 * into the component above made a single `useState` soup.
 */
function ToolbarItems({
  toolbar,
  menuItems,
  isBusy,
  run,
}: {
  toolbar: ToolbarWithItems;
  menuItems: MenuItem[];
  isBusy: boolean;
  run: (action: () => Promise<{ ok: boolean; error?: string }>, note?: string) => Promise<boolean>;
}) {
  const [kind, setKind] = useState<ToolbarItemKind>("menu-item");
  const [moduleSlug, setModuleSlug] = useState("");
  const [menuItemId, setMenuItemId] = useState("");
  const [label, setLabel] = useState("");
  const [draggingId, setDraggingId] = useState<number | undefined>();
  const [dropTargetId, setDropTargetId] = useState<number | undefined>();

  // The module list, derived from the catalogue rather than passed separately, so a
  // module with no sections cannot appear as an empty group.
  const modules = useMemo(() => {
    const seen = new Map<string, string>();
    for (const item of menuItems) {
      if (item.moduleSlug && !seen.has(item.moduleSlug)) seen.set(item.moduleSlug, item.moduleName);
    }
    return [...seen.entries()].map(([slug, name]) => ({ slug, name }));
  }, [menuItems]);

  const screens = useMemo(
    () => menuItems.filter((item) => item.moduleSlug === moduleSlug),
    [menuItems, moduleSlug],
  );

  const byId = useMemo(() => new Map(menuItems.map((item) => [item.id, item])), [menuItems]);

  async function handleAdd() {
    const ok = await run(() =>
      addToolbarItemAction(toolbar.id, {
        kind,
        menuItemId: kind === "menu-item" ? menuItemId : undefined,
        // The ornamental kinds carry no label; the schema rejects one outright.
        label: isOrnamentalKind(kind) ? undefined : label || undefined,
      }),
    );
    if (ok) {
      setMenuItemId("");
      setLabel("");
    }
  }

  async function move(index: number, delta: number) {
    const next = [...toolbar.items.map((item) => item.id)];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    await run(() => reorderToolbarItemsAction(toolbar.id, next));
  }

  function handleDrop(targetItem: (typeof toolbar.items)[number]) {
    setDropTargetId(undefined);
    if (!draggingId) return;

    const draggingIndex = toolbar.items.findIndex((item) => item.id === draggingId);
    const targetIndex = toolbar.items.findIndex((item) => item.id === targetItem.id);

    if (draggingIndex === -1 || targetIndex === -1 || draggingIndex === targetIndex) {
      setDraggingId(undefined);
      return;
    }

    const next = [...toolbar.items.map((item) => item.id)];
    next.splice(draggingIndex, 1);
    next.splice(targetIndex, 0, draggingId);
    setDraggingId(undefined);

    void run(() => reorderToolbarItemsAction(toolbar.id, next));
  }

  return (
    <div className="mt-6 border-t border-line pt-6">
      <h3 className="font-display text-lg font-semibold text-ink">Items</h3>
      <p className="mt-1 text-sm text-muted">
        A <strong>screen</strong> is a shortcut. A <strong>separator</strong> draws a
        dividing line between two groups. A <strong>space</strong> is invisible and
        pushes what follows to the far end. New items are added at the end of the list;
        use the arrows to move one.
      </p>

      {toolbar.items.length === 0 ? (
        <p className="mt-4 text-sm text-muted">Nothing on this toolbar yet.</p>
      ) : (
        <>
          <ul className="mt-4 divide-y divide-line rounded-xl border border-line">
            {toolbar.items.map((item, index) => {
              const target = item.menuItemId ? byId.get(item.menuItemId) : undefined;
              const isDragging = draggingId === item.id;
              const isDropTarget = dropTargetId === item.id && draggingId !== item.id;

              return (
                <li
                  key={item.id}
                  className={`group relative flex cursor-grab items-center justify-between gap-3 p-3 transition-shadow active:cursor-grabbing motion-reduce:transition-none ${
                    isDragging ? "opacity-40" : ""
                  } ${isDropTarget ? "ring-2 ring-brass" : "ring-1 ring-transparent hover:ring-line/50"}`}
                  draggable
                  onDragStart={() => setDraggingId(item.id)}
                  onDragOver={(event) => {
                    if (!draggingId) return;
                    event.preventDefault();
                    setDropTargetId(item.id);
                  }}
                  onDragLeave={() => setDropTargetId((current) => (current === item.id ? undefined : current))}
                  onDrop={(event) => {
                    event.preventDefault();
                    handleDrop(item);
                  }}
                  onDragEnd={() => {
                    setDraggingId(undefined);
                    setDropTargetId(undefined);
                  }}
                >
                  <div className="min-w-0 flex-1">
                    {item.kind === "spacer" ? (
                      <p className="text-sm italic text-muted">Flexible space</p>
                    ) : item.kind === "separator" ? (
                      // Drawn as an actual rule in the list, not just named: it is the
                      // one row whose whole purpose is how it looks, so the admin list
                      // should show it rather than describe it.
                      <p className="flex items-center gap-2 text-sm italic text-muted">
                        <span aria-hidden className="h-px w-8 bg-line" />
                        Separator
                      </p>
                    ) : (
                      <>
                        <p className="truncate text-sm font-medium text-ink">
                          {item.label ?? target?.title ?? "Unknown screen"}
                        </p>
                        <p className="truncate text-xs text-muted">
                          {target
                            ? `${target.moduleName} · ${target.href}`
                            : // A row whose menu item no longer exists. It is simply not
                              // drawn on the real toolbar; saying so here is the only
                              // place an admin can find out and remove it.
                              `Missing screen (${item.menuItemId}) — not shown on the toolbar`}
                        </p>
                      </>
                    )}
                  </div>
                  <div
                    className="flex shrink-0 gap-1 opacity-0 transition-opacity motion-reduce:transition-none group-hover:opacity-100 group-focus-within:opacity-100"
                    draggable={false}
                    onDragStart={(event) => {
                      event.preventDefault();
                    }}
                  >
                    <Button
                      variant="secondary"
                      size="sm"
                      ariaLabel="Move up"
                      disabled={isBusy || index === 0}
                      onClick={() => void move(index, -1)}
                    >
                      ↑
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      ariaLabel="Move down"
                      disabled={isBusy || index === toolbar.items.length - 1}
                      onClick={() => void move(index, 1)}
                    >
                      ↓
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={isBusy}
                      onClick={() => void run(() => removeToolbarItemAction(toolbar.id, item.id))}
                    >
                      Remove
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-4 text-xs text-muted">
            Drag an item to rearrange, or use the arrows that appear on hover.
          </p>
        </>
      )}

      <div className="mt-4 rounded-xl border border-line p-3">
        <p className={LABEL}>Add an item</p>

        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <div>
            <label htmlFor="item-kind" className={LABEL}>
              Type
            </label>
            <select
              id="item-kind"
              value={kind}
              onChange={(event) => setKind(event.target.value as ToolbarItemKind)}
              className={`mt-1 ${INPUT}`}
            >
              <option value="menu-item">Screen</option>
              <option value="separator">Separator (a dividing line)</option>
              <option value="spacer">Space (flexible, pushes the rest along)</option>
            </select>
          </div>

          {kind === "menu-item" ? (
            <>
              <div>
                <label htmlFor="item-module" className={LABEL}>
                  Module
                </label>
                <select
                  id="item-module"
                  value={moduleSlug}
                  onChange={(event) => {
                    setModuleSlug(event.target.value);
                    // The previously picked screen belongs to the old module, so it
                    // must not survive the switch.
                    setMenuItemId("");
                  }}
                  className={`mt-1 ${INPUT}`}
                >
                  <option value="">Choose a module…</option>
                  {modules.map((appModule) => (
                    <option key={appModule.slug} value={appModule.slug}>
                      {appModule.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="item-screen" className={LABEL}>
                  Screen
                </label>
                <select
                  id="item-screen"
                  value={menuItemId}
                  disabled={!moduleSlug}
                  onChange={(event) => setMenuItemId(event.target.value)}
                  className={`mt-1 ${INPUT}`}
                >
                  <option value="">{moduleSlug ? "Choose a screen…" : "Pick a module first"}</option>
                  {screens.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.group ? `${item.group} — ${item.title}` : item.title}
                    </option>
                  ))}
                </select>
              </div>
            </>
          ) : null}

          {!isOrnamentalKind(kind) ? (
            <div>
              <label htmlFor="item-label" className={LABEL}>
                Name (optional)
              </label>
              <input
                id="item-label"
                value={label}
                maxLength={MAX_TOOLBAR_LABEL_LENGTH}
                onChange={(event) => setLabel(event.target.value)}
                placeholder={
                  (menuItemId ? byId.get(menuItemId)?.title : undefined) ??
                  "The screen's own name"
                }
                className={`mt-1 ${INPUT}`}
              />
            </div>
          ) : null}
        </div>

        {kind === "menu-item" ? (
          <p className="mt-2 text-xs text-muted">
            The name is the tooltip — a toolbar row is its icon alone, so nothing else
            says what it opens. Leave it empty to use the screen&apos;s own name, and
            renaming it on the Menu Items screen will update this toolbar too.
          </p>
        ) : null}

        <div className="mt-3">
          <Button
            variant="primary"
            disabled={isBusy || (kind === "menu-item" && !menuItemId)}
            onClick={() => void handleAdd()}
          >
            Add
          </Button>
        </div>
      </div>
    </div>
  );
}
