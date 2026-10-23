// The journal's map: every subject it holds, and which ones travel together.
//
// The counterpart to `match.ts`. That one answers "which entries are about
// X" — one topic, entries as the thing on screen. This one answers "what are
// my subjects at all", with the *names* as the thing on screen and the entries
// reduced to the evidence joining them. It is what the Topics section shows
// before a term is picked, so the empty state is a map rather than a prompt.
//
// Pure over the entries: one pass, no repository, no SQL. The pairing counts
// cannot come from `listTopTags`/`listTopCategories` — those group by name and
// so know how often each name is used but never which names shared an entry,
// which is the only thing an edge is made of.

import { normalizeTerm } from "./fuzzy";
import type { JournalEntry } from "@/lib/journal/types";

/** One subject in the map. */
export interface TopicMapNode {
  /** The name as the journal spells it — the first spelling seen wins. */
  name: string;
  kind: "tag" | "category";
  /** How many entries carry it. Drives the drawn size. */
  entryCount: number;
}

/** Two subjects that appear together. */
export interface TopicMapEdge {
  /** Normalized key of one end. Always orders before `b`. */
  a: string;
  b: string;
  /** How many entries carry both. */
  sharedEntries: number;
  /**
   * `sharedEntries` scaled to 0–1 against the densest pairing in the map, so
   * the renderer and the physics read one scale rather than each dividing
   * again. Matches what `buildTaxonomyGraph` does with its own edges.
   */
  strength: number;
}

export interface TopicMap {
  nodes: TopicMapNode[];
  edges: TopicMapEdge[];
  /**
   * How many names were left out by `minEntryCount`, so the view can say so.
   *
   * A map that silently drops half the journal's tags is lying about its own
   * completeness; saying "82 rarer subjects hidden" turns the threshold into
   * something the reader can reason about rather than a mystery.
   */
  hiddenNodeCount: number;
}

export interface BuildTopicMapOptions {
  /**
   * Names on fewer entries than this are left out entirely. Default 2.
   *
   * A name used once has no pairings and draws as an unconnected dot, and a
   * well-used journal has a long tail of them — they are most of what turns a
   * map into a hairball while carrying the least information.
   */
  minEntryCount?: number;
  /**
   * Pairings seen on fewer entries than this draw no edge. Default 2.
   *
   * One shared entry is a coincidence, not a relationship. This is the more
   * important of the two thresholds: nodes merely crowd a map, while spurious
   * edges actively mislead, because the layout pulls unrelated subjects into
   * the same cluster.
   */
  minSharedEntries?: number;
}

/** Keys a name by kind and normalized spelling, so `HSA` and `hsa` are one node. */
function keyOf(kind: "tag" | "category", name: string): string {
  return `${kind}:${normalizeTerm(name)}`;
}

/**
 * Builds the map from every entry.
 *
 * Encrypted entries are included. Their tags and categories are plaintext —
 * only the title and body are sealed — so they contribute to the counts and
 * the pairings exactly like any other entry. Nothing here reads entry text at
 * all, which is why this view needs no `matchBody` preference.
 *
 * O(entries × names²). Names per entry are in single digits, so at journal
 * scale this is a few tens of thousands of map operations, done once per page
 * load rather than per frame.
 */
export function buildTopicMap(
  entries: readonly JournalEntry[],
  options: BuildTopicMapOptions = {},
): TopicMap {
  const minEntryCount = options.minEntryCount ?? 2;
  const minSharedEntries = options.minSharedEntries ?? 2;

  const nodes = new Map<string, TopicMapNode>();
  const pairs = new Map<string, number>();

  for (const entry of entries) {
    // Deduplicated per entry: the repository does not promise distinct arrays,
    // and a double-tagged entry would otherwise inflate both its own count and
    // every pairing it takes part in.
    const named: { key: string; node: TopicMapNode }[] = [];
    const seen = new Set<string>();

    const add = (kind: "tag" | "category", name: string) => {
      if (name.trim() === "") return;
      const key = keyOf(kind, name);
      if (normalizeTerm(name) === "" || seen.has(key)) return;
      seen.add(key);

      const existing = nodes.get(key);
      if (existing) {
        existing.entryCount += 1;
        named.push({ key, node: existing });
      } else {
        const node: TopicMapNode = { name, kind, entryCount: 1 };
        nodes.set(key, node);
        named.push({ key, node });
      }
    };

    for (const name of entry.tags) add("tag", name);
    for (const name of entry.categories) add("category", name);

    // Every unordered pair on this entry. Keys are sorted so `a|b` and `b|a`
    // are one tally rather than two half-counts.
    for (let i = 0; i < named.length; i += 1) {
      for (let j = i + 1; j < named.length; j += 1) {
        const [a, b] =
          named[i].key < named[j].key ? [named[i].key, named[j].key] : [named[j].key, named[i].key];
        const pairKey = `${a}|${b}`;
        pairs.set(pairKey, (pairs.get(pairKey) ?? 0) + 1);
      }
    }
  }

  const kept = new Map<string, TopicMapNode>();
  let hiddenNodeCount = 0;
  for (const [key, node] of nodes) {
    if (node.entryCount >= minEntryCount) kept.set(key, node);
    else hiddenNodeCount += 1;
  }

  const edges: TopicMapEdge[] = [];
  let maxShared = 0;
  for (const [pairKey, sharedEntries] of pairs) {
    if (sharedEntries < minSharedEntries) continue;
    const [a, b] = pairKey.split("|");
    // An edge to a dropped node would reference a node that is not there.
    if (!kept.has(a) || !kept.has(b)) continue;

    maxShared = Math.max(maxShared, sharedEntries);
    edges.push({ a, b, sharedEntries, strength: sharedEntries });
  }
  for (const edge of edges) {
    edge.strength = maxShared === 0 ? 0 : edge.sharedEntries / maxShared;
  }

  return {
    // Biggest subjects first, ties alphabetical — a stable order, so the layout
    // (which seeds positions from array index) does not reshuffle on refresh.
    nodes: [...kept.values()].sort(
      (a, b) => b.entryCount - a.entryCount || a.name.localeCompare(b.name),
    ),
    edges: edges.sort(
      (a, b) => b.sharedEntries - a.sharedEntries || a.a.localeCompare(b.a),
    ),
    hiddenNodeCount,
  };
}

/** The normalized key for a node, for callers matching edges back to nodes. */
export function topicMapNodeKey(node: TopicMapNode): string {
  return keyOf(node.kind, node.name);
}
