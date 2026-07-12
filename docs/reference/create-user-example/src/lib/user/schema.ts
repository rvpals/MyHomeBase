import { z } from "zod";

// The single source of truth for what "creating a user" needs.
// Every caller (UI, CLI, tests) validates against THIS.
export const newUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8),
});

export type NewUserInput = z.infer<typeof newUserSchema>;
