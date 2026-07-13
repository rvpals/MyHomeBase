import { z } from "zod";

export const userRoleSchema = z.enum(["admin", "user"]);

export const userSchema = z.object({
  id: z.number().int().positive(),
  username: z.string().min(1),
  fullName: z.string().min(1),
  description: z.string().min(1).optional(),
  role: userRoleSchema,
  isDisabled: z.boolean(),
  googleEmail: z.string().email().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const createUserSchema = z.object({
  username: z.string().min(1),
  fullName: z.string().min(1),
  description: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(1).optional(),
  ),
  password: z.string().min(8),
  role: userRoleSchema,
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

export const setPasswordSchema = z.object({
  password: z.string().min(8),
});

export type SetPasswordInput = z.infer<typeof setPasswordSchema>;

export const moduleAccessSchema = z.object({
  moduleIds: z.array(z.number().int().positive()),
});

export type ModuleAccessInput = z.infer<typeof moduleAccessSchema>;

export const setGoogleEmailSchema = z.object({
  googleEmail: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().email().optional(),
  ),
});

export type SetGoogleEmailInput = z.infer<typeof setGoogleEmailSchema>;
