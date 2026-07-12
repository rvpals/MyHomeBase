import type { TreeNode } from "@/components/tree-nav";

export const adminNav: TreeNode[] = [
  {
    id: "configuration",
    label: "Configuration",
    children: [
      {
        id: "configuration-modules",
        label: "Module Configuration",
        href: "/admin/configuration/modules",
        hint: "Configuration of modules in the application",
      },
      {
        id: "configuration-application",
        label: "Application Configuration",
        href: "/admin/configuration/application",
        hint: "General settings that apply across the application",
      },
      {
        id: "configuration-themes",
        label: "Color Themes",
        href: "/admin/configuration/themes",
        hint: "Change color theme for the application",
      },
    ],
  },
  {
    id: "about",
    label: "About",
    href: "/admin/about",
    hint: "Version and information about this application",
  },
];
