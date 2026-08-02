"use client";

// Paste-and-review importer for a James Clear "3-2-1" issue. The parser is a
// pure library function with no I/O, so parsing runs here in the browser and the
// user sees exactly what was extracted before anything is written — only the
// approved rows go to the server.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import {
  DEFAULT_IMPORT_CATEGORY,
  parseThreeTwoOneNewsletter,
  type ParsedQuoteCandidate,
  type QuoteCategory,
} from "@/lib/daily-quote";
import { importQuotesAction } from "./actions";

const inputClass =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

interface ReviewRow extends ParsedQuoteCandidate {
  include: boolean;
  category: QuoteCategory;
}

export function NewsletterImport({ categories }: { categories: readonly QuoteCategory[] }) {
  const router = useRouter();
  const [pastedText, setPastedText] = useState("");
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [hasParsed, setHasParsed] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  function handleParse() {
    setMessage(undefined);
    setError(undefined);
    const result = parseThreeTwoOneNewsletter(pastedText);
    setRows(
      result.candidates.map((candidate) => ({
        ...candidate,
        include: true,
        category: DEFAULT_IMPORT_CATEGORY,
      })),
    );
    setWarnings(result.warnings);
    setHasParsed(true);
  }

  function updateRow(index: number, patch: Partial<ReviewRow>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  async function handleImport() {
    const selected = rows.filter((row) => row.include);
    if (selected.length === 0) return;
    setIsImporting(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const result = await importQuotesAction(
        selected.map((row) => ({
          quote: row.quote,
          author: row.author,
          category: row.category,
          source: row.source,
        })),
      );
      if (!result.ok) {
        const detail = (result.failures ?? []).map((f) => `#${f.index + 1}: ${f.reason}`).join("; ");
        setError(
          `Imported ${result.importedCount ?? 0} of ${selected.length}. ${detail || result.error || ""}`.trim(),
        );
      } else {
        setMessage(`Imported ${result.importedCount} quote(s).`);
        setRows([]);
        setPastedText("");
        setHasParsed(false);
      }
      router.refresh();
    } finally {
      setIsImporting(false);
    }
  }

  const selectedCount = rows.filter((row) => row.include).length;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        Paste a &ldquo;3-2-1&rdquo; issue below and review what was found before importing. Nothing is
        saved until you press Import.
      </p>

      <textarea
        value={pastedText}
        onChange={(event) => setPastedText(event.target.value)}
        rows={8}
        placeholder="Paste the newsletter text here…"
        className={inputClass}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={handleParse} disabled={pastedText.trim() === ""}>
          Parse
        </Button>
        {hasParsed && (
          <span className="text-sm text-muted">
            {rows.length} quote(s) found{rows.length > 0 && `, ${selectedCount} selected`}.
          </span>
        )}
      </div>

      {warnings.length > 0 && (
        <ul className="rounded-md border border-line bg-paper p-3 text-xs text-red-400">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}

      {message && <p className="text-sm text-emerald-400">{message}</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {rows.length > 0 && (
        <>
          <ul className="flex flex-col gap-3">
            {rows.map((row, index) => (
              <li key={index} className="rounded-md border border-line bg-paper p-3">
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={row.include}
                      onChange={(event) => updateRow(index, { include: event.target.checked })}
                    />
                    Include
                  </label>
                  <span className="rounded-full bg-brass-soft px-2 py-0.5 text-xs font-semibold text-brass-dark">
                    {row.section}
                  </span>
                  {row.topic !== "" && <span className="text-xs text-muted">on {row.topic}</span>}
                </div>

                <textarea
                  value={row.quote}
                  onChange={(event) => updateRow(index, { quote: event.target.value })}
                  rows={3}
                  className={`${inputClass} mt-2`}
                />

                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <label className="block text-xs">
                    <span className="mb-1 block text-muted">Author</span>
                    <input
                      value={row.author}
                      onChange={(event) => updateRow(index, { author: event.target.value })}
                      className={inputClass}
                    />
                  </label>
                  <label className="block text-xs">
                    <span className="mb-1 block text-muted">Source</span>
                    <input
                      value={row.source}
                      onChange={(event) => updateRow(index, { source: event.target.value })}
                      className={inputClass}
                    />
                  </label>
                  <label className="block text-xs">
                    <span className="mb-1 block text-muted">Category</span>
                    <select
                      value={row.category}
                      onChange={(event) =>
                        updateRow(index, { category: event.target.value as QuoteCategory })
                      }
                      className={inputClass}
                    >
                      {categories.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </li>
            ))}
          </ul>

          <div>
            <Button onClick={handleImport} disabled={isImporting || selectedCount === 0}>
              {isImporting ? "Importing…" : `Import ${selectedCount} quote(s)`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
