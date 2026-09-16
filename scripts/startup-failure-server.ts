// Serves the "MyHomeBase failed to start" page on port 3000, so a startup crash
// shows you app.log in the browser instead of DSM's generic "cannot connect".
//
// Why a second server at all: when server.js dies during startup -- a native
// module built for the wrong Node ABI, an unopenable database, a port still held
// -- nothing binds port 3000. DSM's reverse proxy has no upstream and serves its
// own error, which says nothing about the cause. The app cannot render its own
// failure page, because the app is what failed. So start.sh brings this up
// instead, and it holds the port until the next real start succeeds.
//
// This is the deploy-side entry point, bundled to plain CJS for the NAS the same
// way scripts/migrate.ts is -- the NAS has no tsx and no path-alias resolution,
// so it imports by relative path rather than via `@/`.
//
// It uses ONLY node:http and node:fs, on purpose. No better-sqlite3, no sharp, no
// Next. Every dependency would be another thing that could fail on the one screen
// that has to work when everything else has -- and a broken native module is
// among the failures it exists to report.
//
// Usage:
//   node startup-failure-server.cjs            # port 3000, ./app.log
//   node startup-failure-server.cjs 3000 /path/to/app.log

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { LOG_TAIL_LINES, tailLines } from "../src/lib/startup-failure/log-tail";
import { renderFailurePage } from "../src/lib/startup-failure/page";

/**
 * How often the page reloads itself.
 *
 * 15s, comfortably under the keepalive task's one-minute interval, so the browser
 * lands on the real app within a few seconds of it coming up rather than leaving
 * the reader looking at a stale failure and wondering.
 */
const REFRESH_SECONDS = 15;

const [portArg, logArg] = process.argv.slice(2);
const port = Number(portArg ?? process.env.PORT ?? 3000);
const logPath = logArg ?? path.join(process.cwd(), "app.log");

// Captured once, at startup, rather than per request: this is when the failure was
// detected, and it must not tick forward on every refresh -- a moving timestamp
// would read as "the app just crashed again" on a page that has been up for an hour.
const occurredAt = new Date();

/** The log tail, or no lines if it can't be read. */
function readTail() {
  try {
    return tailLines(readFileSync(logPath, "utf8"), LOG_TAIL_LINES);
  } catch {
    // Missing or unreadable is an ordinary case, not an error worth crashing on:
    // a process that died before writing anything leaves no file. The page says
    // so in words, which is itself a useful diagnosis.
    return { lines: [], truncated: false, totalLines: 0 };
  }
}

const server = createServer((request, response) => {
  // Read on every request rather than caching, so a refresh picks up whatever the
  // retrying keepalive task has appended since.
  const html = renderFailurePage({
    tail: readTail(),
    occurredAt,
    logPath,
    refreshSeconds: REFRESH_SECONDS,
  });

  // 503, not 200: this is an unhealthy app, and an uptime monitor or the reverse
  // proxy should be able to tell without parsing the body. Retry-After matches the
  // keepalive interval.
  //
  // Every path gets the same page -- there is no routing to do, and a 404 on
  // /favicon.ico or a deep link the reader had bookmarked would be a worse answer
  // than telling them why the app is down.
  response.writeHead(503, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store, max-age=0",
    "Retry-After": "60",
  });
  // HEAD must not carry a body, and the browser tab's favicon request is a GET, so
  // this is the only method that needs special handling.
  response.end(request.method === "HEAD" ? undefined : html);
});

// If even this can't bind, say so on stderr and exit rather than hanging: start.sh
// appends our output to app.log, so the message lands where someone will find it.
// The likeliest cause is that the real server actually did come up and took the
// port, which is a good outcome -- nothing to do but step aside.
server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.log(
      `startup-failure-server: port ${port} is already bound — assuming the app came up. Exiting.`,
    );
    process.exit(0);
  }
  console.error(`startup-failure-server: could not listen on ${port}: ${error.message}`);
  process.exit(1);
});

server.listen(port, "0.0.0.0", () => {
  console.log(
    `startup-failure-server: serving the startup-failure page on ${port} (log: ${logPath})`,
  );
});

// start.sh stops this with a plain `kill` before each real start attempt. Closing
// the listener on SIGTERM releases the port promptly, so the new server.js isn't
// met by EADDRINUSE -- which would be this fallback causing the very failure it
// reports.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    // Don't wait on open keep-alive connections: a browser sitting on the refresh
    // loop holds one, and the port has to be free now, not whenever it gives up.
    server.closeAllConnections?.();
  });
}
