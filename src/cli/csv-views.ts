import {
  CSV_VIEW_OPERATORS,
  CSV_VIEW_OPERATOR_LABELS,
  createCustomView,
  deleteCustomView,
  describeCriteria,
  describeOrderBy,
  getCustomViewById,
  getEntryById,
  listAllCustomViews,
  listCustomViews,
  operatorArity,
  readCustomViewPage,
  setCustomViewEnabled,
  updateCustomView,
  type CsvCustomView,
  type CsvViewCriterion,
  type CsvViewOperator,
  type CsvViewOrderBy,
} from "@/lib/csv-analytics";
import { deps } from "@/lib/wiring";
import { messageOf } from "./error-message";
import { parseFlags } from "./parse-flags";

/**
 * CSV Analysis custom views from the terminal — the same use-cases the Custom Views
 * screen drives.
 *
 *   csv-views list [--entry 3]
 *   csv-views show --id 2
 *   csv-views create --entry 3 --name "Big sales" \
 *                    --columns city,amount \
 *                    --where "amount>=100" --where "city in Rome,Oslo" \
 *                    --order "amount:desc" --order "city:asc" \
 *                    --per-page 25 [--disabled]
 *   csv-views update --id 2 --name "Renamed" --columns "" --per-page 50
 *   csv-views enable  --id 2
 *   csv-views disable --id 2
 *   csv-views delete  --id 2
 *   csv-views read --id 2 [--page 2]
 *   csv-views operators
 *
 * `read` is the interesting one: it runs the view and prints a page, which is how the
 * compiled SQL is exercised against a real table without a browser — and the proof
 * that the query really lives in `src/lib/`, since this file only prints.
 *
 * `--where` and `--order` repeat, once per criterion / order-by, rather than taking a
 * JSON blob: a shell is a bad place to quote JSON. `parseFlags` keeps only the last
 * occurrence of a key, so both are re-scanned from argv directly below.
 */
export async function csvViewsCommand(args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  const flags = parseFlags(rest);

  switch (subcommand) {
    case "list":
      return printList(flags.entry);
    case "show":
      return printOne(flags.id);
    case "create":
      return create(flags, rest);
    case "update":
      return update(flags, rest);
    case "enable":
      return setEnabled(flags.id, true);
    case "disable":
      return setEnabled(flags.id, false);
    case "delete":
      return remove(flags.id);
    case "read":
      return read(flags.id, flags.page);
    case "operators":
      return printOperators();
    default:
      console.error(`Unknown subcommand "${subcommand ?? "(none)"}".`);
      console.error(
        "Use: list | show | create | update | enable | disable | delete | read | operators",
      );
      process.exitCode = 1;
  }
}

/** Every `--flag value` occurrence, in argv order — `parseFlags` keeps only the last. */
function repeatedFlag(args: string[], name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === `--${name}`) {
      const value = args[index + 1];
      if (value !== undefined && !value.startsWith("--")) values.push(value);
    }
  }
  return values;
}

function parseId(raw: string | undefined, label: string): number | undefined {
  if (!raw) {
    console.error(`Pass --${label}.`);
    process.exitCode = 1;
    return undefined;
  }
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    console.error(`--${label} must be a positive integer.`);
    process.exitCode = 1;
    return undefined;
  }
  return id;
}

/**
 * Parses one `--where` into a criterion.
 *
 * Accepted forms, longest operator first so `>=` isn't read as `>`:
 *   amount>=100          a symbol operator
 *   city is empty        a word operator with no value
 *   city in Rome,Oslo    a word operator with a list
 *   amount between 1 20  a word operator with two values (space-separated)
 */
function parseCriterion(raw: string): CsvViewCriterion {
  const symbols: [string, CsvViewOperator][] = [
    [">=", "greaterThanOrEqual"],
    ["<=", "lessThanOrEqual"],
    ["<>", "notEquals"],
    ["!=", "notEquals"],
    [">", "greaterThan"],
    ["<", "lessThan"],
    ["=", "equals"],
  ];
  for (const [symbol, operator] of symbols) {
    const at = raw.indexOf(symbol);
    if (at > 0) {
      return {
        column: raw.slice(0, at).trim(),
        operator,
        values: [raw.slice(at + symbol.length).trim()],
      };
    }
  }

  // Word forms: the operator is whatever label matches after the column name.
  // Checked longest-label-first so "is not empty" beats "is empty".
  const labelled = CSV_VIEW_OPERATORS.map(
    (operator) => [CSV_VIEW_OPERATOR_LABELS[operator], operator] as const,
  )
    .filter(([label]) => /[a-z]/.test(label))
    .sort((left, right) => right[0].length - left[0].length);

  for (const [label, operator] of labelled) {
    const marker = ` ${label}`;
    const at = raw.toLowerCase().indexOf(marker);
    if (at > 0) {
      const tail = raw.slice(at + marker.length).trim();
      const arity = operatorArity(operator);
      const values =
        arity === "none"
          ? []
          : arity === "list"
            ? tail.split(",").map((value) => value.trim()).filter((value) => value !== "")
            : arity === "two"
              ? tail.split(/\s+/).slice(0, 2)
              : [tail];
      return { column: raw.slice(0, at).trim(), operator, values };
    }
  }

  throw new Error(
    `Could not read the criterion "${raw}". Use e.g. "amount>=100", "city is empty", ` +
      `"city in Rome,Oslo" or "amount between 1 20". Run \`csv-views operators\` for the list.`,
  );
}

/** Parses one `--order` (`column` or `column:desc`) into an order-by. */
function parseOrderBy(raw: string): CsvViewOrderBy {
  const [column, direction = "asc"] = raw.split(":").map((part) => part.trim());
  if (direction !== "asc" && direction !== "desc") {
    throw new Error(`Order direction must be "asc" or "desc", got "${direction}".`);
  }
  return { column, direction };
}

/** Splits a `--columns a,b,c` list. An explicitly empty value means "every column". */
function parseColumns(raw: string): string[] {
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value !== "");
}

function describe(view: CsvCustomView): string {
  const entry = getEntryById(deps.csvAnalyticsRepo, view.entryId);
  const state = view.isEnabled ? "" : " (disabled)";
  return `#${view.id} ${view.name}${state} — dataset ${entry?.name ?? `?${view.entryId}`}`;
}

function printDetail(view: CsvCustomView): void {
  console.log(describe(view));
  if (view.description) console.log(`  ${view.description}`);
  console.log(
    `  columns   ${view.selectedColumns.length === 0 ? "(all)" : view.selectedColumns.join(", ")}`,
  );
  console.log(`  criteria  ${describeCriteria(view.criteria)}`);
  console.log(`  order by  ${describeOrderBy(view.orderBy)}`);
  console.log(`  per page  ${view.recordsPerPage}`);
}

function printList(entryFlag: string | undefined): void {
  const views = entryFlag
    ? listCustomViews(deps.csvAnalyticsRepo, Number(entryFlag))
    : listAllCustomViews(deps.csvAnalyticsRepo);

  if (views.length === 0) {
    console.log("No custom views.");
    return;
  }
  for (const view of views) {
    printDetail(view);
    console.log("");
  }
}

/** Looks a view up, reporting and exiting non-zero when it isn't found. */
function mustFind(rawId: string | undefined): CsvCustomView | undefined {
  const id = parseId(rawId, "id");
  if (id === undefined) return undefined;
  const view = getCustomViewById(deps.csvAnalyticsRepo, id);
  if (!view) {
    console.error(`No custom view #${id}.`);
    process.exitCode = 1;
    return undefined;
  }
  return view;
}

function printOne(rawId: string | undefined): void {
  const view = mustFind(rawId);
  if (view) printDetail(view);
}

function create(flags: Record<string, string>, rest: string[]): void {
  const entryId = parseId(flags.entry, "entry");
  if (entryId === undefined) return;
  if (!flags.name) {
    console.error("Pass --name.");
    process.exitCode = 1;
    return;
  }

  try {
    const view = createCustomView(deps.csvAnalyticsRepo, {
      entryId,
      name: flags.name,
      description: flags.description || undefined,
      selectedColumns: parseColumns(flags.columns ?? ""),
      criteria: repeatedFlag(rest, "where").map(parseCriterion),
      orderBy: repeatedFlag(rest, "order").map(parseOrderBy),
      recordsPerPage: flags["per-page"] ? Number(flags["per-page"]) : 100,
      // `--disabled` takes no value, so its presence as a key is what matters.
      isEnabled: !("disabled" in flags),
    });
    console.log("Created:");
    printDetail(view);
  } catch (error) {
    console.error(messageOf(error));
    process.exitCode = 1;
  }
}

/**
 * Updates a view. The use-case replaces the whole definition, so any part not passed
 * is re-sent as it currently stands — otherwise `--name X` alone would silently clear
 * the criteria.
 */
function update(flags: Record<string, string>, rest: string[]): void {
  const existing = mustFind(flags.id);
  if (!existing) return;

  const wheres = repeatedFlag(rest, "where");
  const orders = repeatedFlag(rest, "order");

  try {
    const view = updateCustomView(deps.csvAnalyticsRepo, existing.id, {
      name: flags.name ?? existing.name,
      description: "description" in flags ? flags.description || undefined : existing.description,
      // `--columns ""` is a real instruction ("every column"), distinct from omitting it.
      selectedColumns: "columns" in flags ? parseColumns(flags.columns) : existing.selectedColumns,
      criteria: wheres.length > 0 ? wheres.map(parseCriterion) : existing.criteria,
      orderBy: orders.length > 0 ? orders.map(parseOrderBy) : existing.orderBy,
      recordsPerPage: flags["per-page"] ? Number(flags["per-page"]) : existing.recordsPerPage,
      isEnabled:
        "disabled" in flags ? false : "enabled" in flags ? true : existing.isEnabled,
    });
    console.log("Updated:");
    printDetail(view);
  } catch (error) {
    console.error(messageOf(error));
    process.exitCode = 1;
  }
}

function setEnabled(rawId: string | undefined, isEnabled: boolean): void {
  const view = mustFind(rawId);
  if (!view) return;
  try {
    const updated = setCustomViewEnabled(deps.csvAnalyticsRepo, view.id, isEnabled);
    console.log(`${updated.name} is now ${updated.isEnabled ? "enabled" : "disabled"}.`);
  } catch (error) {
    console.error(messageOf(error));
    process.exitCode = 1;
  }
}

function remove(rawId: string | undefined): void {
  const view = mustFind(rawId);
  if (!view) return;
  deleteCustomView(deps.csvAnalyticsRepo, view.id);
  console.log(`Deleted "${view.name}".`);
}

function read(rawId: string | undefined, rawPage: string | undefined): void {
  const id = parseId(rawId, "id");
  if (id === undefined) return;

  try {
    const result = readCustomViewPage(deps.csvAnalyticsRepo, {
      viewId: id,
      page: rawPage ? Number(rawPage) : 1,
    });

    console.log(result.columns.map((column) => column.sourceHeader).join("\t"));
    for (const row of result.rows) {
      console.log(row.map((cell) => (cell === null ? "" : String(cell))).join("\t"));
    }
    console.log("");
    console.log(
      `${result.totalRows} matching records · page ${result.page} of ${result.pageCount} ` +
        `· ${result.recordsPerPage} per page`,
    );
  } catch (error) {
    console.error(messageOf(error));
    process.exitCode = 1;
  }
}

function printOperators(): void {
  for (const operator of CSV_VIEW_OPERATORS) {
    const arity = operatorArity(operator);
    const takes =
      arity === "none"
        ? "no value"
        : arity === "one"
          ? "one value"
          : arity === "two"
            ? "two values"
            : "a comma-separated list";
    console.log(`${CSV_VIEW_OPERATOR_LABELS[operator].padEnd(18)} ${takes}`);
  }
}
