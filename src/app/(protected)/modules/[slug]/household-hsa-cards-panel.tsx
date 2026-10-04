"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { Modal } from "@/components/modal";
import type { HsaCard } from "@/lib/household/hsa-types";
import {
  createHsaCardAction,
  deleteHsaCardAction,
  renameHsaCardAction,
  setHsaCardActiveAction,
} from "./household-actions";

// The cards panel on Household → Configuration: the pick list behind an expense's
// "Paid with" box. One-off UI, kept local — a short list with an add box, not a
// reusable table. Rendered inside the Configuration page, which is admin-only.

const INPUT_CLASS =
  "rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

export function HouseholdHsaCardsPanel({ cards }: { cards: HsaCard[] }) {
  const router = useRouter();
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [newName, setNewName] = useState("");
  // The card being renamed, and its draft name. One at a time.
  const [editing, setEditing] = useState<{ id: number; name: string }>();
  const [deleting, setDeleting] = useState<HsaCard>();

  async function run(work: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setIsBusy(true);
    setError(undefined);
    const result = await work();
    setIsBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Something went wrong.");
      return;
    }
    after?.();
    router.refresh();
  }

  return (
    <div>
      {error && (
        <p className="mb-3 rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink">
          {error}
        </p>
      )}

      {/* The add box. Stacks on a phone via `max-lg:`. */}
      <form
        className="mb-4 flex items-end gap-2 max-lg:flex-col max-lg:items-stretch"
        onSubmit={(event) => {
          event.preventDefault();
          void run(() => createHsaCardAction(newName), () => setNewName(""));
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-muted">New card</span>
          <input
            className={INPUT_CLASS}
            value={newName}
            placeholder="Visa ending 1234, HSA debit card…"
            onChange={(event) => setNewName(event.target.value)}
          />
        </label>
        <Button type="submit" variant="primary" disabled={isBusy || newName.trim() === ""}>
          Add card
        </Button>
      </form>

      {cards.length === 0 ? (
        <p className="text-sm text-muted">
          No cards yet. Add the credit and HSA cards you pay with; they appear in an
          expense&apos;s Paid with box.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {cards.map((card) => (
            <li
              key={card.id}
              className="flex items-center gap-3 rounded-xl border border-line p-3 max-lg:flex-col max-lg:items-stretch"
            >
              <div className="min-w-0 flex-1">
                {editing?.id === card.id ? (
                  <input
                    className={`${INPUT_CLASS} w-full`}
                    value={editing.name}
                    autoFocus
                    onChange={(event) => setEditing({ id: card.id, name: event.target.value })}
                  />
                ) : (
                  <span className={card.isActive ? "text-ink" : "text-muted line-through"}>
                    {card.name}
                  </span>
                )}
                {!card.isActive && editing?.id !== card.id && (
                  <span className="ml-2 text-xs text-muted">Hidden from the pick list</span>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                {editing?.id === card.id ? (
                  <>
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={isBusy}
                      onClick={() =>
                        run(() => renameHsaCardAction(card.id, editing.name), () => setEditing(undefined))
                      }
                    >
                      Save
                    </Button>
                    <Button size="sm" variant="secondary" disabled={isBusy} onClick={() => setEditing(undefined)}>
                      Cancel
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={isBusy}
                      onClick={() => setEditing({ id: card.id, name: card.name })}
                    >
                      Rename
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={isBusy}
                      onClick={() => run(() => setHsaCardActiveAction(card.id, !card.isActive))}
                    >
                      {card.isActive ? "Hide" : "Show"}
                    </Button>
                    <Button size="sm" variant="danger" disabled={isBusy} onClick={() => setDeleting(card)}>
                      Delete
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {deleting && (
        <Modal
          title="Delete this card?"
          description={deleting.name}
          isBusy={isBusy}
          onClose={() => setDeleting(undefined)}
          footer={
            <>
              <Button variant="secondary" disabled={isBusy} onClick={() => setDeleting(undefined)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={isBusy}
                onClick={() => run(() => deleteHsaCardAction(deleting.id), () => setDeleting(undefined))}
              >
                Delete
              </Button>
            </>
          }
        >
          <p className="text-sm text-muted">
            It leaves the pick list. Expenses already paid with it keep the name, so nothing
            recorded changes. Use Hide instead to keep the card but stop offering it.
          </p>
        </Modal>
      )}
    </div>
  );
}
