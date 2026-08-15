"use client";

// The popup that builds a saved entry filter: one level of AND/OR groups, each
// holding conditions. Route-local — nothing outside My Journal builds one.
//
// The condition row is the thing that dictates the layout. On desktop it's a
// single line (field, operator, value, remove); below 1024px that's ~4 controls
// in 390px, so `max-lg:` stacks it into a labelled block instead. Restyled, not
// a different component — see design.md.

import { useState } from "react";
import { Button } from "@/components/button";
import { Modal } from "@/components/modal";
import {
  FIELD_LABELS,
  OPERATORS_BY_FIELD,
  describeFilter,
  emptyFilter,
  isListOperator,
  isRangeOperator,
  isValuelessOperator,
  type JournalFilter,
  type JournalFilterCondition,
  type JournalFilterField,
  type JournalFilterJoin,
  type JournalFilterOperator,
  type SavedJournalFilter,
} from "@/lib/journal";

const INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-2 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

const FIELDS = Object.keys(FIELD_LABELS) as JournalFilterField[];

/** Fields whose value is picked from a known list rather than typed. */
const TAXONOMY_FIELDS: ReadonlySet<JournalFilterField> = new Set(["category", "tag"]);

function operatorLabel(operator: JournalFilterOperator): string {
  switch (operator) {
    case "contains": return "contains";
    case "notContains": return "does not contain";
    case "equals": return "is";
    case "before": return "is before";
    case "after": return "is after";
    case "between": return "is between";
    case "hasAny": return "is any of";
    case "hasNone": return "is none of";
    case "is": return "is";
    case "isEmpty": return "is empty";
    case "isNotEmpty": return "is not empty";
  }
}

/** A date field gets a date picker, a time field a time picker, else plain text. */
function inputTypeFor(field: JournalFilterField): string {
  if (field === "date") return "date";
  if (field === "time") return "time";
  return "text";
}

function ConditionRow({
  condition,
  categoryOptions,
  tagOptions,
  onChange,
  onRemove,
}: {
  condition: JournalFilterCondition;
  categoryOptions: string[];
  tagOptions: string[];
  onChange: (next: JournalFilterCondition) => void;
  onRemove: () => void;
}) {
  const operators = OPERATORS_BY_FIELD[condition.field] ?? [];
  const isTaxonomy = TAXONOMY_FIELDS.has(condition.field);
  const names = condition.field === "category" ? categoryOptions : tagOptions;
  const isBoolean = condition.field === "isPinned" || condition.field === "isLocked";

  function changeField(field: JournalFilterField) {
    // Switching field usually invalidates the operator, so fall back to that
    // field's first one. `value` is deliberately kept: a user who typed "Rome"
    // and then realised they meant Place rather than Title shouldn't retype it.
    const nextOperators = OPERATORS_BY_FIELD[field] ?? [];
    const operator = nextOperators.includes(condition.operator) ? condition.operator : nextOperators[0];
    onChange({ ...condition, field, operator });
  }

  return (
    <div className="flex flex-wrap items-start gap-2 rounded-md border border-line bg-paper p-2 max-lg:flex-col max-lg:items-stretch">
      <label className="min-w-0 max-lg:w-full">
        <span className="mb-1 hidden text-xs font-medium text-muted max-lg:block">Field</span>
        <select
          value={condition.field}
          onChange={(event) => changeField(event.target.value as JournalFilterField)}
          aria-label="Field"
          className={`${INPUT_CLASS} lg:w-32`}
        >
          {FIELDS.map((field) => (
            <option key={field} value={field}>
              {FIELD_LABELS[field]}
            </option>
          ))}
        </select>
      </label>

      <label className="min-w-0 max-lg:w-full">
        <span className="mb-1 hidden text-xs font-medium text-muted max-lg:block">Condition</span>
        <select
          value={condition.operator}
          onChange={(event) =>
            onChange({ ...condition, operator: event.target.value as JournalFilterOperator })
          }
          aria-label="Operator"
          className={`${INPUT_CLASS} lg:w-40`}
        >
          {operators.map((operator) => (
            <option key={operator} value={operator}>
              {operatorLabel(operator)}
            </option>
          ))}
        </select>
      </label>

      {/* The value control depends on the operator, which is why this isn't one
          input: a range needs two, a taxonomy needs a multi-select, and
          isEmpty/isNotEmpty need none at all. */}
      {!isValuelessOperator(condition.operator) && (
        <div className="min-w-0 flex-1 max-lg:w-full">
          <span className="mb-1 hidden text-xs font-medium text-muted max-lg:block">Value</span>
          {isTaxonomy && isListOperator(condition.operator) ? (
            <select
              multiple
              value={condition.values ?? []}
              onChange={(event) =>
                onChange({
                  ...condition,
                  values: Array.from(event.target.selectedOptions, (option) => option.value),
                })
              }
              aria-label="Values"
              className={`${INPUT_CLASS} h-24`}
            >
              {names.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          ) : isBoolean ? (
            <select
              value={condition.value ?? "true"}
              onChange={(event) => onChange({ ...condition, value: event.target.value })}
              aria-label="Value"
              className={INPUT_CLASS}
            >
              <option value="true">yes</option>
              <option value="false">no</option>
            </select>
          ) : isRangeOperator(condition.operator) ? (
            <div className="flex items-center gap-2">
              <input
                type={inputTypeFor(condition.field)}
                value={condition.value ?? ""}
                onChange={(event) => onChange({ ...condition, value: event.target.value })}
                aria-label="From"
                className={INPUT_CLASS}
              />
              <span className="shrink-0 text-xs text-muted">and</span>
              <input
                type={inputTypeFor(condition.field)}
                value={condition.valueTo ?? ""}
                onChange={(event) => onChange({ ...condition, valueTo: event.target.value })}
                aria-label="To"
                className={INPUT_CLASS}
              />
            </div>
          ) : (
            <input
              type={inputTypeFor(condition.field)}
              value={condition.value ?? ""}
              onChange={(event) => onChange({ ...condition, value: event.target.value })}
              aria-label="Value"
              className={INPUT_CLASS}
            />
          )}
        </div>
      )}

      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove condition"
        title="Remove condition"
        className="shrink-0 rounded-md px-2 py-1.5 text-sm text-muted hover:text-red-400 max-lg:self-end"
      >
        &times;
      </button>
    </div>
  );
}

function JoinToggle({
  value,
  onChange,
  label,
}: {
  value: JournalFilterJoin;
  onChange: (next: JournalFilterJoin) => void;
  label: string;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-xs text-muted">{label}</span>
      {(["AND", "OR"] as JournalFilterJoin[]).map((join) => (
        <button
          key={join}
          type="button"
          onClick={() => onChange(join)}
          aria-pressed={value === join}
          className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
            value === join
              ? "bg-brass-soft text-brass-dark"
              : "border border-line text-muted hover:text-ink"
          }`}
        >
          {join}
        </button>
      ))}
    </span>
  );
}

export function JournalFilterBuilder({
  existing,
  categoryOptions,
  tagOptions,
  onClose,
  onSave,
}: {
  /** The filter being edited, or undefined to build a new one. */
  existing?: SavedJournalFilter;
  categoryOptions: string[];
  tagOptions: string[];
  onClose: () => void;
  onSave: (name: string, filter: JournalFilter) => Promise<void>;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [filter, setFilter] = useState<JournalFilter>(existing?.filter ?? emptyFilter());
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  function updateGroup(groupIndex: number, next: JournalFilter["groups"][number]) {
    setFilter((current) => ({
      ...current,
      groups: current.groups.map((group, index) => (index === groupIndex ? next : group)),
    }));
  }

  function addCondition(groupIndex: number) {
    const group = filter.groups[groupIndex];
    updateGroup(groupIndex, {
      ...group,
      conditions: [...group.conditions, { field: "title", operator: "contains", value: "" }],
    });
  }

  async function handleSave() {
    setError(undefined);
    if (name.trim() === "") {
      setError("Give the filter a name.");
      return;
    }
    setIsBusy(true);
    try {
      await onSave(name.trim(), filter);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save the filter.");
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <Modal
      title={existing ? `Edit filter: ${existing.name}` : "New filter"}
      description="Conditions inside a group combine with the group's AND/OR; the groups combine with each other the same way."
      size="lg"
      onClose={onClose}
      isBusy={isBusy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isBusy}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isBusy}>
            {isBusy ? "Saving…" : "Save filter"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <p className="text-sm text-red-400">{error}</p>}

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Filter name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Trips in 2026"
            className={INPUT_CLASS}
          />
          {/* Saving over an existing name replaces it — worth saying, since the
              table's UNIQUE (name) makes that an upsert rather than an error. */}
          <span className="mt-1 block text-xs text-muted">
            Saving with an existing name replaces that filter.
          </span>
        </label>

        {filter.groups.length > 1 && (
          <JoinToggle
            label="Combine groups with"
            value={filter.join}
            onChange={(join) => setFilter((current) => ({ ...current, join }))}
          />
        )}

        {filter.groups.map((group, groupIndex) => (
          <div key={groupIndex} className="flex flex-col gap-2 rounded-lg border border-line bg-paper-raised p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                Group {groupIndex + 1}
              </span>
              <div className="flex items-center gap-3">
                {group.conditions.length > 1 && (
                  <JoinToggle
                    label="Match"
                    value={group.join}
                    onChange={(join) => updateGroup(groupIndex, { ...group, join })}
                  />
                )}
                {filter.groups.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      setFilter((current) => ({
                        ...current,
                        groups: current.groups.filter((_, index) => index !== groupIndex),
                      }))
                    }
                    className="text-xs text-muted hover:text-red-400"
                  >
                    Remove group
                  </button>
                )}
              </div>
            </div>

            {group.conditions.length === 0 ? (
              <p className="text-sm text-muted">No conditions yet.</p>
            ) : (
              group.conditions.map((condition, conditionIndex) => (
                <ConditionRow
                  key={conditionIndex}
                  condition={condition}
                  categoryOptions={categoryOptions}
                  tagOptions={tagOptions}
                  onChange={(next) =>
                    updateGroup(groupIndex, {
                      ...group,
                      conditions: group.conditions.map((item, index) =>
                        index === conditionIndex ? next : item,
                      ),
                    })
                  }
                  onRemove={() =>
                    updateGroup(groupIndex, {
                      ...group,
                      conditions: group.conditions.filter((_, index) => index !== conditionIndex),
                    })
                  }
                />
              ))
            )}

            <div>
              <Button size="sm" variant="secondary" onClick={() => addCondition(groupIndex)}>
                Add condition
              </Button>
            </div>
          </div>
        ))}

        <div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              setFilter((current) => ({
                ...current,
                groups: [...current.groups, { join: "AND", conditions: [] }],
              }))
            }
          >
            Add group
          </Button>
        </div>

        {/* The same description the Entries screen shows, so what you're building
            is legible before you save it. */}
        <div className="rounded-md border border-line bg-paper p-3">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted">
            Reads as
          </span>
          <p className="text-sm text-ink">{describeFilter(filter)}</p>
        </div>
      </div>
    </Modal>
  );
}
