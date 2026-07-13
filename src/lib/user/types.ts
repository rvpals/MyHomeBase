export type UserRole = "admin" | "user";

export interface User {
  id: number;
  username: string;
  fullName: string;
  description?: string;
  role: UserRole;
  isDisabled: boolean;
  /** Linked Google account email, if any — set via User Management. Enables "Sign in with Google". */
  googleEmail?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * The shape `UserRepository.findCredentialsByUsername` returns. Exported
 * only because implementers of that port (real or fake) need the type —
 * `verifyCredentials` is the only *function* in this codebase that reads
 * a value of this shape; nothing outside `src/lib/user` should call
 * `findCredentialsByUsername` directly or handle a password hash.
 */
export interface UserCredentials {
  id: number;
  username: string;
  passwordHash: string;
  role: UserRole;
  isDisabled: boolean;
}
