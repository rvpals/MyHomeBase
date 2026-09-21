"use client";

// The New Journal Entry section — the entry form on a route of its own.
//
// It used to be a card on the home screen, revealed by a quill button in the
// title row and hidden again afterwards. That needed `JournalNewEntryContext`
// to carry the open/closed state across the server boundary between the header
// and `JournalView`; as a section it needs none of that, and the context is
// gone with it.
//
// A thin wrapper rather than a `JournalEntryForm` rendered straight into the
// section body: the card is what gives the form the paper texture and the
// heading every other journal section's body has.

import { CollapsibleCard } from "@/components/collapsible-card";
import type {
  JournalPreferences,
  JournalPrefillTemplate,
} from "@/lib/journal";
import { JournalEntryForm } from "./journal-entry-form";

export function JournalNewEntryView({
  categoryOptions,
  tagOptions,
  preferences,
  prefillTemplates = [],
  locationCategoryOptions = [],
  locationTagOptions = [],
}: {
  categoryOptions: string[];
  tagOptions: string[];
  preferences: JournalPreferences;
  /** Enabled prefill templates, for the form's picker. */
  prefillTemplates?: JournalPrefillTemplate[];
  /** The location library's taxonomy, for the picker's library tab. */
  locationCategoryOptions?: string[];
  locationTagOptions?: string[];
}) {
  return (
    // `defaultOpen` because the form is the only thing on the page — arriving
    // here is already the decision to write one, so a collapsed card would need
    // a click to reach what the reader navigated for.
    <CollapsibleCard title="New Journal" defaultOpen className="paper-texture">
      <JournalEntryForm
        categoryOptions={categoryOptions}
        tagOptions={tagOptions}
        preferences={preferences}
        prefillTemplates={prefillTemplates}
        locationCategoryOptions={locationCategoryOptions}
        locationTagOptions={locationTagOptions}
      />
    </CollapsibleCard>
  );
}
