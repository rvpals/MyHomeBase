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

import { useRouter } from "next/navigation";
import { CollapsibleCard } from "@/components/collapsible-card";
import type { DashboardTextureItem } from "@/lib/dashboard-texture";
import type {
  JournalEntryCloneSeed,
  JournalPreferences,
  JournalPrefillTemplate,
} from "@/lib/journal";
import { JournalEntryForm } from "./journal-entry-form";

/** This section's own route, for returning to a blank form after a clone is saved. */
const NEW_ENTRY_PATH = "/modules/journal/new-entry";

export function JournalNewEntryView({
  categoryOptions,
  tagOptions,
  preferences,
  contentTextures = [],
  prefillTemplates = [],
  locationCategoryOptions = [],
  locationTagOptions = [],
  cloneSeed,
}: {
  categoryOptions: string[];
  tagOptions: string[];
  preferences: JournalPreferences;
  /** The app texture library, so the Content field's chosen picture resolves. */
  contentTextures?: DashboardTextureItem[];
  /** Enabled prefill templates, for the form's picker. */
  prefillTemplates?: JournalPrefillTemplate[];
  /** The location library's taxonomy, for the picker's library tab. */
  locationCategoryOptions?: string[];
  locationTagOptions?: string[];
  /**
   * Set when the reader arrived from an entry's Clone button (?clone=). The
   * section resolves the id to a seed server-side; this only spreads it onto
   * the form and says so in the heading.
   */
  cloneSeed?: JournalEntryCloneSeed;
}) {
  const router = useRouter();

  return (
    // `defaultOpen` because the form is the only thing on the page — arriving
    // here is already the decision to write one, so a collapsed card would need
    // a click to reach what the reader navigated for.
    //
    // The heading names the source when cloning, because a form that arrives
    // already filled in needs to say where the values came from — otherwise a
    // pre-filled category list looks like a bug, or like an entry being edited
    // rather than a new one being written.
    <CollapsibleCard
      title={
        cloneSeed ? `New Journal — cloned from entry #${cloneSeed.sourceEntryId}` : "New Journal"
      }
      defaultOpen
      className="paper-texture"
    >
      <JournalEntryForm
        // Remounts the form when the reader clones a different entry from the
        // same screen. The form seeds its state in a lazy initialiser, which
        // runs once per mount -- without this key, navigating from ?clone=12 to
        // ?clone=34 would keep the first entry's values on screen.
        key={cloneSeed ? `clone-${cloneSeed.sourceEntryId}` : "blank"}
        initialValues={
          cloneSeed
            ? {
                title: cloneSeed.title,
                placeName: cloneSeed.placeName,
                categories: cloneSeed.categories,
                tags: cloneSeed.tags,
              }
            : undefined
        }
        initialLocations={cloneSeed?.locations}
        // Only while cloning. The form's own post-save behaviour is to clear
        // back to its starting values, which on a *seeded* form means the seed
        // — so after saving a clone it would sit there pre-filled and one click
        // away from writing the same entry a second time. Dropping ?clone= puts
        // the reader on the ordinary blank form instead, which is what "I have
        // finished cloning that" should leave behind.
        //
        // `replace`, not `push`: the filled form has already been saved, so
        // Back should go wherever the reader was before cloning rather than to
        // a form offering to write the duplicate again.
        onSaved={cloneSeed ? () => router.replace(NEW_ENTRY_PATH) : undefined}
        categoryOptions={categoryOptions}
        tagOptions={tagOptions}
        preferences={preferences}
        contentTextures={contentTextures}
        prefillTemplates={prefillTemplates}
        locationCategoryOptions={locationCategoryOptions}
        locationTagOptions={locationTagOptions}
      />
    </CollapsibleCard>
  );
}
