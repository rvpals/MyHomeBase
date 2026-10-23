// Journal entries as graph subjects.
//
// The force simulation in `@/lib/shared/taxonomy-graph` works on anything with
// `id`, `name`, `categories` and `tags`. A `JournalEntry` has all four already
// — but its label field is `title`, and an encrypted entry's title is `""`
// because the real text lives in a blob nobody here can open. So this adapter
// does two things and no more: renames `title` to `name`, and substitutes a
// stand-in label for the entries whose own one is unreadable.

import type { GraphSubject } from "@/lib/shared/taxonomy-graph";
import { topicMapNodeKey, type TopicMap } from "./map";
import type { TopicEntry } from "./types";

/**
 * What an encrypted entry is labelled in the graph and the lists.
 *
 * It appears rather than being dropped: its tags and categories are plaintext,
 * so it is genuinely part of the topic, and omitting it would make the picture
 * quietly understate what the journal holds. Labelling it honestly is the
 * compromise — the reader can see that something is there and that it is
 * sealed, which is the true state of affairs.
 */
export const MASKED_ENTRY_LABEL = "Encrypted entry";

/** A journal entry in the shape the shared graph wants. */
export interface TopicGraphSubject extends GraphSubject {
  /** The entry this node stands for, so the view can link to it. */
  topicEntry: TopicEntry;
  /** True when `name` is the stand-in rather than the entry's own title. */
  isMasked: boolean;
}

/**
 * Turns matched entries into graph subjects.
 *
 * An entry with no title falls back to its date rather than to an empty label:
 * a nameless dot in a force graph is unidentifiable, and the date is the one
 * thing every entry has.
 */
export function topicGraphSubjects(entries: readonly TopicEntry[]): TopicGraphSubject[] {
  return entries.map((topicEntry) => {
    const { entry } = topicEntry;
    const name = topicEntry.isMasked
      ? MASKED_ENTRY_LABEL
      : entry.title.trim() !== ""
        ? entry.title
        : entry.date;

    return {
      id: entry.id,
      name,
      categories: entry.categories,
      tags: entry.tags,
      topicEntry,
      isMasked: topicEntry.isMasked,
    };
  });
}

// --- The map: subjects as nodes ---------------------------------------------

/** One tag or category as a node in the journal map. */
export interface TopicMapSubject extends GraphSubject {
  kind: "tag" | "category";
  /** How many entries carry this name — what the node is sized by. */
  entryCount: number;
}

/**
 * Turns the map into graph subjects.
 *
 * The trick that makes this need no change to the physics: `buildTaxonomyGraph`
 * draws an edge wherever two subjects **share a name in the chosen list**, so
 * each node's `tags` array is set to *the names it co-occurs with*. Feeding the
 * result to the builder with `kind: "tag"` then reproduces the map's own edges
 * exactly, and the force layout, hit-testing and hover highlighting all work
 * unmodified.
 *
 * `categories` stays empty for the same reason: it is the other list the
 * builder could join on, and leaving it empty keeps there being exactly one
 * meaning for an edge here. A node's own kind rides on `kind`, which is what
 * the view colours by — it is not a thing to draw edges from.
 *
 * Ids are positional rather than meaningful: a tag has no row id of its own
 * (`jrn_entry_tags` keys on the name), and `GraphSubject` needs a number. They
 * are stable for a given map because `buildTopicMap` sorts its nodes.
 */
export function topicMapSubjects(map: TopicMap): TopicMapSubject[] {
  const present = new Set(map.nodes.map((node) => topicMapNodeKey(node)));

  // Neighbours per node, built once rather than scanned per node.
  const neighbours = new Map<string, string[]>();
  for (const edge of map.edges) {
    // `buildTopicMap` already drops edges to filtered-out nodes; this is the
    // belt to that braces, so a hand-built map cannot produce a token on one
    // end only — which would be an edge the builder silently never draws.
    if (!present.has(edge.a) || !present.has(edge.b)) continue;
    // The shared "name" on both ends is the pair itself, so the two nodes have
    // exactly one list entry in common and the builder joins them once.
    const token = `${edge.a}|${edge.b}`;
    neighbours.set(edge.a, [...(neighbours.get(edge.a) ?? []), token]);
    neighbours.set(edge.b, [...(neighbours.get(edge.b) ?? []), token]);
  }

  return map.nodes.map((node, index) => {
    const key = topicMapNodeKey(node);
    return {
      id: index + 1,
      name: node.name,
      categories: [],
      tags: neighbours.get(key) ?? [],
      kind: node.kind,
      entryCount: node.entryCount,
    };
  });
}
