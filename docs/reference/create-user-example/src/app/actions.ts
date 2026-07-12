// In a real Next.js app this file begins with the "use server" directive
// and createUserAction is passed to <form action={createUserAction}>.
import { createUser, newUserSchema } from "../lib/user/index.js";
import { deps } from "../lib/wiring.js";

// Web adapter: read UI input -> validate -> call the use-case -> shape for the UI.
export async function createUserAction(form: Record<string, string>) {
  const input = newUserSchema.parse(form);
  const user = await createUser(input, deps.userRepo);   // <-- SAME call
  return { id: user.id, email: user.email, name: user.name }; // no hash leaves the server
}
