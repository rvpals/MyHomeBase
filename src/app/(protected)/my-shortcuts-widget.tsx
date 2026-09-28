"use client";

// One-off home-screen widget (not a registered shared component) — the card is
// the My Shortcuts grid and nothing else will render it. The *picker* it opens
// is reusable and lives in `src/components/shortcut-picker.tsx`.
//
// Editing is inline rather than on the Account screen: a shortcut list you have
// to leave the home screen to change is a list nobody curates. The card holds
// the reader's own tiles, so the controls belong beside them.

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import {
  ShortcutPicker,
  type ShortcutIconIntent,
  type ShortcutPickerModule,
} from "@/components/shortcut-picker";
import { SlotIcon } from "@/components/slot-icon";
import { TreeIcon, hasTreeIcon } from "@/components/tree-icons";
import { getIconSlot } from "@/lib/icons";
import {
  DEFAULT_SHORTCUT_ICON,
  MAX_SHORTCUTS_PER_USER,
  canAddShortcut,
  type ResolvedShortcut,
  type ShortcutDraftInput,
} from "@/lib/user-shortcuts";
import {
  addShortcutAction,
  clearShortcutIconAction,
  editShortcutAction,
  moveShortcutAction,
  removeShortcutAction,
  uploadShortcutIconAction,
} from "./my-shortcuts-actions";

// Resolved once at module scope — `getIconSlot` reads the static registry, so
// this is not I/O. The guard is for the registry, not the user: a removed id
// costs the card its glyph rather than crashing it.
const CARD_SLOT = getIconSlot("homescreen_card_my_shortcuts");
const ADD_SLOT = getIconSlot("homescreen_shortcut_add");

/** What the edit dialog needs to reopen on the right values. */
interface EditingState {
  id: number;
  initial: Partial<ShortcutDraftInput> & { iconImageUrl?: string };
}

/**
 * The upload's payload.
 *
 * A `FormData` carrying the real `File`, not a base64 argument — the rule in
 * `coding-guide.md`, because a base64 string inflates ~33% against the
 * server-action body limit and Next rejects a long one outright with
 * "Maximum array nesting exceeded".
 */
function iconFormData(id: number, file: File): FormData {
  const data = new FormData();
  data.set("id", String(id));
  data.set("icon", file);
  return data;
}

export function MyShortcutsWidget({
  shortcuts,
  modules,
  className,
}: {
  /** Already resolved against this reader's tree — see `resolveShortcuts`. */
  shortcuts: ResolvedShortcut[];
  /** The modules the picker may browse, filtered to this reader by the page. */
  modules: ShortcutPickerModule[];
  /** Spacing is the caller's call — the card's position on the page is arrangeable. */
  className?: string;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<EditingState | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  // The dialog stays open on a failure so the reader can fix the field rather
  // than retyping everything — which is why closing is conditional on `ok`.
  //
  // An icon is a *second* write, sequenced after the first: a picture can only
  // be stored against a row that exists, so on Add the shortcut is created and
  // the upload posted against the id that comes back.
  async function save(draft: ShortcutDraftInput, icon: ShortcutIconIntent) {
    setBusy(true);
    setError(undefined);
    try {
      const result = editing
        ? await editShortcutAction(editing.id, draft)
        : await addShortcutAction(draft);
      if (!result.ok) {
        setError(result.error ?? "Failed to save the shortcut.");
        return;
      }

      const id = editing ? editing.id : result.createdId;
      if (id && icon.action !== "keep") {
        // The shortcut itself is already saved at this point, so a failure here
        // is reported against the picture alone — the dialog stays open, and
        // the text the reader typed is not lost to an image problem.
        const iconResult =
          icon.action === "upload"
            ? await uploadShortcutIconAction(iconFormData(id, icon.file))
            : await clearShortcutIconAction(id);

        if (!iconResult.ok) {
          setError(iconResult.error ?? "The shortcut was saved, but its picture was not.");
          return;
        }
      }

      setAdding(false);
      setEditing(undefined);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number, name: string) {
    if (!confirm(`Remove the "${name}" shortcut?`)) return;
    setBusy(true);
    try {
      const result = await removeShortcutAction(id);
      if (!result.ok) setError(result.error ?? "Failed to remove the shortcut.");
    } finally {
      setBusy(false);
    }
  }

  async function move(id: number, direction: "up" | "down") {
    setBusy(true);
    try {
      await moveShortcutAction(id, direction);
    } finally {
      setBusy(false);
    }
  }

  const full = !canAddShortcut(shortcuts.length);

  return (
    <>
      <CollapsibleCard
        title="My Shortcuts"
        titleIcon={CARD_SLOT ? <SlotIcon slot={CARD_SLOT} className="h-4 w-4" /> : undefined}
        defaultOpen
        className={className}
        headerAction={
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setError(undefined);
              setAdding(true);
            }}
            disabled={full || busy}
            title={full ? `You can keep up to ${MAX_SHORTCUTS_PER_USER} shortcuts.` : "Add a shortcut"}
          >
            {ADD_SLOT ? <SlotIcon slot={ADD_SLOT} className="h-4 w-4" /> : null}
            Add
          </Button>
        }
      >
        {shortcuts.length === 0 ? (
          <p className="py-2 text-sm text-muted">
            No shortcuts yet. Add one to jump straight to a page you use often, or to any
            address on the web.
          </p>
        ) : (
          // `tile-grid-lg`, not a hand-counted `grid-cols-4 max-lg:grid-cols-2`.
          // This is a variable-length collection of the same thing repeated, which
          // design.md ("Collections size themselves") says should let the browser
          // count columns: `compact` spans a 3.2x range of widths, so two fixed
          // states would give a 402px phone and an 810px iPad the same treatment.
          // The `-lg` variant (10-14rem) over plain `tile-grid` (5-7rem) because a
          // tile here carries a wrapping name under its glyph, not just a glyph.
          // `gap-y` is larger than `gap-x`: each tile casts a 4px offset shadow
          // below itself (and grows to 5px on hover), so the row beneath needs
          // clearance or the depth reads as a collision rather than a lift.
          <ul className="tile-grid-lg gap-x-3 gap-y-4 pb-1">
            {shortcuts.map((shortcut, index) => (
              <ShortcutTile
                key={shortcut.id}
                shortcut={shortcut}
                busy={busy}
                isFirst={index === 0}
                isLast={index === shortcuts.length - 1}
                onEdit={() => {
                  setError(undefined);
                  setEditing({ id: shortcut.id, initial: initialFor(shortcut) });
                }}
                onRemove={() => remove(shortcut.id, shortcut.name)}
                onMove={(direction) => move(shortcut.id, direction)}
              />
            ))}
          </ul>
        )}

        {/* An error from a tile action (delete, move) has no dialog to live in. */}
        {error && !adding && !editing && (
          <p role="alert" className="mt-3 text-sm text-red-400">
            {error}
          </p>
        )}
      </CollapsibleCard>

      {(adding || editing) && (
        <ShortcutPicker
          // Keyed so switching target remounts it. The picker seeds its fields
          // from `initial` in `useState`, which only runs on mount — without a
          // key, editing one shortcut and then another would reopen the dialog
          // still showing the first one's values.
          key={editing ? `edit-${editing.id}` : "add"}
          title={editing ? "Edit shortcut" : "Add a shortcut"}
          modules={modules}
          initial={editing?.initial}
          error={error}
          saving={busy}
          onSave={save}
          onClose={() => {
            setAdding(false);
            setEditing(undefined);
            setError(undefined);
          }}
        />
      )}
    </>
  );
}

/**
 * A resolved shortcut back to the draft shape the picker pre-fills from.
 *
 * Reads `target`, which carries the stored coordinates, rather than taking them
 * apart from `href` — a section's href is whatever its module's href builder
 * returns and is not guaranteed to be `/modules/<slug>/<section>`. It is also
 * the only thing an *unreachable* shortcut has, since that one has no href.
 */
function initialFor(
  shortcut: ResolvedShortcut,
): Partial<ShortcutDraftInput> & { iconImageUrl?: string } {
  const { target } = shortcut;
  // The picture comes along so the dialog can show what's already there — and
  // so "Remove picture" has something to remove. Display-only: it is never
  // re-uploaded, the dialog just reports whether it was dropped.
  const iconImageUrl = shortcut.iconImageUrl;

  return target.kind === "url"
    ? { kind: "url", name: shortcut.name, icon: shortcut.icon, url: target.url, iconImageUrl }
    : {
        kind: "section",
        name: shortcut.name,
        icon: shortcut.icon,
        moduleSlug: target.moduleSlug,
        sectionId: target.sectionId,
        iconImageUrl,
      };
}

function ShortcutTile({
  shortcut,
  busy,
  isFirst,
  isLast,
  onEdit,
  onRemove,
  onMove,
}: {
  shortcut: ResolvedShortcut;
  busy: boolean;
  isFirst: boolean;
  isLast: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onMove: (direction: "up" | "down") => void;
}) {
  // Whether this tile's action row is expanded. Per-tile and local: opening one
  // tile's actions has no bearing on any other, and nothing outside this tile
  // needs to know. Collapsed again after any action fires, so a row doesn't sit
  // open over a tile whose list has just been reordered underneath it.
  const [open, setOpen] = useState(false);

  // `TreeIcon` renders nothing for a concept it doesn't know, which is right in a
  // row where the label carries the meaning — but here the glyph is half the tile,
  // so a retired icon would leave a visible hole. Falls back to the default rather
  // than drawing blank. (`resolveShortcut` already handles a *blank* stored icon;
  // this covers one that was valid when saved and has since been removed.)
  const glyph = hasTreeIcon(shortcut.icon) ? shortcut.icon : DEFAULT_SHORTCUT_ICON;

  const body = (
    <>
      {shortcut.iconImageUrl ? (
        // The reader's own picture wins over the glyph. A plain `<img>`, not
        // `next/image`: these bytes come from a session-scoped API route the
        // optimizer cannot fetch, and they are already downscaled to 128px on
        // the way in, so there is nothing for it to do.
        //
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={shortcut.iconImageUrl}
          alt=""
          className="h-7 w-7 shrink-0 rounded object-contain"
        />
      ) : (
        <TreeIcon name={glyph} className="h-7 w-7 shrink-0 text-brass-dark" />
      )}
      <span className="mt-2 line-clamp-2 text-center text-sm font-medium text-ink">
        {shortcut.name}
      </span>
    </>
  );

  // `bg-paper-raised` rather than `bg-paper`: the tile stands off the page, and
  // the offset shadow below needs a surface a step up from the card behind it to
  // read against. Same fill as `Button`'s secondary variant, which this borrows
  // its whole mechanic from.
  const tile =
    "relative flex h-full min-h-24 flex-col items-center justify-center rounded-lg " +
    "border border-line bg-paper-raised p-3 text-center";

  return (
    // No `group` any more — nothing here reveals on hover. The action row is
    // toggled by its own gear, so this only needs to be the positioning parent.
    <li className="relative">
      {shortcut.reachable ? (
        <Link
          href={shortcut.href}
          // A URL shortcut leaves the app, so it opens in a new tab and carries
          // `noreferrer` — the destination is arbitrary and shouldn't be handed
          // this app's address. An in-app one navigates normally.
          {...(shortcut.kind === "url"
            ? { target: "_blank", rel: "noopener noreferrer" }
            : {})}
          className={`${tile} shortcut-tile hover:border-brass hover:bg-brass-soft`}
        >
          {body}
        </Link>
      ) : (
        // Shown rather than hidden: a tile that vanished would look like data
        // loss to the only person who can fix it. Not a link, because there is
        // nowhere to go.
        <div
          className={`${tile} shortcut-tile-dead cursor-not-allowed opacity-60`}
          title={shortcut.unreachableReason}
        >
          {body}
          <span className="mt-1 text-[0.65rem] uppercase tracking-wide text-muted">
            Unavailable
          </span>
        </div>
      )}

      {/* Row actions — deliberately hand-drawn glyphs and no icon slots, per the
          rules at the top of slots.ts.

          ALWAYS VISIBLE, AND OPENED BY A CLICK, NOT A HOVER. This was four chips
          revealed by `group-hover:opacity-100`, and on a desktop they never
          painted: the tile is a *sibling* of this row and `.shortcut-tile:hover`
          applies a `transform`, which promotes the tile to its own stacking
          context and paints it over an absolutely-positioned sibling. The chips
          reached `opacity: 1` and were covered — a `title` tooltip would show
          while the button behind it stayed invisible, and only a drag-select
          (forcing an uncomposited repaint) revealed them. A `z-index` did not
          fix it. So the reveal no longer depends on hover at all: one gear that
          is always painted, and a click expands the rest. That also gives a
          phone the same affordance instead of a permanently-open row. */}
      <div className="absolute right-1 top-1 z-10 flex items-start gap-0.5">
        {open && (
          <div className="flex gap-0.5">
            <TileButton
              label={`Move ${shortcut.name} earlier`}
              disabled={busy || isFirst}
              onClick={() => onMove("up")}
            >
              ‹
            </TileButton>
            <TileButton
              label={`Move ${shortcut.name} later`}
              disabled={busy || isLast}
              onClick={() => onMove("down")}
            >
              ›
            </TileButton>
            <TileButton
              label={`Edit ${shortcut.name}`}
              disabled={busy}
              onClick={() => {
                setOpen(false);
                onEdit();
              }}
            >
              ✎
            </TileButton>
            <TileButton
              label={`Remove ${shortcut.name}`}
              disabled={busy}
              onClick={() => {
                setOpen(false);
                onRemove();
              }}
            >
              ✕
            </TileButton>
          </div>
        )}

        {/* The gear is drawn inline rather than `<TreeIcon name="gear">`: `gear`
            marks the Configuration *section* in five modules, so it is a place a
            themed icon set may redraw in full colour. This is a 24px row-action
            control and has to stay a monochrome glyph, and adding `gear` to
            ALWAYS_CLASSIC to get that would change those five nav entries. */}
        <TileButton
          label={open ? `Hide actions for ${shortcut.name}` : `Actions for ${shortcut.name}`}
          disabled={false}
          expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3 w-3">
            <circle cx="12" cy="12" r="3.2" />
            <path
              d="M12 2.6v2.6M12 18.8v2.6M4.4 4.4l1.9 1.9M17.7 17.7l1.9 1.9M2.6 12h2.6M18.8 12h2.6M4.4 19.6l1.9-1.9M17.7 6.3l1.9-1.9"
              strokeLinecap="round"
            />
          </svg>
        </TileButton>
      </div>
    </li>
  );
}

function TileButton({
  label,
  disabled,
  onClick,
  expanded,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  /** Set on the gear only — renders `aria-expanded` for the row it toggles. */
  expanded?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-expanded={expanded}
      disabled={disabled}
      // The tile behind is a `<Link>` and this sits inside it visually but not in
      // the DOM. A click must not also reach the link's navigation, and on a
      // touch device `mousedown` would start the tile's press animation.
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
      // The accent pair, not a paper surface. This was `bg-paper border-line`
      // on the theory that stepping *down* a surface reads as a control sitting
      // on the `paper-raised` tile — but that only steps down on a dark theme.
      // The light themes (Daybreak, Sea Glass) deliberately invert the
      // relationship, so `paper` is a near-identical off-white against a white
      // tile: #F4F1F2 fill with an #E7E2E4 hairline on #FFFFFF is ~1.04:1, and
      // the whole action row was invisible on hover. `brass-soft`/`brass` is
      // defined per theme and contrasts in both polarities — and it's the same
      // accent the tile itself hovers to.
      // The glyph colour is `.shell-accent-text`, not `text-brass-dark`: on a
      // `brass-soft` fill neither raw token works across all eight themes
      // (brass-dark measures 3.0:1 on Daybreak, brass 3.2:1 on Signal Deck).
      // See the token's note in globals.css.
      // `h-6 w-6`, up from the old `h-5 w-5`: the gear is now permanent rather
      // than a hover reveal, so it is a real tap target on a phone.
      className="shell-accent-text flex h-6 w-6 items-center justify-center rounded
                 border border-brass bg-brass-soft text-xs leading-none
                 hover:text-ink disabled:opacity-50"
    >
      {children}
    </button>
  );
}
