"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/avatar";
import type { User } from "@/lib/user";
import { changeOwnPasswordAction, removeOwnAvatarAction, uploadOwnAvatarAction } from "./actions";

function AvatarSection({ user }: { user: User }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(undefined);
    try {
      const formData = new FormData(event.currentTarget);
      const result = await uploadOwnAvatarAction(formData);
      if (!result.ok) {
        setError(result.error ?? "Failed to upload image.");
        return;
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
      router.refresh();
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRemove() {
    setIsSaving(true);
    setError(undefined);
    try {
      const result = await removeOwnAvatarAction();
      if (!result.ok) setError(result.error ?? "Failed to remove image.");
      else router.refresh();
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-line bg-paper-raised p-5">
      <h2 className="font-display text-lg font-semibold text-ink">Avatar</h2>
      <div className="mt-4 flex items-center gap-4">
        <Avatar
          userId={user.id}
          avatarMimeType={user.avatarMimeType}
          fallbackText={user.fullName}
          version={user.updatedAt}
          size="md"
        />
        <form onSubmit={handleUpload} className="flex flex-1 flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            name="avatar"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="text-sm text-ink"
          />
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-full bg-brass px-4 py-1.5 text-sm font-medium text-white hover:bg-brass-dark disabled:opacity-50"
          >
            {isSaving ? "Saving…" : "Upload"}
          </button>
          {user.avatarMimeType && (
            <button
              type="button"
              disabled={isSaving}
              onClick={handleRemove}
              className="rounded-full border border-line px-4 py-1.5 text-sm font-medium text-muted hover:text-ink disabled:opacity-50"
            >
              Remove
            </button>
          )}
        </form>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <p className="mt-3 text-xs text-muted">PNG, JPEG, WEBP, or GIF. Up to 2 MB.</p>
    </div>
  );
}

function PasswordSection() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [success, setSuccess] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setSuccess(false);
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setIsSaving(true);
    try {
      const result = await changeOwnPasswordAction(password);
      if (!result.ok) {
        setError(result.error ?? "Failed to change password.");
        return;
      }
      setPassword("");
      setConfirmPassword("");
      setSuccess(true);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="mt-6 rounded-xl border border-line bg-paper-raised p-5">
      <h2 className="font-display text-lg font-semibold text-ink">Password</h2>
      <form onSubmit={handleSubmit} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">New password</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Confirm password</span>
          <input
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
          />
        </label>
        {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
        {success && <p className="text-sm text-emerald-700 sm:col-span-2">Password updated.</p>}
        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-full bg-brass px-4 py-2 text-sm font-medium text-white hover:bg-brass-dark disabled:opacity-50"
          >
            {isSaving ? "Saving…" : "Save password"}
          </button>
        </div>
      </form>
    </div>
  );
}

export function AccountView({ user }: { user: User }) {
  return (
    <div className="mx-auto max-w-2xl">
      <p className="font-mono text-xs font-medium uppercase tracking-widest text-brass-dark">
        {user.username}
      </p>
      <h1 className="mt-2 font-display text-3xl font-semibold text-ink">My Account</h1>
      <div className="mt-3 h-px w-full bg-line" />

      <div className="mt-8">
        <AvatarSection user={user} />
        {!user.googleEmail && <PasswordSection />}
      </div>
    </div>
  );
}
