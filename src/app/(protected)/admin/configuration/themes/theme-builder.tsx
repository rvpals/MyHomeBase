"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/button";
import { ColorField } from "@/components/color-field";
import { Modal } from "@/components/modal";
import {
  checkThemeContrast,
  colorThemeWriteSchema,
  slugifyThemeName,
} from "@/lib/color-themes";
import {
  COLOR_TOKEN_KEYS,
  FONT_KEYS,
  FONT_LABELS,
  type ColorThemeTokens,
  type ColorTokenKey,
  type FontKey,
} from "@/lib/settings";

/** What each token paints, so the nine pickers are not nine mystery colors. */
const TOKEN_LABELS: Record<ColorTokenKey, { label: string; hint: string }> = {
  paper: { label: "Paper", hint: "The page background." },
  paperRaised: { label: "Paper raised", hint: "Cards and panels sitting on the page." },
  ink: { label: "Ink", hint: "Body text and headings." },
  line: { label: "Line", hint: "Borders and dividers. Deliberately quiet." },
  muted: { label: "Muted", hint: "Secondary text, captions, labels." },
  mutedInverse: { label: "Muted inverse", hint: "Dimmed text on an accent fill." },
  brass: { label: "Brass", hint: "The accent: active nav, icons, primary buttons." },
  brassDark: { label: "Brass dark", hint: "Accent text — must be legible on Brass soft." },
  brassSoft: { label: "Brass soft", hint: "A tinted fill behind accent text." },
};

const FONT_SLOTS = [
  { key: "display" as const, label: "Display", hint: "Headings and the wordmark." },
  { key: "body" as const, label: "Body", hint: "Everything you read." },
  { key: "mono" as const, label: "Mono", hint: "Numbers, codes, eyebrow labels." },
];

export interface ThemeBuilderValue {
  id: string;
  name: string;
  description: string;
  tokens: ColorThemeTokens;
}

export interface ThemeBuilderProps {
  /** `"create"` derives the id from the name; `"edit"` shows it read-only. */
  mode: "create" | "edit";
  initial: ThemeBuilderValue;
  /** True when editing one of the eight seeded themes — shown as a note, not a block. */
  isBuiltin?: boolean;
  onSave: (value: ThemeBuilderValue) => Promise<void>;
  onClose: () => void;
  isSaving?: boolean;
  /** Server-side failure, shown above the footer. */
  error?: string;
}

export function ThemeBuilder({
  mode,
  initial,
  isBuiltin = false,
  onSave,
  onClose,
  isSaving = false,
  error,
}: ThemeBuilderProps) {
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [tokens, setTokens] = useState<ColorThemeTokens>(initial.tokens);

  // On create the id follows the name, because an id is permanent and asking for one
  // separately invites a typo nobody can fix later. On edit it is frozen: changing it
  // would orphan the `color_theme` setting pointing at it.
  const id = mode === "create" ? slugifyThemeName(name) : initial.id;

  const setToken = (key: ColorTokenKey, value: string) =>
    setTokens((current) => ({ ...current, [key]: value }));

  const setFont = (slot: "display" | "body" | "mono", value: FontKey) =>
    setTokens((current) => ({ ...current, fonts: { ...current.fonts, [slot]: value } }));

  // Validation and contrast both recompute on every keystroke. Cheap — nine regex tests
  // and ten luminance calculations — and it is what makes the warnings live.
  const parsed = useMemo(
    () => colorThemeWriteSchema.safeParse({ id, name, description, tokens, sortOrder: 100 }),
    [id, name, description, tokens],
  );

  /** Field-level messages, keyed by token, from the same schema the server runs. */
  const fieldErrors = useMemo(() => {
    if (parsed.success) return {} as Partial<Record<ColorTokenKey, string>>;
    const errors: Partial<Record<ColorTokenKey, string>> = {};
    for (const issue of parsed.error.issues) {
      const [first, second] = issue.path;
      if (first === "tokens" && typeof second === "string") {
        errors[second as ColorTokenKey] ??= issue.message;
      }
    }
    return errors;
  }, [parsed]);

  const idError = useMemo(() => {
    if (parsed.success) return undefined;
    return parsed.error.issues.find((issue) => issue.path[0] === "id")?.message;
  }, [parsed]);

  const nameError = useMemo(() => {
    if (parsed.success) return undefined;
    return parsed.error.issues.find((issue) => issue.path[0] === "name")?.message;
  }, [parsed]);

  const findings = useMemo(() => checkThemeContrast(tokens), [tokens]);
  const failures = findings.filter((finding) => finding.fails);

  const handleSave = async () => {
    if (!parsed.success) return;
    await onSave({ id, name: name.trim(), description: description.trim(), tokens });
  };

  return (
    <Modal
      title={mode === "create" ? "New color theme" : `Edit ${initial.name}`}
      description={
        isBuiltin
          ? "This is a built-in theme. Your changes replace it everywhere, and you can reset it back at any time."
          : "Colors apply to the whole application once saved."
      }
      onClose={onClose}
      isBusy={isSaving}
      size="full"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving || !parsed.success}>
            {isSaving ? "Saving…" : "Save theme"}
          </Button>
        </>
      }
    >
      {/* Two columns on a desktop, stacked on a phone. The preview is the taller half,
          so it goes second — on a narrow screen you scroll to it after the pickers. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label
                htmlFor="theme-name"
                className="block text-xs font-medium uppercase tracking-wider text-muted"
              >
                Name
              </label>
              <input
                id="theme-name"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={isSaving}
                className={`mt-1.5 w-full rounded-lg border bg-paper-raised px-2.5 py-1.5 text-sm text-ink outline-none transition focus:border-brass ${
                  nameError ? "border-red-400" : "border-line"
                }`}
              />
              <p className={`mt-1 text-xs ${nameError ? "text-red-400" : "text-muted"}`}>
                {nameError ??
                  (mode === "create"
                    ? `Saved as "${id || "…"}" — the id is permanent.`
                    : `Id: ${initial.id} (permanent)`)}
              </p>
              {idError && mode === "create" && (
                <p className="mt-1 text-xs text-red-400">{idError}</p>
              )}
            </div>

            <div className="sm:col-span-2">
              <label
                htmlFor="theme-description"
                className="block text-xs font-medium uppercase tracking-wider text-muted"
              >
                Description
              </label>
              <input
                id="theme-description"
                type="text"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                disabled={isSaving}
                placeholder="One line, shown on the picker card."
                className="mt-1.5 w-full rounded-lg border border-line bg-paper-raised px-2.5 py-1.5 text-sm text-ink outline-none transition focus:border-brass"
              />
            </div>

            {COLOR_TOKEN_KEYS.map((key) => (
              <ColorField
                key={key}
                label={TOKEN_LABELS[key].label}
                hint={TOKEN_LABELS[key].hint}
                error={fieldErrors[key]}
                value={tokens[key]}
                onChange={(next) => setToken(key, next)}
                disabled={isSaving}
              />
            ))}

            {FONT_SLOTS.map((slot) => (
              <div key={slot.key}>
                <label
                  htmlFor={`theme-font-${slot.key}`}
                  className="block text-xs font-medium uppercase tracking-wider text-muted"
                >
                  {slot.label} font
                </label>
                <select
                  id={`theme-font-${slot.key}`}
                  value={tokens.fonts[slot.key]}
                  onChange={(event) => setFont(slot.key, event.target.value as FontKey)}
                  disabled={isSaving}
                  className="mt-1.5 w-full rounded-lg border border-line bg-paper-raised px-2.5 py-1.5 text-sm text-ink outline-none transition focus:border-brass"
                >
                  {FONT_KEYS.map((font) => (
                    <option key={font} value={font}>
                      {FONT_LABELS[font]}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-muted">{slot.hint}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <ThemePreview name={name || "Untitled theme"} tokens={tokens} />
          <ContrastReport findings={findings} failureCount={failures.length} />
        </div>
      </div>

      {error && (
        <p className="mt-4 rounded-lg border border-red-400/40 bg-red-400/10 px-3 py-2 text-sm text-red-400">
          {error}
        </p>
      )}
    </Modal>
  );
}

/**
 * The theme drawn with its own colors, using inline styles rather than token classes.
 *
 * It has to: `bg-paper` resolves to the CSS variable of the theme currently *active*, so
 * a preview built from utilities would show the old theme with new labels. Inline styles
 * are the one legitimate exception to design.md's token rule — the values here are the
 * subject of the screen, not styling choices.
 */
function ThemePreview({ name, tokens }: { name: string; tokens: ColorThemeTokens }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wider text-muted">Preview</p>
      <div
        className="mt-1.5 overflow-hidden rounded-xl border"
        style={{ backgroundColor: tokens.paper, borderColor: tokens.line }}
      >
        <div
          className="flex items-center gap-2 border-b px-4 py-2.5"
          style={{ borderColor: tokens.line, backgroundColor: tokens.paperRaised }}
        >
          <span
            className="grid h-6 w-6 place-items-center rounded-md text-xs font-bold"
            style={{ backgroundColor: tokens.brass, color: tokens.paper }}
          >
            M
          </span>
          <span className="text-sm font-semibold" style={{ color: tokens.ink }}>
            {name}
          </span>
          <span
            className="ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider"
            style={{ backgroundColor: tokens.brassSoft, color: tokens.brassDark }}
          >
            Live
          </span>
        </div>

        <div className="space-y-3 p-4">
          <div>
            <p
              className="text-[10px] font-medium uppercase tracking-widest"
              style={{ color: tokens.brassDark }}
            >
              Configuration
            </p>
            <p className="mt-1 text-lg font-semibold" style={{ color: tokens.ink }}>
              Sample heading
            </p>
            <p className="mt-1 text-sm" style={{ color: tokens.muted }}>
              Secondary copy sits at this contrast against the page.
            </p>
          </div>

          <div
            className="rounded-lg border p-3"
            style={{ backgroundColor: tokens.paperRaised, borderColor: tokens.line }}
          >
            <p className="text-sm" style={{ color: tokens.ink }}>
              A card on the page
            </p>
            <p className="mt-0.5 text-xs" style={{ color: tokens.muted }}>
              Cards use the raised surface with a line border.
            </p>
            <p className="mt-2 font-mono text-xs" style={{ color: tokens.mutedInverse }}>
              1,428.60 USD
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span
              className="rounded-lg px-3 py-1.5 text-xs font-semibold"
              style={{ backgroundColor: tokens.brass, color: tokens.paper }}
            >
              Primary
            </span>
            <span
              className="rounded-lg border px-3 py-1.5 text-xs font-semibold"
              style={{ borderColor: tokens.line, color: tokens.ink }}
            >
              Secondary
            </span>
            <span className="ml-auto text-xs font-medium" style={{ color: tokens.brass }}>
              Accent link
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Every measured pair with its ratio. Warn-only by design — nothing here blocks Save.
 *
 * Shows passes as well as failures so the number means something: a list that only ever
 * appears when something is wrong is a list people learn to dismiss.
 */
function ContrastReport({
  findings,
  failureCount,
}: {
  findings: ReturnType<typeof checkThemeContrast>;
  failureCount: number;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wider text-muted">Contrast</p>
        <p className={`text-xs ${failureCount > 0 ? "text-amber-400" : "text-muted"}`}>
          {failureCount > 0
            ? `${failureCount} below target`
            : "All checked pairs meet their target"}
        </p>
      </div>

      <ul className="mt-1.5 divide-y divide-line overflow-hidden rounded-xl border border-line">
        {findings.map((finding) => (
          <li
            key={finding.id}
            className="flex items-center justify-between gap-3 bg-paper-raised px-3 py-2"
          >
            <span className="min-w-0 truncate text-xs text-ink">{finding.label}</span>
            <span className="flex shrink-0 items-center gap-2">
              <span
                className={`font-mono text-xs ${
                  finding.fails ? "text-amber-400" : "text-muted"
                }`}
              >
                {finding.ratio.toFixed(1)}:1
              </span>
              {finding.threshold === undefined ? (
                <span className="w-14 text-right text-[10px] uppercase tracking-wider text-muted-inverse">
                  info
                </span>
              ) : (
                <span
                  className={`w-14 text-right text-[10px] uppercase tracking-wider ${
                    finding.fails ? "text-amber-400" : "text-brass-dark"
                  }`}
                >
                  {finding.fails ? `needs ${finding.threshold}` : "pass"}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-1.5 text-xs text-muted">
        Warnings only — a low ratio never blocks saving. Pairs marked{" "}
        <span className="uppercase">info</span> are quiet on purpose, like borders.
      </p>
    </div>
  );
}
