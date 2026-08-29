import type { SectionNode } from "@/components/section-panel";

export const adminNav: SectionNode[] = [
  {
    id: "configuration",
    label: "Configuration",
    icon: "sliders",
    children: [
      {
        id: "configuration-modules",
        label: "Module Configuration",
        href: "/admin/configuration/modules",
        hint: "Configuration of modules in the application",
        icon: "grid",
      },
      {
        id: "configuration-application",
        label: "Application Configuration",
        href: "/admin/configuration/application",
        hint: "General settings that apply across the application",
        icon: "window",
      },
    ],
  },
  {
    // Heading only, like `configuration` above -- the three appearance screens live
    // here, but there is no Display Settings page to link to.
    //
    // The child ids stay `configuration-*` on purpose. `SectionPanel` derives each
    // icon slot id from the id, so renaming these to `display-settings-*` would
    // orphan any icon already uploaded for those positions. Their routes stay under
    // /admin/configuration/ for the same reason: this is a regrouping of the nav,
    // not a move of the screens.
    id: "display-settings",
    label: "Display Settings",
    icon: "palette",
    children: [
      {
        id: "configuration-themes",
        label: "Color Themes",
        href: "/admin/configuration/themes",
        hint: "Change color theme for the application",
        icon: "palette",
      },
      {
        id: "configuration-icons",
        label: "Icons",
        href: "/admin/configuration/icons",
        hint: "Change the module icon set for the application",
        icon: "shapes",
      },
      {
        id: "configuration-texture",
        label: "Dashboard Texture",
        href: "/admin/configuration/texture",
        hint: "Set an optional background picture for the home dashboard",
        icon: "palette",
      },
      {
        // A fresh id, so unlike its siblings above it needs no `configuration-`
        // legacy: nothing has ever been uploaded against its icon slot.
        id: "display-settings-widgets",
        label: "Dashboard Widgets",
        href: "/admin/display-settings/widgets",
        hint: "Choose which cards the home screen shows, and in what order",
        icon: "grid",
      },
    ],
  },
  {
    id: "user-management",
    label: "User Management",
    href: "/admin/user-management",
    hint: "Manage users, roles, and module access",
    icon: "users",
  },
  {
    id: "daily-quote",
    label: "Daily Quote",
    href: "/admin/daily-quote",
    hint: "Manage the inspirational quotes shown on the home screen",
    icon: "quote",
    children: [
      {
        id: "daily-quote-add",
        label: "Add Quote",
        href: "/admin/daily-quote/add",
        hint: "Add a single quote by hand",
        icon: "plus",
      },
      {
        id: "daily-quote-import",
        label: "Import from Newsletter",
        href: "/admin/daily-quote/import",
        hint: "Paste a 3-2-1 issue and import the quotes it contains",
        icon: "newspaper",
      },
    ],
  },
  {
    id: "security",
    label: "Security",
    href: "/admin/security",
    hint: "Sign-in history and failed login attempts",
    icon: "shield",
  },
  {
    id: "background-tasks",
    label: "Background Tasks",
    href: "/admin/background-tasks",
    hint: "What the server runs on a timer, and when each job last ran",
    // `history`, not `clock` -- there is no clock glyph in the baked icon sets, and
    // this screen is a run log as much as a scheduler. Present in every set.
    icon: "history",
  },
  {
    id: "sql-explorer",
    label: "SQL Explorer",
    href: "/admin/sql-explorer",
    hint: "Run read-only or ad-hoc SQL against the application database",
    icon: "database",
  },
  {
    id: "about",
    label: "About",
    href: "/admin/about",
    hint: "Version, system information, and the project's change log",
    icon: "info",
  },
];
