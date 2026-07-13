"use client";

import { useAdminSettings } from "../../admin-shell";

export default function ApplicationConfigurationPage() {
  const { applicationName, setApplicationName } = useAdminSettings();

  return (
    <div className="mx-auto max-w-2xl">
      <p className="font-mono text-xs font-medium uppercase tracking-widest text-brass-dark">
        Configuration
      </p>
      <h1 className="mt-2 font-display text-3xl font-semibold text-ink">
        Application Configuration
      </h1>
      <p className="mt-2 text-sm text-muted">Settings that apply across the whole application.</p>

      <div className="mt-8 rounded-xl border border-line bg-paper-raised p-5">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Application name</span>
          <input
            value={applicationName}
            onChange={(event) => setApplicationName(event.target.value)}
            className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
          />
        </label>
      </div>
    </div>
  );
}
