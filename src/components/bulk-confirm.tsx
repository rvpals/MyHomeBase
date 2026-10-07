// Confirmation dialog for an action about to hit a ticked selection — "Delete
// these entries?", "Lock these entries?", and the rest of that shape.
//
// Promoted from the Journal Entries screen, which was about to carry a third
// hand-rolled copy of the same modal: a count of what's selected, a caveat
// about the rows that won't behave like the others, and a Cancel / confirm
// pair. The count and the caveat are the whole value — a bulk action's real
// hazard is that the reader has lost track of what is ticked, and a dialog that
// only says "Are you sure?" answers the wrong question.
//
// Pure presentation: it owns no open/closed state and calls no action. The
// caller decides whether to render it, supplies the counted nouns, and handles
// what the confirm actually does. Everything dialog-shaped — overlay, Escape,
// focus trap, scroll lock — comes from `Modal`.
//
// See components.md before hand-rolling a fourth.

"use client";

import { type ReactNode } from "react";
import { Button } from "./button";
import { Modal } from "./modal";

/** The confirm button's weight. Matches `Button`'s own variants. */
type Tone = "danger" | "primary";

export interface BulkConfirmProps {
  /** Dialog heading — phrase it as the question being answered. */
  title: string;
  /** Optional sub-heading explaining what the action will do. */
  description?: ReactNode;
  /**
   * How many rows are selected. Rendered as the dialog's first line, because
   * mis-reading the selection is the mistake this dialog exists to catch.
   */
  count: number;
  /**
   * What the rows are called, for that line. Pass both forms — the caller knows
   * the noun, and an `s` appended here would be wrong for half of them.
   */
  noun: { one: string; many: string };
  /**
   * The caveat under the count: the thing that behaves differently for some of
   * the selection ("some of these are locked and will move anyway").
   *
   * A node rather than a string so it can emphasise the word that matters, and
   * **conditional at the call site** — pass `undefined` when the selection has
   * no such rows, and nothing is rendered. A caveat that is always on screen
   * stops being read.
   */
  caveat?: ReactNode;
  /** The confirm button's label. "Delete", "Lock" — the verb, not "OK". */
  confirmLabel: string;
  /** Confirm button weight. Default `"danger"`, the common case for a bulk action. */
  tone?: Tone;
  /** Disables both buttons and swaps the confirm label while the action is in flight. */
  isBusy?: boolean;
  /** Raised when the confirm button is pressed. */
  onConfirm: () => void;
  /** Raised from Cancel, Escape, the overlay and the ✕. */
  onCancel: () => void;
}

export function BulkConfirm({
  title,
  description,
  count,
  noun,
  caveat,
  confirmLabel,
  tone = "danger",
  isBusy = false,
  onConfirm,
  onCancel,
}: BulkConfirmProps) {
  return (
    <Modal
      title={title}
      description={description}
      onClose={onCancel}
      isBusy={isBusy}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={isBusy}>
            Cancel
          </Button>
          <Button variant={tone} onClick={onConfirm} disabled={isBusy}>
            {isBusy ? "Working…" : confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink">
        {count} {count === 1 ? noun.one : noun.many} selected.
      </p>
      {caveat && <div className="mt-2 text-sm text-muted">{caveat}</div>}
    </Modal>
  );
}
