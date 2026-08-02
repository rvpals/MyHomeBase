"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import {
  TRANSACTION_STATUSES,
  type CategoryRule,
  type ExpenseCategory,
  type TransactionStatus,
} from "@/lib/expense";
import {
  applyRulesAction,
  deleteRuleAction,
  previewPatternAction,
  saveRuleAction,
} from "./expense-actions";

const INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

/**
 * How the matching works, in the user's terms. Kept next to the pattern field
 * because the rules only pay off if it's obvious what a pattern will catch.
 */
function PatternHelp() {
  return (
    <div className="rounded-md border border-line bg-paper p-3 text-xs text-muted">
      <p className="font-medium text-ink">How patterns work</p>
      <ul className="mt-2 flex list-disc flex-col gap-1 pl-4">
        <li>
          <code className="font-mono text-brass-dark">*</code> stands for &ldquo;anything&rdquo;.{" "}
          <code className="font-mono text-brass-dark">AMAZON*</code> matches descriptions that{" "}
          <em>start with</em> AMAZON — e.g. <span className="font-mono">AMAZON MKTPL*2X4Y9</span>.
        </li>
        <li>
          Wrap it in stars to match anywhere:{" "}
          <code className="font-mono text-brass-dark">*UBER*</code> catches{" "}
          <span className="font-mono">SQ *UBER TRIP</span>.
        </li>
        <li>
          A pattern with <strong>no</strong> <code className="font-mono text-brass-dark">*</code>{" "}
          matches anywhere by default — typing{" "}
          <code className="font-mono text-brass-dark">COSTCO</code> is the same as{" "}
          <code className="font-mono text-brass-dark">*COSTCO*</code>.
        </li>
        <li>Matching ignores upper/lower case, and every other character is taken literally.</li>
        <li>
          When several rules match, the one with the lowest <strong>priority</strong> number wins —
          so put specific patterns (<span className="font-mono">AMAZON PRIME*</span>) above general
          ones (<span className="font-mono">AMAZON*</span>).
        </li>
        <li>
          Rules only fill in a <strong>blank</strong> category, so they never overwrite something you
          set yourself, and re-running them is safe.
        </li>
      </ul>
    </div>
  );
}

const emptyRule = {
  pattern: "",
  categoryName: "",
  applyStatus: "" as TransactionStatus | "",
  priority: 0,
  isEnabled: true,
};

function RuleForm({
  categories,
  editing,
  onDone,
}: {
  categories: ExpenseCategory[];
  editing?: CategoryRule;
  onDone: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState(() =>
    editing
      ? {
          pattern: editing.pattern,
          categoryName: editing.categoryName,
          applyStatus: editing.applyStatus,
          priority: editing.priority,
          isEnabled: editing.isEnabled,
        }
      : emptyRule,
  );
  const [preview, setPreview] = useState<{ matchCount: number; samples: string[] } | undefined>(
    undefined,
  );
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);

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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">When the description matches</span>
          <input
            value={form.pattern}
            onChange={(event) => setForm({ ...form, pattern: event.target.value })}
            placeholder="AMAZON*"
            className={`${INPUT_CLASS} font-mono`}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Assign this category</span>
          <input
            list="expense-rule-category-options"
            value={form.categoryName}
            onChange={(event) => setForm({ ...form, categoryName: event.target.value })}
            placeholder="online-purchase"
            className={INPUT_CLASS}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">And set the status to</span>
          <select
            value={form.applyStatus}
            onChange={(event) =>
              setForm({ ...form, applyStatus: event.target.value as TransactionStatus | "" })
            }
            className={INPUT_CLASS}
          >
            <option value="">Leave the status alone</option>
            {TRANSACTION_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Priority</span>
          <input
            type="number"
            value={form.priority}
            onChange={(event) => setForm({ ...form, priority: Number(event.target.value) })}
            className={INPUT_CLASS}
          />
          <span className="mt-1 block text-xs text-muted">Lower numbers are checked first</span>
        </label>
      </div>

      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={form.isEnabled}
          onChange={(event) => setForm({ ...form, isEnabled: event.target.checked })}
        />
        Enabled
      </label>

      <datalist id="expense-rule-category-options">
        {categories.map((category) => (
          <option key={category.name} value={category.name} />
        ))}
      </datalist>

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

export function ExpenseRulesView({
  rules,
  categories,
}: {
  rules: CategoryRule[];
  categories: ExpenseCategory[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<CategoryRule | undefined>(undefined);
  const [runMessage, setRunMessage] = useState<string | undefined>(undefined);
  const [isRunning, setIsRunning] = useState(false);

  async function handleApplyRules() {
    setIsRunning(true);
    setRunMessage(undefined);
    try {
      const result = await applyRulesAction();
      if (!result.ok || !result.summary) {
        setRunMessage(result.error ?? "Failed to apply the rules.");
        return;
      }
      const { categorisedCount, examinedCount } = result.summary;
      setRunMessage(
        `Categorised ${categorisedCount} of ${examinedCount} uncategorised transaction(s).`,
      );
      router.refresh();
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        Rules read the raw description from your statement and fill in the category automatically —
        for example <span className="font-mono">AMAZON*</span> →{" "}
        <span className="font-mono">online-purchase</span>. They run during import and whenever you
        press &ldquo;Apply rules now&rdquo;.
      </p>

      <PatternHelp />

      <RuleForm
        key={editing?.id ?? "new"}
        categories={categories}
        editing={editing}
        onDone={() => setEditing(undefined)}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={handleApplyRules} disabled={isRunning}>
          {isRunning ? "Applying…" : "Apply rules now"}
        </Button>
        {runMessage && <span className="text-xs text-muted">{runMessage}</span>}
      </div>

      {rules.length === 0 ? (
        <p className="text-sm text-muted">No rules yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {rules.map((rule) => (
            <li
              key={rule.id}
              className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-paper px-3 py-1.5 text-sm"
            >
              <span className="font-mono text-xs text-brass-dark">{rule.pattern}</span>
              <span className="text-muted">→</span>
              <span className="text-ink">{rule.categoryName}</span>
              {rule.applyStatus !== "" && (
                <span className="text-xs text-muted">+ status: {rule.applyStatus}</span>
              )}
              <span className="text-xs text-muted">priority {rule.priority}</span>
              {!rule.isEnabled && <span className="text-xs text-red-400">disabled</span>}
              <span className="ml-auto flex gap-3">
                <button
                  type="button"
                  onClick={() => setEditing(rule)}
                  className="text-xs font-medium text-brass-dark hover:underline"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!window.confirm(`Delete the rule "${rule.pattern}"?`)) return;
                    const result = await deleteRuleAction(rule.id);
                    if (result.ok) router.refresh();
                    else window.alert(result.error);
                  }}
                  className="text-xs font-medium text-red-400 hover:underline"
                >
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
