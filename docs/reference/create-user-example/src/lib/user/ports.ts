import type { User } from "./types.js";

// The use-case depends on THIS interface, not on a concrete database.
// That is what lets the UI, the CLI, and tests each supply their own.
export interface UserRepository {
  existsByEmail(email: string): Promise<boolean>;
  save(user: User): Promise<void>;
}
