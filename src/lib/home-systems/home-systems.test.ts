import { describe, expect, it } from "vitest";
import { TINT_COLORS } from "@/lib/shared/tint";
import { groupModulesBySystem } from "./home-systems";
import { HOME_SYSTEMS, type HomeSystem } from "./types";

/** The caller's shape, reduced to what the function actually reads. */
const mod = (slug: string) => ({ slug });

describe("HOME_SYSTEMS", () => {
  it("registers exactly one catch-all, so an unknown module always has somewhere to land", () => {
    expect(HOME_SYSTEMS.filter((system) => system.catchAll)).toHaveLength(1);
  });

  it("claims each slug once, so no module could be drawn twice", () => {
    const claimed = HOME_SYSTEMS.flatMap((system) => system.slugs);
    expect(new Set(claimed).size).toBe(claimed.length);
  });

  it("names a tint from the shared palette, or the plain surface", () => {
    // A literal colour here would look right on one theme and wrong on the other
    // eight — design.md, "Tinted surfaces".
    for (const system of HOME_SYSTEMS) {
      if (system.tint === "") continue;
      expect(TINT_COLORS as readonly string[], system.id).toContain(system.tint);
    }
  });

  it("gives every system a name and a tagline for the panel header", () => {
    for (const system of HOME_SYSTEMS) {
      expect(system.name.length, system.id).toBeGreaterThan(0);
      expect(system.tagline.length, system.id).toBeGreaterThan(0);
    }
  });

  it("keeps Classroom on its own", () => {
    // Asked for explicitly: it is a different audience from the household's tools.
    const classroom = HOME_SYSTEMS.find((system) => system.id === "classroom");
    expect(classroom?.slugs).toEqual(["classroom"]);
  });
});

describe("groupModulesBySystem", () => {
  it("clusters the shipped modules into their systems, in registry order", () => {
    const cards = groupModulesBySystem([
      mod("investments"),
      mod("journal"),
      mod("expense"),
      mod("classroom"),
    ]);

    expect(cards.map((card) => card.system.id)).toEqual(["money", "journal", "classroom"]);
    expect(cards[0].modules.map((m) => m.slug)).toEqual(["investments", "expense"]);
  });

  it("keeps the caller's order inside a panel, not the registry's", () => {
    // The web app passes modules sorted by `sequence`, which an admin can change.
    const cards = groupModulesBySystem([mod("expense"), mod("investments")]);
    expect(cards[0].modules.map((m) => m.slug)).toEqual(["expense", "investments"]);
  });

  it("drops a system no accessible module belongs to", () => {
    const cards = groupModulesBySystem([mod("journal")]);
    expect(cards).toHaveLength(1);
    expect(cards[0].system.id).toBe("journal");
  });

  it("returns nothing when the reader can open nothing", () => {
    expect(groupModulesBySystem([])).toEqual([]);
  });

  it("puts a module no system claims in the catch-all rather than losing it", () => {
    const cards = groupModulesBySystem([mod("brand-new-module")]);
    expect(cards.map((card) => card.system.id)).toEqual(["other"]);
    expect(cards[0].modules.map((m) => m.slug)).toEqual(["brand-new-module"]);
  });

  it("ignores a duplicated module instead of drawing it twice", () => {
    const cards = groupModulesBySystem([mod("journal"), mod("journal")]);
    expect(cards[0].modules).toHaveLength(1);
  });

  it("gives a slug claimed twice to the first system that claims it", () => {
    const systems: HomeSystem[] = [
      { id: "money", name: "Money", tagline: "a", tint: "ocean", slugs: ["journal"] },
      { id: "journal", name: "Journal", tagline: "b", tint: "rose", slugs: ["journal"] },
    ];
    const cards = groupModulesBySystem([mod("journal")], systems);
    expect(cards).toHaveLength(1);
    expect(cards[0].system.id).toBe("money");
  });

  it("drops unclaimed modules when no catch-all is registered", () => {
    // The failure path the shipped registry must never take — hence the test above
    // asserting a catch-all exists.
    const systems: HomeSystem[] = [
      { id: "money", name: "Money", tagline: "a", tint: "ocean", slugs: ["investments"] },
    ];
    const cards = groupModulesBySystem([mod("investments"), mod("nowhere")], systems);
    expect(cards).toHaveLength(1);
    expect(cards[0].modules.map((m) => m.slug)).toEqual(["investments"]);
  });
});
