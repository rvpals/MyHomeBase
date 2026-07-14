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
  /** MIME type of the uploaded avatar, if any. The raw bytes aren't part of this type — see `getUserAvatar`. */
  avatarMimeType?: string;
  createdAt: string;
  updatedAt: string;
}

/** A user's avatar image bytes and their MIME type, fetched/set separately from the rest of `User`. */
export interface UserAvatar {
  data: Buffer;
  mimeType: string;
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
