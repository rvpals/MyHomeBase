import { createUser, newUserSchema } from "../lib/user/index.js";
import { deps } from "../lib/wiring.js";

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) { out[argv[i].slice(2)] = argv[i + 1]; i++; }
  }
  return out;
}

// CLI adapter: read argv -> validate -> call the use-case -> print.
export async function createUserCommand(argv: string[]) {
  const input = newUserSchema.parse(parseArgs(argv));
  const user = await createUser(input, deps.userRepo);   // <-- SAME call
  console.log(`Created user ${user.name} <${user.email}> (id ${user.id})`);
}
