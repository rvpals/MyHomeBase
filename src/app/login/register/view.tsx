"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { AppIcon } from "@/components/app-icon";
import { Button } from "@/components/button";
import { registerAction } from "../actions";

const inputClassName =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

// Typing this sequence anywhere on the page reveals the hidden admin-secret
// input — a deliberate easter egg so the field never shows for ordinary
// visitors. Revealing it is harmless; the entered secret still has to match.
const ADMIN_UNLOCK_SEQUENCE = "adm";

export interface RegisterViewProps {
  appName: string;
}

export function RegisterView({ appName }: RegisterViewProps) {
  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [adminSecretKey, setAdminSecretKey] = useState("");
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const recentKeys = useRef("");

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      // Only single-character keys build the sequence; ignore Shift, Tab, etc.
      if (event.key.length !== 1) return;

      recentKeys.current = (recentKeys.current + event.key.toLowerCase()).slice(-ADMIN_UNLOCK_SEQUENCE.length);
      if (recentKeys.current === ADMIN_UNLOCK_SEQUENCE) setAdminUnlocked(true);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await registerAction({
        username,
        fullName,
        password,
        adminSecretKey: adminUnlocked ? adminSecretKey : undefined,
      });
      // A successful registerAction redirects, so reaching here means it failed.
      if (!result.ok) setError(result.error ?? "Could not create the account.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-xl border border-line bg-paper-raised p-6 shadow-lg shadow-ink/10"
      >
        <div className="flex items-center justify-center gap-2">
          <AppIcon className="h-8 w-8 shrink-0" />
          <span className="font-display text-lg font-semibold text-ink">{appName}</span>
        </div>
        <p className="mt-2 text-center text-sm text-muted">Create an account</p>

        <label className="mt-6 block text-sm">
          <span className="mb-1 block font-medium text-ink">Username</span>
          <input
            autoFocus
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            className={inputClassName}
          />
        </label>
        <label className="mt-4 block text-sm">
          <span className="mb-1 block font-medium text-ink">Full name</span>
          <input
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            className={inputClassName}
          />
        </label>
        <label className="mt-4 block text-sm">
          <span className="mb-1 block font-medium text-ink">Password</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={inputClassName}
          />
        </label>
        <label className="mt-4 block text-sm">
          <span className="mb-1 block font-medium text-ink">Confirm password</span>
          <input
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className={inputClassName}
          />
        </label>

        {adminUnlocked && (
          <label className="mt-4 block text-sm">
            <span className="mb-1 block font-medium text-ink">Admin secret key</span>
            <input
              type="password"
              value={adminSecretKey}
              onChange={(event) => setAdminSecretKey(event.target.value)}
              className={inputClassName}
            />
            <span className="mt-1 block text-xs text-muted">
              Enter the configured secret to create this account as an admin.
            </span>
          </label>
        )}

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

        <Button type="submit" disabled={isSubmitting} className="mt-6 w-full">
          {isSubmitting ? "Creating account…" : "Create account"}
        </Button>

        <Button href="/login" variant="secondary" className="mt-4 w-full">
          Back to sign in
        </Button>
      </form>
    </div>
  );
}
