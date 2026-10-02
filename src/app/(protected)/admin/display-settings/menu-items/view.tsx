"use client";

// The Menu Items list: every destination in the app, grouped by the module that owns
// it, each row editable in place.
//
// Route-local rather than a registered component, for the reason components.md gives:
// it is one admin control bound to this screen's actions. It departs from the
// Floating Components view next door in one way, and deliberately — that screen has
// three rows and saves them as a batch, this one has ~78 and saves **one row at a
// time**. A draft-then-save-all over 78 text fields would make a single typo's blast
// radius the whole navigation, and would need a diff to know what changed.
//
// Narrow behaviour: the row is a stacked block of label + two inputs, which already
// reflows — the grid is `sm:` upward only, so a phone gets one column with no second
// component and no `useIsCompact()` fork.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import {
  MAX_MENU_ITEM_HINT_LENGTH,
  MAX_MENU_ITEM_TITLE_LENGTH,
  type MenuItem,
} from "@/lib/menu-items";
import { resetMenuItemAction, saveMenuItemAction } from "./actions";

/** The form input style every module view copies. Not a new style — see design.md. */
const INPUT =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

/** One module's worth of rows, as the list renders them. */
interface Group {
  key: string;
  name: string;
  items: MenuItem[];
}

function groupByModule(items: MenuItem[]): Group[] {
  const groups: Group[] = [];
  for (const item of items) {
    // Home has no `moduleSlug` by design, so it gets its own heading rather than
    // being filed under a module it does not belong to.
    const key = item.moduleSlug ?? "__home__";
    const existing = groups.find((group) => group.key === key);
    if (existing) existing.items.push(item);
    else groups.push({ key, name: item.moduleName, items: [item] });
  }
  return groups;
}

export function MenuItemsView({ items }: { items: MenuItem[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState("");
  // Only the row being edited is held here, so an unsaved edit on one row cannot be
  // carried onto another by a re-render.
  const [editing, setEditing] = useState<string | undefined>(undefined);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftHint, setDraftHint] = useState("");
  const [busyId, setBusyId] = useState<string | undefined>(undefined);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  const groups = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return groupByModule(items);
    // Matches the id too: an admin arriving from the Icons screen or from a
    // toolbar's stored row has the id in hand, not the title.
    const matched = items.filter((item) =>
      [item.title, item.defaultTitle, item.hint ?? "", item.moduleName, item.id]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
    return groupByModule(matched);
  }, [items, filter]);

  const matchCount = groups.reduce((total, group) => total + group.items.length, 0);

  function beginEdit(item: MenuItem) {
    setEditing(item.id);
    setDraftTitle(item.title);
    setDraftHint(item.hint ?? "");
    setMessage(undefined);
    setError(undefined);
  }

  function cancelEdit() {
    setEditing(undefined);
    setMessage(undefined);
    setError(undefined);
  }

  async function handleSave(item: MenuItem) {
    setBusyId(item.id);
    setError(undefined);
    setMessage(undefined);
    try {
      const result = await saveMenuItemAction({
        menuItemId: item.id,
        title: draftTitle,
        hint: draftHint,
      });
      if (!result.ok) {
        setError(result.error ?? "Failed to save.");
        return;
      }
      setEditing(undefined);
      setMessage(`Saved “${result.item?.title ?? item.title}”.`);
      // The title is navigation chrome, rendered by every shell — refresh rather
      // than trusting this page's own cache to carry the change into the tree.
      router.refresh();
    } finally {
      setBusyId(undefined);
    }
  }

  async function handleReset(item: MenuItem) {
    setBusyId(item.id);
    setError(undefined);
    setMessage(undefined);
    try {
      const result = await resetMenuItemAction(item.id);
      if (!result.ok) {
        setError(result.error ?? "Failed to reset.");
        return;
      }
      setEditing(undefined);
      setMessage(`Reset to “${result.item?.defaultTitle ?? item.defaultTitle}”.`);
      router.refresh();
    } finally {
      setBusyId(undefined);
    }
  }

  return (
    <CollapsibleCard className="mt-8" title="Every screen in the application">
      <p className="text-sm text-muted">
        Renaming an item changes it everywhere the navigation shows it. Clearing a name
        restores the one the application ships with; a description may be cleared to
        nothing.
      </p>

      <div className="mt-4">
        <label htmlFor="menu-item-filter" className="sr-only">
          Filter menu items
        </label>
        <input
          id="menu-item-filter"
          type="search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter by name, module or id…"
          className={INPUT}
        />
        <p className="mt-2 text-xs text-muted">
          {matchCount} of {items.length} items
          {items.some((item) => item.isOverridden)
            ? ` · ${items.filter((item) => item.isOverridden).length} renamed`
            : ""}
        </p>
      </div>

      {error ? <p className="mt-4 text-sm text-red-400">{error}</p> : null}
      {message ? <p className="mt-4 text-sm text-emerald-400">{message}</p> : null}

      {groups.length === 0 ? (
        <p className="mt-6 text-sm text-muted">Nothing matches that filter.</p>
      ) : null}

      {groups.map((group) => (
        <section key={group.key} className="mt-6">
          <h3 className="font-mono text-xs font-medium uppercase tracking-widest text-brass-dark">
            {group.name}
          </h3>

          <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
            {group.items.map((item) => {
              const isEditing = editing === item.id;
              const isBusy = busyId === item.id;

              return (
                <li key={item.id} className="p-3">
                  {isEditing ? (
                    <div className="space-y-2">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div>
                          <label
                            htmlFor={`title-${item.id}`}
                            className="text-xs font-medium uppercase tracking-wide text-muted"
                          >
                            Name
                          </label>
                          <input
                            id={`title-${item.id}`}
                            value={draftTitle}
                            maxLength={MAX_MENU_ITEM_TITLE_LENGTH}
                            onChange={(event) => setDraftTitle(event.target.value)}
                            placeholder={item.defaultTitle}
                            className={`mt-1 ${INPUT}`}
                          />
                        </div>
                        <div>
                          <label
                            htmlFor={`hint-${item.id}`}
                            className="text-xs font-medium uppercase tracking-wide text-muted"
                          >
                            Description
                          </label>
                          <input
                            id={`hint-${item.id}`}
                            value={draftHint}
                            maxLength={MAX_MENU_ITEM_HINT_LENGTH}
                            onChange={(event) => setDraftHint(event.target.value)}
                            placeholder={item.defaultHint ?? "No description"}
                            className={`mt-1 ${INPUT}`}
                          />
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="primary"
                          disabled={isBusy}
                          onClick={() => void handleSave(item)}
                        >
                          {isBusy ? "Saving…" : "Save"}
                        </Button>
                        <Button variant="secondary" disabled={isBusy} onClick={cancelEdit}>
                          Cancel
                        </Button>
                        {item.isOverridden ? (
                          <Button
                            variant="secondary"
                            disabled={isBusy}
                            onClick={() => void handleReset(item)}
                          >
                            Reset to default
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink">
                          {item.title}
                          {item.group ? (
                            <span className="ml-2 text-xs font-normal text-muted">
                              {item.group}
                            </span>
                          ) : null}
                          {item.isOverridden ? (
                            <span className="ml-2 rounded-full bg-brass-soft px-2 py-0.5 text-xs font-medium text-brass-dark">
                              renamed
                            </span>
                          ) : null}
                        </p>
                        {item.hint ? (
                          <p className="mt-0.5 truncate text-xs text-muted">{item.hint}</p>
                        ) : null}
                        {/* The id, because it is what the Icons screen and a toolbar's
                            stored row address this item by — and it is permanent. */}
                        <p className="mt-0.5 truncate font-mono text-xs text-muted">{item.id}</p>
                      </div>
                      <Button variant="secondary" onClick={() => beginEdit(item)}>
                        Edit
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </CollapsibleCard>
  );
}
