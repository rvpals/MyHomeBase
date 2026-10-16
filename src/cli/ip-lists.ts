// The two IP judgement lists from the terminal — the same use-cases Admin → Security
// → Visit drives.
//
//   npm run cli -- ip-lists allowed
//   npm run cli -- ip-lists blocked
//   npm run cli -- ip-lists allow 203.0.113.7 "my phone on 5G"
//   npm run cli -- ip-lists block 203.0.113.7 "scanning /wp-admin all week"
//   npm run cli -- ip-lists unallow 203.0.113.7
//   npm run cli -- ip-lists unblock 203.0.113.7
//
// `block` exists here so an address can be marked from a shell script or while
// reading the proxy's own logs, without going through the web app — which is the
// point of these being library use-cases rather than screens.
//
// THESE MARK, THEY DO NOT BLOCK. Nothing in this command or downstream refuses a
// request; `block` changes the verdict stored on an address's visits and nothing
// else. See migrations/0144 for why a blocking gate on a forgeable `x-forwarded-for`
// header would stop nothing determined and could lock the household out.

import {
  allowIpAddress,
  blockIpAddress,
  disallowIpAddress,
  listAllowedIps,
  listBlockedIps,
  unblockIpAddress,
} from "@/lib/site-visits";
import { deps } from "@/lib/wiring";
import { messageOf } from "./error-message";

const USAGE = `Usage:
  ip-lists allowed
  ip-lists blocked
  ip-lists allow <ip> [why]
  ip-lists block <ip> [why]
  ip-lists unallow <ip>
  ip-lists unblock <ip>`;

/** Both list types print the same way — the columns are identical (0103, 0144). */
function printEntries(
  entries: { id: number; ipAddress: string; label?: string; createdAt: string }[],
  emptyMessage: string,
): void {
  if (entries.length === 0) {
    console.log(emptyMessage);
    return;
  }
  for (const entry of entries) {
    console.log(`  [${entry.id}] ${entry.ipAddress}  ${entry.createdAt}`);
    if (entry.label) console.log(`        ${entry.label}`);
  }
}

/**
 * Finds the entry for an address so `unallow` / `unblock` can take the address the
 * reader can actually see, rather than an id they would have to look up first.
 *
 * The lists hold a handful of rows and the use-cases below need the id anyway, so a
 * scan here is cheaper than widening the port with a find-by-address method that
 * only the CLI would call.
 */
function findByAddress<T extends { ipAddress: string }>(
  entries: T[],
  ipAddress: string,
): T | undefined {
  return entries.find((entry) => entry.ipAddress === ipAddress);
}

export async function ipListsCommand(args: string[]): Promise<void> {
  const [action, ...rest] = args;

  // Wrapped for the same reason every other write command is: the schema throws on a
  // blank address, and that should print as a message with an exit code rather than
  // a stack trace.
  try {
    switch (action) {
      case undefined:
      case "allowed": {
        printEntries(listAllowedIps(deps.ipAllowlistRepo), "No allowed addresses.");
        return;
      }

      case "blocked": {
        printEntries(listBlockedIps(deps.ipBlacklistRepo), "No blocked addresses.");
        return;
      }

      case "allow": {
        const [ipAddress, label] = rest;
        if (!ipAddress) {
          console.error(USAGE);
          process.exitCode = 1;
          return;
        }
        const rescored = allowIpAddress(
          { ipAddress, label },
          deps.ipAllowlistRepo,
          deps.siteVisitRepo,
          deps.ipBlacklistRepo,
        );
        console.log(`Allowed ${ipAddress}. Re-scored ${rescored} past visit(s) as normal.`);
        return;
      }

      case "block": {
        const [ipAddress, label] = rest;
        if (!ipAddress) {
          console.error(USAGE);
          process.exitCode = 1;
          return;
        }
        const rescored = blockIpAddress(
          { ipAddress, label },
          deps.ipBlacklistRepo,
          deps.siteVisitRepo,
          deps.ipAllowlistRepo,
        );
        console.log(`Blocked ${ipAddress}. Re-scored ${rescored} past visit(s) as suspicious.`);
        console.log("This marks the address. It does not refuse its requests.");
        return;
      }

      case "unallow": {
        const [ipAddress] = rest;
        if (!ipAddress) {
          console.error(USAGE);
          process.exitCode = 1;
          return;
        }
        const entry = findByAddress(listAllowedIps(deps.ipAllowlistRepo), ipAddress);
        if (!entry) {
          console.error(`${ipAddress} is not on the allowlist.`);
          process.exitCode = 1;
          return;
        }
        const rescored = disallowIpAddress(
          entry.id,
          ipAddress,
          deps.ipAllowlistRepo,
          deps.siteVisitRepo,
        );
        console.log(`Removed ${ipAddress}. Re-scored ${rescored} past visit(s).`);
        return;
      }

      case "unblock": {
        const [ipAddress] = rest;
        if (!ipAddress) {
          console.error(USAGE);
          process.exitCode = 1;
          return;
        }
        const entry = findByAddress(listBlockedIps(deps.ipBlacklistRepo), ipAddress);
        if (!entry) {
          console.error(`${ipAddress} is not on the blacklist.`);
          process.exitCode = 1;
          return;
        }
        const rescored = unblockIpAddress(
          entry.id,
          ipAddress,
          deps.ipBlacklistRepo,
          deps.siteVisitRepo,
        );
        console.log(`Unblocked ${ipAddress}. Re-scored ${rescored} past visit(s).`);
        return;
      }

      default:
        console.error(USAGE);
        process.exitCode = 1;
    }
  } catch (error) {
    console.error(messageOf(error));
    process.exitCode = 1;
  }
}
