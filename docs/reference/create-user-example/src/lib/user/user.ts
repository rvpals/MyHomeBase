import { randomUUID, scryptSync, randomBytes } from "node:crypto";
import { newUserSchema, type NewUserInput } from "./schema.js";
import type { User } from "./types.js";
import type { UserRepository } from "./ports.js";

export class EmailTakenError extends Error {
  constructor(email: string) {
    super(`Email already registered: ${email}`);
    this.name = "EmailTakenError";
  }
}

function hashPassword(plain: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(plain, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

// ============================================================
// THE function. The UI calls this. The batch file calls this.
// There is no second copy of this logic anywhere.
// ============================================================
export async function createUser(
  input: NewUserInput,
  repo: UserRepository,
): Promise<User> {
  const data = newUserSchema.parse(input);          // 1. validate (shared rule)
  if (await repo.existsByEmail(data.email)) {        // 2. business rule
    throw new EmailTakenError(data.email);
  }
  const user: User = {                               // 3. build the domain object
    id: randomUUID(),
    email: data.email,
    name: data.name,
    passwordHash: hashPassword(data.password),       // 4. logic that must match everywhere
    createdAt: new Date().toISOString(),
  };
  await repo.save(user);                             // 5. persist through the port
  return user;
}
