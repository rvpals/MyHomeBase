// Exits 0 if something is accepting TCP connections on a port, 1 if not.
//
// start.sh uses this to answer "did server.js actually come up?" after launching
// it. That question used to go unasked: `nohup ... &` reports the forked PID
// whether or not the process survives, so a build that crashed on startup looked
// identical to a healthy one.
//
// Why a real connect instead of scraping `netstat`:
//   * It tests the thing that matters -- that a client can connect -- rather than
//     that a socket shows up in a table.
//   * netstat parsing is where the false positives are. Matching ":3000" also
//     matches port 30001, and matches a *remote* :3000 in an ESTABLISHED row.
//     Either would report a dead app as healthy, and the cost of that is start.sh
//     leaving a crashed build in place with nothing serving.
//
// Deliberately dependency-free (node:net only), for the same reason as
// startup-failure-server.ts: a native module built for the wrong Node ABI is one
// of the failures this helps detect, so it must not depend on one.
//
// Usage:  node port-probe.cjs 3000 [timeoutMs]

import { connect } from "node:net";

const port = Number(process.argv[2] ?? 3000);
const timeoutMs = Number(process.argv[3] ?? 2000);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`port-probe: not a usable port: ${process.argv[2]}`);
  process.exit(1);
}

// 127.0.0.1, not the 0.0.0.0 the server binds: a connect target has to be a real
// address, and loopback is what the reverse proxy uses to reach the app anyway.
const socket = connect(port, "127.0.0.1");

// Bounded so a port that accepts the TCP handshake but never responds can't hang
// start.sh -- the caller is already inside its own retry loop.
socket.setTimeout(timeoutMs);

socket.on("connect", () => {
  socket.destroy();
  process.exit(0);
});

// Connection refused is the ordinary "not up yet" answer, not an error to report:
// start.sh calls this once a second while waiting, and noise on every attempt
// would bury the real failure in app.log.
socket.on("error", () => process.exit(1));

socket.on("timeout", () => {
  socket.destroy();
  process.exit(1);
});
