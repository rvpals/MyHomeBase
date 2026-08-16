import type { UserPreference } from "./types";

export interface UserPreferencesRepository {
  /** Every preference belonging to one user. The account screen and the home page both read this way. */
  listByUserId(userId: number): UserPreference[];
  /**
   * Upserts one key for one user. Per-key rather than a whole-set replace (which
   * is what module settings do): replacing the set would mean any code path
   * saving one preference had to resend every other one, so a preference added
   * later would be wiped by an older screen. See migrations/0044.
   */
  setValue(userId: number, key: string, value: string): void;
  /** Removes every preference for a user. Called when the account is deleted — there is no FK to cascade. */
  deleteForUser(userId: number): void;
}
