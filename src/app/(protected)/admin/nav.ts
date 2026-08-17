import type { TreeNode } from "@/components/tree-nav";

export const adminNav: TreeNode[] = [
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
