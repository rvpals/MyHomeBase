import { describe, expect, it } from "vitest";
import type { SectionNode } from "@/components/section-panel";
import { ADMIN_TREE_MODULE, flattenAdminNav } from "./admin-tree-module";

describe("flattenAdminNav", () => {
  it("carries the heading's label, href and icon onto every child", () => {
    const nodes: SectionNode[] = [
      {
        id: "daily-quote",
        label: "Daily Quote",
        href: "/admin/daily-quote",
        icon: "quote",
        children: [
          { id: "daily-quote-list", label: "All Quotes", href: "/admin/daily-quote" },
          { id: "daily-quote-add", label: "Add Quote", href: "/admin/daily-quote/add" },
        ],
      },
    ];

    expect(flattenAdminNav(nodes)).toEqual([
      {
        id: "daily-quote-list",
        label: "All Quotes",
        href: "/admin/daily-quote",
        hint: undefined,
        icon: undefined,
        group: "Daily Quote",
        groupHref: "/admin/daily-quote",
        groupIcon: "quote",
      },
      {
        id: "daily-quote-add",
        label: "Add Quote",
        href: "/admin/daily-quote/add",
        hint: undefined,
        icon: undefined,
        group: "Daily Quote",
        groupHref: "/admin/daily-quote",
        groupIcon: "quote",
      },
    ]);
  });

  it("leaves groupHref undefined for a heading that is not itself a page", () => {
    // "Configuration" and "Display Settings" are pure headings — there is no
    // /admin/configuration route. Their boxes render an unclickable header, so
    // an href invented here would be a link to a 404.
    const nodes: SectionNode[] = [
      {
        id: "configuration",
        label: "Configuration",
        icon: "sliders",
        children: [
          { id: "configuration-modules", label: "Module Configuration", href: "/admin/x" },
        ],
      },
    ];

    const [section] = flattenAdminNav(nodes);
    expect(section.group).toBe("Configuration");
    expect(section.groupHref).toBeUndefined();
    expect(section.groupIcon).toBe("sliders");
  });

  it("keeps a top-level destination ungrouped", () => {
    const nodes: SectionNode[] = [
      { id: "security", label: "Security", href: "/admin/security", icon: "shield" },
    ];

    const [section] = flattenAdminNav(nodes);
    expect(section.group).toBeUndefined();
    expect(section.href).toBe("/admin/security");
  });

  it("drops a heading with neither an href nor children", () => {
    // A label with no rows under it. `adminNav` uses hrefless nodes as pure
    // headings, so one with nothing beneath is a heading of nothing.
    expect(flattenAdminNav([{ id: "empty", label: "Empty" }])).toEqual([]);
  });

  it("drops a child with no href", () => {
    const nodes: SectionNode[] = [
      {
        id: "group",
        label: "Group",
        children: [
          { id: "real", label: "Real", href: "/admin/real" },
          { id: "labelled", label: "Labelled" },
        ],
      },
    ];

    expect(flattenAdminNav(nodes).map((s) => s.id)).toEqual(["real"]);
  });

  it("keeps each group's children adjacent, so a group draws as one box", () => {
    // `NavTree` splits sections into runs by *adjacency*, not by label — a group
    // interrupted and resumed would draw as two boxes. Real `adminNav`.
    const groups = ADMIN_TREE_MODULE.sections.map((section) => section.group);
    const runs = groups.filter((group, index) => group !== groups[index - 1]);
    const named = runs.filter((group): group is string => group !== undefined);

    expect(new Set(named).size).toBe(named.length);
  });
});
