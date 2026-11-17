import { setUserPassword } from "@/lib/user";
import { deps } from "@/lib/wiring";
import { parseFlags } from "./parse-flags";

export async function setPasswordCommand(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const username = flags.username ?? "";

  try {
    const user = deps.userRepo.getUserByUsername(username);
    if (!user) {
      console.error(`User "${username}" does not exist.`);
      process.exitCode = 2;
      return;
    }

    setUserPassword(user.id, { password: flags.password ?? "" }, deps.userRepo);
    console.log(`Password updated for "${user.username}" (id ${user.id}).`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Failed to update the password.");
    process.exitCode = 1;
  }
}
