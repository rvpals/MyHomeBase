import { createUserCommand } from "./create-user.js";

const [command, ...rest] = process.argv.slice(2);

const commands: Record<string, (argv: string[]) => Promise<void>> = {
  "create-user": createUserCommand,
};

const run = commands[command];
if (!run) {
  console.error(`Unknown command: ${command ?? "(none)"}`);
  process.exit(1);
}
run(rest).catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
