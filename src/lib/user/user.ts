import { randomBytes } from "node:crypto";
import type { Module } from "@/lib/modules";
import { hashPassword, verifyPassword } from "@/lib/shared/password";
import type { NewUserRecord, UserRepository } from "./ports";
import {
  createUserSchema,
  moduleAccessSchema,
  setAvatarSchema,
  setGoogleEmailSchema,
  setPasswordSchema,
  type CreateUserInput,
} from "./schema";
import type { User, UserAvatar, UserRole } from "./types";

export class DuplicateUsernameError extends Error {
  constructor(username: string) {
    super(`Username "${username}" is already taken.`);
  }
}

export class DuplicateGoogleEmailError extends Error {
  constructor(googleEmail: string) {
    super(`Google account "${googleEmail}" is already linked to another user.`);
  }
}

export class SelfLockoutError extends Error {
  constructor(action: string) {
    super(`You can't ${action} your own account.`);
  }
}

export function listUsers(repo: UserRepository): User[] {
  return repo.listUsers();
}

export function createUser(input: CreateUserInput, repo: UserRepository): User {
  const parsed = createUserSchema.parse(input);
  if (repo.existsByUsername(parsed.username)) {
    throw new DuplicateUsernameError(parsed.username);
  }

  const record: NewUserRecord = {
    username: parsed.username,
    fullName: parsed.fullName,
    description: parsed.description,
    passwordHash: hashPassword(parsed.password),
    role: parsed.role,
  };
  return repo.createUser(record);
}

/**
 * Verifies a login attempt. Returns the public `User` only if the password
 * matches and the account isn't disabled — this is the only place outside
 * the repository that touches a password hash.
 */
export function verifyCredentials(
  input: { username: string; password: string },
  repo: UserRepository,
): User | undefined {
  const credentials = repo.findCredentialsByUsername(input.username);
  if (!credentials) return undefined;
  if (credentials.isDisabled) return undefined;
  if (!verifyPassword(input.password, credentials.passwordHash)) return undefined;

  return repo.getUserById(credentials.id);
}

export function setUserPassword(
  targetUserId: number,
  input: { password: string },
  repo: UserRepository,
): void {
  const parsed = setPasswordSchema.parse(input);
  repo.setPasswordHash(targetUserId, hashPassword(parsed.password));
}

export function setUserRole(
  actingUserId: number,
  targetUserId: number,
  role: UserRole,
  repo: UserRepository,
): void {
  if (actingUserId === targetUserId && role !== "admin") {
    throw new SelfLockoutError("demote");
  }
  repo.setRole(targetUserId, role);
}

export function setUserDisabled(
  actingUserId: number,
  targetUserId: number,
  isDisabled: boolean,
  repo: UserRepository,
): void {
  if (actingUserId === targetUserId && isDisabled) {
    throw new SelfLockoutError("disable");
  }
  repo.setDisabled(targetUserId, isDisabled);
}

export function deleteUser(actingUserId: number, targetUserId: number, repo: UserRepository): void {
  if (actingUserId === targetUserId) {
    throw new SelfLockoutError("delete");
  }
  repo.deleteUser(targetUserId);
}

export function getUserByGoogleEmail(googleEmail: string, repo: UserRepository): User | undefined {
  return repo.getUserByGoogleEmail(googleEmail);
}

/**
 * Auto-creates a `user`-role account for a first-time Google sign-in with no
 * existing link, per the "allow any Google account" policy. The account gets
 * a random, never-revealed password (password login stays possible but
 * unusable until an admin sets a real one) and zero module access until an
 * admin grants some.
 */
export function createUserFromGoogle(
  input: { googleEmail: string; fullName?: string },
  repo: UserRepository,
): User {
  const user = createUser(
    {
      username: input.googleEmail,
      fullName: input.fullName?.trim() || input.googleEmail,
      description: "Created automatically via Google sign-in.",
      password: randomBytes(32).toString("hex"),
      role: "user",
    },
    repo,
  );
  repo.setGoogleEmail(user.id, input.googleEmail);
  return { ...user, googleEmail: input.googleEmail };
}

/** Links (or, with `googleEmail: undefined`, unlinks) a Google account for sign-in. */
export function setUserGoogleEmail(
  userId: number,
  input: { googleEmail?: string },
  repo: UserRepository,
): void {
  const parsed = setGoogleEmailSchema.parse(input);
  repo.setGoogleEmail(userId, parsed.googleEmail);
}

export function isAdmin(user: User): boolean {
  return user.role === "admin";
}

/**
 * Admins get every module unchanged (including ones added after the admin
 * account was created — this is a role check, not a stored list). Regular
 * users get only the modules explicitly granted to them.
 */
export function getAccessibleModules(user: User, allModules: Module[], repo: UserRepository): Module[] {
  if (isAdmin(user)) return allModules;

  const accessibleIds = new Set(repo.getAccessibleModuleIds(user.id));
  return allModules.filter((module) => accessibleIds.has(module.id));
}

export function userHasModuleAccess(user: User, moduleId: number, repo: UserRepository): boolean {
  if (isAdmin(user)) return true;
  return repo.getAccessibleModuleIds(user.id).includes(moduleId);
}

/** The raw grant list for a user, independent of the admin-bypass rule — used to edit grants in the admin UI. */
export function getUserModuleAccess(userId: number, repo: UserRepository): number[] {
  return repo.getAccessibleModuleIds(userId);
}

export function setUserModuleAccess(userId: number, moduleIds: number[], repo: UserRepository): void {
  const parsed = moduleAccessSchema.parse({ moduleIds });
  repo.setAccessibleModuleIds(userId, parsed.moduleIds);
}

/** Used only by the avatar-serving route — never by anything that renders a user list. */
export function getUserAvatar(userId: number, repo: UserRepository): UserAvatar | undefined {
  return repo.getAvatar(userId);
}

export function setUserAvatar(userId: number, input: UserAvatar, repo: UserRepository): void {
  const parsed = setAvatarSchema.parse(input);
  repo.setAvatar(userId, parsed);
}

export function clearUserAvatar(userId: number, repo: UserRepository): void {
  repo.setAvatar(userId, undefined);
}
