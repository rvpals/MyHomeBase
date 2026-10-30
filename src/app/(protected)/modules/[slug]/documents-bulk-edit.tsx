"use client";

import { useState } from "react";
import { Button } from "@/components/button";
import { Modal } from "@/components/modal";

/**
 * The bulk categories/tags dialog for a ticked selection of documents (migration 0163).
 *
 * Route-local rather than a shared component: it is one screen's dialog, and the
 * journal's equivalent (`journal-entries-bulk-edit.tsx`) is deliberately its own file
 * too. If a third module wants this shape, that is the point to name it and register
 * it in `components.md` — not before.
 *
 * ## Why three modes rather than one "set these"
 *
 * A document holds *several* categories and tags, so "add Tax to these twelve" and
 * "replace their categories with Tax" are different intentions. A single-valued bulk
 * edit would quietly discard filing the reader meant to keep. Same reasoning, and the
 * same three modes, as the journal's bulk edit.
 */
export interface DocumentsBulkEditProps {
  /** How many documents are ticked — quoted in the heading so the scope is explicit. */
  count: number;
  /** Every category in the library, for the picker. */
  categories: string[];
  /** Every tag in the library. */
  tags: string[];
  isBusy?: boolean;
  onCancel: () => void;
  onApply: (
    field: "categories" | "tags",
    mode: "add" | "remove" | "replace",
    names: string[],
  ) => void;
}

const MODE_LABELS: Record<"add" | "remove" | "replace", string> = {
  add: "Add to what they already have",
  remove: "Remove from them",
  replace: "Replace everything with",
};

export function DocumentsBulkEdit({
  count,
  categories,
  tags,
  isBusy = false,
  onCancel,
  onApply,
}: DocumentsBulkEditProps) {
  const [field, setField] = useState<"categories" | "tags">("categories");
  const [mode, setMode] = useState<"add" | "remove" | "replace">("add");
  const [selected, setSelected] = useState<string[]>([]);

  const available = field === "categories" ? categories : tags;
  const noun = count === 1 ? "document" : "documents";

  // `replace` with nothing ticked is the one combination that destroys filing, so it
  // is called out rather than left to be discovered. It stays available: refusing
  // would leave no way to clear a field in bulk at all.
  const isClearing = mode === "replace" && selected.length === 0;
  // Every other mode needs something ticked to do anything.
  const canApply = !isBusy && (isClearing || selected.length > 0);

  function toggle(name: string) {
    setSelected((current) =>
      current.includes(name) ? current.filter((item) => item !== name) : [...current, name],
    );
  }

  /** Switching the field resets the ticks — a category name is not a tag name. */
  function switchField(next: "categories" | "tags") {
    setField(next);
    setSelected([]);
  }

  return (
    <Modal
      title={`Categories & tags for ${count} ${noun}`}
      onClose={() => {
        if (!isBusy) onCancel();
      }}
      isBusy={isBusy}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={isBusy}>
            Cancel
          </Button>
          <Button
            variant={isClearing ? "danger" : "primary"}
            onClick={() => onApply(field, mode, selected)}
            disabled={!canApply}
          >
            {isBusy ? "Working…" : isClearing ? "Clear them" : "Apply"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        <div className="flex flex-col gap-2">
          <span className="font-medium text-ink">Which list</span>
          <div className="flex gap-2">
            {(["categories", "tags"] as const).map((option) => (
              <Button
                key={option}
                variant={field === option ? "primary" : "secondary"}
                onClick={() => switchField(option)}
                disabled={isBusy}
              >
                {option === "categories" ? "Categories" : "Tags"}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="font-medium text-ink">What to do</span>
          {(["add", "remove", "replace"] as const).map((option) => (
            <label key={option} className="flex items-start gap-2">
              <input
                type="radio"
                className="mt-1"
                name="bulk-mode"
                checked={mode === option}
                onChange={() => setMode(option)}
                disabled={isBusy}
              />
              <span className="text-ink">{MODE_LABELS[option]}</span>
            </label>
          ))}
        </div>

        <div className="flex flex-col gap-2">
          <span className="font-medium text-ink">
            {field === "categories" ? "Categories" : "Tags"}
          </span>
          {available.length === 0 ? (
            <p className="text-muted">
              There are none yet. Add some in Categories &amp; Tags first.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {available.map((name) => (
                <Button
                  key={name}
                  variant={selected.includes(name) ? "primary" : "secondary"}
                  onClick={() => toggle(name)}
                  disabled={isBusy}
                >
                  {name}
                </Button>
              ))}
            </div>
          )}
        </div>

        {isClearing && (
          <p role="alert" className="rounded-md border border-line bg-paper px-3 py-2 text-ink">
            Nothing is ticked, so this will remove{" "}
            <strong>every {field === "categories" ? "category" : "tag"}</strong> from{" "}
            {count} {noun}.
          </p>
        )}
      </div>
    </Modal>
  );
}
