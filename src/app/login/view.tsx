"use client";

import { useState, type FormEvent } from "react";
import { AppIcon } from "@/components/app-icon";
import { loginAction } from "./actions";

const GOOGLE_ERROR_MESSAGES: Record<string, string> = {
  google_account_disabled: "This account has been disabled. Contact an admin.",
  google_failed: "Google sign-in failed. Please try again.",
};

export interface LoginViewProps {
  appName: string;
  googleLoginEnabled: boolean;
  errorCode?: string;
}

export function LoginView({ appName, googleLoginEnabled, errorCode }: LoginViewProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | undefined>(
    errorCode ? GOOGLE_ERROR_MESSAGES[errorCode] ?? "Sign-in failed. Please try again." : undefined,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(undefined);
    try {
      const result = await loginAction({ username, password });
      if (!result.ok) setError(result.error ?? "Invalid username or password.");
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
        <p className="mt-2 text-center text-sm text-muted">Sign in to continue</p>

        <label className="mt-6 block text-sm">
          <span className="mb-1 block font-medium text-ink">Username</span>
          <input
            autoFocus
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
          />
        </label>
        <label className="mt-4 block text-sm">
          <span className="mb-1 block font-medium text-ink">Password</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
          />
        </label>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-6 w-full rounded-full bg-brass px-4 py-2 text-sm font-medium text-white shadow-lg shadow-ink/10 transition hover:bg-brass-dark disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        >
          {isSubmitting ? "Signing in…" : "Sign in"}
        </button>

        {googleLoginEnabled && (
          <>
            <div className="mt-5 flex items-center gap-2">
              <div className="h-px flex-1 bg-line" aria-hidden />
              <span className="text-xs text-muted">or</span>
              <div className="h-px flex-1 bg-line" aria-hidden />
            </div>
            <a
              href="/login/google"
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-full border border-line bg-paper px-4 py-2 text-sm font-medium text-ink transition hover:border-brass hover:text-brass-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
            >
              Sign in with Google
            </a>
          </>
        )}
      </form>
    </div>
  );
}
