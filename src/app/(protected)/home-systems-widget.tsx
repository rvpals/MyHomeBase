"use client";

// The Systems card: every module the reader can open, clustered by what it is for.
//
// One-off home-screen widget (not a registered shared component), like
// `today-in-history-widget.tsx` beside it — nothing else renders a system panel.
//
// Pure presentation. The grouping is `groupModulesBySystem` in
// `@/lib/home-systems`; the figures in the activity strips are read and summed in
// `page.tsx` from the same calls the TODO, Daily Glance and journal cards already
// make. This file decides only what is on screen.
//
// **The panel colour is a tint key, never a colour.** `.clip-tint` mixes the hue
// into the running theme's `--paper-raised` and `--line`, so a panel is a pale
// wash on Daybreak and a deep one on Copper Vault with no branching — design.md,
// "Tinted surfaces". The class names are spelled out in `TINT_CLASS` rather than
// built from the key, because Tailwind and the CSS bundle are scanned as source
// text and a composed class name is never emitted.

import Link from "next/link";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { ModuleIcon } from "@/components/module-icons";
import { Progress3D } from "@/components/progress-3d";
import { SlotIcon } from "@/components/slot-icon";
import type { HomeSystemId } from "@/lib/home-systems";
import { getIconSlot } from "@/lib/icons";
import { formatCents } from "@/lib/shared/money";
import type { TintColor } from "@/lib/shared/tint";

// Resolved once at module scope; the registry is static, so this is not I/O.
const SYSTEMS_SLOT = getIconSlot("homescreen_card_systems");

const SYSTEM_SLOTS: Record<HomeSystemId, ReturnType<typeof getIconSlot>> = {
  money: getIconSlot("homescreen_system_money"),
  journal: getIconSlot("homescreen_system_journal"),
  household: getIconSlot("homescreen_system_household"),
  media: getIconSlot("homescreen_system_media"),
  classroom: getIconSlot("homescreen_system_classroom"),
  workbench: getIconSlot("homescreen_system_workbench"),
  other: getIconSlot("homescreen_system_other"),
};

/** Spelled out, not interpolated — see the note at the top of this file. */
const TINT_CLASS: Record<TintColor | "", string> = {
  "": "border-line bg-paper-raised",
  rose: "clip-tint clip-tint-rose",
  amber: "clip-tint clip-tint-amber",
  sage: "clip-tint clip-tint-sage",
  ocean: "clip-tint clip-tint-ocean",
  indigo: "clip-tint clip-tint-indigo",
  slate: "clip-tint clip-tint-slate",
};

/** One module's row inside a panel. Plain data — the page holds the records. */
export interface HomeSystemPanelModule {
  slug: string;
  /** The module's short name, as an admin has it. */
  name: string;
  description?: string;
  /** The module's icon name — a DB column, so it arrives as a prop. */
  icon: string;
  href: string;
}

/**
 * The state of one system, where there is anything cheap to say.
 *
 * A discriminated union rather than a bag of optional fields: three systems have
 * a strip and each says something structurally different, so a shared shape
 * would be three sets of fields with two always blank.
 */
export type HomeSystemActivity =
  | {
      kind: "money";
      gainLossCents: number;
      changePct: number;
      /** Today's biggest risers and fallers by dollar impact, already ranked and capped. */
      gainers: HomeSystemMover[];
      losers: HomeSystemMover[];
    }
  | { kind: "todo"; lists: number; open: number; completed: number; total: number }
  | { kind: "journal"; entries: { id: number; date: string; title: string }[] }
  | {
      kind: "classroom";
      classes: {
        id: number;
        name: string;
        enrolledCount: number;
        meetsToday: boolean;
        /** Opens the home screen already on this class, ready for attendance. */
        href: string;
      }[];
    };

/** A button across the top of a panel — the one or two things the system is opened for. */
export interface HomeSystemAction {
  label: string;
  href: string;
  /** The panel's lead action takes the primary variant; the rest are secondary. */
  primary?: boolean;
}

/** One ticker's move today, as the Money panel lists it. */
export interface HomeSystemMover {
  ticker: string;
  name: string;
  gainLossCents: number;
  changePct: number;
}

export interface HomeSystemPanel {
  id: HomeSystemId;
  name: string;
  tagline: string;
  tint: TintColor | "";
  modules: HomeSystemPanelModule[];
  activity?: HomeSystemActivity;
  actions?: HomeSystemAction[];
}

/**
 * Red down, green up, neutral at zero — the same rule (and the same reason) as
 * the Daily Glance card: a flat day is not a win. Semantic colour, deliberately
 * not a theme token; design.md says so explicitly.
 */
function gainClass(cents: number): string {
  if (cents < 0) return "text-red-400";
  if (cents > 0) return "text-emerald-400";
  return "text-muted";
}

function signed(cents: number): string {
  return `${cents >= 0 ? "+" : ""}${formatCents(cents)}`;
}

function signedPct(pct: number): string {
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

/** The small pill at the right of a panel heading. */
function StatusChip({ text, className = "" }: { text: string; className?: string }) {
  return (
    <span
      className={`shrink-0 rounded-full border border-line px-2 py-0.5 text-xs whitespace-nowrap ${className}`}
    >
      {text}
    </span>
  );
}

function chipFor(
  activity: HomeSystemActivity | undefined,
): { text: string; className: string } | undefined {
  if (!activity) return undefined;
  if (activity.kind === "money") {
    return {
      text: `${signed(activity.gainLossCents)} today`,
      className: gainClass(activity.gainLossCents),
    };
  }
  if (activity.kind === "todo") {
    return {
      text: activity.open === 1 ? "1 open" : `${activity.open} open`,
      className: "text-muted",
    };
  }
  if (activity.kind === "classroom") {
    const today = activity.classes.filter((item) => item.meetsToday).length;
    return today > 0 ? { text: `${today} today`, className: "text-muted" } : undefined;
  }
  return {
    text:
      activity.entries.length === 1 ? "1 recent entry" : `${activity.entries.length} recent entries`,
    className: "text-muted",
  };
}

/** One ranked list of movers, with an honest line when there are none (a red day has no gainers). */
function MoverList({ title, movers }: { title: string; movers: HomeSystemMover[] }) {
  return (
    <div className="min-w-0">
      <h4 className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">{title}</h4>
      {movers.length === 0 ? (
        <p className="text-xs text-muted">None today.</p>
      ) : (
        <ul className="space-y-0.5 text-sm">
          {movers.map((mover) => (
            <li key={mover.ticker} className="flex items-baseline justify-between gap-2" title={mover.name}>
              <span className="truncate font-semibold">{mover.ticker}</span>
              <span className={`shrink-0 ${gainClass(mover.gainLossCents)}`}>
                {signed(mover.gainLossCents)}{" "}
                <span className="text-xs">({signedPct(mover.changePct)})</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ActivityStrip({ activity }: { activity: HomeSystemActivity }) {
  if (activity.kind === "money") {
    return (
      <div className="mt-3 border-t border-line pt-3 text-sm">
        <div>
          <span className="text-muted">Today&rsquo;s move</span>{" "}
          <span className={gainClass(activity.gainLossCents)}>
            {signed(activity.gainLossCents)} ({signedPct(activity.changePct)})
          </span>
        </div>
        {/* Stacked, not side by side: a row is a ticker plus a signed dollar figure and a
            percentage, which needs most of a panel's 18-24rem width, and the panel has
            vertical room to spare -- that is why the lists are here. */}
        <div className="mt-3 space-y-3">
          <MoverList title="Top gainers" movers={activity.gainers} />
          <MoverList title="Top losers" movers={activity.losers} />
        </div>
      </div>
    );
  }

  if (activity.kind === "todo") {
    return (
      <div className="mt-3 border-t border-line pt-3">
        <Progress3D
          label={
            activity.total === 0
              ? `${activity.lists === 1 ? "1 list" : `${activity.lists} lists`}, nothing on them yet`
              : `${activity.completed} of ${activity.total} done`
          }
          value={activity.completed}
          // A board with no items at all renders an empty track rather than
          // dividing by zero — `Progress3D` treats a `max` of 0 that way.
          max={activity.total}
          size="sm"
        />
      </div>
    );
  }

  if (activity.kind === "classroom") {
    return (
      <div className="mt-3 border-t border-line pt-3">
        <h4 className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">
          Take attendance for
        </h4>
        <ul className="space-y-1 text-sm">
          {activity.classes.map((item) => (
            <li key={item.id}>
              <Link
                href={item.href}
                className="flex items-baseline justify-between gap-2 rounded px-1 py-0.5 hover:bg-paper-raised"
              >
                <span className="truncate font-semibold">{item.name}</span>
                <span className="shrink-0 text-xs text-muted">
                  {item.meetsToday && <span className="mr-2 text-brass-dark">Today</span>}
                  {item.enrolledCount} {item.enrolledCount === 1 ? "student" : "students"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <ul className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
      {activity.entries.map((entry) => (
        <li key={entry.id}>
          <Link
            href={`/modules/journal/entries/${entry.id}`}
            className="flex items-baseline gap-2 rounded px-1 py-0.5 hover:bg-paper-raised"
          >
            <span className="shrink-0 font-mono text-xs text-muted">{entry.date}</span>
            <span className="truncate">{entry.title}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function SystemPanel({ panel }: { panel: HomeSystemPanel }) {
  const slot = SYSTEM_SLOTS[panel.id];
  const chip = chipFor(panel.activity);

  return (
    <section className={`rounded-2xl border p-4 ${TINT_CLASS[panel.tint]}`}>
      <header className="flex items-start gap-3">
        <span className="shrink-0 rounded-xl border border-line bg-paper p-2 text-brass">
          {slot && <SlotIcon slot={slot} className="h-5 w-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-display leading-tight font-semibold">{panel.name}</h3>
          <p className="text-xs text-muted">{panel.tagline}</p>
        </div>
        {chip && <StatusChip text={chip.text} className={chip.className} />}
      </header>

      {panel.actions && (
        <div className="mt-3 flex flex-wrap gap-2">
          {panel.actions.map((action) => (
            <Button
              key={action.href}
              href={action.href}
              size="sm"
              variant={action.primary ? "primary" : "secondary"}
            >
              {action.label}
            </Button>
          ))}
        </div>
      )}

      <ul className="mt-3 space-y-1">
        {panel.modules.map((appModule) => (
          <li key={appModule.slug}>
            <Link
              href={appModule.href}
              className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-paper-raised"
            >
              <span className="shrink-0 rounded-lg bg-brass-soft p-1.5 text-brass-dark">
                <ModuleIcon slug={appModule.slug} name={appModule.icon} className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{appModule.name}</span>
                {appModule.description && (
                  <span className="block truncate text-xs text-muted">{appModule.description}</span>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {panel.activity && <ActivityStrip activity={panel.activity} />}
    </section>
  );
}

export function HomeSystemsWidget({
  panels,
  className,
}: {
  panels: HomeSystemPanel[];
  className?: string;
}) {
  return (
    <CollapsibleCard
      title="Systems"
      titleIcon={SYSTEMS_SLOT && <SlotIcon slot={SYSTEMS_SLOT} className="h-4 w-4" />}
      className={className}
      defaultOpen
    >
      {/* `.card-grid`, not a per-breakpoint column count: the number of panels
          depends on what this reader can open, so the browser counts the columns
          and a lone panel stays panel-sized instead of inflating — design.md,
          "Collections size themselves". */}
      <div className="card-grid gap-4">
        {panels.map((panel) => (
          <SystemPanel key={panel.id} panel={panel} />
        ))}
      </div>
    </CollapsibleCard>
  );
}
