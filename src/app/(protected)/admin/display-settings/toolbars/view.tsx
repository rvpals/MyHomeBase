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

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
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

export function ToolbarsView({
  toolbars,
  menuItems,
  editToolbarId,
}: {
  toolbars: ToolbarWithItems[];
  menuItems: MenuItem[];
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

  return (
    <>
      <CollapsibleCard className="mt-8" title="Toolbars">
        <p className="text-sm text-muted">
          Each toolbar docks to one edge. Creating one does not put it on anyone&apos;s
          screen by itself — it has to be visible here, and each person can still hide
          it from their own Account page.
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
                    {!toolbar.isVisible ? (
                      <span className="ml-2 rounded-full bg-line px-2 py-0.5 text-xs font-normal text-muted">
                        hidden
                      </span>
                    ) : null}
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
                <div className="flex shrink-0 gap-2">
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
        <ul className="mt-4 divide-y divide-line rounded-xl border border-line">
          {toolbar.items.map((item, index) => {
            const target = item.menuItemId ? byId.get(item.menuItemId) : undefined;
            return (
              <li key={item.id} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
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
                <div className="flex shrink-0 gap-1">
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
