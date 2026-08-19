// The Attendance module's section list and metadata.
//
// Deliberately NOT a "use client" module: server components (the section pages
// and the shell) read these values directly. Exporting them from the client nav
// module instead would hand the server client-reference proxies rather than the
// real objects, so a lookup like ATTENDANCE_SECTION_INFO[section] would come
// back undefined. Same reasoning as journal-sections.ts and expense-sections.ts.

export const ATTENDANCE_SECTIONS = [
  "main",
  "rosters",
  "classes",
  "actions",
  "report",
  "configuration",
] as const;

export type AttendanceSection = (typeof ATTENDANCE_SECTIONS)[number];

export function isAttendanceSection(value: string): value is AttendanceSection {
  return (ATTENDANCE_SECTIONS as readonly string[]).includes(value);
}

/** Title and one-line description, used in the nav and as the page heading. */
export const ATTENDANCE_SECTION_INFO: Record<
  AttendanceSection,
  { label: string; description: string }
> = {
  main: {
    label: "Home screen",
    description: "Pick a class and take today's attendance.",
  },
  rosters: {
    label: "Rosters",
    description: "Add students and enroll them into a class.",
  },
  classes: {
    label: "Classes",
    description: "Create classes and manage who is in them.",
  },
  actions: {
    label: "Student actions",
    description: "The list of things you can note about a student on the day.",
  },
  report: {
    label: "Report",
    description: "Print a class's attendance for a day.",
  },
  configuration: {
    label: "Configuration",
    description: "Preferences for how attendance works.",
  },
};

/** Section → nav icon key, resolved by TreeIcon. */
export const ATTENDANCE_SECTION_ICONS: Record<AttendanceSection, string> = {
  main: "grid",
  rosters: "users",
  // `classroom` rather than `list`: Rosters is already the list of people, so
  // two list glyphs in one nav read as the same idea twice.
  classes: "classroom",
  // `sliders` rather than `gear`: this is a set of adjustable values, where
  // Configuration *is* configuration. The distinction components.md draws.
  actions: "sliders",
  report: "chart",
  configuration: "gear",
};

const BASE_PATH = "/modules/attendance";

/** The home screen is the module root; every other section is a child route. */
export function attendanceSectionHref(section: AttendanceSection): string {
  return section === "main" ? BASE_PATH : `${BASE_PATH}/${section}`;
}
