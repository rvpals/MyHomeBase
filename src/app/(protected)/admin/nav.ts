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
    id: "about",
    label: "About",
    href: "/admin/about",
    hint: "Version and information about this application",
    icon: "info",
  },
  {
    id: "change-history",
    label: "Change History",
    href: "/admin/history",
    hint: "View the project's change log",
    icon: "history",
  },
];
