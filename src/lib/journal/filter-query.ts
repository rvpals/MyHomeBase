// Pure — no I/O. Parses the compact filter-query syntax into the same
// JournalFilter tree the builder produces, so a caller-supplied string and a
// user-built filter share one query engine (buildFilterSql) rather than being two
// code paths that can disagree.
//
//   category = TRIP and title ~ beach
//   (title ~ rome or title ~ oslo) and category = TRIP
//   category = TRIP, FAMILY          -- comma means "any of"
//   tags != spam                     -- negation
//   date >= 2026-01-01
//   place is empty
//
// Deliberately strict: an unknown field or a malformed clause is an **error**, not
// a silently-ignored condition. A filter that quietly matches everything looks
// exactly like a filter that worked, which is the worst possible failure here —
// the caller thinks it's showing a slice and it's showing the lot.
//
// Nesting is one level, matching the builder: parentheses group conditions, and
// groups can't contain groups. That's a real limit of the tree shape, so it's
// reported rather than half-supported.

import type {
  JournalFilter,
  JournalFilterCondition,
  JournalFilterField,
  JournalFilterGroup,
  JournalFilterJoin,
  JournalFilterOperator,
} from "./types";
import { OPERATORS_BY_FIELD } from "./filters";

/**
 * Query field name -> the canonical field. Accepts a few natural aliases
 * (`tags` for `tag`, `pinned` for `isPinned`) because the query is written by
 * hand and "tags = x" reads better than "tag = x".
 *
 * This is an allowlist. A name absent from it is an error — it is never passed
 * through to the filter tree, which is what keeps the SQL layer's own allowlist
 * from ever being the only line of defence.
 */
const FIELD_ALIASES: Record<string, JournalFilterField> = {
  date: "date",
  time: "time",
  title: "title",
  content: "content",
  place: "placeName",
  placename: "placeName",
  category: "category",
  categories: "category",
  tag: "tag",
  tags: "tag",
  pinned: "isPinned",
  ispinned: "isPinned",
  locked: "isLocked",
  islocked: "isLocked",
};

/**
 * What a comparator token means *in the query language*, before it's mapped onto
 * a filter-tree operator.
 *
 * A separate vocabulary because the two don't line up one-to-one: the query has
 * `!=` (which the tree expresses as `hasNone` for a taxonomy and `notContains`
 * for text), and `>=`/`<=` collapse onto the tree's `after`/`before`. Keeping
 * them distinct avoids casting a string that isn't a JournalFilterOperator into
 * one, which would defeat the type.
 */
type QueryComparator = "gte" | "lte" | "gt" | "lt" | "eq" | "ne" | "like" | "notLike";

/** Longest-first so `>=` is matched before `>`, and `!~` before `~`. */
const COMPARATORS: { token: string; comparator: QueryComparator }[] = [
  { token: ">=", comparator: "gte" },
  { token: "<=", comparator: "lte" },
  { token: "!=", comparator: "ne" },
  { token: "!~", comparator: "notLike" },
  { token: "=", comparator: "eq" },
  { token: "~", comparator: "like" },
  { token: ">", comparator: "gt" },
  { token: "<", comparator: "lt" },
];

export class FilterQueryError extends Error {}

/** Truthy words accepted for the boolean fields. */
const TRUE_WORDS = new Set(["yes", "true", "1"]);
const FALSE_WORDS = new Set(["no", "false", "0"]);

/**
 * The names to suggest when a field isn't recognised.
 *
 * Deliberately the *query* spellings, not the canonical field names: telling
 * someone who typed `catgory` that the options include `placeName` and
 * `isPinned` sends them to write exactly the thing that won't parse.
 */
const SUGGESTED_FIELD_NAMES = [
  "date",
  "time",
  "title",
  "content",
  "place",
  "category",
  "tags",
  "pinned",
  "locked",
];

function resolveField(raw: string): JournalFilterField {
  const field = FIELD_ALIASES[raw.trim().toLowerCase()];
  if (!field) {
    throw new FilterQueryError(
      `Unknown field "${raw.trim()}". Known fields: ${SUGGESTED_FIELD_NAMES.join(", ")}.`,
    );
  }
  return field;
}

/**
 * Builds one condition, mapping the parsed operator onto what the field actually
 * supports. This is where `category = TRIP` becomes `hasAny`, and where an
 * operator the field can't take is rejected rather than compiled into something
 * that would silently never match.
 */
/** Query comparator -> tree operator, for the plain single-value fields. */
const TEXT_OPERATOR_BY_COMPARATOR: Record<QueryComparator, JournalFilterOperator> = {
  gte: "after",
  gt: "after",
  lte: "before",
  lt: "before",
  eq: "equals",
  // Text has no "not equals" in the tree — the builder offers "does not contain"
  // instead, so both negations land there.
  ne: "notContains",
  like: "contains",
  notLike: "notContains",
};

const NEGATING_COMPARATORS: ReadonlySet<QueryComparator> = new Set(["ne", "notLike"]);

function buildCondition(
  field: JournalFilterField,
  comparator: QueryComparator,
  rawValue: string,
  /** How the user spelled the field, so errors quote their text and not ours. */
  spelling: string,
): JournalFilterCondition {
  const allowed = OPERATORS_BY_FIELD[field];
  const value = rawValue.trim();

  // Multi-valued fields: `=` means "is any of", `!=` means "is none of", and a
  // comma-separated list is the point of them.
  if (field === "category" || field === "tag") {
    const values = value
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part !== "");
    if (values.length === 0) {
      throw new FilterQueryError(`"${spelling}" needs at least one value.`);
    }
    if (comparator === "eq" || comparator === "like") {
      return { field, operator: "hasAny", values };
    }
    if (NEGATING_COMPARATORS.has(comparator)) {
      return { field, operator: "hasNone", values };
    }
    throw new FilterQueryError(
      `"${spelling}" supports = (any of) and != (none of), not that comparison.`,
    );
  }

  if (field === "isPinned" || field === "isLocked") {
    const lowered = value.toLowerCase();
    if (!TRUE_WORDS.has(lowered) && !FALSE_WORDS.has(lowered)) {
      throw new FilterQueryError(`"${spelling}" takes yes or no, got "${value}".`);
    }
    // `!= yes` is the same as `= no`; normalising here keeps the tree simple.
    const isTrue = TRUE_WORDS.has(lowered);
    return {
      field,
      operator: "is",
      value: String(NEGATING_COMPARATORS.has(comparator) ? !isTrue : isTrue),
    };
  }

  const mapped = TEXT_OPERATOR_BY_COMPARATOR[comparator];
  if (!allowed.includes(mapped)) {
    throw new FilterQueryError(
      `"${spelling}" doesn't support that comparison. It supports: ${allowed.join(", ")}.`,
    );
  }
  if (value === "") throw new FilterQueryError(`"${spelling}" needs a value.`);
  return { field, operator: mapped, value };
}

/** `place is empty` / `title is not empty` — handled before comparators. */
function parseEmptyClause(clause: string): JournalFilterCondition | undefined {
  const match = /^(.+?)\s+is\s+(not\s+)?empty$/i.exec(clause.trim());
  if (!match) return undefined;
  const field = resolveField(match[1]);
  const operator: JournalFilterOperator = match[2] ? "isNotEmpty" : "isEmpty";
  if (!OPERATORS_BY_FIELD[field].includes(operator)) {
    throw new FilterQueryError(`"${match[1].trim()}" can't be tested for empty.`);
  }
  return { field, operator };
}

function parseClause(clause: string): JournalFilterCondition {
  const trimmed = clause.trim();
  if (trimmed === "") throw new FilterQueryError("Empty condition.");

  const emptyClause = parseEmptyClause(trimmed);
  if (emptyClause) return emptyClause;

  for (const { token, comparator } of COMPARATORS) {
    const index = trimmed.indexOf(token);
    if (index <= 0) continue;
    const spelling = trimmed.slice(0, index).trim();
    const field = resolveField(spelling);
    const value = trimmed.slice(index + token.length);
    return buildCondition(field, comparator, value, spelling);
  }

  throw new FilterQueryError(
    `Couldn't read "${trimmed}". Expected something like: category = TRIP, or title ~ beach.`,
  );
}

/**
 * Splits on a boolean keyword at paren depth 0, so `and`/`or` inside a group
 * doesn't split the outer expression. Returns the pieces plus which keyword
 * joined them, and rejects a mix of both at the same level — `a and b or c` is
 * ambiguous without precedence rules, and inventing one silently would give the
 * caller a filter they didn't ask for.
 */
function splitOnJoin(text: string): { parts: string[]; join: JournalFilterJoin } {
  const parts: string[] = [];
  const joins: JournalFilterJoin[] = [];
  let depth = 0;
  let current = "";

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (depth < 0) throw new FilterQueryError("Unbalanced ) in the filter query.");

    if (depth === 0) {
      const rest = text.slice(index);
      // \b so "android" isn't read as "and", and a following space/paren is required.
      const andMatch = /^and\b/i.exec(rest);
      const orMatch = /^or\b/i.exec(rest);
      const isBoundary = index === 0 || /[\s)]/.test(text[index - 1]);
      if (isBoundary && (andMatch || orMatch)) {
        const keyword = andMatch ? "AND" : "OR";
        parts.push(current);
        joins.push(keyword);
        current = "";
        index += (andMatch ? andMatch[0] : orMatch![0]).length - 1;
        continue;
      }
    }
    current += character;
  }
  if (depth !== 0) throw new FilterQueryError("Unbalanced ( in the filter query.");
  parts.push(current);

  const distinct = new Set(joins);
  if (distinct.size > 1) {
    throw new FilterQueryError(
      "Mixing and/or at the same level is ambiguous — use parentheses, e.g. (a or b) and c.",
    );
  }
  return { parts, join: joins[0] ?? "AND" };
}

function stripOuterParens(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("(") || !trimmed.endsWith(")")) return trimmed;
  // Only strip when the opening paren closes at the very end, so
  // "(a or b) and (c)" isn't mangled into "a or b) and (c".
  let depth = 0;
  for (let index = 0; index < trimmed.length; index += 1) {
    if (trimmed[index] === "(") depth += 1;
    if (trimmed[index] === ")") depth -= 1;
    if (depth === 0 && index < trimmed.length - 1) return trimmed;
  }
  return trimmed.slice(1, -1).trim();
}

function parseGroup(text: string): JournalFilterGroup {
  const inner = stripOuterParens(text);
  if (inner.includes("(")) {
    throw new FilterQueryError(
      "Groups can't be nested inside other groups — one level of parentheses only.",
    );
  }
  const { parts, join } = splitOnJoin(inner);
  return { join, conditions: parts.map(parseClause) };
}

/**
 * Parses a filter query into a JournalFilter.
 *
 * Throws `FilterQueryError` with a message meant to be shown to the user — the
 * caller renders it rather than falling back to unfiltered, so a typo can't
 * masquerade as "no matches" or "everything".
 */
export function parseFilterQuery(query: string): JournalFilter {
  const trimmed = query.trim();
  if (trimmed === "") throw new FilterQueryError("The filter query is empty.");

  const { parts, join } = splitOnJoin(trimmed);

  // Parentheses are what create groups. Without them the whole query is ONE
  // group whose conditions share a join — `a and b` is a two-condition group,
  // not two one-condition groups. Both compile to the same SQL, but the tree is
  // what the builder UI renders when you open a query-derived filter for
  // editing, and a row of single-condition groups would be a mess to edit.
  if (!trimmed.includes("(")) {
    const conditions = parts.map(parseClause);
    if (conditions.length === 0) throw new FilterQueryError("The filter query has no conditions.");
    return { join: "AND", groups: [{ join, conditions }] };
  }

  const groups = parts.map(parseGroup).filter((group) => group.conditions.length > 0);
  if (groups.length === 0) throw new FilterQueryError("The filter query has no conditions.");
  return { join, groups };
}

/**
 * Parses without throwing, for a caller that wants to render the message itself.
 */
export function tryParseFilterQuery(
  query: string,
): { ok: true; filter: JournalFilter } | { ok: false; error: string } {
  try {
    return { ok: true, filter: parseFilterQuery(query) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Couldn't read the filter query.",
    };
  }
}
