import { describe, expect, it } from "vitest";
import type { HomeWidgetId } from "@/lib/home-dashboard";
import {
  applyHiddenWidgets,
  hiddenHomeWidgetsToValue,
  hideHomeWidget,
  orderWithHiddenPreserved,
  resolveHiddenHomeWidgets,
} from "./home-layout";

describe("resolveHiddenHomeWidgets", () => {
  it("reads a stored list", () => {
    expect(resolveHiddenHomeWidgets("dailyQuote,todo")).toEqual(["dailyQuote", "todo"]);
  });

  it("tolerates surrounding whitespace and empty tokens", () => {
    expect(resolveHiddenHomeWidgets(" dailyQuote , , todo ")).toEqual(["dailyQuote", "todo"]);
  });

  it("resolves an unset or blank value to nothing closed", () => {
    expect(resolveHiddenHomeWidgets(undefined)).toEqual([]);
    expect(resolveHiddenHomeWidgets("")).toEqual([]);
    expect(resolveHiddenHomeWidgets("   ")).toEqual([]);
  });

  // The failure path that matters: a card retired from the catalogue must not leave a
  // stored value unreadable, or an upgrade would strand the reader with a home screen
  // they cannot fix from the UI.
  it("drops an id that is no longer a card", () => {
    expect(resolveHiddenHomeWidgets("dailyQuote,clock,nonsense")).toEqual(["dailyQuote"]);
  });

  it("collapses duplicates", () => {
    expect(resolveHiddenHomeWidgets("todo,todo")).toEqual(["todo"]);
  });

  it("resolves to nothing closed when no token survives", () => {
    expect(resolveHiddenHomeWidgets("clock,nonsense")).toEqual([]);
  });
});

describe("hiddenHomeWidgetsToValue", () => {
  it("round-trips through the reader", () => {
    const hidden: HomeWidgetId[] = ["dailyQuote", "todo"];
    expect(resolveHiddenHomeWidgets(hiddenHomeWidgetsToValue(hidden))).toEqual(hidden);
  });

  it("writes blank for nothing closed — the value Reset layout stores", () => {
    expect(hiddenHomeWidgetsToValue([])).toBe("");
  });
});

describe("hideHomeWidget", () => {
  it("adds a card to the closed set", () => {
    expect(hideHomeWidget([], "todo")).toEqual(["todo"]);
    expect(hideHomeWidget(["dailyQuote"], "todo")).toEqual(["dailyQuote", "todo"]);
  });

  // A `✕` pressed on a stale page is an ordinary gesture, not an error — and storing
  // the id twice would trip the schema's no-duplicates refinement on the next save.
  it("is idempotent, returning the list unchanged for an already-closed card", () => {
    const hidden: HomeWidgetId[] = ["todo"];
    expect(hideHomeWidget(hidden, "todo")).toBe(hidden);
  });

  it("does not mutate the list it is given", () => {
    const hidden: HomeWidgetId[] = ["todo"];
    hideHomeWidget(hidden, "dailyQuote");
    expect(hidden).toEqual(["todo"]);
  });
});

describe("applyHiddenWidgets", () => {
  const visible: HomeWidgetId[] = ["carousel", "dailyQuote", "todo"];

  it("removes the closed cards", () => {
    expect(applyHiddenWidgets(visible, ["dailyQuote"])).toEqual(["carousel", "todo"]);
  });

  it("returns the list untouched when nothing is closed", () => {
    expect(applyHiddenWidgets(visible, [])).toBe(visible);
  });

  it("can close every card", () => {
    expect(applyHiddenWidgets(visible, [...visible])).toEqual([]);
  });

  // The rule the whole feature rests on: this subtracts, it never adds. A card an
  // admin hid is absent from `visible` and must stay absent whatever is stored here.
  it("cannot resurrect a card that is not being drawn today", () => {
    expect(applyHiddenWidgets(["carousel"], ["stockGlance"])).toEqual(["carousel"]);
  });

  it("ignores a closed id for a card that is not drawn", () => {
    expect(applyHiddenWidgets(visible, ["stockGlance"])).toEqual(visible);
  });

  it("preserves the order it is given", () => {
    expect(applyHiddenWidgets(["todo", "carousel", "dailyQuote"], ["carousel"])).toEqual([
      "todo",
      "dailyQuote",
    ]);
  });
});

describe("orderWithHiddenPreserved", () => {
  // The case the function exists for: a card is closed, the reader then drags the
  // cards that are left, and the closed card must not lose the place it had.
  it("keeps a closed card after the card it followed", () => {
    expect(
      orderWithHiddenPreserved(
        ["todo", "carousel"],
        ["carousel", "dailyQuote", "todo"],
        ["dailyQuote"],
      ),
    ).toEqual(["todo", "carousel", "dailyQuote"]);
  });

  it("puts a closed card back at the front when nothing preceded it", () => {
    expect(
      orderWithHiddenPreserved(
        ["carousel", "todo"],
        ["dailyQuote", "carousel", "todo"],
        ["dailyQuote"],
      ),
    ).toEqual(["dailyQuote", "carousel", "todo"]);
  });

  // Walking the stored order forwards is what makes this work: `carousel` is already
  // back in the list by the time `dailyQuote` looks for its predecessor.
  it("keeps a run of adjacent closed cards in their stored order", () => {
    expect(
      orderWithHiddenPreserved(
        ["todo"],
        ["carousel", "dailyQuote", "todo"],
        ["carousel", "dailyQuote"],
      ),
    ).toEqual(["carousel", "dailyQuote", "todo"]);
  });

  it("returns the visible order untouched when nothing is closed", () => {
    const visible: HomeWidgetId[] = ["carousel", "todo"];
    expect(orderWithHiddenPreserved(visible, ["carousel", "todo"], [])).toBe(visible);
  });

  // A reader who has never dragged has no stored positions to preserve, so there is
  // nothing to fold in and the visible order stands on its own.
  it("returns the visible order untouched when there is no stored order", () => {
    const visible: HomeWidgetId[] = ["carousel", "todo"];
    expect(orderWithHiddenPreserved(visible, [], ["dailyQuote"])).toBe(visible);
  });

  it("does not duplicate a closed card already present in the visible order", () => {
    expect(
      orderWithHiddenPreserved(
        ["carousel", "dailyQuote"],
        ["carousel", "dailyQuote"],
        ["dailyQuote"],
      ),
    ).toEqual(["carousel", "dailyQuote"]);
  });

  it("ignores a closed id that is not in the stored order", () => {
    expect(
      orderWithHiddenPreserved(["carousel", "todo"], ["carousel", "todo"], ["stockGlance"]),
    ).toEqual(["carousel", "todo"]);
  });
});
