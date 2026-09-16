import { classifyFailure, isTransient } from "./log-tail";
import type { FailurePageInput } from "./types";

/**
 * Escapes text for HTML.
 *
 * Non-negotiable here rather than a nicety: every line of `app.log` is untrusted
 * as far as this page is concerned. A log can contain an error message built from
 * a request path, a filename, or a database value, and any of those could carry
 * `<script>`. The page is served without authentication (it cannot check a session
 * — the database may be the thing that's broken), so escaping is the only thing
 * standing between a crafted log line and script execution on the app's own origin.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A timestamp a human reads, in the server's own timezone — which is the NAS's. */
function formatTimestamp(when: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ` +
    `${pad(when.getHours())}:${pad(when.getMinutes())}:${pad(when.getSeconds())}`
  );
}

/**
 * Renders the whole failure page as one self-contained HTML document.
 *
 * Deliberately *not* a React component and deliberately not using the app's theme
 * tokens, fonts or Tailwind classes, which is a conscious exception to the usual
 * "colors and fonts are theme tokens" rule in design.md. Those all live inside the
 * application bundle; this page is served by a standalone process precisely because
 * that bundle wouldn't load. Anything it imported from the app would be another
 * thing that could fail, on the one screen that has to work when everything else
 * has. So: no imports, no stylesheet request, no webfont, one file, inline CSS.
 *
 * It follows the app's dark palette by eye so it doesn't look like a browser error,
 * and states plainly that it is not the app.
 */
export function renderFailurePage(input: FailurePageInput): string {
  const { tail, occurredAt, logPath, refreshSeconds } = input;
  const diagnosis = classifyFailure(tail);

  const logBody =
    tail.lines.length === 0
      ? '<p class="empty">The log file is empty, or does not exist yet.</p>'
      : `<pre>${escapeHtml(tail.lines.join("\n"))}</pre>`;

  const counts =
    tail.totalLines === 0
      ? "no lines yet"
      : tail.truncated
        ? `last ${tail.lines.length} of ${tail.totalLines.toLocaleString("en-US")} lines`
        : `all ${tail.totalLines.toLocaleString("en-US")} lines`;

  const retryNote = isTransient(diagnosis.cause)
    ? "This one often clears on its own — the keepalive task retries every minute."
    : "The keepalive task retries every minute. This page updates itself, and hands over to the app as soon as it starts.";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="${refreshSeconds}">
<title>MyHomeBase — failed to start</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 2rem 1.25rem; min-height: 100vh;
    background: #0f1115; color: #e6e8ee;
    font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  main { max-width: 60rem; margin: 0 auto; }
  .tag {
    display: inline-block; margin-bottom: 0.9rem; padding: 0.2rem 0.55rem;
    border: 1px solid #7f1d1d; border-radius: 999px;
    background: #2a1215; color: #fca5a5;
    font-size: 0.72rem; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;
  }
  h1 { margin: 0 0 0.6rem; font-size: 1.45rem; line-height: 1.25; font-weight: 650; }
  .remedy { margin: 0 0 0.4rem; color: #b9bfcc; }
  .meta { margin: 0 0 1.6rem; color: #7d8494; font-size: 0.85rem; }
  .meta code {
    padding: 0.1rem 0.3rem; border-radius: 4px;
    background: #1a1d24; color: #aab2c3; font-size: 0.85em;
  }
  h2 {
    display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: baseline;
    margin: 0 0 0.5rem; font-size: 0.9rem; font-weight: 600;
  }
  h2 .count { color: #7d8494; font-size: 0.8rem; font-weight: 400; }
  pre {
    margin: 0; padding: 1rem; max-height: 60vh; overflow: auto;
    border: 1px solid #262a33; border-radius: 10px; background: #14161c;
    color: #cfd5e1; font: 12.5px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    white-space: pre-wrap; word-break: break-word;
  }
  .empty {
    margin: 0; padding: 1rem; border: 1px dashed #303541; border-radius: 10px;
    background: #14161c; color: #7d8494;
  }
  footer { margin-top: 1.5rem; color: #6b7280; font-size: 0.8rem; }
  @media (max-width: 1023px) {
    body { padding: 1.25rem 0.9rem; }
    h1 { font-size: 1.2rem; }
    pre { max-height: 55vh; font-size: 11.5px; padding: 0.75rem; }
  }
</style>
</head>
<body>
<main>
  <p class="tag">Startup failure</p>
  <h1>${escapeHtml(diagnosis.headline)}</h1>
  <p class="remedy">${escapeHtml(diagnosis.remedy)}</p>
  <p class="meta">
    Detected ${escapeHtml(formatTimestamp(occurredAt))} ·
    log <code>${escapeHtml(logPath)}</code>
  </p>
  <h2>Server log <span class="count">${escapeHtml(counts)}</span></h2>
  ${logBody}
  <footer>
    ${escapeHtml(retryNote)}
    This page is served by the startup fallback, not by MyHomeBase.
  </footer>
</main>
</body>
</html>
`;
}
