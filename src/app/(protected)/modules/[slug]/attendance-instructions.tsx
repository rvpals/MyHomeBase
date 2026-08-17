// Per-section guidance for the Attendance module. Each section gets only the
// text that applies to it — the whole document above every screen is noise
// between the heading and the content.

import type { AttendanceSection } from "./attendance-sections";

export function AttendanceInstructions({ section }: { section: AttendanceSection }) {
  switch (section) {
    case "main":
      return (
        <p className="text-sm text-muted">
          Pick a class, then tap each student who is here — everyone starts absent. Press{" "}
          <strong className="text-ink">Save attendance</strong> to record the day. Saving again for
          the same class on the same day replaces that day&apos;s record rather than adding a
          second one.
        </p>
      );

    case "rosters":
      return (
        <p className="text-sm text-muted">
          Add students to the school-wide roster here. Only a first and last name are required. To
          put several students in a class at once, tick them in the grid and use{" "}
          <strong className="text-ink">Add to class</strong> in the toolbar. A student can be in as
          many classes as you like.
        </p>
      );

    case "classes":
      return (
        <p className="text-sm text-muted">
          Create a class, then use <strong className="text-ink">Students</strong> on its row to see
          who is in it and add more from the roster. Deleting a class leaves its saved attendance
          intact — past reports keep the class name they were taken under.
        </p>
      );

    case "report":
      return (
        <p className="text-sm text-muted">
          Pick a class and a date to see who was present and who was absent, then press{" "}
          <strong className="text-ink">Print</strong>. Names are shown as they were when attendance
          was taken, so a later rename doesn&apos;t change an old report.
        </p>
      );

    case "configuration":
      return (
        <p className="text-sm text-muted">
          Set the class the home screen opens on, and whether the report starts on today&apos;s
          date.
        </p>
      );

    default:
      return null;
  }
}
