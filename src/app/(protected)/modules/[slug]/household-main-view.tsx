"use client";

import Link from "next/link";
import { SlotIcon } from "@/components/slot-icon";
import { getIconSlot } from "@/lib/icons";
import { PAGE_CONTAINER } from "../../page-container";

// The Household landing screen: a card per half of the module.
//
// A client component only because `SlotIcon` reads the reader's icon overrides from
// context. There is no state and no fetching here — every link is a plain
// `next/link`, and the one number it shows arrives as a prop.

// Looked up once at module scope, as every other SlotIcon caller does. `getIconSlot`
// returns undefined for an unregistered id, so each use is guarded rather than
// asserted — an icon that fails to resolve should cost a glyph, not the screen.
const RECIPES_SLOT = getIconSlot("household_section_recipes_group");
const HSA_SLOT = getIconSlot("household_section_hsa_group");

/**
 * One card per submodule.
 *
 * Deliberately NOT a navigation component: these are content links on a page, the
 * same way the Tools dashboard lists its two utilities. The module's real
 * navigation is the shell's tree (desktop) and the shared bottom bar (compact),
 * and neither is rebuilt here — design.md, *There is no second navigation system*.
 */
function HalfCard({
  href,
  slot,
  title,
  blurb,
  detail,
}: {
  href: string;
  slot: ReturnType<typeof getIconSlot>;
  title: string;
  blurb: string;
  detail: string;
}) {
  return (
    <Link
      href={href}
      className="card-raised flex flex-col gap-2 rounded-xl border border-line p-4 transition-colors hover:border-brass"
    >
      <div className="flex items-center gap-2">
        {slot && <SlotIcon slot={slot} className="h-5 w-5 text-brass" />}
        <h2 className="font-display text-lg text-ink">{title}</h2>
      </div>
      <p className="text-sm text-muted">{blurb}</p>
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{detail}</p>
    </Link>
  );
}

export function HouseholdMainView({ recipeCount }: { recipeCount: number }) {
  return (
    <div className={PAGE_CONTAINER}>
      {/* Two across on a wide screen, stacked on a phone. `max-lg:` first, so the
          desktop classes are untouched and a wide screen provably can't regress. */}
      <div className="grid grid-cols-2 gap-4 max-lg:grid-cols-1">
        <HalfCard
          href="/modules/household/recipes"
          slot={RECIPES_SLOT}
          title="Recipes"
          blurb="The recipe box — what to cook, how you made it last time, and how it went."
          detail={`${recipeCount} ${recipeCount === 1 ? "recipe" : "recipes"}`}
        />
        <HalfCard
          href="/modules/household/hsa"
          slot={HSA_SLOT}
          title="HSA Tracker"
          blurb="Health savings account contributions and claims."
          detail="Not built yet"
        />
      </div>
    </div>
  );
}
