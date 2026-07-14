import type { User, UserAvatar, UserCredentials, UserRole } from "./types";

export interface NewUserRecord {
  username: string;
  fullName: string;
  description?: string;
  passwordHash: string;
  role: UserRole;
}

// The use-cases depend on THIS interface, not on a concrete database.
// That is what lets the web app, the CLI, and tests each supply their own.
export interface UserRepository {
  listUsers(): User[];
  getUserById(id: number): User | undefined;
  getUserByUsername(username: string): User | undefined;
  getUserByGoogleEmail(googleEmail: string): User | undefined;
  existsByUsername(username: string): boolean;
  /** Internal-only lookup used by `verifyCredentials` — never call from outside `src/lib/user`. */
  findCredentialsByUsername(username: string): UserCredentials | undefined;
  createUser(record: NewUserRecord): User;
  setPasswordHash(id: number, passwordHash: string): void;
  setRole(id: number, role: UserRole): void;
  setDisabled(id: number, isDisabled: boolean): void;
  deleteUser(id: number): void;
  /** Links/unlinks a Google account for sign-in. Throws on a duplicate google email (see `DuplicateGoogleEmailError`). */
  setGoogleEmail(id: number, googleEmail: string | undefined): void;
  getAccessibleModuleIds(userId: number): number[];
  /** Replaces the full grant list for a user with the given module ids. */
  setAccessibleModuleIds(userId: number, moduleIds: number[]): void;
  /** Separate from every other read — the only query that touches the `avatar` blob column. */
  getAvatar(userId: number): UserAvatar | undefined;
  /** `undefined` clears both the image and its mime type. */
  setAvatar(userId: number, avatar: UserAvatar | undefined): void;
}
