"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { IconSelect } from "@/components/icon-select";
import { Progress3D } from "@/components/progress-3d";
import {
  DEFAULT_CLEANUP_BATCH_SIZE,
  RULE_ACTION_FIELDS,
  RULE_ACTION_FIELD_LABELS,
  TRANSACTION_STATUSES,
  type CleanupLogEntry,
  type ExpenseCategory,
  type PostImportRule,
  type RuleActionField,
} from "@/lib/expense";
import {
  applyRuleToExistingAction,
  countUnprocessedAction,
  deleteRuleAction,
  previewPatternAction,
  refreshExpenseViewAction,
  resetProcessedAction,
  runCleanupBatchAction,
  saveRuleAction,
} from "./expense-actions";
import {
  CategoryIconThumbnail,
  categoryIconSelectOptions,
  categoryIconUrlsByName,
} from "./expense-shared";

const INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

/** How the matching works, in the user's terms. */
function PatternHelp() {
  return (
    <div className="rounded-md border border-line bg-paper p-3 text-xs text-muted">
      <p className="font-medium text-ink">How rules work</p>
      <ul className="mt-2 flex list-disc flex-col gap-1 pl-4">
        <li>
          A rule is <strong className="text-ink">one condition</strong> on the statement description
          plus <strong className="text-ink">any number of fields to set</strong>. For example{" "}
          <code className="font-mono text-brass-dark">*TGI*</code> &rarr; Vendor ={" "}
          <span className="font-mono">TGI Friday</span>, Category ={" "}
          <span className="font-mono">Restaurant</span>.
        </li>
        <li>
          <code className="font-mono text-brass-dark">*</code> stands for &ldquo;anything&rdquo;.{" "}
          <code className="font-mono text-brass-dark">AMAZON*</code> matches descriptions that{" "}
          <em>start with</em> AMAZON; <code className="font-mono text-brass-dark">*UBER*</code>{" "}
          matches it anywhere. A pattern with <strong>no</strong>{" "}
          <code className="font-mono text-brass-dark">*</code> matches anywhere by default, so{" "}
          <code className="font-mono text-brass-dark">TGI</code> is the same as{" "}
          <code className="font-mono text-brass-dark">*TGI*</code>.
        </li>
        <li>Matching ignores case, and every other character is taken literally.</li>
        <li>
          When several rules match, the lowest <strong>priority</strong> number wins — put specific
          patterns above general ones.
        </li>
        <li>
          A rule only fills in a field that is <strong>still blank</strong> (or, for status, still{" "}
          <span className="font-mono">new</span>), so it never overwrites something you set by hand.
        </li>
      </ul>
    </div>
  );
}

interface ActionDraft {
  fieldName: RuleActionField;
  fieldValue: string;
}

const emptyRule = {
  name: "",
  description: "",
  pattern: "",
  priority: 0,
  isEnabled: true,
  actions: [{ fieldName: "categoryName" as RuleActionField, fieldValue: "" }] as ActionDraft[],
};

function RuleForm({
  categories,
  editing,
  prefillName,
  prefillDescription,
  prefillPattern,
  onDone,
}: {
  categories: ExpenseCategory[];
  editing?: PostImportRule;
  /**
   * Seeds a *new* rule from ?name= / ?description= / ?vendorDescription=.
   * Ignored while editing. `prefillPattern` fills "When the description matches".
   */
  prefillName?: string;
  prefillDescription?: string;
  prefillPattern?: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState(() =>
    editing
      ? {
          name: editing.name,
          description: editing.description,
          pattern: editing.pattern,
          priority: editing.priority,
          isEnabled: editing.isEnabled,
          actions: editing.actions.map((action) => ({
            fieldName: action.fieldName,
            fieldValue: action.fieldValue,
          })),
        }
      : // A prefill only seeds a new rule — an existing rule's own values must win
        // when you open it to edit.
        {
          ...emptyRule,
          name: prefillName ?? "",
          description: prefillDescription ?? "",
          pattern: prefillPattern ?? "",
        },
  );
  const [preview, setPreview] = useState<{ matchCount: number; samples: string[] } | undefined>();
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);

  function updateAction(index: number, patch: Partial<ActionDraft>) {
    setForm((current) => ({
      ...current,
      actions: current.actions.map((action, i) => (i === index ? { ...action, ...patch } : action)),
    }));
  }

  function addAction() {
    setForm((current) => ({
      ...current,
      actions: [...current.actions, { fieldName: "vendor", fieldValue: "" }],
    }));
  }

  function removeAction(index: number) {
    setForm((current) => ({
      ...current,
      actions: current.actions.filter((_, i) => i !== index),
    }));
  }

  async function handlePreview() {
    setIsChecking(true);
    try {
      const result = await previewPatternAction(form.pattern);
      if (result.ok) setPreview({ matchCount: result.matchCount ?? 0, samples: result.samples ?? [] });
    } finally {
      setIsChecking(false);
    }
  }

  async function handleSave() {
    setIsSaving(true);
    setError(undefined);
    try {
      const result = await saveRuleAction(editing?.id, form);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (!editing) setForm(emptyRule);
      setPreview(undefined);
      onDone();
      router.refresh();
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-line bg-paper-raised p-3">
      <p className="text-sm font-medium text-ink">{editing ? `Edit rule #${editing.id}` : "New rule"}</p>
      {error && <p className="text-sm text-red-400">{error}</p>}

      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Name</span>
        <input
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
          placeholder="TGI Friday's"
          className={INPUT_CLASS}
        />
      </label>

      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">
          Description <span className="font-normal text-muted">(optional)</span>
        </span>
        <textarea
          value={form.description}
          onChange={(event) => setForm({ ...form, description: event.target.value })}
          rows={2}
          placeholder="Why this rule exists — e.g. the card prints this restaurant under three different names."
          className={INPUT_CLASS}
        />
      </label>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="block text-sm sm:col-span-2">
          <span className="mb-1 block font-medium text-ink">When the description matches</span>
          <input
            value={form.pattern}
            onChange={(event) => setForm({ ...form, pattern: event.target.value })}
            placeholder="*TGI*"
            className={`${INPUT_CLASS} font-mono`}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Priority</span>
          <input
            type="number"
            value={form.priority}
            onChange={(event) => setForm({ ...form, priority: Number(event.target.value) })}
            className={INPUT_CLASS}
          />
        </label>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-ink">Then set</span>
        {form.actions.map((action, index) => (
          <div key={index} className="flex flex-wrap items-center gap-2">
            <select
              value={action.fieldName}
              onChange={(event) =>
                updateAction(index, {
                  fieldName: event.target.value as RuleActionField,
                  // Seed a valid status so the field is never saved empty.
                  fieldValue: event.target.value === "status" ? "reconciled" : "",
                })
              }
              className={`${INPUT_CLASS} w-32`}
            >
              {RULE_ACTION_FIELDS.map((field) => (
                <option key={field} value={field}>
                  {RULE_ACTION_FIELD_LABELS[field]}
                </option>
              ))}
            </select>
            <span className="text-muted">=</span>
            {action.fieldName === "status" ? (
              <select
                value={action.fieldValue}
                onChange={(event) => updateAction(index, { fieldValue: event.target.value })}
                className={`${INPUT_CLASS} w-40`}
              >
                {TRANSACTION_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            ) : action.fieldName === "categoryName" ? (
              // A rule may name a category that doesn't exist yet — it's created
              // when the rule first assigns it — so free text stays allowed here.
              <div className="w-56">
                <IconSelect
                  options={categoryIconSelectOptions(categories)}
                  value={action.fieldValue}
                  onChange={(fieldValue) => updateAction(index, { fieldValue })}
                  placeholder="Restaurant"
                  ariaLabel="Category to set"
                />
              </div>
            ) : (
              <input
                value={action.fieldValue}
                onChange={(event) => updateAction(index, { fieldValue: event.target.value })}
                placeholder={action.fieldName === "vendor" ? "TGI Friday" : "value"}
                className={`${INPUT_CLASS} w-56`}
              />
            )}
            {form.actions.length > 1 && (
              <button
                type="button"
                onClick={() => removeAction(index)}
                aria-label="Remove this assignment"
                className="text-xs text-muted hover:text-red-400"
              >
                Remove
              </button>
            )}
          </div>
        ))}
        <div>
          <Button size="sm" variant="secondary" onClick={addAction}>
            + Add another field
          </Button>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={form.isEnabled}
          onChange={(event) => setForm({ ...form, isEnabled: event.target.checked })}
        />
        Enabled
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={handlePreview}
          disabled={isChecking || form.pattern.trim() === ""}
        >
          {isChecking ? "Checking…" : "Test this pattern"}
        </Button>
        {preview && (
          <span className="text-xs text-muted">
            Matches <strong className="text-ink">{preview.matchCount}</strong> existing transaction(s)
            {preview.samples.length > 0 && (
              <>
                {" "}
                — e.g. <span className="font-mono">{preview.samples.slice(0, 2).join(", ")}</span>
              </>
            )}
          </span>
        )}
      </div>

      <div className="flex gap-2">
        <Button size="sm" onClick={handleSave} disabled={isSaving}>
          {isSaving ? "Saving…" : editing ? "Save rule" : "Add rule"}
        </Button>
        {editing && (
          <Button size="sm" variant="secondary" onClick={onDone} disabled={isSaving}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * What to call a rule on screen. Every rule saved since migration 0065 has a name;
 * the fallback covers the one row that can still be blank — a pre-0065 rule whose
 * pattern was whitespace-only, which never matches anything anyway.
 */
function ruleDisplayName(rule: { name: string; pattern: string }): string {
  return rule.name.trim() || rule.pattern;
}

/** Formats one processed row for the run log. */
function logLine(entry: CleanupLogEntry, index: number, total: number): string {
  const head = `Processing ${index} of ${total} — #${entry.transactionId} ${entry.description}`;
  if (!entry.pattern) return `${head} — no rule matched`;
  // The name reads better in a log than the glob did, but a pre-0065 rule may not
  // have one, so the pattern stays the fallback.
  const label = entry.ruleName?.trim() || entry.pattern;
  if (entry.changes.length === 0) return `${head} — rule "${label}" matched, nothing to change`;
  const changes = entry.changes
    .map((change) => `${RULE_ACTION_FIELD_LABELS[change.fieldName].toLowerCase()} set to "${change.value}"`)
    .join(", ");
  return `${head} — rule "${label}" used, ${changes}`;
}

function CleanupRunner({ unprocessedCount }: { unprocessedCount: number }) {
  const router = useRouter();
  const [isRunning, setIsRunning] = useState(false);
  const [total, setTotal] = useState(0);
  const [done, setDone] = useState(0);
  const [changed, setChanged] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | undefined>(undefined);

  async function handleRun() {
    setIsRunning(true);
    setError(undefined);
    setLog([]);
    setDone(0);
    setChanged(0);

    try {
      const countResult = await countUnprocessedAction();
      const queueSize = countResult.count ?? 0;
      setTotal(queueSize);
      if (queueSize === 0) {
        setLog(["Nothing to process — every transaction has already been through the rules."]);
        return;
      }

      let completed = 0;
      let changedSoFar = 0;

      // Loop a batch at a time so the bar and log can move; the processed flag
      // is the queue, so an interrupted run simply resumes next time.
      for (;;) {
        const result = await runCleanupBatchAction(DEFAULT_CLEANUP_BATCH_SIZE);
        if (!result.ok || !result.result) {
          setError(result.error ?? "Clean-up failed.");
          return;
        }

        const batch = result.result;
        const lines = batch.entries.map((entry, index) =>
          logLine(entry, completed + index + 1, queueSize),
        );
        completed += batch.processedCount;
        changedSoFar += batch.changedCount;

        setLog((current) => [...current, ...lines]);
        setDone(completed);
        setChanged(changedSoFar);

        // processedCount of 0 means the queue is empty — stop rather than spin.
        if (batch.remainingCount === 0 || batch.processedCount === 0) break;
      }

      setLog((current) => [
        ...current,
        `Done. Processed ${completed} transaction(s); ${changedSoFar} changed by a rule.`,
      ]);
      await refreshExpenseViewAction();
      router.refresh();
    } finally {
      setIsRunning(false);
    }
  }

  async function handleReset() {
    if (
      !window.confirm(
        "Re-queue every transaction so the rules run over them again? Existing values are still never overwritten.",
      )
    ) {
      return;
    }
    const result = await resetProcessedAction();
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setLog([`Re-queued ${result.count ?? 0} transaction(s). Run the clean-up to process them.`]);
    router.refresh();
  }

  const percent = total === 0 ? 0 : Math.round((done / total) * 100);

  return (
    <div className="flex flex-col gap-3 rounded-md border border-line bg-paper p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={handleRun} disabled={isRunning}>
          {isRunning ? "Running…" : "Manually Run Import Clean up"}
        </Button>
        <Button size="sm" variant="secondary" onClick={handleReset} disabled={isRunning}>
          Re-queue all
        </Button>
        <span className="text-xs text-muted">
          {unprocessedCount} transaction(s) awaiting processing
        </span>
      </div>

      {(isRunning || done > 0) && total > 0 && (
        <div>
          <div className="flex items-center justify-between text-xs text-muted">
            <span>
              Processing {done} of {total} ({changed} changed)
            </span>
            <span>{percent}%</span>
          </div>
          <Progress3D
            value={done}
            max={total}
            ariaLabel="Cleanup progress"
            className="mt-1"
          />
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      {log.length > 0 && (
        <pre className="max-h-64 overflow-auto rounded-md border border-line bg-paper-raised p-2 font-mono text-[11px] leading-5 text-ink">
          {log.join("\n")}
        </pre>
      )}
    </div>
  );
}

export function ExpenseRulesView({
  rules,
  categories,
  unprocessedCount,
  prefillName,
  prefillDescription,
  prefillPattern,
}: {
  rules: PostImportRule[];
  categories: ExpenseCategory[];
  unprocessedCount: number;
  /**
   * From ?name= / ?description= on the transaction-rules route, so "add a rule
   * for this" can be a plain link that arrives with the form part-filled.
   */
  prefillName?: string;
  prefillDescription?: string;
  /** Seeds "When the description matches" — the raw statement line to match on. */
  prefillPattern?: string;
}) {
  const [editing, setEditing] = useState<PostImportRule | undefined>(undefined);
  // A rule action stores a category *name*, so its icon is looked up once here.
  const categoryIconUrls = categoryIconUrlsByName(categories);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        Rules read the raw description from your statement and fill in the fields for you — for
        example <span className="font-mono">*TGI*</span> setting the vendor to{" "}
        <span className="font-mono">TGI Friday</span> and the category to{" "}
        <span className="font-mono">Restaurant</span>. They run during import, and whenever you run
        the clean-up below.
      </p>

      <PatternHelp />

      <CleanupRunner unprocessedCount={unprocessedCount} />

      <RuleForm
        key={
          editing?.id ??
          `new:${prefillName ?? ""}:${prefillDescription ?? ""}:${prefillPattern ?? ""}`
        }
        categories={categories}
        editing={editing}
        prefillName={prefillName}
        prefillDescription={prefillDescription}
        prefillPattern={prefillPattern}
        onDone={() => setEditing(undefined)}
      />

      {rules.length === 0 ? (
        <p className="text-sm text-muted">No rules yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {rules.map((rule) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              categoryIconUrls={categoryIconUrls}
              onEdit={() => setEditing(rule)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/** Line break for the confirm dialog, which takes plain text rather than JSX. */
const NEWLINE = "\n";

/**
 * The warning shown before a forced run. Names the fields that will actually be
 * overwritten and the ones that won't, because the whole risk of this button is
 * changing a field the user wasn't thinking about.
 */
function forcedRunWarning(rule: PostImportRule): string {
  const fields = [...new Set(rule.actions.map((action) => action.fieldName))];
  const overwritten = fields.filter((field) => field !== "status");
  const labels = overwritten.map((field) => RULE_ACTION_FIELD_LABELS[field]).join(", ");

  const lines = [
    `Re-run "${ruleDisplayName(rule)}" over every transaction matching ${rule.pattern}?`,
    "",
  ];

  if (overwritten.length === 0) {
    lines.push("This rule only sets Status, which is never overwritten, so nothing will change.");
    return lines.join(NEWLINE);
  }

  lines.push(
    `This OVERWRITES ${labels} on every matching transaction, including rows you have already edited by hand. It cannot be undone.`,
  );
  if (fields.includes("status")) {
    lines.push("", "Status will NOT be changed — reconciled rows keep their status.");
  }
  if (!rule.isEnabled) {
    lines.push("", "Note: this rule is disabled, but running it here will still change transactions.");
  }
  return lines.join(NEWLINE);
}

/**
 * One saved rule, with its row actions.
 *
 * Its own component so "Update Trans" can hold a per-row busy state — a shared
 * one would grey out every rule's button while a single rule ran.
 */
function RuleRow({
  rule,
  categoryIconUrls,
  onEdit,
}: {
  rule: PostImportRule;
  categoryIconUrls: Map<string, string>;
  onEdit: () => void;
}) {
  const router = useRouter();
  const [isApplying, setIsApplying] = useState(false);

  async function handleUpdateExisting() {
    if (!window.confirm(forcedRunWarning(rule))) return;
    setIsApplying(true);
    try {
      const result = await applyRuleToExistingAction(rule.id);
      if (!result.ok) {
        window.alert(result.error);
        return;
      }
      const matched = result.matchedCount ?? 0;
      const changed = result.changedCount ?? 0;
      window.alert(
        matched === 0
          ? `No transactions match "${rule.pattern}", so nothing changed.`
          : `Matched ${matched} transaction(s); ${changed} updated.` +
              (changed < matched ? " The rest already held these values." : ""),
      );
      router.refresh();
    } finally {
      setIsApplying(false);
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-paper px-3 py-1.5 text-sm">
      <span className="font-medium text-ink">{ruleDisplayName(rule)}</span>
      <span className="font-mono text-xs text-brass-dark">{rule.pattern}</span>
      <span className="text-muted">&rarr;</span>
      <span className="flex flex-wrap items-center gap-1">
        {rule.actions.map((action) => (
          <span key={action.id} className="flex items-center gap-1">
            {action.fieldName === "categoryName" && (
              <CategoryIconThumbnail
                iconUrl={categoryIconUrls.get(action.fieldValue)}
                className="h-4 w-4"
              />
            )}
            <span className="rounded-full bg-brass-soft px-2 py-0.5 text-xs text-brass-dark">
              {RULE_ACTION_FIELD_LABELS[action.fieldName]} = {action.fieldValue || "(blank)"}
            </span>
          </span>
        ))}
      </span>
      <span className="text-xs text-muted">priority {rule.priority}</span>
      {!rule.isEnabled && <span className="text-xs text-red-400">disabled</span>}
      <span className="ml-auto flex gap-3">
        <button
          type="button"
          onClick={handleUpdateExisting}
          disabled={isApplying}
          title="Update existing transactions by overwriting"
          className="text-xs font-medium text-brass-dark hover:underline disabled:opacity-50"
        >
          {isApplying ? "Updating…" : "Update Trans"}
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="text-xs font-medium text-brass-dark hover:underline"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={async () => {
            if (!window.confirm(`Delete the rule "${ruleDisplayName(rule)}"?`)) return;
            const result = await deleteRuleAction(rule.id);
            if (result.ok) router.refresh();
            else window.alert(result.error);
          }}
          className="text-xs font-medium text-red-400 hover:underline"
        >
          Delete
        </button>
      </span>
      {rule.description.trim() !== "" && (
        <span className="basis-full text-xs text-muted">{rule.description}</span>
      )}
      <span className="basis-full text-xs text-muted">
        <strong className="font-medium text-ink">Update Trans</strong> updates existing
        transactions by overwriting.
      </span>
    </li>
  );
}
