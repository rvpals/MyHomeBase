"use client";

// The Export for AI Analysis screen: pick a format and what to analyse, preview
// the generated prompt, then copy or download it.
//
// Presentation only. Every number, every word of the prompt and both renderings
// come from `@/lib/portfolio-export` via one server action — this file decides
// what is on screen and nothing about what the export says.

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { Modal } from "@/components/modal";
import { SlotIcon } from "@/components/slot-icon";
import { getIconSlot } from "@/lib/icons";
import { ANALYSIS_FOCUSES, ANALYSIS_FOCUS_INFO, type AnalysisFocus } from "@/lib/portfolio-export";
import {
  generatePortfolioExportAction,
  type GenerateExportResult,
} from "./stock-ai-export-actions";

const AI_EXPORT_SLOT = getIconSlot("stock_section_ai_export")!;

type Format = "markdown" | "json";

/** How long the copy button stays in its confirmed state. */
const COPIED_FEEDBACK_MS = 2000;

const INPUT_CLASSES =
  "rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export interface StockAiExportViewProps {
  /** Shown before anything is generated, so the screen isn't empty on arrival. */
  holdingCount: number;
  accountCount: number;
  totalMarketValue: number;
}

export function StockAiExportView({
  holdingCount,
  accountCount,
  totalMarketValue,
}: StockAiExportViewProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [format, setFormat] = useState<Format>("markdown");
  const [focus, setFocus] = useState<AnalysisFocus[]>([...ANALYSIS_FOCUSES]);
  const [result, setResult] = useState<GenerateExportResult | undefined>();
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  /**
   * Regenerates for an explicit choice.
   *
   * Every caller passes the selection it is about to apply rather than reading
   * the current state, because a `setState` in the same handler has not landed
   * yet — and driving this from an effect on `[format, focus]` instead would be
   * the cascading-render anti-pattern the lint rule (rightly) rejects.
   */
  const generate = useCallback(async (nextFormat: Format, nextFocus: AnalysisFocus[]) => {
    setIsGenerating(true);
    // Dropping the confirmation here, at the moment the content starts changing,
    // is what stops "Copied" describing text that is no longer on screen.
    setCopied(false);
    try {
      setResult(await generatePortfolioExportAction({ format: nextFormat, focus: nextFocus }));
    } catch {
      setResult({ ok: false, error: "The export could not be generated." });
    } finally {
      setIsGenerating(false);
    }
  }, []);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  function open() {
    setIsOpen(true);
    void generate(format, focus);
  }

  function chooseFormat(next: Format) {
    setFormat(next);
    void generate(next, focus);
  }

  function toggleFocus(value: AnalysisFocus) {
    // Kept in the canonical order so the same ticks always send the same array.
    const next = focus.includes(value)
      ? focus.filter((entry) => entry !== value)
      : ANALYSIS_FOCUSES.filter((entry) => entry === value || focus.includes(entry));
    setFocus(next);
    void generate(format, next);
  }

  async function copyToClipboard() {
    if (!result?.content) return;
    try {
      await navigator.clipboard.writeText(result.content);
      setCopied(true);
    } catch {
      // A denied clipboard permission is not an error worth a dialog: the text
      // is on screen and selectable, which is the fallback either way.
      setCopied(false);
    }
  }

  function download() {
    if (!result?.content || !result.fileName) return;
    const blob = new Blob([result.content], {
      type: format === "json" ? "application/json" : "text/markdown",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = result.fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-6">
      <CollapsibleCard
        title="Export for AI Analysis"
        titleIcon={<SlotIcon slot={AI_EXPORT_SLOT} className="h-5 w-5" />}
        defaultOpen
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">
            Package the portfolio as a prompt you can paste into any AI chat — holdings,
            weights, cost basis and returns, with an analyst brief in front of them. Account
            names are replaced by their tax treatment, so no broker, employer or personal
            name leaves this machine.
          </p>

          <div className="grid grid-cols-3 gap-3 max-lg:grid-cols-1">
            <div className="rounded-xl border border-line p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-muted">
                Market value
              </div>
              <div className="font-display text-xl text-ink">{formatUsd(totalMarketValue)}</div>
            </div>
            <div className="rounded-xl border border-line p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-muted">
                Positions
              </div>
              <div className="font-display text-xl text-ink">{holdingCount}</div>
            </div>
            <div className="rounded-xl border border-line p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-muted">
                Accounts
              </div>
              <div className="font-display text-xl text-ink">{accountCount}</div>
            </div>
          </div>

          <div>
            <Button onClick={open}>Export for AI Analysis</Button>
          </div>
        </div>
      </CollapsibleCard>

      {isOpen && (
        <Modal
          title="Export for AI Analysis"
          titleIcon={<SlotIcon slot={AI_EXPORT_SLOT} className="h-5 w-5" />}
          description="Pick a format and what you want analysed, then copy the result into your AI of choice."
          size="lg"
          onClose={() => setIsOpen(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setIsOpen(false)}>
                Close
              </Button>
              <Button
                variant="secondary"
                onClick={download}
                disabled={!result?.content || isGenerating}
              >
                Download {format === "json" ? ".json" : ".md"}
              </Button>
              <Button onClick={copyToClipboard} disabled={!result?.content || isGenerating}>
                {copied ? "Copied" : "Copy to clipboard"}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted">Format</span>
              <div className="flex gap-2">
                {(["markdown", "json"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => chooseFormat(option)}
                    aria-pressed={format === option}
                    className={`rounded-full border px-4 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${
                      format === option
                        ? "border-brass bg-brass text-paper"
                        : "border-line bg-paper text-ink"
                    }`}
                  >
                    {option === "markdown" ? "Markdown" : "JSON"}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted">
                {format === "markdown"
                  ? "Tables and bullets — best for pasting straight into a chat."
                  : "A structured object — best for a script or a custom workflow."}
              </p>
            </div>

            <fieldset className="flex flex-col gap-2">
              <legend className="text-xs font-medium uppercase tracking-wide text-muted">
                Analysis focus
              </legend>
              <div className="flex flex-col gap-2">
                {ANALYSIS_FOCUSES.map((option) => (
                  <label key={option} className="flex items-start gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={focus.includes(option)}
                      onChange={() => toggleFocus(option)}
                      className="mt-1 accent-[var(--brass)]"
                    />
                    <span>
                      <span className="font-medium">{ANALYSIS_FOCUS_INFO[option].label}</span>
                      <span className="block text-xs text-muted">
                        {ANALYSIS_FOCUS_INFO[option].description}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              {focus.length === 0 && (
                <p className="text-xs text-muted">
                  Nothing ticked — the prompt will ask for a general review instead.
                </p>
              )}
            </fieldset>

            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-xs font-medium uppercase tracking-wide text-muted">
                  Preview
                </span>
                {result?.stats && (
                  <span className="text-xs text-muted">
                    {result.stats.holdingCount} positions · {result.stats.accountCount} accounts ·{" "}
                    {formatUsd(result.stats.totalMarketValue)}
                    {result.stats.excludedCount > 0
                      ? ` · ${result.stats.excludedCount} accounts excluded`
                      : ""}
                  </span>
                )}
              </div>

              {isGenerating && <p className="text-sm text-muted">Generating…</p>}

              {!isGenerating && result && !result.ok && (
                <p className="text-sm text-red-400">{result.error}</p>
              )}

              {!isGenerating && result?.ok && (
                <textarea
                  readOnly
                  value={result.content ?? ""}
                  spellCheck={false}
                  // Read-only rather than a <pre>: a textarea is selectable with one
                  // keystroke and scrolls on its own, which is what a reader who can't
                  // use the clipboard button needs.
                  className={`${INPUT_CLASSES} h-80 w-full resize-y font-mono text-xs leading-relaxed max-lg:h-56`}
                />
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
