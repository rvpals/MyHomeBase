// Refuses to start the browser gate while another dev server for this repo is running.
//
// This exists because of a real incident: `clean:next` deleted `.next` while a dev
// server was serving out of it, that server thrashed trying to read files that no
// longer existed, and left ~1600 orphaned Turbopack worker processes behind — enough
// to saturate the machine so the gate's own server could not start.
import net from "node:net";

/** Ports that must be free: the usual dev port, and the one the gate boots on. */
const REQUIRED_FREE_PORTS = [3000, 3100];

/** Resolves true when something is already accepting connections on `port`. */
function isPortInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const settle = (inUse) => {
      socket.destroy();
      resolve(inUse);
    };

    socket.setTimeout(1500);
    socket.on("connect", () => settle(true));
    socket.on("timeout", () => settle(false));
    socket.on("error", () => settle(false));
  });
}

const occupiedPorts = [];
for (const port of REQUIRED_FREE_PORTS) {
  if (await isPortInUse(port)) occupiedPorts.push(port);
}

if (occupiedPorts.length > 0) {
  console.error(
    `Port(s) ${occupiedPorts.join(", ")} are in use.\n\n` +
      "The browser gate clears .next and boots its own dev server. Doing that while another\n" +
      "dev server is serving from .next corrupts that server and leaks worker processes.\n\n" +
      "Stop your dev server (Ctrl+C in its terminal) and run this again.\n" +
      "Note: the deployed instance on port 5200 is a separate tree and does not matter here.",
  );
  process.exit(1);
}

console.log(`Preflight clean: ports ${REQUIRED_FREE_PORTS.join(", ")} are free.`);
