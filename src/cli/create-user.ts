import { createUser, type UserRole } from "@/lib/user";
import { deps } from "@/lib/wiring";
import { parseFlags } from "./parse-flags";

export async function createUserCommand(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  try {
    const user = createUser(
      {
        username: flags.username ?? "",
        fullName: flags["full-name"] ?? "",
        description: flags.description,
        password: flags.password ?? "",
        role: (flags.role as UserRole) ?? "user",
      },
      deps.userRepo,
    );
    console.log(`Created user "${user.username}" (id ${user.id}, role ${user.role}).`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Failed to create user.");
    process.exitCode = 1;
  }
}
