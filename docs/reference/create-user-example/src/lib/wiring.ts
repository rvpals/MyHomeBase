import { JsonFileUserRepository } from "./user/repository.js";

// Composition root: the ONE place that picks the real implementations.
// Both the web app and the CLI import `deps` from here.
const dbPath = process.env.USERS_DB ?? "users.json";

export const deps = {
  userRepo: new JsonFileUserRepository(dbPath),
};
