"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { Modal } from "@/components/modal";
import type { HsaCard } from "@/lib/household/hsa-types";
import type { FolderListing } from "@/lib/household/receipt-store";
import { PAGE_CONTAINER } from "../../page-container";
import {
  browseFoldersAction,
  checkReceiptRootAction,
  saveReceiptRootAction,
} from "./household-actions";
import { HouseholdHsaCardsPanel } from "./household-hsa-cards-panel";

// Household → Configuration. Admin-only (the page checks; this view only presents).
//
// Two panels: where HSA receipts are filed, and the cards offered in Paid with.

const INPUT_CLASS =
  "rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

export function HouseholdConfigurationView({
  receiptRoot,
  cards,
}: {
  receiptRoot: string;
  cards: HsaCard[];
}) {
  const router = useRouter();
  const [path, setPath] = useState(receiptRoot);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [isBrowsing, setIsBrowsing] = useState(false);

  async function save() {
    setIsBusy(true);
    setError(undefined);
    setNotice(undefined);
    const result = await saveReceiptRootAction(path);
    setIsBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Could not save that folder.");
      return;
    }
    setNotice(path.trim() === "" ? "The receipt folder is cleared." : "Saved.");
    router.refresh();
  }

  async function check() {
    setIsBusy(true);
    setError(undefined);
    setNotice(undefined);
    const result = await checkReceiptRootAction(path);
    setIsBusy(false);
    if (result.ok) setNotice(result.message);
    else setError(result.error ?? "Could not check that folder.");
  }

  // Unsaved as soon as the box differs from what is stored — the Save button is the
  // only thing that writes, and Check deliberately does not.
  const isDirty = path.trim() !== receiptRoot;

  return (
    <div className={PAGE_CONTAINER}>
      <div className="flex flex-col gap-4">
        <CollapsibleCard title="HSA receipt folder" defaultOpen>
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">
              Where HSA receipts are filed. Inside it, one folder per year is created as
              needed — <code className="text-ink">2026</code>,{" "}
              <code className="text-ink">2025</code> — and each receipt is saved under the
              year of its expense&apos;s date. Until this is set, a receipt cannot be
              attached.
            </p>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-muted">
                Folder on the server
              </span>
              <div className="flex gap-2 max-lg:flex-col">
                <input
                  className={`${INPUT_CLASS} flex-1`}
                  value={path}
                  placeholder="//NAS_DS223/app/myhomebase/hsa-receipts"
                  onChange={(event) => setPath(event.target.value)}
                />
                <Button variant="secondary" disabled={isBusy} onClick={() => setIsBrowsing(true)}>
                  Browse…
                </Button>
              </div>
            </label>

            <p className="text-xs text-muted">
              This is a path on the machine running MyHomeBase, not on your phone or
              laptop — so Browse lists the server&apos;s own folders.
            </p>

            <div className="flex flex-wrap gap-2">
              <Button variant="primary" disabled={isBusy || !isDirty} onClick={save}>
                {isBusy ? "Working…" : "Save folder"}
              </Button>
              <Button variant="secondary" disabled={isBusy} onClick={check}>
                Check access
              </Button>
              {isDirty && (
                <Button
                  variant="secondary"
                  disabled={isBusy}
                  onClick={() => {
                    setPath(receiptRoot);
                    setError(undefined);
                    setNotice(undefined);
                  }}
                >
                  Revert
                </Button>
              )}
            </div>

            {error && (
              <p role="alert" className="rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink">
                {error}
              </p>
            )}
            {notice && (
              <p className="rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink">
                {notice}
              </p>
            )}

            <p className="text-xs text-muted">
              Changing this does not move receipts that are already filed — each one is
              stored relative to this folder, so point it at a copy that still holds the
              year folders, or move them across yourself.
            </p>
          </div>
        </CollapsibleCard>

        <CollapsibleCard title="Cards" defaultOpen>
          <HouseholdHsaCardsPanel cards={cards} />
        </CollapsibleCard>
      </div>

      {isBrowsing && (
        <FolderBrowser
          startPath={path}
          onCancel={() => setIsBrowsing(false)}
          onPick={(picked) => {
            setPath(picked);
            setIsBrowsing(false);
            setNotice(undefined);
            setError(undefined);
          }}
        />
      )}
    </div>
  );
}

/**
 * Walks the server's folders one level at a time.
 *
 * The server's, not the reader's: a browser file dialog never hands the page a real
 * path, and this folder has to be one the server can write to anyway. Only folders are
 * listed — the choice being made is a folder.
 */
function FolderBrowser({
  startPath,
  onCancel,
  onPick,
}: {
  startPath: string;
  onCancel: () => void;
  onPick: (path: string) => void;
}) {
  const [listing, setListing] = useState<FolderListing>();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>();
  // Loads on first render and on every navigation. `useState` + this flag rather than
  // `useEffect`: there is exactly one load in flight and the dialog owns it.
  const [requested, setRequested] = useState<string>();

  async function open(path: string) {
    setIsLoading(true);
    setError(undefined);
    const result = await browseFoldersAction(path);
    setIsLoading(false);
    if (!result.ok || !result.listing) {
      setError(result.error ?? "Could not open that folder.");
      return;
    }
    setListing(result.listing);
  }

  if (requested === undefined) {
    setRequested(startPath);
    void open(startPath);
  }

  return (
    <Modal
      title="Choose a folder"
      description={listing?.path ?? "Loading…"}
      size="lg"
      onClose={onCancel}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!listing || isLoading}
            onClick={() => listing && onPick(listing.path)}
          >
            Use this folder
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        {error && (
          <p role="alert" className="rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={isLoading || !listing?.parent}
            onClick={() => listing?.parent && open(listing.parent)}
          >
            ↑ Up one level
          </Button>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted">Reading the folder…</p>
        ) : (
          <ul className="panel-inset flex max-h-80 flex-col overflow-auto rounded-md bg-paper">
            {listing?.folders.length === 0 && (
              <li className="px-3 py-2 text-sm text-muted">
                No sub-folders here. &ldquo;Use this folder&rdquo; chooses it as it is.
              </li>
            )}
            {listing?.folders.map((name) => (
              <li key={name}>
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left text-sm text-ink hover:bg-paper-raised"
                  onClick={() => open(`${listing.path.replace(/[/\\]+$/, "")}/${name}`)}
                >
                  {name}
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="text-xs text-muted">
          Pick the folder the year folders should sit in — not a year folder itself.
        </p>
      </div>
    </Modal>
  );
}
