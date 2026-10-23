"use client";

// Journal → Topics: pick a subject, see the entries about it and how they
// relate.
//
// A topic is a *term*, not a stored row — `?topic=HSA` is the whole state of
// this screen. That is why there is no save button, no editor and no delete:
// the URL is the saved lookup, which also makes every tag chip elsewhere in the
// app a one-line link into here.
//
// Presentational. The matching, the episode clustering and the co-occurrence
// counting all happen in `@/lib/journal-topics` on the server; this component
// holds the search box, the active tab, and nothing else of substance.

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BusyOverlay } from "@/components/busy-overlay";
import { Button } from "@/components/button";
import { Tabs, type TabItem } from "@/components/tabs";
import { TaxonomyGraphView } from "@/components/taxonomy-graph-view";
import { useIsCompact } from "@/components/viewport-context";
import {
  topicGraphSubjects,
  topicMapSubjects,
  type TopicGraphSubject,
  type TopicMap,
  type TopicMapSubject,
} from "@/lib/journal-topics";
import type {
  TopicCooccurrence,
  TopicEntry,
  TopicEpisode,
  TopicMatchKind,
  TopicResult,
  TopicSuggestion,
} from "@/lib/journal-topics";

/** How each match kind is labelled on an entry row. */
const MATCH_LABEL: Record<TopicMatchKind, string> = {
  tag: "tag",
  category: "category",
  title: "title",
  body: "body",
};

export interface JournalTopicsViewProps {
  /** The term from ?topic=, already trimmed. `""` shows the picker. */
  term: string;
  result: TopicResult;
  episodes: TopicEpisode[];
  related: TopicCooccurrence[];
  suggestions: TopicSuggestion[];
  /**
   * The whole journal as subjects and their pairings — what the screen shows
   * before a term is picked. Built on the server; `null` when a term is set,
   * since the map is not drawn then and reading every entry for it would be
   * waste.
   */
  map: TopicMap | null;
  /** The `topic_match_body` preference, for the note about hidden matches. */
  matchBody: boolean;
  /** The `topic_episode_gap_days` preference, named on the Timeline tab. */
  episodeGapDays: number;
  /** Where this screen lives, so the search box can push a new ?topic=. */
  basePath: string;
}

export function JournalTopicsView({
  term,
  result,
  episodes,
  related,
  suggestions,
  map,
  matchBody,
  episodeGapDays,
  basePath,
}: JournalTopicsViewProps) {
  const router = useRouter();
  const isCompact = useIsCompact();
  const [draft, setDraft] = useState(term);
  // The push is wrapped in a transition so `isSearching` covers the *whole*
  // wait, not just the URL change: this screen is server-rendered, so pressing
  // Show topic reads every entry and matches it before anything new paints.
  // Without this the page sits unchanged for that whole time and reads as a
  // click that didn't land — the same failure `NavPending` fixes for nav rows,
  // which cannot help here because `useLinkStatus` only works inside a <Link>.
  const [isSearching, startSearching] = useTransition();

  const subjects = useMemo(() => topicGraphSubjects(result.entries), [result.entries]);

  const go = (next: string) => {
    const trimmed = next.trim();
    // The box follows whatever started the lookup, so a chip or a Related link
    // leaves the search field showing the topic actually being fetched rather
    // than the previous one — which is also what the overlay's detail line
    // reads from.
    setDraft(trimmed);
    startSearching(() => {
      router.push(trimmed === "" ? basePath : `${basePath}?topic=${encodeURIComponent(trimmed)}`);
    });
  };

  // Straight to the entry's own screen by id. The node carries the whole entry
  // (`topicEntry`), so there is nothing to look up and nothing to match on.
  const openEntry = (subject: TopicGraphSubject) => {
    router.push(`/modules/journal/entries/${subject.topicEntry.entry.id}`);
  };

  return (
    <div className="space-y-6">
      {/* `subtle` rather than the default scrim: a topic lookup is a read that
          usually returns quickly, and a heavy dim for a sub-second wait jars.
          Indeterminate, because the match runs on the server and returns once —
          nothing here can count its progress, and inventing a fraction would be
          worse than the sweep. No `onCancel`: a push cannot be called back, and
          a button that only hid the overlay would claim a power this page does
          not have. */}
      <BusyOverlay
        isBusy={isSearching}
        message="Finding entries…"
        detail={
          draft.trim() === ""
            ? undefined
            : `Matching every entry against “${draft.trim()}”.`
        }
        progress="indeterminate"
        tone="subtle"
      />
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          go(draft);
        }}
      >
        <input
          type="search"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="A tag, a category, or any word — try HSA"
          aria-label="Topic"
          className="min-w-0 flex-1 rounded border border-line bg-paper px-3 py-2 text-sm"
        />
        <Button type="submit" disabled={isSearching}>
          {isSearching ? "Searching…" : "Show topic"}
        </Button>
        {term !== "" && (
          <Button
            variant="secondary"
            disabled={isSearching}
            onClick={() => go("")}
          >
            Clear
          </Button>
        )}
      </form>

      {term === "" ? (
        <TopicMapPanel
          map={map}
          suggestions={suggestions}
          basePath={basePath}
          isCompact={isCompact}
          onPick={go}
        />
      ) : result.entries.length === 0 ? (
        <EmptyTopic term={term} bodyOnlyCount={result.bodyOnlyCount} matchBody={matchBody} />
      ) : (
        <>
          <TopicSummary result={result} matchBody={matchBody} />
          <Tabs
            items={buildTabs({
              result,
              episodes,
              related,
              subjects,
              episodeGapDays,
              basePath,
              isCompact,
              onSelect: openEntry,
              onPick: go,
            })}
          />
        </>
      )}
    </div>
  );
}

function buildTabs({
  result,
  episodes,
  related,
  subjects,
  episodeGapDays,
  basePath,
  isCompact,
  onSelect,
  onPick,
}: {
  result: TopicResult;
  episodes: TopicEpisode[];
  related: TopicCooccurrence[];
  subjects: TopicGraphSubject[];
  episodeGapDays: number;
  basePath: string;
  isCompact: boolean;
  onSelect: (subject: TopicGraphSubject) => void;
  onPick: (name: string) => void;
}): TabItem[] {
  return [
    {
      key: "timeline",
      label: `Timeline (${episodes.length})`,
      content: <TimelinePanel episodes={episodes} gapDays={episodeGapDays} />,
    },
    {
      key: "graph",
      label: "Graph",
      // A force graph on a phone is a hairball nobody can tap — genuinely a
      // different component rather than a restyled one, which is the one case
      // design.md allows `useIsCompact()` instead of a `max-lg:` variant.
      content: isCompact ? (
        <CompactGraphNotice related={related} basePath={basePath} onPick={onPick} />
      ) : (
        <TaxonomyGraphView
          subjects={subjects}
          kind="tag"
          onSelect={onSelect}
          height="34rem"
          className="mt-2"
        />
      ),
    },
    {
      key: "related",
      label: `Related (${related.length})`,
      content: <RelatedPanel related={related} basePath={basePath} onPick={onPick} />,
    },
    {
      key: "entries",
      label: `Entries (${result.entries.length})`,
      content: <EntriesPanel entries={result.entries} />,
    },
  ];
}

/**
 * The journal's map: every subject it holds, drawn as a graph.
 *
 * This is the screen before a term is picked. The chips below it are the same
 * list the picker always showed — kept as the keyboard path, the narrow
 * fallback, and the way to reach a subject you can see faster than you can
 * find on a canvas.
 */
function TopicMapPanel({
  map,
  suggestions,
  basePath,
  isCompact,
  onPick,
}: {
  map: TopicMap | null;
  suggestions: TopicSuggestion[];
  basePath: string;
  isCompact: boolean;
  onPick: (name: string) => void;
}) {
  const subjects = useMemo(() => (map ? topicMapSubjects(map) : []), [map]);

  return (
    <div className="space-y-6">
      {/* Same rule the Graph tab follows: a force layout at phone width is a
          hairball nobody can tap, so narrow gets the chips alone. */}
      {/* Says so rather than rendering blank space. An empty map is a real
          state — a journal whose tags are each used once produces one — and a
          section that silently isn't there reads as a broken screen. */}
      {!isCompact && subjects.length === 0 && (
        <p className="text-sm text-ink/60">
          No map yet: it needs subjects that appear on two or more entries, and
          pairs of them that appear together. Tag a few more entries and it will fill in.
        </p>
      )}
      {!isCompact && subjects.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-ink/70">Your journal&rsquo;s subjects</h3>
          <p className="mt-1 text-xs text-ink/50">
            Every tag and category on two or more entries. Two are joined when they
            appear together. Click one to open it.
            {map && map.hiddenNodeCount > 0 && (
              <> {map.hiddenNodeCount} rarer {map.hiddenNodeCount === 1 ? "subject is" : "subjects are"} not shown.</>
            )}
          </p>
          <TaxonomyGraphView
            subjects={subjects}
            kind="tag"
            onSelect={(subject: TopicMapSubject) => onPick(subject.name)}
            // Sized by how many entries carry the name, not by how many
            // neighbours it has: a tag on 90 entries is a bigger subject than
            // one on 3 however few things it sits beside.
            weightOf={(subject: TopicMapSubject) => subject.entryCount}
            accentOf={(subject: TopicMapSubject) =>
              subject.kind === "category" ? "secondary" : "primary"
            }
            height="34rem"
            className="mt-2"
          />
        </div>
      )}

      <TopicPicker
        suggestions={suggestions}
        basePath={basePath}
        onPick={onPick}
        heading={
          !isCompact && subjects.length > 0 ? "Or pick one from the list" : "Your biggest subjects"
        }
      />
    </div>
  );
}

/** What the screen shows before a term is picked. */
function TopicPicker({
  suggestions,
  basePath,
  onPick,
  heading = "Your biggest subjects",
}: {
  suggestions: TopicSuggestion[];
  basePath: string;
  /** Routes a left-click through the parent's transition, so the overlay shows. */
  onPick: (name: string) => void;
  /**
   * Overridden when the map is drawn above this list, so the two do not both
   * read as the page's own heading.
   */
  heading?: string;
}) {
  if (suggestions.length === 0) {
    return (
      <p className="text-sm text-ink/60">
        Tag or categorise a few entries and they will show up here as topics.
      </p>
    );
  }

  return (
    <div>
      <h3 className="text-sm font-medium text-ink/70">{heading}</h3>
      <ul className="mt-3 flex flex-wrap gap-2">
        {suggestions.map((suggestion) => (
          <li key={`${suggestion.kind}:${suggestion.name}`}>
            {/* A real link, so it keeps its href — middle-click, copy-link and
                "open in new tab" all still work. `onNavigate` only intercepts
                the ordinary left-click, routing it through the same transition
                the search box uses so every way into a topic shows the same
                overlay. */}
            <Link
              href={`${basePath}?topic=${encodeURIComponent(suggestion.name)}`}
              onNavigate={(event) => {
                event.preventDefault();
                onPick(suggestion.name);
              }}
              className="inline-flex items-center gap-2 rounded-full border border-line px-3 py-1 text-sm hover:border-brass"
            >
              <span>{suggestion.name}</span>
              <span className="text-xs text-ink/50">{suggestion.entryCount}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EmptyTopic({
  term,
  bodyOnlyCount,
  matchBody,
}: {
  term: string;
  bodyOnlyCount: number;
  matchBody: boolean;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-ink/70">
        Nothing matches <strong>{term}</strong> in your tags, categories or titles.
      </p>
      {!matchBody && bodyOnlyCount > 0 && (
        <HiddenByBodySetting count={bodyOnlyCount} />
      )}
    </div>
  );
}

/**
 * The line that keeps the body-matching preference honest.
 *
 * A setting that silently shrinks the results is worse than no setting, so the
 * screen always says what it is hiding and where to change it.
 */
function HiddenByBodySetting({ count }: { count: number }) {
  return (
    <p className="text-sm text-ink/60">
      {count} more {count === 1 ? "entry mentions" : "entries mention"} it in the body
      text.{" "}
      <Link href="/modules/journal/configuration" className="underline hover:text-ink">
        Turn on body matching
      </Link>{" "}
      to include {count === 1 ? "it" : "them"}.
    </p>
  );
}

function TopicSummary({ result, matchBody }: { result: TopicResult; matchBody: boolean }) {
  return (
    <div className="space-y-1 text-sm text-ink/70">
      <p>
        <strong>{result.entries.length}</strong>{" "}
        {result.entries.length === 1 ? "entry" : "entries"}
        {result.matchedNames.length > 0 && (
          <> · matched on {result.matchedNames.join(", ")}</>
        )}
      </p>
      {result.maskedCount > 0 && (
        // Encrypted entries are counted rather than quietly dropped: their tags
        // are plaintext, so they really are part of this topic even though
        // nothing here can read their words.
        <p className="text-ink/60">
          {result.maskedCount} of these {result.maskedCount === 1 ? "is" : "are"} encrypted —
          matched by tag, with the text sealed.
        </p>
      )}
      {!matchBody && result.bodyOnlyCount > 0 && (
        <HiddenByBodySetting count={result.bodyOnlyCount} />
      )}
    </div>
  );
}

function TimelinePanel({ episodes, gapDays }: { episodes: TopicEpisode[]; gapDays: number }) {
  return (
    <div className="mt-2 space-y-4">
      <p className="text-xs text-ink/50">
        Entries more than {gapDays} days apart start a new episode.
      </p>
      {episodes.map((episode) => (
        <div key={`${episode.startDate}-${episode.endDate}`} className="border-l-2 border-line pl-4">
          <h4 className="text-sm font-medium">
            {episode.startDate === episode.endDate
              ? episode.startDate
              : `${episode.startDate} → ${episode.endDate}`}
            <span className="ml-2 text-xs font-normal text-ink/50">
              {episode.entries.length} {episode.entries.length === 1 ? "entry" : "entries"}
            </span>
          </h4>
          <ul className="mt-2 space-y-1">
            {episode.entries.map((item) => (
              <li key={item.entry.id} className="text-sm">
                <EntryLine item={item} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function RelatedPanel({
  related,
  basePath,
  onPick,
}: {
  related: TopicCooccurrence[];
  basePath: string;
  onPick: (name: string) => void;
}) {
  if (related.length === 0) {
    return (
      <p className="mt-2 text-sm text-ink/60">
        Nothing else appears on two or more of these entries yet.
      </p>
    );
  }

  return (
    <ul className="mt-2 space-y-2">
      {related.map((row) => (
        <li key={`${row.kind}:${row.name}`} className="flex items-center gap-3 text-sm">
          {/* Same treatment as the picker chips: a real href that still
              middle-clicks, with the plain click routed through the parent's
              transition. */}
          <Link
            href={`${basePath}?topic=${encodeURIComponent(row.name)}`}
            onNavigate={(event) => {
              event.preventDefault();
              onPick(row.name);
            }}
            className="underline hover:text-brass"
          >
            {row.name}
          </Link>
          <span className="text-xs text-ink/50">{row.kind}</span>
          <span className="ml-auto text-xs text-ink/60">
            {row.entryCount} ({Math.round(row.share * 100)}%)
          </span>
        </li>
      ))}
    </ul>
  );
}

/** What the Graph tab shows on a phone, where a force graph is unusable. */
function CompactGraphNotice({
  related,
  basePath,
  onPick,
}: {
  related: TopicCooccurrence[];
  basePath: string;
  onPick: (name: string) => void;
}) {
  return (
    <div className="mt-2 space-y-3">
      <p className="text-sm text-ink/60">
        The relationship graph needs a wider screen. Here is what this topic travels
        with instead.
      </p>
      <RelatedPanel related={related} basePath={basePath} onPick={onPick} />
    </div>
  );
}

function EntriesPanel({ entries }: { entries: TopicEntry[] }) {
  return (
    <ul className="mt-2 space-y-2">
      {entries.map((item) => (
        <li key={item.entry.id} className="text-sm">
          <EntryLine item={item} showDate />
        </li>
      ))}
    </ul>
  );
}

/**
 * One matched entry, badged with why it matched.
 *
 * The badges are the point: "matched because you tagged it" and "matched
 * because the word appears in the body somewhere" deserve very different trust,
 * and collapsing both into a relevance number would hide that.
 */
function EntryLine({ item, showDate = false }: { item: TopicEntry; showDate?: boolean }) {
  const kinds = [...new Set(item.reasons.map((reason) => reason.kind))];

  return (
    <span className="flex flex-wrap items-baseline gap-2">
      {showDate && <span className="text-xs text-ink/50">{item.entry.date}</span>}
      {/* Straight to the entry by id. An encrypted one is a link too: its own
          screen is where it can be unlocked, so sending the reader there is
          more use than a dead label. */}
      <Link
        href={`/modules/journal/entries/${item.entry.id}`}
        className={
          item.isMasked ? "italic text-ink/50 underline hover:text-brass" : "underline hover:text-brass"
        }
      >
        {item.isMasked
          ? "Encrypted entry"
          : item.entry.title.trim() === ""
            ? item.entry.date
            : item.entry.title}
      </Link>
      {kinds.map((kind) => (
        <span
          key={kind}
          className="rounded-full border border-line px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink/50"
        >
          {MATCH_LABEL[kind]}
        </span>
      ))}
    </span>
  );
}
