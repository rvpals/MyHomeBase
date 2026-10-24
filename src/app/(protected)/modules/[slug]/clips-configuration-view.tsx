"use client";

// Configuration. A placeholder until there is a setting worth persisting — the same
// shape CSV Analysis's Configuration section shipped as.
//
// Deliberately not an empty screen: the section exists so the module's nav matches
// every other one, and saying what *would* live here is more useful than a blank.

export function ClipsConfigurationView() {
  return (
    <div className="rounded-xl border border-line bg-paper-raised p-4">
      <p className="text-sm text-muted">
        Nothing to configure yet. Image limits (5&nbsp;MB each, 20 per clip) and the
        list of modules a clip can be attached to are fixed in code for now — they
        move here if either needs to vary.
      </p>
    </div>
  );
}
