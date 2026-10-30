// The Document Library's tree: categories at the top level, the tags actually in use
// beneath each one.
//
// Pure shaping over rows the caller already read. No repository and no port, because
// there is no query here that `listCategories` and `listDocuments` do not already
// answer — the counts and the per-category tag lists are derived from the same
// summaries the list pane renders. Deriving rather than aggregating in SQL is what
// stops the tree and the list disagreeing: a count in the tree that came from a
// different query than the rows beside it is a count that can be wrong.
//
// Callable from the CLI exactly as from the web, since it takes data and returns data.

import type { DocumentSummary, DocumentTaxonomyItem } from "./types";

/**
 * The node id for documents filed under no category at all.
 *
 * A real id rather than `""` so it can be put in a URL and compared without a special
 * case, and deliberately a string no category name can collide with: category names
 * are matched `COLLATE NOCASE` and this one carries characters a name cannot.
 */
export const UNCATEGORIZED_ID = "(uncategorized)";

/** What the Uncategorized node calls itself. */
export const UNCATEGORIZED_LABEL = "Uncategorized";

/** One tag beneath a category, with how many of that category's documents wear it. */
export interface DocumentTreeTag {
  /** The tag name, in the casing the taxonomy list records. */
  name: string;
  /** How many documents in this category carry it. Always at least 1. */
  count: number;
  /** Whether an icon has been uploaded for it, for the row's glyph. */
  hasIcon: boolean;
  /** The taxonomy row's `updatedAt`, which is the icon URL's cache-buster. */
  updatedAt: string;
}

/**
 * One top-level node: a category, or the Uncategorized bucket.
 *
 * `id` is what selection and the URL key on; `name` is what a filter is built from.
 * They differ only for Uncategorized, whose `name` is `""` — the absence of a
 * category, which no filter value can express.
 */
export interface DocumentTreeCategory {
  id: string;
  /** The category name, or `""` for the Uncategorized bucket. */
  name: string;
  label: string;
  /** How many documents are filed here. */
  count: number;
  hasIcon: boolean;
  updatedAt: string;
  /** The tags worn by this category's documents, most-used first. */
  tags: DocumentTreeTag[];
}

/**
 * Builds the tree from the category list and the documents.
 *
 * **Every category is a node, including an empty one.** A category someone created
 * and has not filed anything under yet still exists, and a tree that hid it would
 * make the reader wonder where it went — the same reason `TreeNav` renders an empty
 * group with a message rather than dropping it.
 *
 * **Tags are the opposite: only those in use appear.** A tag beneath a category that
 * no document there carries is a filter guaranteed to return nothing, and offering it
 * is offering a dead end. This is why the tags cannot come from `listTags()`.
 *
 * A document filed under several categories is counted under each of them, which is
 * what the filter does too: clicking either category finds it.
 *
 * `documents` should be the **unfiltered** list. Passing a filtered one builds a tree
 * whose counts describe the filter rather than the library, and whose nodes vanish as
 * the reader narrows — a tree you cannot navigate back up.
 */
export function buildDocumentTree(
  categories: DocumentTaxonomyItem[],
  documents: DocumentSummary[],
): DocumentTreeCategory[] {
  // Keyed lower-case throughout: `doc_categories.name` is `COLLATE NOCASE`, so
  // "Tax" on a document and "tax" in the taxonomy list are the same category and
  // must land in the same node.
  const byKey = new Map<string, DocumentTreeCategory>();

  for (const category of categories) {
    byKey.set(category.name.toLowerCase(), {
      id: category.name,
      name: category.name,
      label: category.name,
      count: 0,
      hasIcon: category.hasIcon,
      updatedAt: category.updatedAt,
      tags: [],
    });
  }

  // Tag tallies are collected separately from the nodes so the counts can be sorted
  // and resolved to their canonical casing in one pass at the end.
  const tagCounts = new Map<string, Map<string, number>>();
  const uncategorized: DocumentTreeCategory = {
    id: UNCATEGORIZED_ID,
    name: "",
    label: UNCATEGORIZED_LABEL,
    count: 0,
    hasIcon: false,
    updatedAt: "",
    tags: [],
  };

  for (const document of documents) {
    // A document filed under a category that is not in the taxonomy list is still
    // counted: the row exists, and dropping it would make it unreachable from this
    // screen. It gets a node of its own rather than falling into Uncategorized,
    // because it *is* categorised — the list is what is out of step.
    const keys =
      document.categories.length === 0
        ? [UNCATEGORIZED_ID]
        : document.categories.map((name) => name.toLowerCase());

    for (const key of keys) {
      let node: DocumentTreeCategory;
      if (key === UNCATEGORIZED_ID) {
        node = uncategorized;
      } else {
        const existing = byKey.get(key);
        if (existing) {
          node = existing;
        } else {
          const name = document.categories.find((value) => value.toLowerCase() === key) ?? key;
          node = {
            id: name,
            name,
            label: name,
            count: 0,
            hasIcon: false,
            updatedAt: "",
            tags: [],
          };
          byKey.set(key, node);
        }
      }

      node.count += 1;

      let counts = tagCounts.get(node.id);
      if (!counts) {
        counts = new Map<string, number>();
        tagCounts.set(node.id, counts);
      }
      for (const tag of document.tags) {
        const tagKey = tag.toLowerCase();
        counts.set(tagKey, (counts.get(tagKey) ?? 0) + 1);
      }
    }
  }

  return [...byKey.values(), ...(uncategorized.count > 0 ? [uncategorized] : [])].map((node) => ({
    ...node,
    tags: resolveTags(tagCounts.get(node.id), documents),
  }));
}

/**
 * Turns one category's lower-cased tallies into display rows.
 *
 * Sorted by count descending, then by name — the most-used tag is the one a reader
 * is most likely to want, and ties fall back to something stable so the order does
 * not shuffle between renders.
 *
 * Icon fields come from the documents rather than from `listTags()` because this
 * function deliberately does not take the tag taxonomy: see `attachTagIcons`, which
 * the view uses to fill them in from the list it already has.
 */
function resolveTags(
  counts: Map<string, number> | undefined,
  documents: DocumentSummary[],
): DocumentTreeTag[] {
  if (!counts || counts.size === 0) return [];

  // The canonical casing is whichever a document spells it with — the taxonomy list
  // is not consulted here, so a tag in use but missing from it still renders.
  const casing = new Map<string, string>();
  for (const document of documents) {
    for (const tag of document.tags) {
      const key = tag.toLowerCase();
      if (!casing.has(key)) casing.set(key, tag);
    }
  }

  return [...counts.entries()]
    .map(([key, count]) => ({
      name: casing.get(key) ?? key,
      count,
      hasIcon: false,
      updatedAt: "",
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * Fills in each tag node's icon fields from the tag taxonomy.
 *
 * Separate from `buildDocumentTree` so the tree can be built from documents alone —
 * the counts and the structure are the part worth testing, and they do not depend on
 * whether anyone uploaded a picture. The view calls both; a CLI caller wanting the
 * shape calls only the first.
 */
export function attachTagIcons(
  tree: DocumentTreeCategory[],
  tags: DocumentTaxonomyItem[],
): DocumentTreeCategory[] {
  const byKey = new Map(tags.map((tag) => [tag.name.toLowerCase(), tag]));

  return tree.map((node) => ({
    ...node,
    tags: node.tags.map((tag) => {
      const match = byKey.get(tag.name.toLowerCase());
      return match === undefined
        ? tag
        : { ...tag, hasIcon: match.hasIcon, updatedAt: match.updatedAt };
    }),
  }));
}

/**
 * The filter a tree selection means.
 *
 * Here rather than in the view because it is the one place the Uncategorized bucket
 * stops being a special case: it filters on no category at all, which the filter
 * schema expresses as an empty list — so a view that built this itself would need to
 * know that, and so would the CLI.
 *
 * Returns `categories` and `tags` ready for `listDocuments`.
 */
export function treeSelectionFilter(
  categoryId: string | undefined,
  tagName: string | undefined,
): { categories: string[]; tags: string[] } {
  return {
    categories:
      categoryId === undefined || categoryId === "" || categoryId === UNCATEGORIZED_ID
        ? []
        : [categoryId],
    tags: tagName === undefined || tagName === "" ? [] : [tagName],
  };
}

/**
 * Whether a document belongs under the selected node.
 *
 * `listDocuments` cannot express "has no category" — its filter is a list of names,
 * and an empty list means "do not filter". So Uncategorized is narrowed here, after
 * the query, rather than by it. Every other selection is already exact, and this
 * returns `true` for it untouched rather than re-checking what SQL just decided.
 */
export function isInTreeSelection(
  document: DocumentSummary,
  categoryId: string | undefined,
): boolean {
  return categoryId === UNCATEGORIZED_ID ? document.categories.length === 0 : true;
}
