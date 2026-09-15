"use client";

// The "Consult AI about this ticker" dialog: an editable prompt about one
// symbol, ready to copy into an AI chat or save as a markdown file.
//
// Presentation plus one fetch. Every word of the prompt comes from
// `@/lib/ticker-consult` — this file decides what is on screen, offers the
// reader a textarea to change it in, and hands whatever is *in that textarea*
// to the clipboard and to the download. That last part is the whole point of
// the edit box: the two buttons must never act on the generated text once the
// reader has moved on from it.

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/button";
import { Modal } from "@/components/modal";
import { TreeIcon } from "@/components/tree-icons";
import { buildTickerConsult } from "@/lib/ticker-consult";
import type { TickerOwnData, TickerQuote } from "@/lib/ticker-overview";
import { getTickerSectorAction } from "./stock-profiles-actions";

/** How long the copy button stays in its confirmed state. */
const COPIED_FEEDBACK_MS = 2000;

const INPUT_CLASSES =
  "rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

export interface TickerConsultDialogProps {
  ticker: string;
  /** Already loaded by the viewer — the dialog never refetches it. */
  ownData: TickerOwnData;
  /** The live quote, when the reader has been on the Market tab. */
  quote?: TickerQuote;
  onClose: () => void;
}

export function TickerConsultDialog({
  ticker,
  ownData,
  quote,
  onClose,
}: TickerConsultDialogProps) {
  // The sector, once resolved. Held rather than used and discarded so that Reset
  // rebuilds the prompt the reader actually started from, sector included.
  const [sector, setSector] = useState<string>();
  const [industry, setIndustry] = useState<string>();
  // The prompt as it currently stands, which is what gets copied and
  // downloaded. Seeded from the library and then owned by the reader.
  const [seeded] = useState(() => buildTickerConsult({ ticker, ownData, quote }));
  const [prompt, setPrompt] = useState(seeded.content);
  // Not restated when the sector lands: it is only the ticker and the date, so a
  // rebuild can't change it, and holding it steady keeps the saved file's name
  // the same one the reader saw when they opened the dialog.
  const fileName = seeded.fileName;
  // True once the reader has typed. It gates the sector rebuild below: an
  // arriving sector must not overwrite words the reader has just written.
  const [isEdited, setIsEdited] = useState(false);
  const [isLoadingSector, setIsLoadingSector] = useState(true);
  const [copied, setCopied] = useState(false);

  /**
   * Resolves the sector, then rebuilds the prompt around it.
   *
   * Worth doing because the sector *is* the question — "something else in this
   * sector" is half of what the prompt asks for, and the alternative is making
   * the model guess at a classification we already know. Usually a single cached
   * row rather than a provider call, and the prompt renders immediately without
   * it and is replaced when this lands, so nothing is blocked on it.
   *
   * A failure is deliberately silent: the prompt already contains a branch that
   * asks the model to establish the sector itself, so there is nothing for the
   * reader to do about it and nothing worth an error banner.
   */
  useEffect(() => {
    let stale = false;

    void getTickerSectorAction(ticker)
      .then((result) => {
        if (stale || !result.sector) return;
        setSector(result.sector);
        setIndustry(result.industry || undefined);

        const rebuilt = buildTickerConsult({
          ticker,
          ownData,
          quote,
          sector: result.sector,
          industry: result.industry || undefined,
        });
        // Only if the reader hasn't started writing. Their words win, always.
        setIsEdited((edited) => {
          if (!edited) setPrompt(rebuilt.content);
          return edited;
        });
      })
      .finally(() => {
        if (!stale) setIsLoadingSector(false);
      });

    return () => {
      stale = true;
    };
    // Runs once per open. `ownData` and `quote` are the records the prompt was
    // seeded from and don't change while the dialog is up; depending on their
    // object identity would re-run this and discard the reader's edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const edit = useCallback((value: string) => {
    setPrompt(value);
    setIsEdited(true);
    // Dropped at the moment the content starts changing, so "Copied" can never
    // describe text that is no longer on screen.
    setCopied(false);
  }, []);

  /** Restores the generated wording, discarding the reader's edits. */
  const reset = useCallback(() => {
    setPrompt(buildTickerConsult({ ticker, ownData, quote, sector, industry }).content);
    setIsEdited(false);
    setCopied(false);
  }, [industry, ownData, quote, sector, ticker]);

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
    } catch {
      // A denied clipboard permission is not an error worth a dialog: the text
      // is on screen and selectable, which is the fallback either way.
      setCopied(false);
    }
  }

  function download() {
    const blob = new Blob([prompt], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Modal
      title={`Consult AI about ${ticker}`}
      titleIcon={<TreeIcon name="ai-spark" className="h-5 w-5" />}
      description="Edit the prompt if you like, then copy it into your AI of choice. It asks for alternatives in the same sector and in a different one, priced within 15% of this ticker."
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          {isEdited && (
            <Button variant="secondary" onClick={reset}>
              Reset
            </Button>
          )}
          <Button variant="secondary" onClick={download}>
            Download .md
          </Button>
          <Button onClick={copyToClipboard}>{copied ? "Copied" : "Copy to clipboard"}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3 max-lg:flex-col max-lg:items-start">
          <span className="text-xs font-medium uppercase tracking-wide text-muted">Prompt</span>
          <span className="text-xs text-muted">
            {isLoadingSector
              ? "Looking up the sector…"
              : isEdited
                ? "Edited — Copy and Download use what is below."
                : "Editable. Copy and Download use what is below."}
          </span>
        </div>

        <textarea
          value={prompt}
          onChange={(event) => edit(event.target.value)}
          spellCheck={false}
          aria-label={`The AI consult prompt for ${ticker}`}
          className={`${INPUT_CLASSES} h-96 w-full resize-y font-mono text-xs leading-relaxed max-lg:h-64`}
        />
      </div>
    </Modal>
  );
}
