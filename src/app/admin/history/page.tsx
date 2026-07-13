import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";

// One-off: reading a single known file for display. Not worth a lib repository
// for this — promote if a second consumer needs CHANGE_HISTORY.md content.
function readChangeHistory(): string | null {
  try {
    return readFileSync(path.join(process.cwd(), "CHANGE_HISTORY.md"), "utf8");
  } catch {
    return null;
  }
}

// Minimal renderer for the specific subset of markdown CHANGE_HISTORY.md
// actually uses (#/##/### headings, "-"/"*" bullet lists, plain paragraphs).
// Not a general markdown parser.
function renderChangeHistory(markdown: string): ReactNode[] {
  const blocks: ReactNode[] = [];
  let listItems: string[] = [];

  function flushList() {
    if (listItems.length === 0) return;
    blocks.push(
      <ul key={`list-${blocks.length}`} className="list-disc space-y-1 pl-5 text-sm text-ink">
        {listItems.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>,
    );
    listItems = [];
  }

  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trimEnd();
    if (line.startsWith("### ")) {
      flushList();
      blocks.push(
        <h3 key={blocks.length} className="mt-4 font-display text-base font-semibold text-ink">
          {line.slice(4)}
        </h3>,
      );
    } else if (line.startsWith("## ")) {
      flushList();
      blocks.push(
        <h2
          key={blocks.length}
          className="mt-6 border-t border-line pt-4 font-display text-lg font-semibold text-ink first:mt-0 first:border-t-0 first:pt-0"
        >
          {line.slice(3)}
        </h2>,
      );
    } else if (line.startsWith("# ")) {
      flushList();
      blocks.push(
        <h1 key={blocks.length} className="font-display text-2xl font-semibold text-ink">
          {line.slice(2)}
        </h1>,
      );
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      listItems.push(line.slice(2));
    } else if (line.trim() === "") {
      flushList();
    } else {
      flushList();
      blocks.push(
        <p key={blocks.length} className="text-sm text-muted">
          {line}
        </p>,
      );
    }
  }
  flushList();

  return blocks;
}

export default function ChangeHistoryPage() {
  const content = readChangeHistory();

  return (
    <div className="mx-auto max-w-3xl">
      <p className="font-mono text-xs font-medium uppercase tracking-widest text-brass-dark">
        Administration
      </p>
      <h1 className="mt-2 font-display text-3xl font-semibold text-ink">Change History</h1>
      <div className="mt-3 h-px w-full bg-line" />
      <div className="mt-8 space-y-2">
        {content ? (
          renderChangeHistory(content)
        ) : (
          <div className="rounded-xl border border-dashed border-line p-8 text-center">
            <p className="font-display text-lg text-ink">No change history yet</p>
            <p className="mt-1 text-sm text-muted">
              Run the <code className="font-mono">build_project</code> skill to create{" "}
              <code className="font-mono">CHANGE_HISTORY.md</code>.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
