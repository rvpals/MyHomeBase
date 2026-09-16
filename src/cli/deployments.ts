// The deployment history from the terminal — the same use-cases the About screen's
// Deployments tab drives.
//
//   npm run cli -- deployments list
//   npm run cli -- deployments show 12
//   npm run cli -- deployments delete 12
//   npm run cli -- deployments delete 12,13,14
//   npm run cli -- deployments prune
//
// Rows are written on the deployment target by record-deployment.cjs as a new build comes
// up, so a dev database is normally empty here: the history lives where the app is
// deployed. Point MYHOMEBASE_DB at a copy of the production database to read it.

import {
  DEPLOYMENTS_KEEP_COUNT,
  deleteDeployment,
  deleteDeployments,
  listDeployments,
  pruneDeployments,
  type Deployment,
} from "@/lib/deployments";
import { formatBytes } from "@/lib/system-info";
import { deps } from "@/lib/wiring";
import { messageOf } from "./error-message";

const USAGE = `Usage:
  deployments list
  deployments show <id>
  deployments delete <id>[,<id>...]
  deployments prune                  keep the newest ${DEPLOYMENTS_KEEP_COUNT}, delete the rest`;

function printRow(deployment: Deployment): void {
  const build = deployment.buildId ?? "unknown build";
  const version = deployment.appVersion ? ` v${deployment.appVersion}` : "";
  const migrated = deployment.migrated ? "  [migrated]" : "";
  console.log(`  #${deployment.id}  ${deployment.deployedAt}  ${build}${version}${migrated}`);
}

/** The whole record, including the build log — `show`'s reason for existing. */
function printDetail(deployment: Deployment): void {
  const lines: [string, string][] = [
    ["Deployed", deployment.deployedAt],
    ["Built", deployment.builtAt ?? "—"],
    ["Build id", deployment.buildId ?? "—"],
    ["App version", deployment.appVersion ?? "—"],
    ["Built on", deployment.builtOnHost ?? "—"],
    ["Node ABI", deployment.nodeAbi === null ? "—" : String(deployment.nodeAbi)],
    [
      "Package size",
      deployment.packageSizeBytes === null ? "—" : formatBytes(deployment.packageSizeBytes),
    ],
    ["Migrated", deployment.migrated ? "yes" : "no"],
  ];

  console.log(`Deployment #${deployment.id}`);
  for (const [label, value] of lines) console.log(`  ${label.padEnd(13)}${value}`);

  console.log("");
  if (deployment.buildOutput === null) {
    console.log("No build log was recorded for this deployment.");
    return;
  }
  console.log("Build log:");
  console.log(deployment.buildOutput);
}

export async function deploymentsCommand(args: string[]): Promise<void> {
  const [action, rawId] = args;

  // Wrapped because the schema throws on a malformed id, and a CLI should print that as a
  // message with an exit code rather than a stack trace.
  try {
    switch (action) {
      case undefined:
      case "list": {
        const deployments = listDeployments(deps.deploymentRepo);
        if (deployments.length === 0) {
          console.log(
            "No deployments recorded. Rows are written on the deployment target by " +
              "record-deployment.cjs — a dev database has none.",
          );
          return;
        }
        console.log(`${deployments.length} deployment${deployments.length === 1 ? "" : "s"}:`);
        deployments.forEach(printRow);
        return;
      }

      case "show": {
        if (!rawId) throw new Error("An id is required.");
        // Read through the list rather than adding a `get` to the port for one caller:
        // this history is short by nature (one row per release), so a scan is free and the
        // port stays as small as the About screen actually needs.
        const deployment = listDeployments(deps.deploymentRepo).find(
          (candidate) => String(candidate.id) === rawId,
        );
        if (!deployment) {
          console.error(`No deployment with id ${rawId}.`);
          process.exitCode = 1;
          return;
        }
        printDetail(deployment);
        return;
      }

      case "delete": {
        if (!rawId) throw new Error("An id is required.");

        // A comma-separated list is the batch form, mirroring the ticked checkboxes on the
        // About screen. One id still goes through `deleteDeployment` so the single case
        // keeps its "no deployment with id N" message, which a count can't express.
        const rawIds = rawId
          .split(",")
          .map((part) => part.trim())
          .filter((part) => part !== "");
        if (rawIds.length === 0) throw new Error("An id is required.");

        if (rawIds.length === 1) {
          const deleted = deleteDeployment(deps.deploymentRepo, rawIds[0]);
          console.log(
            deleted ? `Deleted deployment #${rawIds[0]}.` : `No deployment with id ${rawIds[0]}.`,
          );
          return;
        }

        const deleted = deleteDeployments(deps.deploymentRepo, rawIds);
        console.log(`Deleted ${deleted} of ${rawIds.length} deployment records.`);
        return;
      }

      case "prune": {
        const deleted = pruneDeployments(deps.deploymentRepo, DEPLOYMENTS_KEEP_COUNT);
        console.log(
          deleted === 0
            ? `Nothing to delete — ${DEPLOYMENTS_KEEP_COUNT} or fewer deployments recorded.`
            : `Deleted ${deleted} deployment record${deleted === 1 ? "" : "s"}, keeping the newest ${DEPLOYMENTS_KEEP_COUNT}.`,
        );
        return;
      }

      default:
        console.error(`Unknown action: ${action}`);
        console.error(USAGE);
        process.exitCode = 1;
    }
  } catch (error) {
    console.error(messageOf(error));
    process.exitCode = 1;
  }
}
