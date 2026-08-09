import {
  clearStartupMessage,
  formatDeploymentMessage,
  getStartupMessage,
  setStartupMessage,
} from "@/lib/settings";
import { deps } from "@/lib/wiring";

/**
 * Sets the one-shot message the home screen shows.
 *
 *   set-startup-message                 # the standard "new deployment" wording
 *   set-startup-message "Custom text"   # any message
 *   set-startup-message --clear         # blank it
 *   set-startup-message --show          # print the current value
 *
 * This is what a publish calls, so the deploy scripts hold no wording of their own.
 */
export async function setStartupMessageCommand(args: string[]): Promise<void> {
  const [first] = args;

  if (first === "--show") {
    const current = getStartupMessage(deps.settingsRepo);
    console.log(current ?? "(blank — nothing will be shown)");
    return;
  }

  if (first === "--clear") {
    clearStartupMessage(deps.settingsRepo);
    console.log("Startup message cleared.");
    return;
  }

  const message = first ?? formatDeploymentMessage(new Date());
  setStartupMessage(deps.settingsRepo, message);
  console.log(`Startup message set: ${message}`);
}
