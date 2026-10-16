// The Classroom module's section list and metadata.
//
// Deliberately NOT a "use client" module: server components (the section pages
// and the shell) read these values directly. Exporting them from the client nav
// module instead would hand the server client-reference proxies rather than the
// real objects, so a lookup like CLASSROOM_SECTION_INFO[section] would come back
// undefined. Same reasoning as journal-sections.ts and household-sections.ts.
//
// Classroom carries two groups, Attendance and Exam, because the nav tree is two
// levels deep by design (src/lib/navigation/types.ts: TreeSection.group is a flat
// string, "a *rendering* of this field, not a second level of data"). A module
// cannot contain a module, so Attendance is a section *group* here rather than a
// module of its own — migration 0143 records the whole reasoning. Household does
// the same with Recipes + HSA Tracker.
//
// The section slugs are unchanged from the old Attendance module on purpose: the
// hrefs move from /modules/attendance/* to /modules/classroom/*, but `rosters`
// stays `rosters`. SectionPanel derives each icon slot id from the slug, so
// renaming one would orphan any uploaded override.

export const CLASSROOM_SECTIONS = [
  "main",
  "rosters",
  "classes",
  "actions",
  "edit",
  "report",
  "configuration",
  "exam",
  "exam-maker",
  "exam-grader",
] as const;

export type ClassroomSection = (typeof CLASSROOM_SECTIONS)[number];

/**
 * The Attendance group's sections, in nav order.
 *
 * `main` is deliberately absent: it is the module root, which sits above both
 * groups rather than inside either. Household's groups make the same split.
 */
export const CLASSROOM_ATTENDANCE_SECTIONS = [
  "rosters",
  "classes",
  "actions",
  "edit",
  "report",
  "configuration",
] as const satisfies readonly ClassroomSection[];

/**
 * The Exam group's sections.
 *
 * One placeholder today. Declared as a list for the reason Household's are: the
 * real Exam screens are strings here plus a route branch, with no navigation work.
 */
export const CLASSROOM_EXAM_SECTIONS = [
  "exam",
  "exam-maker",
  "exam-grader",
] as const satisfies readonly ClassroomSection[];

export function isClassroomSection(value: string): value is ClassroomSection {
  return (CLASSROOM_SECTIONS as readonly string[]).includes(value);
}

/** Title and one-line description, used in the nav and as the page heading. */
export const CLASSROOM_SECTION_INFO: Record<
  ClassroomSection,
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
  edit: {
    label: "Edit records",
    description: "Open a past day's register and correct it.",
  },
  report: {
    label: "Report",
    description: "Print a class's attendance for a day.",
  },
  configuration: {
    label: "Configuration",
    description: "Preferences for how attendance works.",
  },
  exam: {
    label: "Exams",
    description: "Every exam you have built, ready to edit or print.",
  },
  "exam-maker": {
    label: "Exam Maker",
    description: "Create an exam and record its answer key.",
  },
  "exam-grader": {
    label: "Grader",
    description: "Scan completed answer sheets and grade them against the key.",
  },
};

/** Section → nav icon key, resolved by TreeIcon. */
export const CLASSROOM_SECTION_ICONS: Record<ClassroomSection, string> = {
  main: "grid",
  rosters: "users",
  // `classroom` rather than `list`: Rosters is already the list of people, so
  // two list glyphs in one nav read as the same idea twice.
  classes: "classroom",
  // `sliders` rather than `gear`: this is a set of adjustable values, where
  // Configuration *is* configuration. The distinction components.md draws.
  actions: "sliders",
  // `pencil` rather than another `classroom`/`list`: this section is the one
  // place a saved day is changed, and no other slot in the registry claims the
  // concept — so the glyph reads as "edit" without doubling up on a nav that
  // already has a grid, a roster, a classroom, a set of sliders and a chart.
  edit: "pencil",
  report: "chart",
  configuration: "gear",
  // `clipboard`: a test paper on a board. Deliberately not `pencil` (Edit records
  // holds that) nor `chart` (Report does). There is no `check` or `exam` tree
  // concept — an unknown key renders nothing rather than falling back.
  exam: "clipboard",
  // `note`: the thing you start a new exam from. tree-icons.tsx draws it as "a
  // jotting you start from", which is exactly the maker's job, and it keeps the
  // list (clipboard) and the editor visually distinct in one nav.
  "exam-maker": "note",
  // `magic`: hand it a stack of scans and it produces grades. The same concept Music
  // Magic and the gallery's Magic List use for "conjure a result from some input",
  // which is what makes it read as the same idea across modules.
  "exam-grader": "magic",
};

/** The group headings' own labels, hints and icons. Not destinations. */
export const CLASSROOM_GROUPS = {
  attendance: {
    // `attendance-group`, not `attendance`: a heading and a section must not share
    // an id, because SectionPanel derives each node's icon slot from it. Household's
    // `recipes-group` and Journal's `locations-group` record the same collision.
    id: "attendance-group",
    label: "Attendance",
    hint: "Daily registers for a class.",
    // `calendar`: attendance is a per-day register, and the date is what the group
    // is organised around.
    //
    // Two glyphs this is deliberately NOT. `roster` is a MODULE icon name (this
    // module's own) and nothing here resolves against that table — an unknown tree
    // key renders nothing rather than falling back, the trap Household's
    // `receipt`/`wallet` comment records. And `classroom` already belongs to the
    // `classes` section below, whose own comment in tree-icons.tsx explains it was
    // drawn so "Classes" and "Rosters" don't read as the same idea in one nav —
    // reusing it on the heading above them would undo exactly that.
    icon: "calendar",
  },
  exam: {
    id: "exam-group",
    label: "Exam",
    hint: "Tests, answer keys and grading.",
    // `clipboard`, matching the section below it — the group has one child today, so
    // a second concept here would be a distinction without a difference.
    icon: "clipboard",
  },
} as const;

const BASE_PATH = "/modules/classroom";

/** The home screen is the module root; every other section is a child route. */
export function classroomSectionHref(section: ClassroomSection): string {
  return section === "main" ? BASE_PATH : `${BASE_PATH}/${section}`;
}
