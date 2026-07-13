import { createUser, type UserRole } from "@/lib/user";
import { deps } from "@/lib/wiring";

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const value = args[index + 1];
    flags[key] = value ?? "";
    index += 1;
  }
  return flags;
}

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
